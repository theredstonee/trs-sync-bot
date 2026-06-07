import {
  ChannelType,
  type DMChannel,
  type GuildChannel,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import {
  handleSourceChannelCreate,
  handleSourceChannelDelete,
  handleSourceChannelUpdate,
  handleTargetChannelUpdate,
} from '../sync/structure.js';
import { log } from '../util/logger.js';

function isGuildChannel(channel: unknown): channel is GuildChannel {
  return !!channel && typeof channel === 'object' && 'guild' in (channel as object);
}

export async function onChannelCreate(channel: GuildChannel): Promise<void> {
  if (!isGuildChannel(channel)) return;
  try {
    await handleSourceChannelCreate(channel);
  } catch (err) {
    log.error('onChannelCreate error:', err);
  }
}

export async function onChannelDelete(channel: DMChannel | NonThreadGuildBasedChannel): Promise<void> {
  if (!isGuildChannel(channel)) return;
  try {
    await handleSourceChannelDelete(channel as GuildChannel);
  } catch (err) {
    log.error('onChannelDelete error:', err);
  }
}

export async function onChannelUpdate(
  oldChannel: DMChannel | NonThreadGuildBasedChannel,
  newChannel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  if (!isGuildChannel(oldChannel) || !isGuildChannel(newChannel)) return;
  const oldC = oldChannel as GuildChannel;
  const newC = newChannel as GuildChannel;

  try {
    // First let the target-side handler claim it (custom name / category protection).
    const handledAsTarget = await handleTargetChannelUpdate(oldC, newC);
    if (handledAsTarget) return;

    // Otherwise treat it as a possible source-side structure change.
    await handleSourceChannelUpdate(oldC, newC);
  } catch (err) {
    log.error('onChannelUpdate error:', err);
  }
}
