//usage: node --expose-gc --max-old-space-size=12000 write-snapshot.js <bscDir> <args.json> <out.heapsnapshot>   (run from the project dir)
//validate a project, then write a heap snapshot of everything still alive
const v8 = require('v8');
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, watch: false, logLevel: 'error' });
    global.gc(); global.gc();
    console.log('heap MB', (process.memoryUsage().heapUsed / 1048576).toFixed(1));
    const file = v8.writeHeapSnapshot(process.argv[4]);
    console.log('wrote', file);
    globalThis.keep = builder; //keep the program alive through the snapshot
})();
