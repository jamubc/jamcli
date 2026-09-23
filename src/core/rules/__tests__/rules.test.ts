import { test, expect } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { applyRules, loadRules, renderRulesReport, ruleDirectories } from '../index.js';

const makeTree = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-rules-'));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirpSync(nested);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Root rule\nAlways run the gates.\n');
  fs.writeFileSync(
    path.join(nested, 'AGENTS.md'),
    '# App rule\nKeep components small.\n\n# when: **/*.tsx\nUse the shared primitives.\n'
  );
  return { root, nested };
};

test('the hierarchy is collected outermost first', () => {
  const { root, nested } = makeTree();
  const report = loadRules(root, nested);
  expect(report.files.map((file) => file.displayPath)).toEqual(['AGENTS.md', 'packages/app/AGENTS.md']);
  expect(report.files[0].scope).toBe('project');
});

test('a path condition limits a section to matching work', () => {
  const { root, nested } = makeTree();
  const report = loadRules(root, nested);
  const forTsx = applyRules(report, 'packages/app/Button.tsx');
  const forMarkdown = applyRules(report, 'packages/app/README.md');
  expect(forTsx.applied.some((section) => section.body.includes('shared primitives'))).toBe(true);
  expect(forMarkdown.applied.some((section) => section.body.includes('shared primitives'))).toBe(false);
});

test('the composed prompt carries every applied section', () => {
  const { root, nested } = makeTree();
  const report = applyRules(loadRules(root, nested), 'packages/app/Button.tsx');
  expect(report.systemText).toContain('Always run the gates.');
  expect(report.systemText).toContain('Use the shared primitives.');
});

test('the report names every loaded file with its resolved path', () => {
  const { root, nested } = makeTree();
  const text = renderRulesReport(loadRules(root, nested));
  expect(text).toContain('AGENTS.md (project, 1 sections)');
  expect(text).toContain('packages/app/AGENTS.md (path, 2 sections)');
});

test('a working directory outside the root loads only the root', () => {
  const { root } = makeTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-outside-'));
  expect(ruleDirectories(root, outside)).toEqual([path.resolve(root)]);
});

test('a tree with no instruction files reports none', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-empty-'));
  const report = loadRules(empty, empty);
  expect(report.files).toEqual([]);
  expect(renderRulesReport(report)).toBe('No instruction files loaded.');
});
