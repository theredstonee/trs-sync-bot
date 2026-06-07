import {
  WebhookClient,
  type Message,
  type APIEmbed,
  type JSONEncodable,
} from 'discord.js';
import {
  addMessageMapping,
  deleteMessageMapping,
  getChannelMappingByChannel,
  getMessageMappingByMessage,
  getSyncPair,
} from '../database/db.js';
import {
  getWebhookCredsForChannel,
  webhookCredsForSide,
  type WebhookCreds,
} from './channels.js';
import { managedWebhookIds } from './state.js';
import { log } from '../util/logger.js';

const CONTENT_LIMIT = 2000;

/** Webhook usernames must be 1-80 chars and may not be exactly "clyde"/"discord". */
function sanitizeUsername(name: string): string {
  let n = name.trim().slice(0, 80);
  if (!n) n = 'Unknown';
  if (/^(clyde|discord)$/i.test(n)) n = `${n}.`;
  return n;
}

function collectFiles(message: Message): Array<{ attachment: string; name: string }> {
  return [...message.attachments.values()].map((a) => ({
    attachment: a.url,
    name: a.name ?? 'attachment',
  }));
}

function collectEmbeds(message: Message): Array<APIEmbed | JSONEncodable<APIEmbed>> {
  return message.embeds.slice(0, 10).map((e) => e.toJSON());
}

/**
 * Mirrors a freshly created message into its partner channel via the partner webhook,
 * impersonating the original author (name + avatar), and records the message mapping.
 */
export async function mirrorMessageCreate(message: Message): Promise<void> {
  const mapping = getChannelMappingByChannel(message.channelId);
  if (!mapping) return;

  const pair = getSyncPair(mapping.sync_id);
  if (!pair || pair.active !== 1) return;

  const side: 'source' | 'target' =
    mapping.source_channel_id === message.channelId ? 'source' : 'target';

  // Mirror A->B uses the TARGET webhook; mirror B->A uses the SOURCE webhook.
  const partnerSide: 'source' | 'target' = side === 'source' ? 'target' : 'source';
  const partnerChannelId =
    side === 'source' ? mapping.target_channel_id : mapping.source_channel_id;
  const creds = webhookCredsForSide(mapping, partnerSide);
  if (!creds) return;

  const content = (message.content ?? '').slice(0, CONTENT_LIMIT);
  const files = collectFiles(message);
  const embeds = collectEmbeds(message);

  if (!content && files.length === 0 && embeds.length === 0) {
    // Nothing webhook-sendable (e.g. pure sticker/poll). Skip.
    return;
  }

  // Always use a display name (server nickname -> global display name), never the raw @username handle.
  const username = sanitizeUsername(
    message.member?.displayName ?? message.author.displayName ?? message.author.username,
  );
  const avatarURL = message.author.displayAvatarURL({ extension: 'png', size: 256 });

  const client = new WebhookClient({ id: creds.id, token: creds.token });
  try {
    const sent = await client.send({
      content: content || undefined,
      username,
      avatarURL,
      embeds,
      files,
      allowedMentions: { parse: [] }, // never ping across the mirror
    });

    addMessageMapping({
      syncId: mapping.sync_id,
      originMessageId: message.id,
      originChannelId: message.channelId,
      mirrorMessageId: sent.id,
      mirrorChannelId: partnerChannelId,
    });
  } catch (err) {
    log.error('Failed to mirror message create:', err);
  } finally {
    client.destroy();
  }
}

/** Propagates an edit of an original message to its mirrored counterpart. */
export async function mirrorMessageUpdate(message: Message): Promise<void> {
  const map = getMessageMappingByMessage(message.id);
  if (!map) return;

  // Only react when the edited message is the ORIGIN; mirrored webhook messages
  // can't be edited by users anyway.
  if (map.origin_message_id !== message.id) return;

  const creds = getWebhookCredsForChannel(map.mirror_channel_id);
  if (!creds) return;

  const content = (message.content ?? '').slice(0, CONTENT_LIMIT);
  const embeds = collectEmbeds(message);

  await editViaWebhook(creds, map.mirror_message_id, content, embeds);
}

async function editViaWebhook(
  creds: WebhookCreds,
  messageId: string,
  content: string,
  embeds: Array<APIEmbed | JSONEncodable<APIEmbed>>,
): Promise<void> {
  const client = new WebhookClient({ id: creds.id, token: creds.token });
  try {
    await client.editMessage(messageId, {
      content: content || undefined,
      embeds,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    log.error('Failed to mirror message edit:', err);
  } finally {
    client.destroy();
  }
}

/** Propagates a delete of an original message to its mirrored counterpart. */
export async function mirrorMessageDelete(messageId: string): Promise<void> {
  const map = getMessageMappingByMessage(messageId);
  if (!map) return;

  // Determine which side was deleted, and which mirrored message to remove.
  const mirroredId =
    map.origin_message_id === messageId ? map.mirror_message_id : map.origin_message_id;
  const mirroredChannelId =
    map.origin_message_id === messageId ? map.mirror_channel_id : map.origin_channel_id;

  const creds = getWebhookCredsForChannel(mirroredChannelId);
  if (creds) {
    const client = new WebhookClient({ id: creds.id, token: creds.token });
    try {
      await client.deleteMessage(mirroredId);
    } catch (err) {
      log.debug('Could not delete mirrored message (maybe already gone):', err);
    } finally {
      client.destroy();
    }
  }

  deleteMessageMapping(map.id);
}

/** True if the message comes from one of our own managed webhooks (loop-prevention). */
export function isOwnMirror(message: Message): boolean {
  return message.webhookId != null && managedWebhookIds.has(message.webhookId);
}
