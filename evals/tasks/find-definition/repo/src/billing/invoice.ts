export interface Invoice {
  number: string;
  total: number;
}

export function parseInvoice(text: string): Invoice {
  const [number, total] = text.split(',');
  return { number: number.trim(), total: Number(total) };
}
