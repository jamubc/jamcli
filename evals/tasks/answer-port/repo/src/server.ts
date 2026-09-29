import settings from '../config/default.json';

/** The port to listen on: PORT when set, else the configured one. */
export function listenPort(env: Record<string, string | undefined> = process.env): number {
  return Number(env.PORT ?? settings.server.port);
}
