//usage: node --allow-natives-syntax --max-old-space-size=8000 token-hidden-classes.js <bscDir> <args.json>   (run from the project dir)
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, copyToStaging: false, watch: false, logLevel: 'error' });
    const seen = new Set();
    const visit = t => { if (!t || seen.has(t)) { return; } seen.add(t); for (const x of t.leadingTrivia ?? []) { visit(x); } };
    //tokens from the lexer token arrays, plus every token reachable from AST nodes (parser/creator-made ones too)
    for (const file of Object.values(builder.program.files)) {
        for (const t of file.parser?.tokens ?? []) { visit(t); }
        file.ast?.walk?.(bsc.createVisitor({ AstNode: n => { for (const t of Object.values(n.tokens ?? {})) { Array.isArray(t) ? t.forEach(visit) : visit(t); } } }), { walkMode: bsc.WalkMode.visitAllRecursive });
    }
    const reps = []; let slow = 0;
    for (const t of seen) {
        if (!%HasFastProperties(t)) { slow++; }
        let rep = reps.find(r => %HaveSameMap(r.t, t));
        if (!rep) { rep = { t: t, n: 0 }; reps.push(rep); }
        rep.n++;
    }
    console.log('tokens', seen.size, 'dictionary-mode', slow, 'hidden classes', reps.length);
    for (const r of reps.sort((a, b) => b.n - a.n)) {
        console.log(String(r.n).padStart(7), r.t.constructor.name.padEnd(12), Object.keys(r.t).join(','));
    }
})();
