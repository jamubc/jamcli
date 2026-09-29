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

test('interpreters, escalation, and settings that change what runs are hidden', () => {
  expect(analyzeCommand('python3 -c "import os"').hidden).toContain('python3 -c');
  expect(analyzeCommand('node -e "process.exit()"').hidden).toContain('node -e');
  expect(analyzeCommand('bash <<EOF\nrm -rf /\nEOF').hidden).toContain('bash runs code from its input');
  expect(analyzeCommand('python -').hidden).toContain('python runs code from its input');
  expect(analyzeCommand('bash build.sh').hidden).toEqual([]);
  expect(analyzeCommand('node --version').hidden).toEqual([]);
  expect(analyzeCommand('sudo rm -rf /').hidden).toContain('sudo raises privileges');
  expect(analyzeCommand("git -c core.pager='less' log").hidden).toContain('git -c');
  expect(analyzeCommand('git --exec-path=/tmp/x status').hidden).toContain('git --exec-path');
  expect(analyzeCommand('git config core.hooksPath /tmp/h').hidden).toContain('git config');
  expect(analyzeCommand('git commit -c HEAD').hidden).toEqual([]);
  expect(analyzeCommand('npm --script-shell /tmp/x test').hidden).toContain('npm --script-shell');
  expect(analyzeCommand('npx -p evil tsc').hidden).toContain('npx -p');
  expect(analyzeCommand('npx tsc --noEmit').hidden).toEqual([]);
  expect(analyzeCommand('make SHELL=/tmp/x').hidden).toContain('make SHELL=');
  expect(analyzeCommand('PATH=/tmp/x npm test').hidden).toContain('PATH changes what runs');
  expect(analyzeCommand('LD_PRELOAD=x.so ls').hidden).toContain('LD_PRELOAD changes what runs');
  expect(analyzeCommand('PATH=/tmp/x; npm test').hidden).toContain('PATH changes what runs');
  expect(analyzeCommand('CI=1 npm test').hidden).toEqual([]);
});

test('wrappers and assignments are stripped, so a rule names the program that runs', () => {
  expect(analyzeCommand('nohup npm start').parts).toEqual(['npm start']);
  expect(analyzeCommand('env CI=1 npm test').parts).toEqual(['npm test']);
  expect(analyzeCommand('CI=1 FOO=bar npm test').parts).toEqual(['npm test']);
  expect(analyzeCommand('timeout -k 5 30 npm test').parts).toEqual(['npm test']);
  expect(analyzeCommand('nice -n 5 exec npm test').parts).toEqual(['npm test']);
  expect(analyzeCommand('command -v npm').parts).toEqual(['npm']);
  // Alone, a wrapper is what runs: `env` prints the environment.
  expect(analyzeCommand('env').parts).toEqual(['env']);
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

test('a wrapper with nothing after it is the program that runs, not nothing', () => {
  // The shell still runs `env` here, which prints the environment.
  expect(analyzeCommand('ls | env').parts).toEqual(['ls', 'env']);
  expect(analyzeCommand('nice').parts).toEqual(['nice']);
  expect(analyzeCommand('FOO=1 env -i').parts).toEqual(['env -i']);
  expect(analyzeCommand('env x=1').parts).toEqual(['env x=1']);
  // With a command after it, the command is still what a rule is about.
  expect(analyzeCommand('env FOO=1 timeout 5 ls').parts).toEqual(['ls']);
});

test('a # starts a comment only at the start of a word, as the shell reads it', () => {
  // After an escaped space, # is part of the word, and what follows it runs.
  expect(analyzeCommand('tree \; \\ #$(rm) log').hidden).toContain('command substitution $(...)');
  expect(analyzeCommand('ls a\\ #b').parts).toEqual(['ls a\\ #b']);
  expect(analyzeCommand('ls #b; rm x').parts).toEqual(['ls']);
  expect(analyzeCommand('ls;#b').parts).toEqual(['ls']);
});

test('>& before a word that is not a descriptor writes to a file of that name', () => {
  const targets = (line: string) => analyzeCommand(line).redirects.map((redirect) => [redirect.op, redirect.target]);
  expect(targets('file 2 >&1-bin=sh')).toEqual([['>&', '1-bin=sh']]);
  expect(targets('ls >& out.txt')).toEqual([['>&', 'out.txt']]);
  expect(targets('ls >&2x')).toEqual([['>&', '2x']]);
  // Duplicating or closing a descriptor names no file.
  expect(targets('ls 2>&1 >&2 <&0 >&-')).toEqual([]);
});
