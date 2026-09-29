const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log('usage: tool [--help]');
} else {
  console.log('tool: nothing to do');
}
