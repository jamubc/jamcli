import { formatDate, slugKey } from './utils';

export const reportName = (title: string, date: Date): string => `${slugKey(title)}-${formatDate(date)}`;
