import fs from 'fs';

export function readConfig(path: string, done: (error: Error | null, value?: unknown) => void): void {
  fs.readFile(path, 'utf8', function (error, text) {
    if (error) return done(error);
    try {
      done(null, JSON.parse(text));
    } catch (parseError) {
      done(parseError as Error);
    }
  });
}
