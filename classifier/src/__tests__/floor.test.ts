import { expect, test } from 'bun:test';
import { hardFloor } from '../floor.js';

const floor = (command: string) => hardFloor('run_command', { command }, '/work/app');

test('a model may weigh commands that read, build, and test', () => {
  for (const command of ['ls -la', 'git status', 'git diff HEAD~1', 'git log --oneline', 'bun test src/a.test.ts', 'npm run build', 'cat package.json | head', 'grep -rn foo src', 'node scripts/x.js', 'curl -s https://example.com/health', 'echo hi > notes.txt', 'mkdir -p out', 'cd src && ls']) {
    expect({ command, floor: floor(command) }).toEqual({ command, floor: undefined });
  }
});

test('nothing that hides code, cannot be undone, leaves the machine, or touches the project from outside is ever a model\'s to allow', () => {
  const cases: [string, RegExp][] = [
    ['eval "$X"', /hides code/],
    ['ls $(pwd)', /hides code/],
    ['bash -c "ls"', /hides code/],
    ['echo x > /etc/hosts', /redirects/],
    ['echo x > $OUT', /redirects/],
    ['rm -rf dist', /rm/],
    ['rm file.txt', /rm/],
    ['kill -9 123', /kill/],
    ['git push origin main', /git push/],
    ['git reset --hard HEAD', /reset --hard/],
    ['git checkout .', /checkout/],
    ['git branch -D old', /branch -d/],
    ['git stash drop', /stash/],
    ['git commit -m x --force', /force/],
    ['git clean -fd', /git clean/],
    ['scp a.txt host:/tmp', /scp/],
    ['ssh host ls', /ssh/],
    ['curl -X POST https://x -d @f', /sends data/],
    ['curl --data foo https://x', /sends data/],
    ['wget --post-data=a https://x', /sends data/],
    ['chmod -R 777 .', /chmod -R/],
    ['npm publish', /publishes/],
    ['docker push img', /docker/],
    ['kubectl delete pod x', /infrastructure/],
    ['terraform apply', /infrastructure/],
    ['sudo ls', /sudo|privileges/],
    ['ls && rm x', /rm/],
  ];
  for (const [command, expected] of cases) {
    const why = floor(command);
    expect({ command, why }).toEqual({ command, why: expect.stringMatching(expected) });
  }
  expect(hardFloor('git_commit', {}, '/work/app')).toContain('asked every time');
  expect(hardFloor('edit', { path: 'a.ts' }, '/work/app')).toBeUndefined();
});
