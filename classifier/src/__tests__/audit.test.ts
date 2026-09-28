import { expect, test } from 'bun:test';
import { audit, formatAudit } from '../audit.js';
import type { Extraction } from '../extract.js';
import { make } from './model.test.js';

test('the audit says what the logs cannot support before any model is trained', () => {
  const examples = [
    ...Array.from({ length: 40 }, (_, i) => make(i, `s${i % 4}`, `bun test ${i % 3}`, 'allow')),
    make(50, 's1', 'make deploy', 'deny_call'),
    make(51, 's2', 'make deploy', 'deny_steer'),
    make(52, 's3', 'make deploy', 'deny_stop'),
    make(53, 's1', 'ls', 'system'),
    make(54, 's1', 'rm -rf x', 'deny_call', { floor: 'rm destroys or stops something' }),
  ];
  const extraction: Extraction = { examples, skipped: { nested: 2, unjoined: 0, surface: 0 }, files: 4 };
  const report = audit(extraction);
  expect(report.human).toBe(44);
  expect(report.domain).toMatchObject({ n: 43, allows: 40, denies: 3, strictDenies: 1 });
  expect(report.floor.excluded).toBe(1);
  expect(report.labels).toMatchObject({ allow: 40, deny_call: 2, deny_steer: 1, deny_stop: 1, system: 1 });
  expect(report.readiness.certifyN).toBe(149);
  const text = report.warnings.join('\n');
  expect(text).toContain('Provenance');
  expect(text).toContain('Only 3 denials');
  expect(text).toContain('Fewer than 3 projects');
  expect(text).toContain('One project holds 100%');
  expect(text).toContain('a stopped turn or steering');
  expect(formatAudit(report)).toContain('149 auto-allowed decisions');
});
