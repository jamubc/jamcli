/**
 * One proposer for the search loop: a jamcli headless run, in an empty folder with no
 * tools, reads the top clusters and the surface each is routed to, and answers with up
 * to four candidates as JSON. Any other proposer, a DSPy program or a person, fits the
 * same `propose` signature.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../../src/core/runtime/index.ts';
import type { Candidate, ProposerInput } from './loop.ts';
import type { Surface } from '../../src/core/eval/index.ts';

/** What each surface may change, in the words the proposer is given. */
const SURFACE_FIELDS: Record<Surface, string> = {
  tool_schema: '`tools.<name>.wireSchema` (a JSON Schema with fewer or better-described properties) or `tools.<name>.description`',
  tool_error: '`tools.<name>.description`: say what to do when the tool refuses, since the error text itself is code',
  prompt_reads: '`guidance` (the tool guidance block of the system prompt) and `readOnlyCommands` (programs run without asking when they only read)',
  prompt_dedupe: '`guidance`',
  backpressure: '`maxStopDenials` (0 to 3) and `stopTiers` (["T1"], ["T2"], or ["T1","T2"]), then `guidance`',
  after_edit: '`afterEditBoundMs` (the last duration above which the after-edit gate waits for the stop)',
  elision: '`elideAt` (0.3 to 0.9: the share of the compaction trigger at which older results are stubbed)',
  notes: '`guidance`',
  dedupe: '`guidance`',
  delegation: '`tools.task.description`',
  none: 'nothing',
};

export async function propose(input: ProposerInput): Promise<Candidate[]> {
  const model = process.env.JAMCLI_PROPOSER_MODEL ?? 'opencode-go:deepseek-v4.1-flash';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-proposer-'));
  try {
    const runtime = await createRuntime({ projectRoot: dir, surface: 'headless', mcp: false, model, allowTools: [] });
    const prompt = [
      'You are improving a coding agent harness. The model is fixed; only the harness changes. Do not use any tools.',
      'Below are the top failure clusters from the last trial and, for each, the one surface you may change. Propose at most 4 candidates, each changing only its surface, each a small, specific edit with a one-sentence rationale.',
      'Never mention a project, file, or task by name: a candidate must hold for any project.',
      'Reply with only a JSON array: [{"name": "<short-kebab>", "surface": "<surface>", "rationale": "<one sentence>", "harness": { ...only the fields the surface allows... }}]',
      '',
      ...input.clusters.map((entry, index) => {
        const surface = input.surfaces[index] ?? 'none';
        return [`Cluster ${index + 1}: ${entry.signature} (${entry.count} times in ${entry.sessions} sessions, ${entry.failedSessions} of them failed)`, `  examples: ${entry.examples.join(' | ')}`, `  surface: ${surface}; may change ${SURFACE_FIELDS[surface]}`].join('\n');
      }),
      '',
      input.history.length ? `Already tried: ${input.history.map((entry) => `${entry.candidate.name} on ${entry.candidate.surface} (${entry.accepted ? 'accepted' : 'rejected'}: ${entry.reason})`).join('; ')}` : 'Nothing tried yet.',
    ].join('\n');
    const result = await runtime.run(prompt, (event) => {
      if (event.type === 'approval_request') event.decide({ allow: false, scope: 'once' });
    });
    await runtime.close();
    const match = /\[[\s\S]*\]/.exec(result.response);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Candidate => Boolean(entry && typeof entry === 'object' && typeof (entry as Candidate).name === 'string' && (entry as Candidate).harness && typeof (entry as Candidate).harness === 'object'))
      .map((entry) => ({ name: entry.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase(), surface: entry.surface, harness: entry.harness, ...(entry.rationale ? { rationale: String(entry.rationale) } : {}) }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
