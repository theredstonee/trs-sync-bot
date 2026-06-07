import { type Client } from 'discord.js';
import { commands } from '../commands/index.js';
import { loadManagedWebhookIds } from '../sync/state.js';
import { log } from '../util/logger.js';

/** Registers slash commands per-guild (instant) and primes loop-prevention state. */
export async function onReady(client: Client<true>): Promise<void> {
  log.info(`Logged in as ${client.user.tag} (${client.user.id})`);

  loadManagedWebhookIds();

  const body = commands.map((c) => c.data.toJSON());
  let registered = 0;
  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.commands.set(body);
      registered++;
    } catch (err) {
      log.error(`Failed to register commands in guild ${guild.id}:`, err);
    }
  }
  log.info(`Slash commands registered in ${registered} guild(s).`);
}
