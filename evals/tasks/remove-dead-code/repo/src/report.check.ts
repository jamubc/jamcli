import { expect, test } from 'bun:test';
import { reportName } from './report';

test('a report is named by its title and date', () => expect(reportName(' Weekly Sales ', new Date('2026-09-29T00:00:00Z'))).toBe('weekly-sales-2026-09-29'));
