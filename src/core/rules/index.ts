import fs from 'fs';
import path from 'path';

export const DEFAULT_RULE_FILES = ['AGENTS.md', 'CLAUDE.md', '.jamcli/rules.md'];
export const RULES_DIR = '.jamcli/rules';

export interface RuleSection {
  name?: string;
  condition?: string;
  body: string;
}

export interface LoadedRule {
  path: string;
  displayPath: string;
  scope: 'global' | 'project' | 'path';
  sections: RuleSection[];
}

export interface RulesReport {
  files: LoadedRule[];
  applied: RuleSection[];
  systemText: string;
}

const isInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const ruleDirectories = (projectRoot: string, cwd: string): string[] => {
  const root = path.resolve(projectRoot);
  const target = path.resolve(cwd);
  if (!isInside(root, target)) return [root];
  const segments: string[] = [];
  let current = root;
  segments.push(current);
  const relative = path.relative(root, target);
  if (relative) {
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      segments.push(current);
    }
  }
  return segments;
};

const parseSections = (content: string): RuleSection[] => {
  const sections: RuleSection[] = [];
  const lines = content.split('\n');
  let current: RuleSection = { body: '' };
  let body: string[] = [];

  const flush = () => {
    current.body = body.join('\n').trim();
    if (current.body) sections.push(current);
  };

  for (const line of lines) {
    const heading = /^#\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const title = heading[1].trim();
      const condition = /^when\s*:\s*(.+)$/i.exec(title);
      current = condition ? ({ condition: condition[1].trim() } as RuleSection) : ({ name: title } as RuleSection);
      body = [];
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
};

export const loadRules = (projectRoot: string, cwd: string, files = DEFAULT_RULE_FILES): RulesReport => {
  const directories = ruleDirectories(projectRoot, cwd);
  const loaded: LoadedRule[] = [];

  for (const directory of directories) {
    const candidates: string[] = files.map((file) => path.join(directory, file));
    const rulesDir = path.join(directory, RULES_DIR);
    if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) {
      for (const entry of fs.readdirSync(rulesDir).sort()) {
        if (entry.endsWith('.md')) candidates.push(path.join(rulesDir, entry));
      }
    }

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      const content = fs.readFileSync(candidate, 'utf8');
      loaded.push({
        path: candidate,
        displayPath: path.relative(projectRoot, candidate) || path.basename(candidate),
        scope: directory === path.resolve(projectRoot) ? 'project' : 'path',
        sections: parseSections(content),
      });
    }
  }

  return { files: loaded, applied: [], systemText: '' };
};

const globToRegExp = (pattern: string): RegExp => {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '.';
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(source);
};

const conditionMatches = (condition: string | undefined, subject?: string): boolean => {
  if (!condition) return true;
  if (!subject) return true;
  const normalized = subject.replace(/\\/g, '/');
  const conditions = condition.split(',').map((value) => value.trim()).filter(Boolean);
  return conditions.some((pattern) => {
    const expression = globToRegExp(pattern.replace(/\\/g, '/'));
    if (expression.test(normalized)) return true;
    if (!pattern.includes('/')) {
      return expression.test(normalized.split('/').pop() ?? normalized);
    }
    return false;
  });
};

export const applyRules = (report: RulesReport, subject?: string): RulesReport => {
  const applied: RuleSection[] = [];
  for (const file of report.files) {
    for (const section of file.sections) {
      if (conditionMatches(section.condition, subject)) applied.push(section);
    }
  }
  const systemText = applied
    .map((section, index) => {
      const header = section.name ? `## ${section.name}` : `## Instructions ${index + 1}`;
      return `${header}\n${section.body}`;
    })
    .join('\n\n');
  return { ...report, applied, systemText };
};

export const renderRulesReport = (report: RulesReport): string => {
  if (!report.files.length) return 'No instruction files loaded.';
  const lines = ['Instruction files:'];
  for (const file of report.files) {
    lines.push(`- ${file.displayPath} (${file.scope}, ${file.sections.length} sections)`);
  }
  if (report.applied.length) {
    lines.push('', `Applied sections for this turn: ${report.applied.length}`);
  }
  return lines.join('\n');
};

export const rulesPromptText = (report: RulesReport): string => {
  if (!report.systemText.trim()) return '';
  return ['# Project rules', '', report.systemText].join('\n');
};
