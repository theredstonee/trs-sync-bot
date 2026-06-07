import {
  type Client,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { getMessageMappingByMessage, type MessageMapping } from '../database/db.js';
import { log } from '../util/logger.js';

type AnyReaction = MessageReaction | PartialMessageReaction;
type AnyUser = User | PartialUser;

/** Resolvable key for a reaction emoji: custom -> id, unicode -> name. */
function emojiKey(emoji: AnyReaction['emoji']): string {
  return emoji.id ?? emoji.name ?? '';
}

/** Fetches the mirrored counterpart message of the one that was (un)reacted. */
async function fetchPartnerMessage(
  client: Client,
  map: MessageMapping,
  reactedMessageId: string,
): Promise<Message | null> {
  const onOrigin = map.origin_message_id === reactedMessageId;
  const channelId = onOrigin ? map.mirror_channel_id : map.origin_channel_id;
  const messageId = onOrigin ? map.mirror_message_id : map.origin_message_id;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return null;
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

/** Mirrors a freshly added reaction onto the partner message (added by the bot). */
export async function mirrorReactionAdd(reaction: AnyReaction, user: AnyUser): Promise<void> {
  const client = reaction.client;
  // Loop-prevention: ignore the bot's own mirrored reactions.
  if (user.id === client.user?.id) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const map = getMessageMappingByMessage(reaction.message.id);
  if (!map) return;

  const partner = await fetchPartnerMessage(client, map, reaction.message.id);
  if (!partner) return;

  try {
    await partner.react(reaction.emoji);
  } catch (err) {
    // Custom emoji the bot can't access (foreign server), or message gone.
    log.debug('Could not mirror reaction add:', err);
  }
}

/**
 * Mirrors a removed reaction: removes the bot's mirrored reaction on the partner
 * message — but only once no human reactions of that emoji remain on the source side.
 */
export async function mirrorReactionRemove(reaction: AnyReaction, user: AnyUser): Promise<void> {
  const client = reaction.client;
  if (user.id === client.user?.id) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const map = getMessageMappingByMessage(reaction.message.id);
  if (!map) return;

  // Other users still hold this reaction here -> keep the mirrored one in place.
  if (typeof reaction.count === 'number' && reaction.count > 0) return;

  const partner = await fetchPartnerMessage(client, map, reaction.message.id);
  if (!partner) return;

  const key = emojiKey(reaction.emoji);
  const partnerReaction = key ? partner.reactions.resolve(key) : null;
  if (partnerReaction && client.user) {
    try {
      await partnerReaction.users.remove(client.user.id);
    } catch (err) {
      log.debug('Could not remove mirrored reaction:', err);
    }
  }
}
