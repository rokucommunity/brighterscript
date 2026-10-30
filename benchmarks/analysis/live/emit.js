//usage: node --max-old-space-size=8000 emit.js <bscDir> <args.json> <outDir>   (run from the project dir; diff two outDirs with `diff -rq`)
//build a project into `outDir` with the given bsc, writing every transpiled file (plus source maps).
//ProgramBuilder skips writing when there are error diagnostics, so validate with noEmit and then transpile directly
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, outDir: process.argv[4], sourceMap: true, createPackage: false, noEmit: true, validate: true, watch: false, logLevel: 'error' });
    await builder.transpile();
    console.log('emitted', Object.keys(builder.program.files).length, 'files');
})();
