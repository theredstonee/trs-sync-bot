import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import * as sync from './sync.js';

export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands: Command[] = [sync as Command];

export const commandMap = new Map<string, Command>(
  commands.map((c) => [c.data.name, c]),
);
