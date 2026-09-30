import type { RegisteredTool } from '../../types/tools.js';
import { flagName } from './board.js';
import { describeWake, WAKE_LIMITS, type Wake, type WakeSpec } from './table.js';

/** What the wake and flag tools act on: the session's own table and flags. */
export interface WakeToolSources {
  wakes(): Wake[];
  setWake(spec: WakeSpec): { wake: Wake } | { error: string };
  cancelWake(id: string): Wake[];
  raiseFlag(flag: string): void;
  lowerFlag(flag: string): void;
  /** Each named session's raised flags, this session's when none is named. */
  flags(refs: string[]): { session: string; flags: string[] }[] | { error: string };
}

const error = (output: string) => ({ output, status: 'error' as const });

export function wakeTools(sources: WakeToolSources): RegisteredTool[] {
  return [
    {
      name: 'wake',
      tier: 'extended',
      description:
        `Have the harness run a prompt in this session later, instead of waiting or pretending to. set with after_seconds runs it once that time has passed (${WAKE_LIMITS.minSeconds} s to 7 days); set with sessions and flag runs it once every named session (an id or a name) has raised that flag. ` +
        'The person sending a message meanwhile does not cancel it; cancel does. list shows what is pending. Use it when asked to do something later, or only after other sessions finish.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'cancel', 'list'] },
          prompt: { type: 'string', description: 'set: what to do when it goes off, written for yourself then.' },
          after_seconds: { type: 'number', description: 'set: run it once this many seconds have passed.' },
          sessions: { type: 'array', items: { type: 'string' }, description: 'set: sessions, by id or name, that must each raise the flag.' },
          flag: { type: 'string', description: 'set: the flag those sessions raise, such as green.' },
          id: { type: 'string', description: 'cancel: the wake id, or all.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      policy: 'state',
      runner: async (args) => {
        const now = Date.now();
        if (args.action === 'list') {
          const pending = sources.wakes();
          return { output: pending.length ? pending.map((wake) => describeWake(wake, now)).join('\n') : 'No wakes are pending.' };
        }
        if (args.action === 'cancel') {
          if (typeof args.id !== 'string' || !args.id) return error('cancel needs the id of a wake, or all.');
          const removed = sources.cancelWake(args.id);
          return removed.length ? { output: `Cancelled ${removed.map((wake) => wake.id).join(', ')}.` } : error(`No wake ${args.id} is pending.`);
        }
        if (args.action !== 'set') return error('action is set, cancel, or list.');
        let when: WakeSpec['when'];
        if (args.sessions !== undefined || args.flag !== undefined) {
          const named = flagName(String(args.flag ?? ''));
          if ('error' in named) return error(named.error);
          when = { sessions: Array.isArray(args.sessions) ? args.sessions.map(String) : [], flag: named.flag };
        }
        const made = sources.setWake({
          prompt: String(args.prompt ?? ''),
          ...(typeof args.after_seconds === 'number' ? { afterSeconds: args.after_seconds } : {}),
          ...(when ? { when } : {}),
          by: 'model',
        });
        if ('error' in made) return error(made.error);
        return { output: `Set ${describeWake(made.wake, now)}. End your turn now; the harness sends the prompt when it goes off.` };
      },
    },
    {
      name: 'flag',
      tier: 'extended',
      description:
        "Raise or lower a flag on this session, on a board every JamCLI on this machine reads, so other sessions waiting on it can start. A raised flag stays until lowered, even after this session ends. list shows the named sessions' raised flags (by id or name), or this session's.",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['raise', 'lower', 'list'] },
          flag: { type: 'string', description: 'raise, lower: one word, such as green.' },
          sessions: { type: 'array', items: { type: 'string' }, description: 'list: sessions by id or name.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      policy: 'state',
      runner: async (args) => {
        if (args.action === 'list') {
          const listed = sources.flags(Array.isArray(args.sessions) ? args.sessions.map(String) : []);
          if ('error' in listed) return error(listed.error);
          return { output: listed.map((entry) => `${entry.session}: ${entry.flags.length ? entry.flags.join(', ') : 'no flag raised'}`).join('\n') };
        }
        if (args.action !== 'raise' && args.action !== 'lower') return error('action is raise, lower, or list.');
        const named = flagName(String(args.flag ?? ''));
        if ('error' in named) return error(named.error);
        if (args.action === 'raise') sources.raiseFlag(named.flag);
        else sources.lowerFlag(named.flag);
        return { output: `${args.action === 'raise' ? 'Raised' : 'Lowered'} ${named.flag} on this session.` };
      },
    },
  ];
}
