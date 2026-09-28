import { expect, test } from 'bun:test';
import { averagePrecision, certifyN, ece, gate, logLoss, operatingCurve, policyRow, rocAuc, wilsonUpper } from '../metrics.js';

test('the upper bound falls as evidence grows and never reads zero events as zero risk', () => {
  expect(wilsonUpper(0, 0)).toBe(1);
  expect(wilsonUpper(0, 10)).toBeGreaterThan(0.2);
  expect(wilsonUpper(0, 149)).toBeLessThanOrEqual(0.02);
  expect(wilsonUpper(0, 100)).toBeGreaterThan(0.02);
  expect(wilsonUpper(1, 100)).toBeGreaterThan(wilsonUpper(0, 100));
  expect(certifyN(0.02)).toBe(149);
  expect(certifyN(0.01)).toBe(299);
});

test('AUC handles ties and missing classes; average precision rewards ranking the rare class first', () => {
  expect(rocAuc([0.9, 0.8, 0.2, 0.1], [true, true, false, false])).toBe(1);
  expect(rocAuc([0.1, 0.2, 0.8, 0.9], [true, true, false, false])).toBe(0);
  expect(rocAuc([0.5, 0.5, 0.5, 0.5], [true, false, true, false])).toBe(0.5);
  expect(rocAuc([0.5, 0.6], [true, true])).toBeUndefined();
  expect(averagePrecision([0.9, 0.1, 0.2, 0.3], [true, false, false, false])).toBe(1);
  expect(averagePrecision([0.1, 0.9, 0.2, 0.3], [true, false, false, false])).toBe(0.25);
});

test('log loss and calibration error are zero for a perfect, confident model and large for a wrong one', () => {
  expect(logLoss([1, 0], [1, 0])).toBeLessThan(1e-6);
  expect(logLoss([0, 1], [1, 0])).toBeGreaterThan(10);
  expect(ece([1, 1, 0, 0], [1, 1, 0, 0])).toBe(0);
  expect(ece([0.9, 0.9, 0.9, 0.9], [1, 0, 0, 0])).toBeCloseTo(0.65, 5);
});

test('a policy row counts what it would have allowed against what the person denied', () => {
  const row = policyRow('p', [true, true, false, true], [false, true, true, false]);
  expect(row).toMatchObject({ k: 3, falseAllows: 1, coverage: 0.75 });
  expect(row.far).toBeCloseTo(1 / 3, 5);
});

test('the operating curve auto-allows down the ranking, ties together, and the gate takes the largest bounded prefix', () => {
  const items = [
    ...Array.from({ length: 300 }, (_, i) => ({ p: 0.99 - i * 0.0001, deny: false })),
    { p: 0.5, deny: true },
    ...Array.from({ length: 20 }, () => ({ p: 0.4, deny: false })),
  ];
  const curve = operatingCurve(items);
  expect(curve[0]).toMatchObject({ k: 1, falseAllows: 0 });
  expect(curve.at(-1)).toMatchObject({ k: 321, falseAllows: 1 });
  expect(curve.find((point) => point.threshold === 0.4)?.k).toBe(321);
  // One false allow in 321 is bounded under 2%, so the looser budget accepts it; a 1% budget stops before the denial.
  const loose = gate(curve, 0.02);
  expect(loose.best).toMatchObject({ k: 321, falseAllows: 1 });
  expect(loose.best!.farUpper).toBeLessThanOrEqual(0.02);
  const report = gate(curve, 0.01);
  expect(report.passed).toBe(true);
  expect(report.best).toMatchObject({ k: 300, falseAllows: 0 });
  const few = gate(operatingCurve(items.slice(0, 40)), 0.02);
  expect(few.passed).toBe(false);
  expect(few.reason).toContain('needs about 149');
  expect(gate([], 0.02).passed).toBe(false);
});
