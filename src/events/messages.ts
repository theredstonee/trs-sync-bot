import {
  type Message,
  type PartialMessage,
  type OmitPartialGroupDMChannel,
  type ReadonlyCollection,
  type Snowflake,
} from 'discord.js';
import {
  isOwnMirror,
  mirrorMessageCreate,
  mirrorMessageDelete,
  mirrorMessageUpdate,
} from '../sync/messages.js';
import { log } from '../util/logger.js';

type AnyMessage = OmitPartialGroupDMChannel<Message | PartialMessage>;

export async function onMessageCreate(message: Message): Promise<void> {
  if (!message.guild) return;
  if (message.system) return;
  // Loop-prevention: never re-mirror our own webhook output.
  if (isOwnMirror(message)) return;
  // Ignore the bot's own (non-webhook) messages.
  if (message.author?.id === message.client.user.id) return;

  try {
    await mirrorMessageCreate(message);
  } catch (err) {
    log.error('onMessageCreate error:', err);
  }
}

export async function onMessageUpdate(
  _oldMessage: AnyMessage,
  newMessage: AnyMessage,
): Promise<void> {
  if (!newMessage.guild) return;

  let msg: Message;
  try {
    msg = newMessage.partial ? await newMessage.fetch() : (newMessage as Message);
  } catch {
    return;
  }
  if (isOwnMirror(msg)) return;

  try {
    await mirrorMessageUpdate(msg);
  } catch (err) {
    log.error('onMessageUpdate error:', err);
  }
}

export async function onMessageDelete(message: AnyMessage): Promise<void> {
  // message may be partial; id is always present.
  if (!message.id) return;
  try {
    await mirrorMessageDelete(message.id);
  } catch (err) {
    log.error('onMessageDelete error:', err);
  }
}

/** Mirrors a bulk delete (moderation purge) by removing each mapped mirror message. */
export async function onMessageDeleteBulk(
  messages: ReadonlyCollection<Snowflake, AnyMessage>,
): Promise<void> {
  for (const id of messages.keys()) {
    try {
      await mirrorMessageDelete(id);
    } catch (err) {
      log.error('onMessageDeleteBulk error:', err);
    }
  }
}
