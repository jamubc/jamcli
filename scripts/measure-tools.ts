#!/usr/bin/env bun
/**
 * What each built-in tool costs a request, by the runtime's own estimate, on the wire
 * schema the model sees and on the full schema a call is checked against. Run it after
 * changing a schema or a description, and paste the table into the commit body.
 *
 *   bun scripts/measure-tools.ts
 */
import { BUILTIN_TOOLS } from '../src/core/tools/builtins.ts';
import { estimateText } from '../src/core/context/estimate.ts';

const cost = (tool: (typeof BUILTIN_TOOLS)[number], schema: unknown) =>
  estimateText(JSON.stringify({ type: 'function', function: { name: tool.name, description: tool.description, parameters: schema } }));
const rows = BUILTIN_TOOLS.filter((tool) => !tool.hidden)
  .map((tool) => ({ name: tool.name, tier: tool.tier ?? 'extended', full: cost(tool, tool.inputSchema), wire: cost(tool, tool.wireSchema ?? tool.inputSchema) }))
  .sort((a, b) => b.wire - a.wire);
console.log('| tool | tier | full | wire |');
console.log('|---|---|---|---|');
for (const row of rows) console.log(`| ${row.name} | ${row.tier} | ${row.full} | ${row.wire} |`);
const sum = (rows: { wire: number }[]) => rows.reduce((total, row) => total + row.wire, 0);
console.log(`| total (${rows.length} tools) | | ${rows.reduce((total, row) => total + row.full, 0)} | ${sum(rows)} |`);
console.log(`| core tier (${rows.filter((row) => row.tier === 'core').length} tools) | | | ${sum(rows.filter((row) => row.tier === 'core'))} |`);
