import path from 'path';
import { analyzeCommand } from '../../src/core/permissions/command.js';

/** Tools the engine asks about every time, whatever a rule or a mode says. */
const ALWAYS_ASK = new Set(['git_commit', 'exit_plan_mode']);
const DESTROYS = new Set(['rm', 'rmdir', 'dd', 'mkfs', 'shred', 'truncate', 'kill', 'pkill', 'killall']);
const EGRESS = new Set(['scp', 'rsync', 'ssh', 'sftp', 'ftp', 'nc', 'ncat', 'telnet', 'socat']);
const CONTROL_PLANE = new Set(['kubectl', 'terraform', 'gcloud', 'aws', 'az', 'helm', 'pulumi']);
const GIT_DESTRUCTIVE = new Set(['push', 'clean', 'rebase', 'filter-branch', 'gc', 'prune', 'reflog', 'config']);
const SAFE_REDIRECTS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

const words = (part: string) => part.split(/\s+/).filter(Boolean);
const program = (word: string | undefined) => (word ?? '').replace(/^.*\//, '');

const outside = (target: string, root: string): boolean => {
  if (SAFE_REDIRECTS.has(target)) return false;
  const resolved = path.resolve(root, target);
  return !(resolved === root || resolved.startsWith(root + path.sep));
};

/**
 * Why a call is beyond any learned model's authority, or nothing when a model may weigh
 * in. It is deterministic and stricter than the permission engine: the engine asks about
 * hidden code and the like, and this also keeps a model away from what cannot be undone.
 * A person can still allow any of it; a classifier can never allow it for them.
 */
export function hardFloor(tool: string, args: Record<string, unknown>, projectRoot: string): string | undefined {
  if (ALWAYS_ASK.has(tool)) return `${tool} is asked every time`;
  if (tool !== 'run_command') return undefined;
  const command = typeof args.command === 'string' ? args.command : '';
  const analysis = analyzeCommand(command);
  const root = path.resolve(projectRoot);
  if (analysis.hidden.length) return `it hides code: ${analysis.hidden[0]}`;
  if (!analysis.parts.length) return 'it runs nothing the parts show';
  const bad = analysis.redirects.find((redirect) => redirect.dynamic || outside(redirect.target, root));
  if (bad) return `it redirects to ${bad.target || 'an expansion'}`;
  for (const part of analysis.parts) {
    const w = words(part);
    const name = program(w[0]);
    const rest = w.slice(1);
    if (DESTROYS.has(name)) return `${name} destroys or stops something`;
    if (EGRESS.has(name)) return `${name} sends data off the machine`;
    if (CONTROL_PLANE.has(name)) return `${name} changes remote infrastructure`;
    if ((name === 'chmod' || name === 'chown') && rest.some((word) => /^-\w*R/.test(word))) return `${name} -R changes many files`;
    if ((name === 'curl' || name === 'wget') && rest.some((word) => /^(-X|--request|-d|--data|--data-\w+|-F|--form|-T|--upload-file|--post-\w+)$/.test(word.split('=')[0]) || /^-[A-Za-z]*[dFT]$/.test(word))) return `${name} sends data`;
    if (name === 'git') {
      const at = rest.findIndex((word) => !word.startsWith('-'));
      const sub = at === -1 ? '' : rest[at];
      const args2 = rest.slice(at + 1);
      if (GIT_DESTRUCTIVE.has(sub)) return `git ${sub} cannot be undone locally`;
      if (sub === 'reset' && args2.includes('--hard')) return 'git reset --hard discards work';
      if (sub === 'checkout' && (args2.includes('.') || args2.includes('--'))) return 'git checkout discards work';
      if (sub === 'branch' && args2.some((word) => /^-[dD]$|^--delete$/.test(word))) return 'git branch -d deletes a branch';
      if (sub === 'stash' && args2.some((word) => word === 'drop' || word === 'clear')) return 'git stash drop discards work';
      if (rest.some((word) => word === '--force' || word === '-f' || word.startsWith('--force-'))) return 'git --force overrides a safety';
    }
    if (['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'twine', 'gem'].includes(name) && rest.some((word) => word === 'publish' || word === 'upload' || word === 'push')) return `${name} publishes`;
    if (name === 'docker' && rest.some((word) => ['push', 'rm', 'rmi', 'prune', 'kill', 'stop'].includes(word))) return 'docker changes containers or images';
    if (name === 'sudo' || name === 'su' || name === 'doas') return `${name} raises privileges`;
  }
  return undefined;
}
