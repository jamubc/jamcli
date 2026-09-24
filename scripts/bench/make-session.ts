/**
 * Write a session of `count` messages into a project, for the interface benchmark:
 * `bun scripts/bench/make-session.ts <project> [count]`. Prints the session id.
 */
import { SessionLog } from '../../src/core/transcript/index.js';

const [project, countText] = process.argv.slice(2);
if (!project) throw new Error('Usage: make-session.ts <project> [count]');
const count = Number(countText ?? 1000);
const log = SessionLog.create(project, { surface: 'tui' });
const reply = (index: number) =>
  [
    `Step ${index}: here is what changed.`,
    '',
    '```ts',
    `export function step${index}(value: number): number {`,
    `  return value * ${index};`,
    '}',
    '```',
    '',
    `- checked the tests for step ${index}`,
    `- **all passing**`,
  ].join('\n');
for (let index = 0; index < count; index += 1) {
  const user = index % 2 === 0;
  log.append({ type: 'message', message: { role: user ? 'user' : 'assistant', content: user ? `Please do step ${index / 2}.` : reply(index), timestamp: Date.now() } });
}
log.updateIndex();
process.stdout.write(`${log.id}\n`);
