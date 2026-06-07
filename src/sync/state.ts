import { getActiveSyncPairs, getChannelMappingsBySync } from '../database/db.js';
import { log } from '../util/logger.js';

/**
 * IDs of every webhook the bot manages. Used for loop-prevention: if an incoming
 * message originates from one of these webhooks, it is one of OUR mirrored messages
 * and must NOT be mirrored again.
 */
export const managedWebhookIds = new Set<string>();

/**
 * Channel IDs whose next `channelUpdate` was triggered by the bot itself
 * (structure sync, command rename, category reset, position sync).
 *
 * While an ID is in this set, the channelUpdate handler must NOT treat the change
 * as a user action (e.g. must not store it as a custom name).
 */
const suppressedChannelUpdates = new Set<string>();

/** Mark a channel so the next bot-caused update event is ignored by user-intent logic. */
export function suppressChannelUpdate(channelId: string, ms = 7000): void {
  suppressedChannelUpdates.add(channelId);
  setTimeout(() => suppressedChannelUpdates.delete(channelId), ms).unref?.();
}

export function isChannelUpdateSuppressed(channelId: string): boolean {
  return suppressedChannelUpdates.has(channelId);
}

/** Load all managed webhook ids from the DB into memory (called once on startup). */
export function loadManagedWebhookIds(): void {
  managedWebhookIds.clear();
  for (const pair of getActiveSyncPairs()) {
    for (const m of getChannelMappingsBySync(pair.sync_id)) {
      if (m.source_webhook_id) managedWebhookIds.add(m.source_webhook_id);
      if (m.target_webhook_id) managedWebhookIds.add(m.target_webhook_id);
    }
  }
  log.info(`Loaded ${managedWebhookIds.size} managed webhook id(s) for loop-prevention.`);
}
