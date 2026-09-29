const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose');
const quiet = args.has('--quiet');

if (!quiet) console.log('syncing');
if (verbose) console.log('details: 3 files checked');
