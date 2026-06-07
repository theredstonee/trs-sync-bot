import {
  ChannelType,
  type Client,
  type Guild,
  type GuildChannel,
  type NonThreadGuildBasedChannel,
  type TextChannel,
} from 'discord.js';
import {
  addChannelMapping,
  deleteChannelMapping,
  deleteCustomName,
  getActiveSyncPairs,
  getChannelMappingByChannel,
  getChannelMappingBySource,
  getChannelMappingsBySync,
  getCustomName,
  getSyncPair,
  getSyncPairByTargetCategory,
  setCustomName,
  setTargetCategoryName,
  type SyncPair,
} from '../database/db.js';
import {
  buildCreateOptions,
  ensureWebhook,
  SYNCED_CHANNEL_TYPES,
} from './channels.js';
import { isChannelUpdateSuppressed, suppressChannelUpdate } from './state.js';
import { log } from '../util/logger.js';

/* ------------------------- helpers ------------------------- */

function activePairForSourceChannel(channel: GuildChannel): SyncPair | undefined {
  for (const pair of getActiveSyncPairs()) {
    if (
      pair.source_guild_id === channel.guild.id &&
      channel.parentId === pair.source_category_id
    ) {
      return pair;
    }
  }
  return undefined;
}

function targetGuild(client: Client, pair: SyncPair): Guild | undefined {
  if (!pair.target_guild_id) return undefined;
  return client.guilds.cache.get(pair.target_guild_id);
}

/* ------------------- A -> B: channel created ------------------- */

export async function handleSourceChannelCreate(channel: GuildChannel): Promise<void> {
  if (!SYNCED_CHANNEL_TYPES.has(channel.type)) return;

  const pair = activePairForSourceChannel(channel);
  if (!pair || !pair.target_category_id) return;

  // Already mapped? (e.g. duplicate event)
  if (getChannelMappingBySource(pair.sync_id, channel.id)) return;

  const guildB = targetGuild(channel.client, pair);
  if (!guildB) return;

  await createMirrorChannel(pair, channel as NonThreadGuildBasedChannel, guildB);
  await syncPositions(channel.client, pair.sync_id);
}

async function createMirrorChannel(
  pair: SyncPair,
  source: NonThreadGuildBasedChannel,
  guildB: Guild,
): Promise<void> {
  try {
    const opts = buildCreateOptions(source, source.name, pair.target_category_id!);
    const created = await guildB.channels.create(opts);
    suppressChannelUpdate(created.id);

    const sourceWh = await ensureWebhook(source);
    const targetWh = await ensureWebhook(created);

    addChannelMapping({
      syncId: pair.sync_id,
      sourceChannelId: source.id,
      targetChannelId: created.id,
      channelType: source.type,
      sourceWebhookId: sourceWh?.id ?? null,
      sourceWebhookToken: sourceWh?.token ?? null,
      targetWebhookId: targetWh?.id ?? null,
      targetWebhookToken: targetWh?.token ?? null,
    });

    log.info(`[${pair.sync_id}] Mirrored new channel #${source.name} -> ${guildB.name}`);
  } catch (err) {
    log.error('Failed to create mirror channel:', err);
  }
}

/* ------------------- A -> B: channel deleted ------------------- */

export async function handleSourceChannelDelete(channel: GuildChannel): Promise<void> {
  const mapping = getChannelMappingByChannel(channel.id);
  if (!mapping) return;
  // Only act when the SOURCE side was deleted.
  if (mapping.source_channel_id !== channel.id) return;

  const pair = getSyncPair(mapping.sync_id);
  if (!pair) return;

  const guildB = targetGuild(channel.client, pair);
  const target = guildB?.channels.cache.get(mapping.target_channel_id);
  if (target) {
    suppressChannelUpdate(target.id);
    try {
      await target.delete('TRS structure sync: source channel deleted');
    } catch (err) {
      log.error('Failed to delete mirror channel:', err);
    }
  }

  deleteCustomName(mapping.target_channel_id);
  deleteChannelMapping(mapping.id);
  log.info(`[${pair.sync_id}] Removed mirror for deleted source channel ${channel.id}`);
}

/* ------------------- A -> B: channel updated ------------------- */

export async function handleSourceChannelUpdate(
  oldChannel: GuildChannel,
  newChannel: GuildChannel,
): Promise<void> {
  const mapping = getChannelMappingByChannel(newChannel.id);
  if (!mapping || mapping.source_channel_id !== newChannel.id) return;

  const pair = getSyncPair(mapping.sync_id);
  if (!pair) return;
  const guildB = targetGuild(newChannel.client, pair);
  const target = guildB?.channels.cache.get(mapping.target_channel_id) as
    | GuildChannel
    | undefined;
  if (!target) return;

  const edits: Record<string, unknown> = {};

  // Name — but ONLY if the target has no user-defined custom name.
  if (oldChannel.name !== newChannel.name) {
    const custom = getCustomName(mapping.target_channel_id);
    if (!custom) {
      edits.name = newChannel.name;
    } else {
      log.debug(`[${pair.sync_id}] Skipping name sync; target has custom name "${custom.custom_name}".`);
    }
  }

  // Topic + slowmode for text-like channels
  const oldT = oldChannel as unknown as Partial<TextChannel>;
  const newT = newChannel as unknown as Partial<TextChannel>;
  if ('topic' in newChannel && oldT.topic !== newT.topic) {
    edits.topic = newT.topic ?? null;
  }
  if ('rateLimitPerUser' in newChannel && oldT.rateLimitPerUser !== newT.rateLimitPerUser) {
    edits.rateLimitPerUser = newT.rateLimitPerUser ?? 0;
  }

  if (Object.keys(edits).length > 0) {
    suppressChannelUpdate(target.id);
    try {
      await target.edit({ ...edits, reason: 'TRS structure sync' });
    } catch (err) {
      log.error('Failed to apply structure edit to mirror channel:', err);
    }
  }

  // Position change -> reorder the whole mirrored category to match source order.
  if (oldChannel.rawPosition !== newChannel.rawPosition) {
    await syncPositions(newChannel.client, pair.sync_id);
  }
}

