import {
  ChannelType,
  type CategoryChannel,
  type Client,
  type Guild,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import {
  activateSyncPair,
  addChannelMapping,
  getChannelMappingsBySync,
  getSyncPair,
  type SyncPair,
} from '../database/db.js';
import { buildCreateOptions, ensureWebhook, SYNCED_CHANNEL_TYPES } from './channels.js';
import { suppressChannelUpdate } from './state.js';
import { syncPositions } from './structure.js';
import { log } from '../util/logger.js';

export interface ActivationResult {
  categoryName: string;
  channelsCreated: number;
  webhooksCreated: number;
}

/**
 * Pulls the source category + its children, recreates them on the target guild,
 * provisions webhooks on both sides, writes all mappings and marks the pair active.
 */
export async function activateSync(
  client: Client,
  pair: SyncPair,
  targetGuild: Guild,
): Promise<ActivationResult> {
  const sourceGuild = client.guilds.cache.get(pair.source_guild_id);
  if (!sourceGuild) {
    throw new Error(
      'The bot is not present in the source server, or it has not loaded yet. ' +
        'Make sure the bot is a member of both servers.',
    );
  }

  // Make sure caches are fresh.
  await sourceGuild.channels.fetch();
  await targetGuild.channels.fetch();

  const sourceCategory = sourceGuild.channels.cache.get(pair.source_category_id) as
    | CategoryChannel
    | undefined;
  if (!sourceCategory || sourceCategory.type !== ChannelType.GuildCategory) {
    throw new Error('Source category no longer exists.');
  }

  // 1) Create the mirror category on B.
  const targetCategory = await targetGuild.channels.create({
    name: sourceCategory.name,
    type: ChannelType.GuildCategory,
    reason: 'TRS sync: mirror category',
  });
  suppressChannelUpdate(targetCategory.id);

  activateSyncPair({
    syncId: pair.sync_id,
    targetGuildId: targetGuild.id,
    targetCategoryId: targetCategory.id,
    targetCategoryName: targetCategory.name,
  });

  // 2) Create each child channel on B, ordered by source position.
  const children = [...sourceGuild.channels.cache.values()]
    .filter(
      (c): c is NonThreadGuildBasedChannel =>
        c.parentId === sourceCategory.id && SYNCED_CHANNEL_TYPES.has(c.type),
    )
    .sort((a, b) => a.rawPosition - b.rawPosition);

  let channelsCreated = 0;
  let webhooksCreated = 0;

  for (const source of children) {
    try {
      const opts = buildCreateOptions(source, source.name, targetCategory.id);
      const created = await targetGuild.channels.create(opts);
      suppressChannelUpdate(created.id);

      const sourceWh = await ensureWebhook(source);
      const targetWh = await ensureWebhook(created);
      if (sourceWh) webhooksCreated++;
      if (targetWh) webhooksCreated++;

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
      channelsCreated++;
    } catch (err) {
      log.error(`Failed to mirror channel #${source.name} during activation:`, err);
    }
  }

  await syncPositions(client, pair.sync_id);

  log.info(
    `[${pair.sync_id}] Activated: ${channelsCreated} channel(s), ${webhooksCreated} webhook(s).`,
  );

  return {
    categoryName: targetCategory.name,
    channelsCreated,
    webhooksCreated,
  };
}

/** Best-effort deletion of all bot-managed webhooks for a sync (used by /sync remove). */
export async function destroyWebhooks(client: Client, syncId: string): Promise<void> {
  const pair = getSyncPair(syncId);
  if (!pair) return;
  const mappings = getChannelMappingsBySync(syncId);

  for (const m of mappings) {
    await deleteWebhookSafely(client, pair.source_guild_id, m.source_channel_id, m.source_webhook_id);
    if (pair.target_guild_id) {
      await deleteWebhookSafely(client, pair.target_guild_id, m.target_channel_id, m.target_webhook_id);
    }
  }
}

async function deleteWebhookSafely(
  client: Client,
  guildId: string,
  channelId: string,
  webhookId: string | null,
): Promise<void> {
  if (!webhookId) return;
  try {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || !('fetchWebhooks' in channel)) return;
    const hooks = await (channel as { fetchWebhooks: () => Promise<Map<string, { id: string; delete: (r?: string) => Promise<unknown> }>> }).fetchWebhooks();
    const hook = [...hooks.values()].find((h) => h.id === webhookId);
    if (hook) await hook.delete('TRS sync removed');
  } catch (err) {
    log.debug('Could not delete webhook (may already be gone):', err);
  }
}
