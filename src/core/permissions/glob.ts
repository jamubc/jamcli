/**
 * Standard glob matching for permission rules: `*` and `?` stay within one path segment,
 * `**` crosses segments, `[...]` is a character class, and `{a,b}` is a choice. Unlike
 * gitignore patterns, `*.ts` matches only at the top; `**\/*.ts` matches at any depth.
 */

const escapeRegExp = (text: string) => text.replace(/[.+^${}()|[\]\\/]/g, '\\$&');

const convert = (glob: string): string => {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) {
        out += '\\[';
        continue;
      }
      let body = glob.slice(i + 1, end).replace(/\\/g, '\\\\');
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body}]`;
      i = end;
    } else if (char === '{') {
      const end = glob.indexOf('}', i + 1);
      if (end === -1) {
        out += '\\{';
        continue;
      }
      out += `(?:${glob.slice(i + 1, end).split(',').map(convert).join('|')})`;
      i = end;
    } else {
      out += escapeRegExp(char);
    }
  }
  return out;
};

/** A matcher for one glob. A trailing slash means the directory and everything in it. */
export function globMatcher(glob: string, options: { caseInsensitive?: boolean } = {}): (subject: string) => boolean {
  const normalized = glob.endsWith('/') ? `${glob}**` : glob;
  const regex = new RegExp(`^${convert(normalized)}$`, options.caseInsensitive ? 'i' : '');
  return (subject) => regex.test(subject);
}

/** File systems on macOS and Windows ignore case, so rules about paths must too. */
export const pathsIgnoreCase = (platform: string = process.platform) => platform === 'darwin' || platform === 'win32';
