import { type Interaction } from 'discord.js';
import { commandMap } from '../commands/index.js';
import { log } from '../util/logger.js';

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    log.error(`Error executing /${interaction.commandName}:`, err);
    const payload = { content: 'An error occurred while running this command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: payload.content }).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}
