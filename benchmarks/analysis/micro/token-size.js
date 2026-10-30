//usage: node --expose-gc token-size.js <bscDir>
const { TokenObject } = require(process.argv[2] + '/dist/lexer/TokenObject');
const N = 1_000_000;
const si = { uri: 'file:///x.brs', linePositions: [0] };
class Six { constructor(k, t, s, e, si, lt) { this.kind = k; this.text = t; this.startPosition = s; this.endPosition = e; this.sourceInfo = si; this.leadingTrivia = lt; } }
class Five { constructor(k, t, s, e, si) { this.kind = k; this.text = t; this.startPosition = s; this.endPosition = e; this.sourceInfo = si; } }
function measure(label, make) {
    global.gc(); global.gc();
    const before = process.memoryUsage().heapUsed;
    const keep = new Array(N);
    for (let i = 0; i < N; i++) { keep[i] = make(i); }
    global.gc(); global.gc();
    const bytes = (process.memoryUsage().heapUsed - before - N * 8) / N; //minus the holding array's slots
    console.log(label.padEnd(58), bytes.toFixed(1), 'bytes');
    return keep;
}
const ws = new TokenObject('Whitespace', ' ', false, 0, 1, si, undefined);
measure('TokenObject, 7 fields, no trivia', i => new TokenObject('Identifier', 'm', false, i, i + 1, si, undefined));
measure('TokenObject + leadingTrivia array of 1', i => new TokenObject('Identifier', 'm', false, i, i + 1, si, [ws]));
measure('TokenObject + leadingTrivia array of 2', i => new TokenObject('Identifier', 'm', false, i, i + 1, si, [ws, ws]));
measure('6 fields (no isReserved)', i => new Six('Identifier', 'm', i, i + 1, si, undefined));
measure('5 fields (no isReserved, no leadingTrivia)', i => new Five('Identifier', 'm', i, i + 1, si));
measure('short identifier text copy, e.g. "count" (string only)', i => ('count' + (i % 1)).slice(0));