/* --------- B side: detect user rename / category protection --------- */

/**
 * Called for channelUpdate on the TARGET side. Stores user renames as custom names,
 * and resets the synced category if it was renamed outside of the bot command.
 */
export async function handleTargetChannelUpdate(
  oldChannel: GuildChannel,
  newChannel: GuildChannel,
): Promise<boolean> {
  // 1) Is it the protected mirror category?
  const catPair = getSyncPairByTargetCategory(newChannel.id);
  if (catPair) {
    if (isChannelUpdateSuppressed(newChannel.id)) return true;
    if (oldChannel.name !== newChannel.name && newChannel.name !== catPair.target_category_name) {
      // Category may only be renamed via /sync rename-category -> revert.
      suppressChannelUpdate(newChannel.id);
      try {
        await newChannel.edit({
          name: catPair.target_category_name ?? oldChannel.name,
          reason: 'TRS: category rename only allowed via command',
        });
        log.info(`[${catPair.sync_id}] Reverted unauthorized category rename on target.`);
      } catch (err) {
        log.error('Failed to revert category rename:', err);
      }
    }
    return true;
  }

  // 2) Is it a mapped target channel that a user renamed?
  const mapping = getChannelMappingByChannel(newChannel.id);
  if (!mapping || mapping.target_channel_id !== newChannel.id) return false;

  if (isChannelUpdateSuppressed(newChannel.id)) return true; // bot-caused, ignore

  if (oldChannel.name !== newChannel.name) {
    setCustomName(mapping.sync_id, newChannel.id, newChannel.name);
    log.info(
      `[${mapping.sync_id}] Stored custom name "${newChannel.name}" for target channel ${newChannel.id}; ` +
        `it will no longer be overwritten by source renames.`,
    );
  }
  return true;
}

/* ----------------------- position syncing ----------------------- */

/** Re-orders the mirrored category's children to match the source category order. */
export async function syncPositions(client: Client, syncId: string): Promise<void> {
  const pair = getSyncPair(syncId);
  if (!pair || pair.active !== 1 || !pair.target_guild_id) return;

  const guildA = client.guilds.cache.get(pair.source_guild_id);
  const guildB = client.guilds.cache.get(pair.target_guild_id);
  if (!guildA || !guildB) return;

  const sourceChildren = [...guildA.channels.cache.values()]
    .filter((c): c is NonThreadGuildBasedChannel => c.parentId === pair.source_category_id)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const positions: Array<{ channel: string; position: number }> = [];
  sourceChildren.forEach((ch, index) => {
    const map = getChannelMappingBySource(syncId, ch.id);
    if (map && guildB.channels.cache.has(map.target_channel_id)) {
      positions.push({ channel: map.target_channel_id, position: index });
    }
  });

  if (positions.length === 0) return;
  positions.forEach((p) => suppressChannelUpdate(p.channel));
  try {
    await guildB.channels.setPositions(positions);
  } catch (err) {
    log.error('Failed to sync channel positions:', err);
  }
}

/* --------------------- used by /sync rename-* -------------------- */

export async function applyCustomChannelName(
  client: Client,
  syncId: string,
  targetChannelId: string,
  newName: string,
): Promise<void> {
  const pair = getSyncPair(syncId);
  if (!pair?.target_guild_id) throw new Error('Sync not active.');
  const guildB = client.guilds.cache.get(pair.target_guild_id);
  const channel = guildB?.channels.cache.get(targetChannelId) as GuildChannel | undefined;
  if (!channel) throw new Error('Target channel not found.');

  setCustomName(syncId, targetChannelId, newName);
  suppressChannelUpdate(targetChannelId);
  await channel.edit({ name: newName, reason: 'TRS: custom name via command' });
}

export async function applyCategoryRename(
  client: Client,
  pair: SyncPair,
  newName: string,
): Promise<void> {
  if (!pair.target_guild_id || !pair.target_category_id) throw new Error('Sync not active.');
  const guildB = client.guilds.cache.get(pair.target_guild_id);
  const category = guildB?.channels.cache.get(pair.target_category_id) as
    | GuildChannel
    | undefined;
  if (!category) throw new Error('Target category not found.');

  setTargetCategoryName(pair.sync_id, newName);
  suppressChannelUpdate(pair.target_category_id);
  await category.edit({ name: newName, reason: 'TRS: category rename via command' });
}

// re-export for callers that only need the read helpers
export { getChannelMappingsBySync };
