import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  createSyncPair,
  getChannelMappingByChannel,
  getSyncPair,
  getSyncPairsByGuild,
  removeSyncPair,
} from '../database/db.js';
import { generateSyncId } from '../sync/ids.js';
import { activateSync, destroyWebhooks } from '../sync/setup.js';
import { applyCategoryRename, applyCustomChannelName } from '../sync/structure.js';
import { loadManagedWebhookIds } from '../sync/state.js';
import { log } from '../util/logger.js';

export const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Synchronize a category (structure + messages) between two servers')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('[Server A] Register a category for syncing and get a Sync-ID')
      .addChannelOption((opt) =>
        opt
          .setName('category')
          .setDescription('The category on this server to sync from')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('activate')
      .setDescription('[Server B] Activate a sync using a Sync-ID from Server A')
      .addStringOption((opt) =>
        opt.setName('sync-id').setDescription('The Sync-ID from /sync setup').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show the syncs connected to this server'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('rename-channel')
      .setDescription('[Server B] Rename a mirrored channel and lock its name')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('The mirrored channel to rename')
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('new_name').setDescription('The new channel name').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('rename-category')
      .setDescription('[Server B] Permanently rename the mirrored category')
      .addStringOption((opt) =>
        opt.setName('new_name').setDescription('The new category name').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Disconnect a sync and delete its database entries')
      .addStringOption((opt) =>
        opt
          .setName('sync-id')
          .setDescription('Sync-ID (optional if this server has exactly one sync)')
          .setRequired(false),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'setup':
      return handleSetup(interaction);
    case 'activate':
      return handleActivate(interaction);
    case 'status':
      return handleStatus(interaction);
    case 'rename-channel':
      return handleRenameChannel(interaction);
    case 'rename-category':
      return handleRenameCategory(interaction);
    case 'remove':
      return handleRemove(interaction);
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

/* ----------------------------- setup ----------------------------- */

async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const category = interaction.options.getChannel('category', true);
  if (category.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: 'Please pick a category.', ephemeral: true });
    return;
  }

  const syncId = generateSyncId();
  createSyncPair({
    syncId,
    sourceGuildId: interaction.guild.id,
    sourceCategoryId: category.id,
    sourceCategoryName: category.name ?? 'Unnamed',
  });

  await interaction.reply({
    ephemeral: true,
    content:
      `✅ Sync registered for category **${category.name}**.\n\n` +
      `**Sync-ID:** \`${syncId}\`\n\n` +
      `On **Server B**, run \`/sync activate sync-id:${syncId}\` to start mirroring. ` +
      `The bot must be a member of both servers.`,
  });
}

/* ---------------------------- activate ---------------------------- */

async function handleActivate(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const syncId = interaction.options.getString('sync-id', true).trim().toLowerCase();

  const pair = getSyncPair(syncId);
  if (!pair) {
    await interaction.reply({ content: `❌ No sync found with ID \`${syncId}\`.`, ephemeral: true });
    return;
  }
  if (pair.active === 1) {
    await interaction.reply({ content: '❌ This sync is already active.', ephemeral: true });
    return;
  }
  if (pair.source_guild_id === interaction.guild.id) {
    await interaction.reply({
      content: '❌ Activate must be run on **Server B** (the mirror server), not the source server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await activateSync(interaction.client, pair, interaction.guild);
    loadManagedWebhookIds();
    await interaction.editReply({
      content:
        `✅ Sync \`${syncId}\` is now **active**.\n` +
        `• Mirror category: **${result.categoryName}**\n` +
        `• Channels created: **${result.channelsCreated}**\n` +
        `• Webhooks created: **${result.webhooksCreated}**\n\n` +
        `Messages now sync bidirectionally; structure changes flow from Server A → B.`,
    });
  } catch (err) {
    log.error('Activation failed:', err);
    await interaction.editReply({
      content: `❌ Activation failed: ${(err as Error).message}`,
    });
  }
}

/* ----------------------------- status ----------------------------- */

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const pairs = getSyncPairsByGuild(interaction.guild.id);
  if (pairs.length === 0) {
    await interaction.reply({ content: 'No syncs involve this server.', ephemeral: true });
    return;
  }

  const lines = pairs.map((p) => {
    const role = p.source_guild_id === interaction.guild!.id ? 'SOURCE (A)' : 'MIRROR (B)';
    const state = p.active === 1 ? '🟢 active' : '🟡 pending activation';
    const cat = p.active === 1 ? p.target_category_name ?? p.source_category_name : p.source_category_name;
    return (
      `\`${p.sync_id}\` — ${state} — this server is **${role}**\n` +
      `   Category: **${cat}**` +
      (p.active === 1
        ? `\n   A: \`${p.source_guild_id}\`  ↔  B: \`${p.target_guild_id}\``
        : '')
    );
  });

  await interaction.reply({ ephemeral: true, content: lines.join('\n\n') });
}

/* ------------------------- rename-channel ------------------------- */

async function handleRenameChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const channel = interaction.options.getChannel('channel', true);
  const newName = interaction.options.getString('new_name', true).trim();

  const mapping = getChannelMappingByChannel(channel.id);
  if (!mapping || mapping.target_channel_id !== channel.id) {
    await interaction.reply({
      content: '❌ That channel is not a mirrored (Server B) channel of any sync.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await applyCustomChannelName(interaction.client, mapping.sync_id, channel.id, newName);
    await interaction.editReply({
      content:
        `✅ Renamed to **${newName}** and locked. ` +
        `Source renames will no longer overwrite this channel.`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${(err as Error).message}` });
  }
}

/* ------------------------ rename-category ------------------------ */

async function handleRenameCategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const newName = interaction.options.getString('new_name', true).trim();

  const pair = getSyncPairsByGuild(interaction.guild.id).find(
    (p) => p.active === 1 && p.target_guild_id === interaction.guild!.id,
  );
  if (!pair) {
    await interaction.reply({
      content: '❌ No active mirror category on this server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await applyCategoryRename(interaction.client, pair, newName);
    await interaction.editReply({
      content: `✅ Mirror category permanently renamed to **${newName}**.`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${(err as Error).message}` });
  }
}

/* ----------------------------- remove ----------------------------- */

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  let syncId = interaction.options.getString('sync-id')?.trim().toLowerCase();

  if (!syncId) {
    const pairs = getSyncPairsByGuild(interaction.guild.id);
    if (pairs.length === 0) {
      await interaction.reply({ content: 'No syncs involve this server.', ephemeral: true });
      return;
    }
    if (pairs.length > 1) {
      await interaction.reply({
        content: `❌ Multiple syncs found. Specify one: ${pairs.map((p) => `\`${p.sync_id}\``).join(', ')}`,
        ephemeral: true,
      });
      return;
    }
    syncId = pairs[0].sync_id;
  }

  const pair = getSyncPair(syncId);
  if (!pair) {
    await interaction.reply({ content: `❌ No sync \`${syncId}\`.`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await destroyWebhooks(interaction.client, syncId);
    removeSyncPair(syncId);
    loadManagedWebhookIds();
    await interaction.editReply({
      content:
        `✅ Sync \`${syncId}\` removed. Webhooks deleted and database entries cleared.\n` +
        `The mirrored channels/category on Server B were **kept** as normal channels.`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed: ${(err as Error).message}` });
  }
}
