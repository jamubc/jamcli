import type { ToolRegistry } from '../tools/registry.js';
import { identityOf, listSessionSummaries, resolveSessionRef, sessionName, type SessionLog, type TranscriptRecorder } from '../transcript/index.js';
import { KeepAwake, WakeTable, caffeinate, flagsOf, setFlag, wakeTools, type AwakeSpawner, type FiredWake, type Wake, type WakeSpec } from '../wake/index.js';
import type { Surface } from './types.js';

/** The colors `/color` offers; `default` is the theme's own. */
export const SESSION_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type SessionColor = (typeof SESSION_COLORS)[number];

export interface SessionExtrasOptions {
  projectRoot: string;
  surface: Surface;
  /** Whether the session continues one already in the log. */
  resumed: boolean;
  log: SessionLog;
  recorder: TranscriptRecorder;
  registry: ToolRegistry;
  /** What keeps the machine awake; false for nothing. */
  keepAwake?: AwakeSpawner | false;
}

/** Where wakes can be delivered: a surface a person or a client drives. A delegated run or a workflow step ends with its task. */
const WAKING: Surface[] = ['tui', 'headless', 'acp'];

/**
 * What the session keeps about itself beyond the conversation: its name and color, its
 * flags on the machine's board, the prompts it runs later, and keeping the machine awake
 * while it works or waits. Every change is recorded in the log.
 */
export function sessionExtras(options: SessionExtrasOptions) {
  const { log, recorder, projectRoot } = options;
  const spawner = options.keepAwake === false ? undefined : (options.keepAwake ?? (process.env.NODE_ENV === 'test' ? undefined : caffeinate));
  // A delegated run leaves the machine to its parent, which holds it for the whole turn.
  const awake = new KeepAwake(options.surface === 'child' ? undefined : spawner);
  const table = new WakeTable({
    record: (fact) => recorder.recordFact(fact),
    resolve: (ref) => {
      const found = resolveSessionRef(ref, projectRoot);
      return 'error' in found ? found : { id: found.session.id };
    },
    flags: flagsOf,
    changed: () => awake.hold('wakes', table.list().length > 0),
  });
  const notices = options.resumed ? table.restore(log.events()) : [];

  const flags = (refs: string[]): { session: string; flags: string[] }[] | { error: string } => {
    if (!refs.length) return [{ session: log.id, flags: Object.keys(flagsOf(log.id)) }];
    const listed: { session: string; flags: string[] }[] = [];
    for (const ref of refs) {
      const found = resolveSessionRef(ref, projectRoot);
      if ('error' in found) return found;
      listed.push({ session: `${found.session.id}${found.session.name ? ` (${found.session.name})` : ''}`, flags: Object.keys(flagsOf(found.session.id)) });
    }
    return listed;
  };
  const markFlag = (flag: string, raised: boolean) => {
    setFlag(log.id, projectRoot, flag, raised);
    recorder.recordFact({ type: 'flag', flag, raised });
  };
  const api = {
    get name(): string | undefined {
      return identityOf(log.events()).name;
    },
    get color(): string | undefined {
      return identityOf(log.events()).color;
    },
    /** Name the session. Returns why not, naming nothing, when the name is not one or another session of the project holds it. */
    rename(text: string): string | undefined {
      const made = sessionName(text);
      if ('error' in made) return made.error;
      const taken = listSessionSummaries(projectRoot, Number.MAX_SAFE_INTEGER).find((entry) => entry.id !== log.id && entry.name?.toLowerCase() === made.name.toLowerCase());
      if (taken) return `${taken.id} is already called ${made.name}.`;
      recorder.recordFact({ type: 'name', name: made.name });
      return undefined;
    },
    setColor(color: SessionColor | undefined): void {
      recorder.recordFact({ type: 'color', color: color ?? null });
    },
    wakes: (): Wake[] => table.list(),
    setWake: (spec: Omit<WakeSpec, 'by'>) => table.set({ ...spec, by: 'person' }),
    cancelWake: (id: string) => table.cancel(id),
    onWake: (listener: (wake: FiredWake) => void) => table.onFire(listener),
    flags,
    raiseFlag: (flag: string) => markFlag(flag, true),
    lowerFlag: (flag: string) => markFlag(flag, false),
  };
  if (WAKING.includes(options.surface)) {
    for (const tool of wakeTools({ ...api, setWake: (spec) => table.set(spec) })) options.registry.register(tool);
  }
  return {
    api,
    notices,
    /** Hold the machine awake while a turn runs. */
    turn: (running: boolean) => awake.hold('turn', running),
    close: () => {
      table.close();
      awake.release();
    },
  };
}
