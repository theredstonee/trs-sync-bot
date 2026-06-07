import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { log } from '../util/logger.js';

const dbPath = resolve(config.databasePath);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sync_pairs (
  sync_id              TEXT PRIMARY KEY,
  source_guild_id      TEXT NOT NULL,
  source_category_id   TEXT NOT NULL,
  source_category_name TEXT NOT NULL,
  target_guild_id      TEXT,
  target_category_id   TEXT,
  target_category_name TEXT,
  active               INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_mappings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id              TEXT NOT NULL,
  source_channel_id    TEXT NOT NULL,
  target_channel_id    TEXT NOT NULL,
  channel_type         INTEGER NOT NULL,
  source_webhook_id    TEXT,
  source_webhook_token TEXT,
  target_webhook_id    TEXT,
  target_webhook_token TEXT,
  UNIQUE(sync_id, source_channel_id),
  FOREIGN KEY (sync_id) REFERENCES sync_pairs(sync_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chanmap_source ON channel_mappings(source_channel_id);
CREATE INDEX IF NOT EXISTS idx_chanmap_target ON channel_mappings(target_channel_id);

CREATE TABLE IF NOT EXISTS message_mappings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id           TEXT NOT NULL,
  origin_message_id TEXT NOT NULL,
  origin_channel_id TEXT NOT NULL,
  mirror_message_id TEXT NOT NULL,
  mirror_channel_id TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (sync_id) REFERENCES sync_pairs(sync_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msgmap_origin ON message_mappings(origin_message_id);
CREATE INDEX IF NOT EXISTS idx_msgmap_mirror ON message_mappings(mirror_message_id);

CREATE TABLE IF NOT EXISTS custom_names (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id           TEXT NOT NULL,
  target_channel_id TEXT NOT NULL UNIQUE,
  custom_name       TEXT NOT NULL,
  FOREIGN KEY (sync_id) REFERENCES sync_pairs(sync_id) ON DELETE CASCADE
);
`);

log.info(`SQLite ready at ${dbPath}`);

/* ----------------------------- Types ----------------------------- */

export interface SyncPair {
  sync_id: string;
  source_guild_id: string;
  source_category_id: string;
  source_category_name: string;
  target_guild_id: string | null;
  target_category_id: string | null;
  target_category_name: string | null;
  active: number;
  created_at: number;
}

export interface ChannelMapping {
  id: number;
  sync_id: string;
  source_channel_id: string;
  target_channel_id: string;
  channel_type: number;
  source_webhook_id: string | null;
  source_webhook_token: string | null;
  target_webhook_id: string | null;
  target_webhook_token: string | null;
}

export interface MessageMapping {
  id: number;
  sync_id: string;
  origin_message_id: string;
  origin_channel_id: string;
  mirror_message_id: string;
  mirror_channel_id: string;
  created_at: number;
}

export interface CustomName {
  id: number;
  sync_id: string;
  target_channel_id: string;
  custom_name: string;
}

/* -------------------------- sync_pairs --------------------------- */

const stmtCreatePair = db.prepare(`
  INSERT INTO sync_pairs (sync_id, source_guild_id, source_category_id, source_category_name, active, created_at)
  VALUES (@sync_id, @source_guild_id, @source_category_id, @source_category_name, 0, @created_at)
`);

export function createSyncPair(input: {
  syncId: string;
  sourceGuildId: string;
  sourceCategoryId: string;
  sourceCategoryName: string;
}): void {
  stmtCreatePair.run({
    sync_id: input.syncId,
    source_guild_id: input.sourceGuildId,
    source_category_id: input.sourceCategoryId,
    source_category_name: input.sourceCategoryName,
    created_at: Date.now(),
  });
}

const stmtGetPair = db.prepare('SELECT * FROM sync_pairs WHERE sync_id = ?');
export function getSyncPair(syncId: string): SyncPair | undefined {
  return stmtGetPair.get(syncId) as SyncPair | undefined;
}

const stmtActivePairs = db.prepare('SELECT * FROM sync_pairs WHERE active = 1');
export function getActiveSyncPairs(): SyncPair[] {
  return stmtActivePairs.all() as SyncPair[];
}

const stmtPairsByGuild = db.prepare(
  'SELECT * FROM sync_pairs WHERE source_guild_id = ? OR target_guild_id = ?',
);
export function getSyncPairsByGuild(guildId: string): SyncPair[] {
  return stmtPairsByGuild.all(guildId, guildId) as SyncPair[];
}

const stmtPairByTargetCategory = db.prepare(
  'SELECT * FROM sync_pairs WHERE target_category_id = ? AND active = 1',
);
export function getSyncPairByTargetCategory(categoryId: string): SyncPair | undefined {
  return stmtPairByTargetCategory.get(categoryId) as SyncPair | undefined;
}

const stmtActivatePair = db.prepare(`
  UPDATE sync_pairs
  SET target_guild_id = @target_guild_id,
      target_category_id = @target_category_id,
      target_category_name = @target_category_name,
      active = 1
  WHERE sync_id = @sync_id
`);
export function activateSyncPair(input: {
  syncId: string;
  targetGuildId: string;
  targetCategoryId: string;
  targetCategoryName: string;
}): void {
  stmtActivatePair.run({
    sync_id: input.syncId,
    target_guild_id: input.targetGuildId,
    target_category_id: input.targetCategoryId,
    target_category_name: input.targetCategoryName,
  });
}

const stmtSetCategoryName = db.prepare(
  'UPDATE sync_pairs SET target_category_name = ? WHERE sync_id = ?',
);
export function setTargetCategoryName(syncId: string, name: string): void {
  stmtSetCategoryName.run(name, syncId);
}

const stmtRemovePair = db.prepare('DELETE FROM sync_pairs WHERE sync_id = ?');
export function removeSyncPair(syncId: string): void {
  // ON DELETE CASCADE removes channel_mappings, message_mappings, custom_names
  stmtRemovePair.run(syncId);
}

/* ------------------------ channel_mappings ----------------------- */

const stmtAddChannelMapping = db.prepare(`
  INSERT INTO channel_mappings
    (sync_id, source_channel_id, target_channel_id, channel_type,
     source_webhook_id, source_webhook_token, target_webhook_id, target_webhook_token)
  VALUES
    (@sync_id, @source_channel_id, @target_channel_id, @channel_type,
     @source_webhook_id, @source_webhook_token, @target_webhook_id, @target_webhook_token)
`);
export function addChannelMapping(input: {
  syncId: string;
  sourceChannelId: string;
  targetChannelId: string;
  channelType: number;
  sourceWebhookId: string | null;
  sourceWebhookToken: string | null;
  targetWebhookId: string | null;
  targetWebhookToken: string | null;
}): void {
  stmtAddChannelMapping.run({
    sync_id: input.syncId,
    source_channel_id: input.sourceChannelId,
    target_channel_id: input.targetChannelId,
    channel_type: input.channelType,
    source_webhook_id: input.sourceWebhookId,
    source_webhook_token: input.sourceWebhookToken,
    target_webhook_id: input.targetWebhookId,
    target_webhook_token: input.targetWebhookToken,
  });
}

const stmtChanMapBySource = db.prepare(
  'SELECT * FROM channel_mappings WHERE sync_id = ? AND source_channel_id = ?',
);
export function getChannelMappingBySource(
  syncId: string,
  sourceChannelId: string,
): ChannelMapping | undefined {
  return stmtChanMapBySource.get(syncId, sourceChannelId) as ChannelMapping | undefined;
}

const stmtChanMapByChannel = db.prepare(
  'SELECT * FROM channel_mappings WHERE source_channel_id = ? OR target_channel_id = ?',
);
export function getChannelMappingByChannel(channelId: string): ChannelMapping | undefined {
  return stmtChanMapByChannel.get(channelId, channelId) as ChannelMapping | undefined;
}

const stmtChanMapsBySync = db.prepare('SELECT * FROM channel_mappings WHERE sync_id = ?');
export function getChannelMappingsBySync(syncId: string): ChannelMapping[] {
  return stmtChanMapsBySync.all(syncId) as ChannelMapping[];
}

const stmtDeleteChanMap = db.prepare('DELETE FROM channel_mappings WHERE id = ?');
export function deleteChannelMapping(id: number): void {
  stmtDeleteChanMap.run(id);
}

/* ------------------------ message_mappings ----------------------- */

const stmtAddMessageMapping = db.prepare(`
  INSERT INTO message_mappings
    (sync_id, origin_message_id, origin_channel_id, mirror_message_id, mirror_channel_id, created_at)
  VALUES
    (@sync_id, @origin_message_id, @origin_channel_id, @mirror_message_id, @mirror_channel_id, @created_at)
`);
export function addMessageMapping(input: {
  syncId: string;
  originMessageId: string;
  originChannelId: string;
  mirrorMessageId: string;
  mirrorChannelId: string;
}): void {
  stmtAddMessageMapping.run({
    sync_id: input.syncId,
    origin_message_id: input.originMessageId,
    origin_channel_id: input.originChannelId,
    mirror_message_id: input.mirrorMessageId,
    mirror_channel_id: input.mirrorChannelId,
    created_at: Date.now(),
  });
}

const stmtMsgMapByMessage = db.prepare(
  'SELECT * FROM message_mappings WHERE origin_message_id = ? OR mirror_message_id = ?',
);
/** Finds a mapping by either side. Returns the row plus which message id was matched. */
export function getMessageMappingByMessage(messageId: string): MessageMapping | undefined {
  return stmtMsgMapByMessage.get(messageId, messageId) as MessageMapping | undefined;
}

const stmtDeleteMsgMap = db.prepare('DELETE FROM message_mappings WHERE id = ?');
export function deleteMessageMapping(id: number): void {
  stmtDeleteMsgMap.run(id);
}

/* -------------------------- custom_names ------------------------- */

const stmtSetCustomName = db.prepare(`
  INSERT INTO custom_names (sync_id, target_channel_id, custom_name)
  VALUES (@sync_id, @target_channel_id, @custom_name)
  ON CONFLICT(target_channel_id) DO UPDATE SET custom_name = excluded.custom_name
`);
export function setCustomName(syncId: string, targetChannelId: string, name: string): void {
  stmtSetCustomName.run({
    sync_id: syncId,
    target_channel_id: targetChannelId,
    custom_name: name,
  });
}

const stmtGetCustomName = db.prepare(
  'SELECT * FROM custom_names WHERE target_channel_id = ?',
);
export function getCustomName(targetChannelId: string): CustomName | undefined {
  return stmtGetCustomName.get(targetChannelId) as CustomName | undefined;
}

const stmtDeleteCustomName = db.prepare(
  'DELETE FROM custom_names WHERE target_channel_id = ?',
);
export function deleteCustomName(targetChannelId: string): void {
  stmtDeleteCustomName.run(targetChannelId);
}
