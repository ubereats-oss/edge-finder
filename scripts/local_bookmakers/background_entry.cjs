const path = require('node:path');
const { run, trackChild } = require('./resource_lock.cjs');
const root = process.env.EDGE_DATA_ROOT;
const releaseRoot = process.argv[2];
trackChild(root, process.pid);
trackChild(root, Number(process.env.EDGE_BACKGROUND_WORKER_PID));
run(root, process.execPath, [path.join(releaseRoot, 'pipeline', 'local_betano_reader.js')])
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
