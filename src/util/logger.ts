function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (...args: unknown[]) => console.log(`[INFO  ${stamp()}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[WARN  ${stamp()}]`, ...args),
  error: (...args: unknown[]) => console.error(`[ERROR ${stamp()}]`, ...args),
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) console.log(`[DEBUG ${stamp()}]`, ...args);
  },
};
