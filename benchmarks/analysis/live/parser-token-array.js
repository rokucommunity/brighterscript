//usage: node --max-old-space-size=8000 parser-token-array.js <bscDir> <args.json>   (run from the project dir)
//how many tokens does parser.tokens hold, and how many of them is it the ONLY thing keeping alive (not reachable from the AST or trivia)?
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, watch: false, logLevel: 'error' });
    let inArray = 0, onlyInArray = 0; const byKind = {};
    for (const file of Object.values(builder.program.files)) {
        if (!bsc.isBrsFile(file)) { continue; }
        const reachable = new Set();
        const add = t => { if (t && !reachable.has(t)) { reachable.add(t); (t.leadingTrivia ?? []).forEach(add); } };
        file.ast.walk(bsc.createVisitor({ AstNode: n => { for (const t of Object.values(n.tokens ?? {})) { Array.isArray(t) ? t.forEach(add) : add(t); } (n.leadingTrivia ?? []).forEach(add); (n.endTrivia ?? []).forEach(add); } }), { walkMode: bsc.WalkMode.visitAllRecursive });
        (file.ast.tokens ? Object.values(file.ast.tokens) : []).forEach(add);
        for (const t of file.parser.tokens) {
            inArray++;
            if (!reachable.has(t)) { onlyInArray++; byKind[t.kind] = (byKind[t.kind] ?? 0) + 1; }
        }
    }
    console.log({ inArray: inArray, onlyInArray: onlyInArray, arrayPointersMB: (inArray * 8 / 1048576).toFixed(1), topOnlyInArray: Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e.join('=')).join(', ') });
})();
