import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { config } from './src/config.js';
import './src/database/db.js'; // initialize schema on import
import { onReady } from './src/events/ready.js';
import { onInteractionCreate } from './src/events/interactionCreate.js';
import {
  onMessageCreate,
  onMessageDelete,
  onMessageDeleteBulk,
  onMessageUpdate,
} from './src/events/messages.js';
import {
  onChannelCreate,
  onChannelDelete,
  onChannelUpdate,
} from './src/events/channels.js';
import { onGuildCreate } from './src/events/guilds.js';
import { onReactionAdd, onReactionRemove } from './src/events/reactions.js';
import { log } from './src/util/logger.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.MessageContent, // privileged — enable in the Developer Portal
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (c) => {
  void onReady(c);
});
client.on(Events.InteractionCreate, (i) => void onInteractionCreate(i));
client.on(Events.GuildCreate, (g) => void onGuildCreate(g));

client.on(Events.MessageCreate, (m) => void onMessageCreate(m));
client.on(Events.MessageUpdate, (o, n) => void onMessageUpdate(o, n));
client.on(Events.MessageDelete, (m) => void onMessageDelete(m));
client.on(Events.MessageBulkDelete, (msgs) => void onMessageDeleteBulk(msgs));

client.on(Events.MessageReactionAdd, (r, u) => void onReactionAdd(r, u));
client.on(Events.MessageReactionRemove, (r, u) => void onReactionRemove(r, u));

client.on(Events.ChannelCreate, (c) => void onChannelCreate(c));
client.on(Events.ChannelDelete, (c) => void onChannelDelete(c));
client.on(Events.ChannelUpdate, (o, n) => void onChannelUpdate(o, n));

process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => log.error('Uncaught exception:', err));

log.info('Starting TRS Sync Bot...');
void client.login(config.token);
