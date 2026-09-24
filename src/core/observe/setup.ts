import fs from 'fs';
import path from 'path';
import { getStateDir } from '../../utils/paths.js';
import { createObserver, isLevel, traceFileSink, type Level, type Observer, type SpanSink } from './observer.js';

/** How a surface asks to be observed: from flags on the command line, from the environment otherwise. */
export interface ObserveSettings {
  /** `-v` is info, `-vv` debug. Defaults to JAMCLI_LOG_LEVEL, then warn. */
  level?: Level;
  /** `--log-file`. Defaults to JAMCLI_LOG_FILE, then a file a day in the state directory. */
  logFile?: string;
  /** `--trace-file`. Defaults to JAMCLI_TRACE_FILE; no trace is kept without one. */
  traceFile?: string;
  /** Where log lines are also shown, readably: standard error on the command line. */
  echo?: (line: string) => void;
  /** More places spans go, such as the OpenTelemetry exporter. */
  spans?: SpanSink[];
}

/** Log files older than this are removed when a new day's file is started. */
export const LOG_RETENTION_DAYS = 14;

export const logDir = () => path.join(getStateDir(), 'logs');

/** Today's log file, `<state>/logs/YYYY-MM-DD.jsonl`. */
export const defaultLogFile = (date = new Date()) => path.join(logDir(), `${date.toISOString().slice(0, 10)}.jsonl`);

/** Remove log files older than the retention period. Only files JamCLI names are touched. */
export function pruneLogs(dir = logDir(), now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  const cutoff = now - LOG_RETENTION_DAYS * 86_400_000;
  for (const name of names) {
    const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!match || Date.parse(match[1]) >= cutoff) continue;
    try {
      fs.rmSync(path.join(dir, name));
      removed.push(name);
    } catch {
      // Left for next time.
    }
  }
  return removed;
}

/** The observer a session uses, from its surface's settings and the environment. */
export function observerFor(
  settings: ObserveSettings = {},
  env: Record<string, string | undefined> = process.env,
  redact?: (text: string) => string
): { observer: Observer; problems: string[] } {
  const problems: string[] = [];
  let level = settings.level;
  if (!level && env.JAMCLI_LOG_LEVEL) {
    if (isLevel(env.JAMCLI_LOG_LEVEL)) level = env.JAMCLI_LOG_LEVEL;
    else problems.push(`JAMCLI_LOG_LEVEL is off, error, warn, info, or debug, not ${env.JAMCLI_LOG_LEVEL}.`);
  }
  const explicit = settings.logFile ?? env.JAMCLI_LOG_FILE;
  const logFile = explicit || defaultLogFile();
  const traceFile = settings.traceFile ?? env.JAMCLI_TRACE_FILE;
  const spans = [...(traceFile ? [traceFileSink(traceFile)] : []), ...(settings.spans ?? [])];
  const observer = createObserver({
    level: level ?? 'warn',
    logFile,
    // Old days' files are cleared when a day's first line is written, not at every start.
    onLogOpen: explicit ? undefined : () => pruneLogs(),
    echo: settings.echo,
    spans,
    redact,
  });
  return { observer, problems };
}
