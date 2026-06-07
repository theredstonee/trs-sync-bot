import { randomBytes } from 'node:crypto';

/** Generates a short, human-typeable sync id (8 hex chars, e.g. "a1b2c3d4"). */
export function generateSyncId(): string {
  return randomBytes(4).toString('hex');
}
