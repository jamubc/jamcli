import { expect, test } from 'bun:test';
import { readConfig } from './files';

test('reads and parses the file', async () => expect(await readConfig('./fixture.json')).toEqual({ ok: true }));
test('rejects when the file is missing', async () => expect(readConfig('./missing.json')).rejects.toThrow());
