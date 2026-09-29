export const isValidEmail = (value: string): boolean => /^[a-z0-9.]+@[a-z0-9-]+\.[a-z]{2,}$/i.test(value);
