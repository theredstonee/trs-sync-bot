import {
  ChannelType,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type NonThreadGuildBasedChannel,
  type TextChannel,
  type NewsChannel,
} from 'discord.js';
import {
  getChannelMappingByChannel,
  type ChannelMapping,
} from '../database/db.js';
import { managedWebhookIds } from './state.js';
import { log } from '../util/logger.js';

/** Channel types whose structure we mirror. */
export const SYNCED_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildStageVoice,
]);

/** Channel types that can carry webhook-based message mirroring. */
export function isMessageMirrorable(type: ChannelType): boolean {
  return type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement;
}

export interface WebhookCreds {
  id: string;
  token: string;
}

/**
 * Builds the create-options for a target channel that mirror a source channel's
 * relevant properties (type, topic, slowmode, nsfw, bitrate, position).
 */
export function buildCreateOptions(
  source: NonThreadGuildBasedChannel,
  name: string,
  parentId: string,
): GuildChannelCreateOptions {
  const opts: GuildChannelCreateOptions = {
    name,
    type: source.type as GuildChannelCreateOptions['type'],
    parent: parentId,
    position: 'rawPosition' in source ? source.rawPosition : undefined,
    reason: 'TRS structure sync',
  };

  // Text-like properties
  if (
    source.type === ChannelType.GuildText ||
    source.type === ChannelType.GuildAnnouncement ||
    source.type === ChannelType.GuildForum
  ) {
    const tc = source as TextChannel;
    if (tc.topic) opts.topic = tc.topic;
    if (typeof tc.rateLimitPerUser === 'number') opts.rateLimitPerUser = tc.rateLimitPerUser;
    if (typeof tc.nsfw === 'boolean') opts.nsfw = tc.nsfw;
  }

  // Voice-like properties
  if (source.type === ChannelType.GuildVoice || source.type === ChannelType.GuildStageVoice) {
    const vc = source as unknown as { bitrate?: number; userLimit?: number };
    if (typeof vc.bitrate === 'number') opts.bitrate = vc.bitrate;
    if (typeof vc.userLimit === 'number') opts.userLimit = vc.userLimit;
  }

  return opts;
}

/**
 * Ensures the given text/announcement channel has a bot-managed webhook and
 * returns its credentials. Returns null for channel types that can't host one.
 */
export async function ensureWebhook(
  channel: GuildBasedChannel,
): Promise<WebhookCreds | null> {
  if (!isMessageMirrorable(channel.type)) return null;
  const tc = channel as TextChannel | NewsChannel;
  try {
    const webhook = await tc.createWebhook({
      name: 'TRS Sync',
      reason: 'TRS message sync webhook',
    });
    if (!webhook.token) {
      log.warn(`Webhook on #${tc.name} created without token; cannot use it.`);
      return null;
    }
    managedWebhookIds.add(webhook.id);
    return { id: webhook.id, token: webhook.token };
  } catch (err) {
    log.error(`Failed to create webhook on #${tc.name ?? channel.id}:`, err);
    return null;
  }
}

/**
 * Given any channel id that participates in a mapping, returns the webhook creds
 * belonging to THAT channel (source side -> source webhook, target side -> target webhook).
 */
export function getWebhookCredsForChannel(channelId: string): WebhookCreds | null {
  const mapping = getChannelMappingByChannel(channelId);
  if (!mapping) return null;
  return webhookCredsForSide(mapping, mapping.source_channel_id === channelId ? 'source' : 'target');
}

export function webhookCredsForSide(
  mapping: ChannelMapping,
  side: 'source' | 'target',
): WebhookCreds | null {
  if (side === 'source') {
    if (mapping.source_webhook_id && mapping.source_webhook_token) {
      return { id: mapping.source_webhook_id, token: mapping.source_webhook_token };
    }
    return null;
  }
  if (mapping.target_webhook_id && mapping.target_webhook_token) {
    return { id: mapping.target_webhook_id, token: mapping.target_webhook_token };
  }
  return null;
}
