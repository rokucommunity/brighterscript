//usage: node --max-old-space-size=8000 token-stats.js <bscDir> <args.json>   (run from the project dir)
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, copyToStaging: false, watch: false, logLevel: 'error' });
    const seen = new Set();
    const byKind = {};
    let main = 0, trivia = 0, triviaArrays = 0, triviaArrayLen = 0, posObjs = new Set(), textChars = 0;
    const visit = (t, isTrivia) => {
        if (!t || seen.has(t)) { return; }
        seen.add(t);
        isTrivia ? trivia++ : main++;
        byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
        textChars += t.text?.length ?? 0;
        const r = t.location?.range ?? t.range;
        if (r) { posObjs.add(r.start); posObjs.add(r.end); }
        if (t.leadingTrivia) { triviaArrays++; triviaArrayLen += t.leadingTrivia.length; for (const x of t.leadingTrivia) { visit(x, true); } }
    };
    let files = 0;
    for (const file of Object.values(builder.program.files)) {
        const tokens = file.parser?.tokens ?? file._parser?.tokens;
        if (!tokens) { continue; }
        files++;
        for (const t of tokens) { visit(t, false); }
    }
    const top = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(JSON.stringify({ files, tokensReachable: seen.size, fromTokenArray: main, onlyInTrivia: trivia, triviaArrays, avgTriviaLen: (triviaArrayLen / triviaArrays).toFixed(2), positionObjects: posObjs.size, textChars, topKinds: top }, null, 1));
})();
