import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildRuntimePrompt,
  EXECUTION_GUIDANCE_PROMPT,
  PARALLEL_TOOL_CALL_GUIDANCE_PROMPT,
  shouldEnforceToolUse,
  shouldIncludeExecutionGuidance,
  TASK_COMPLETION_GUIDANCE_PROMPT,
  TOOL_USE_ENFORCEMENT_PROMPT,
} from '../prompt.js';
import { DEFAULT_RULE_FILES, loadRules } from '../../rules/index.js';

test('tool use enforcement is enabled for auto-list models and disabled for claude by default', () => {
  expect(shouldEnforceToolUse('auto', 'deepseek-chat')).toBe(true);
  expect(shouldEnforceToolUse('auto', 'gpt-4o')).toBe(true);
  expect(shouldEnforceToolUse('auto', 'gemini-1.5-pro')).toBe(true);
  expect(shouldEnforceToolUse('auto', 'qwen2.5-coder:7b')).toBe(true);
  expect(shouldEnforceToolUse('auto', 'claude-3-5-sonnet-20241022')).toBe(false);
  expect(shouldEnforceToolUse('auto', 'anthropic/claude-3-opus')).toBe(false);

  expect(shouldEnforceToolUse('on', 'claude-3-5-sonnet-20241022')).toBe(true);
  expect(shouldEnforceToolUse(true, 'claude-3-5-sonnet-20241022')).toBe(true);
  expect(shouldEnforceToolUse('off', 'deepseek-chat')).toBe(false);
  expect(shouldEnforceToolUse(false, 'deepseek-chat')).toBe(false);
});

test('execution guidance targets prone models under auto and respects explicit switches', () => {
  expect(shouldIncludeExecutionGuidance('auto', 'deepseek-chat')).toBe(true);
  expect(shouldIncludeExecutionGuidance('auto', 'claude-3-5-sonnet-20241022')).toBe(false);
  expect(shouldIncludeExecutionGuidance('on', 'claude-3-5-sonnet-20241022')).toBe(true);
  expect(shouldIncludeExecutionGuidance('off', 'deepseek-chat')).toBe(false);
});

test('buildRuntimePrompt prepends tool enforcement prompt at the very top for prone models', () => {
  const prompt = buildRuntimePrompt({
    tools: [{ name: 'read_file', description: '', parameters: {}, policyClass: 'read', source: 'builtin' }],
    projectRoot: '/test',
    cwd: '/test',
    model: 'deepseek:deepseek-chat',
  });

  expect(prompt.startsWith(TOOL_USE_ENFORCEMENT_PROMPT)).toBe(true);
  expect(prompt).toContain(PARALLEL_TOOL_CALL_GUIDANCE_PROMPT);
  expect(prompt).toContain(TASK_COMPLETION_GUIDANCE_PROMPT);
  expect(prompt).toContain(EXECUTION_GUIDANCE_PROMPT);
});

test('buildRuntimePrompt excludes tool enforcement for claude under auto', () => {
  const prompt = buildRuntimePrompt({
    tools: [{ name: 'read_file', description: '', parameters: {}, policyClass: 'read', source: 'builtin' }],
    projectRoot: '/test',
    cwd: '/test',
    model: 'anthropic:claude-3-7-sonnet',
  });

  expect(prompt.startsWith(TOOL_USE_ENFORCEMENT_PROMPT)).toBe(false);
  expect(prompt).not.toContain(TOOL_USE_ENFORCEMENT_PROMPT);
  expect(prompt).toContain(PARALLEL_TOOL_CALL_GUIDANCE_PROMPT);
  expect(prompt).toContain(TASK_COMPLETION_GUIDANCE_PROMPT);
});

test('DEFAULT_RULE_FILES includes SOUL.md and .jamcli/soul.md', () => {
  expect(DEFAULT_RULE_FILES).toContain('SOUL.md');
  expect(DEFAULT_RULE_FILES).toContain('.jamcli/soul.md');
});

test('loadRules loads SOUL.md standing instructions when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-soul-'));
  try {
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Standing instruction\nAct, do not narrate.');
    const report = loadRules(dir, dir);
    expect(report.files.some((f) => f.displayPath === 'SOUL.md')).toBe(true);
    expect(report.files.flatMap((f) => f.sections).some((s) => s.body.includes('Act, do not narrate.'))).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
