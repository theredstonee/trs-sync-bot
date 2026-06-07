/**
 * Optional: register slash commands GLOBALLY via the REST API.
 *
 * You normally do NOT need this — the bot auto-registers commands per guild on
 * startup (see events/ready.ts), which is instant. Use this only if you want
 * global commands (propagation can take up to ~1 hour).
 *
 *   npm run deploy
 */
import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';
import { log } from './util/logger.js';

const body = commands.map((c) => c.data.toJSON());
const rest = new REST({ version: '10' }).setToken(config.token);

try {
  log.info(`Registering ${body.length} global command(s)...`);
  await rest.put(Routes.applicationCommands(config.clientId), { body });
  log.info('Global commands registered.');
} catch (err) {
  log.error('Failed to register global commands:', err);
  process.exit(1);
}
