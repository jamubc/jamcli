import { expect, test } from 'bun:test';
import { analyzeCommand } from '../../permissions/command.js';
import { readOnlyReason } from '../readonly.js';

const root = '/proj';
const reason = (command: string) => readOnlyReason(analyzeCommand(command), root);

test('commands that only read inside the project are read-only', () => {
  for (const line of [
    'ls',
    'ls -la src',
    'cat package.json',
    'head -n 20 src/a.ts',
    'tail -f logs/app.log',
    'wc -l src/*.ts',
    'git status',
    'git diff --stat',
    'git log --oneline -5',
    'git show HEAD:src/a.ts',
    'git branch --list',
    'rg -n "TODO" src',
    'grep -rn pattern src | head -5',
    'find src -name "*.ts" -newer package.json',
    'tree -L 2 src',
    'cd src && ls',
    'ls 2>&1',
    'echo ---',
    'ls src; echo ---; ls tests',
  ]) {
    expect({ line, reason: reason(line) }).toEqual({ line, reason: undefined });
  }
});

test('anything that could write, run code, or leave the project is not', () => {
  const cases: [string, RegExp][] = [
    ['ls > out.txt', /redirects/],
    ['echo secret > notes.txt', /redirects/],
    ['echo $(cat .env)', /substitution/],
    ['echo $HOME', /cannot be checked/],
    ['cat a.txt | tee b.txt', /tee/],
    ['rm -rf src', /rm is not/],
    ['sed -i s/a/b/ src/a.ts', /sed is not/],
    ['ls $(pwd)', /substitution/],
    ['cat `ls`', /substitution/],
    ['find . -name "*.log" -delete', /-delete/],
    ['find . -exec rm {} \\;', /find -exec/],
    ['git branch -D main', /changes branches/],
    ['git branch new-branch', /changes branches/],
    ['git push origin main', /not a read-only subcommand/],
    ['git diff --output=patch.txt', /--output/],
    ['cat /etc/passwd', /outside the project/],
    ['cat ../secrets', /outside the project/],
    ['cat ~/.ssh/id_rsa', /outside the project/],
    ['ls; xargs rm', /xargs/],
    ['rg --pre cat x', /--pre/],
    ['tree -o out.html', /tree -o/],
    ['', /runs nothing/],
    ['sudo ls', /raises privileges/],
    ['bash -c ls', /bash -c/],
    // A read that is told to run a program is not a read.
    ['rg --hostname-bin=sh x', /--hostname-bin runs a command/],
    ['rg --hyperlink-format=default --hostname-bin reboot x', /--hostname-bin runs a command/],
    ['file -C -m magic', /file -C writes/],
    ['file --compile -m magic', /file --compile writes/],
    ['git diff --ext-diff', /--ext-diff runs a configured program/],
    ['git log -p --ext-diff', /--ext-diff runs a configured program/],
    ['git show --textconv HEAD:a.ts', /--textconv runs a configured program/],
  ];
  for (const [line, expected] of cases) {
    const why = reason(line);
    expect({ line, why }).toEqual({ line, why: expect.stringMatching(expected) });
  }
});
