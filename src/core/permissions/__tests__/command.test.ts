import { expect, test } from 'bun:test';
import { analyzeCommand } from '../command.js';
import { globMatcher } from '../glob.js';

test('globs keep * within a segment and let ** cross them', () => {
  const ts = globMatcher('*.ts');
  expect(ts('a.ts')).toBe(true);
  expect(ts('src/a.ts')).toBe(false);
  const deep = globMatcher('**/*.ts');
  expect(deep('a.ts')).toBe(true);
  expect(deep('src/x/a.ts')).toBe(true);
  const src = globMatcher('src/**');
  expect(src('src/a/b.ts')).toBe(true);
  expect(src('srcx/a.ts')).toBe(false);
  expect(globMatcher('src/')('src/a.ts')).toBe(true);
  expect(globMatcher('{src,lib}/*.{ts,js}')('lib/a.js')).toBe(true);
  expect(globMatcher('file?.[ch]')('file1.c')).toBe(true);
  expect(globMatcher('[!.]*')('.env')).toBe(false);
  expect(globMatcher('a+b(1).txt')('a+b(1).txt')).toBe(true);
  expect(globMatcher('.env', { caseInsensitive: true })('.ENV')).toBe(true);
  expect(globMatcher('.env')('.ENV')).toBe(false);
});

test('compound commands split on every operator, outside quotes', () => {
  expect(analyzeCommand('npm test && rm -rf build; ls | wc -l || echo no & sleep 1').parts).toEqual([
    'npm test',
    'rm -rf build',
    'ls',
    'wc -l',
    'echo no',
    'sleep 1',
  ]);
  expect(analyzeCommand('echo "a && b; c | d"').parts).toEqual(['echo "a && b; c | d"']);
  expect(analyzeCommand(String.raw`echo 'x|y' \; done`).parts).toEqual([String.raw`echo 'x|y' \; done`]);
  expect(analyzeCommand('npm test\nnpm run lint').parts).toEqual(['npm test', 'npm run lint']);
  expect(analyzeCommand('(cd web && npm test)').parts).toEqual(['cd web', 'npm test']);
  expect(analyzeCommand('if test -f a; then cat a; else echo none; fi').parts).toEqual(['test -f a', 'cat a', 'echo none']);
  expect(analyzeCommand('npm test \\\n  --watch').parts).toEqual(['npm test --watch']);
  expect(analyzeCommand('npm test # && rm -rf /').parts).toEqual(['npm test']);
});

test('substitution and other hidden code are found wherever they appear', () => {
  expect(analyzeCommand('echo $(whoami)').hidden).toContain('command substitution $(...)');
  expect(analyzeCommand('echo "today is `date`"').hidden).toContain('command substitution `...`');
  expect(analyzeCommand("echo '$(not run)'").hidden).toEqual([]);
  expect(analyzeCommand('diff <(ls a) <(ls b)').hidden).toContain('process substitution');
  expect(analyzeCommand('eval "$CMD"').hidden).toContain('eval');
  expect(analyzeCommand('bash -c "rm -rf /"').hidden).toContain('bash -c');
  expect(analyzeCommand('/bin/sh -c ls').hidden).toContain('sh -c');
  expect(analyzeCommand('git ls-files | xargs rm').hidden).toContain('xargs runs a command from its input');
  expect(analyzeCommand('find . -name x -exec rm {} \;').hidden).toContain('find -exec');
  expect(analyzeCommand('. ./env.sh').hidden).toContain('. runs a script');
  expect(analyzeCommand('cat > out <<< "$(id)"').hidden).toContain('command substitution in a here-string');
  expect(analyzeCommand('echo hi > "$(mktemp)"').hidden).toContain('command substitution in a redirection');
  expect(analyzeCommand('echo "unterminated').hidden).toContain('an unterminated quote');
  expect(analyzeCommand('npm test && npm run build').hidden).toEqual([]);
});

test('redirections are collected and kept out of the parts', () => {
  const result = analyzeCommand('npm test > log.txt 2>&1 && cat < in.txt >> ~/out.log 2>/dev/null');
  expect(result.parts).toEqual(['npm test', 'cat']);
  expect(result.redirects.map((redirect) => [redirect.op, redirect.target])).toEqual([
    ['>', 'log.txt'],
    ['<', 'in.txt'],
    ['>>', '~/out.log'],
    ['>', '/dev/null'],
  ]);
  expect(analyzeCommand('echo x &> "all out.txt"').redirects[0]).toMatchObject({ op: '&>', target: 'all out.txt', dynamic: false });
  expect(analyzeCommand('echo x > $HOME/x').redirects[0].dynamic).toBe(true);
  expect(analyzeCommand('echo a2>x').parts).toEqual(['echo a2']);
});

test('here-document bodies are data, unless an unquoted one substitutes', () => {
  const quoted = analyzeCommand("cat > notes.txt <<'EOF'\nrm -rf /\n$(id)\nEOF\nnpm test");
  expect(quoted.parts).toEqual(['cat', 'npm test']);
  expect(quoted.hidden).toEqual([]);
  const unquoted = analyzeCommand('cat <<EOF\nuser is $(whoami)\nEOF');
  expect(unquoted.hidden).toContain('command substitution in a here-document');
  const stripped = analyzeCommand('cat <<-END\n\tbody\n\tEND\nls');
  expect(stripped.parts).toEqual(['cat', 'ls']);
});
