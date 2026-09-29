import { parseInvoice } from './billing';

export const totalOf = (line: string) => parseInvoice(line).total;
