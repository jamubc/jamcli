const args = process.argv.slice(2);
const exitCode = Number(args[0] ?? '0');
const mode = args[1];
const promptIndex = process.argv.indexOf('-p');
const prompt = promptIndex === -1 ? '' : process.argv[promptIndex + 1];

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (mode === 'slow') {
  setTimeout(() => {
    emit({ type: 'text', delta: 'late child' });
    process.exit(0);
  }, 5000);
} else {
  emit({ type: 'text', delta: 'child said: ' });
  emit({ type: 'text', delta: prompt });
  if (exitCode === 0) {
    emit({
      session_id: 'child-session-1',
      status: 'ok',
      response: `child said: ${prompt}`,
      turns: 1,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  } else {
    process.stderr.write('child failed on purpose\n');
  }
  process.exit(exitCode);
}
