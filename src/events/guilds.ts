import { type Guild } from 'discord.js';
import { commands } from '../commands/index.js';
import { log } from '../util/logger.js';

/** Registers all slash commands for a guild the bot just joined (instant availability). */
export async function onGuildCreate(guild: Guild): Promise<void> {
  try {
    const body = commands.map((c) => c.data.toJSON());
    await guild.commands.set(body);
    log.info(`Joined guild "${guild.name}" (${guild.id}) — registered ${body.length} command(s).`);
  } catch (err) {
    log.error(`Failed to register commands for new guild ${guild.id}:`, err);
  }
}
