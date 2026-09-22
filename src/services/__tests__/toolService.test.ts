import { test, expect } from 'bun:test';
import path from 'node:path';
import { ToolService } from '../ToolService.js';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

test('ToolService returns a string result for a repository listing', async () => {
  const service = new ToolService({ projectRoot });
  const result = await service.execute({ tool: 'list_files', params: { pattern: 'package.json' } });
  expect(typeof result.output).toBe('string');
  expect(result.output).toContain('package.json');
});
