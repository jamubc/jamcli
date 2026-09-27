import { expect, test } from 'bun:test';
import { BUILTIN_COMMANDS } from '../builtin/index.js';
import { hostFixture, said } from './fixture.js';

const { open } = hostFixture();

/**
 * Surface parity: every built-in command runs where there is no screen, through the same
 * definition the interface runs. There is no list of exceptions for this to consult. A
 * command that throws, or that does nothing anyone could see, fails it.
 */
for (const command of BUILTIN_COMMANDS) {
  test(`/${command.name} runs without a screen`, async () => {
    const { host, entries, turns } = await open();
    await host.run(`/${command.name}`);
    expect(said(entries)).not.toContain(`/${command.name} failed:`);
    expect(entries.length + turns.length).toBeGreaterThan(0);
  }, 20_000);
}
