export function logLevel(env: Record<string, string | undefined> = process.env): string {
  return env.LOG_LEVEL as string;
}
