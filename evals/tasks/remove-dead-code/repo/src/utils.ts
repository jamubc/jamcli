export const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

export function legacyFormat(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export const slugKey = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, '-');
