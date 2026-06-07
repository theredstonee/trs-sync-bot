import {
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { mirrorReactionAdd, mirrorReactionRemove } from '../sync/reactions.js';
import { log } from '../util/logger.js';

export async function onReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  try {
    await mirrorReactionAdd(reaction, user);
  } catch (err) {
    log.error('onReactionAdd error:', err);
  }
}

export async function onReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  try {
    await mirrorReactionRemove(reaction, user);
  } catch (err) {
    log.error('onReactionRemove error:', err);
  }
}
