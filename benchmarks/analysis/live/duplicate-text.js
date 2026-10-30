//usage: node --max-old-space-size=8000 duplicate-text.js <bscDir> <args.json>   (run from the project dir)
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
const strSize = s => s.length <= 1 ? 0 : (s.length >= 13 ? 32 : 16 + Math.ceil(s.length / 8) * 8); //1-char strings come from V8's single-char cache; >=13 become 32B sliced strings
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, copyToStaging: false, watch: false, logLevel: 'error' });
    let textBytes = 0, dupBytes = 0, arrays = 0, wsOnly = 0, len1AfterWs = 0, emptyAfterWs = 0;
    const fixed = new Set(['Whitespace', 'Newline', 'Dot', 'LeftParen', 'RightParen', 'Equal', 'Comma', 'Colon']);
    for (const file of Object.values(builder.program.files)) {
        const seen = new Set(); const perFile = new Map();
        const visit = t => {
            if (!t || seen.has(t)) { return; } seen.add(t);
            if (!fixed.has(t.kind) && !t.isReserved && t.text) {
                const sz = strSize(t.text); textBytes += sz;
                if (perFile.has(t.text)) { dupBytes += sz; } else { perFile.set(t.text, true); }
            }
            const lt = t.leadingTrivia;
            if (lt) {
                arrays++;
                const rest = lt.filter(x => x.kind !== 'Whitespace').length;
                if (rest === 0) { emptyAfterWs++; } else if (rest === 1) { len1AfterWs++; }
                lt.forEach(visit);
            }
        };
        for (const t of file.parser?.tokens ?? []) { visit(t); }
    }
    const mb = b => (b / 1048576).toFixed(1) + 'MB';
    console.log({ identifierAndLiteralText: mb(textBytes), duplicateWithinFile: mb(dupBytes), triviaArrays: arrays, emptyOnceWhitespaceRemoved: emptyAfterWs, singleItemOnceWhitespaceRemoved: len1AfterWs });
})();
