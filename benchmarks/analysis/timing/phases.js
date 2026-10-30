//usage: node --expose-gc --max-old-space-size=8000 phases.js <bscDir> <args.json> lex|parse|transpile   (run from the project dir)
//time one phase for one bsc build: prints the median ms per pass over every file in the project
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
const phase = process.argv[4];
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, watch: false, logLevel: 'error' });
    const program = builder.program;
    const brsFiles = Object.values(program.files).filter(f => f.extension === '.brs' || f.extension === '.bs');
    const passes = { lex: 25, parse: 15, transpile: 5 }[phase];
    let run;
    if (phase === 'lex') {
        run = () => { for (const f of brsFiles) { bsc.Lexer.scan(f.fileContents, { srcPath: f.srcPath }); } };
    } else if (phase === 'parse') {
        run = () => {
            for (const f of brsFiles) {
                const { tokens } = bsc.Lexer.scan(f.fileContents, { srcPath: f.srcPath });
                bsc.Parser.parse(tokens, { mode: f.extension === '.bs' ? bsc.ParseMode.BrighterScript : bsc.ParseMode.BrightScript, srcPath: f.srcPath });
            }
        };
    } else {
        const files = Object.values(program.files).filter(f => bsc.isBrsFile(f) || bsc.isXmlFile(f));
        run = async () => { for (const f of files) { f.needsTranspiled = true; await program.getTranspiledFileContents(f.srcPath); } };
    }
    await run(); await run(); //warm up
    const times = [];
    for (let i = 0; i < passes; i++) {
        global.gc();
        const start = performance.now();
        await run();
        times.push(performance.now() - start);
    }
    console.log(median(times).toFixed(1));
})();
