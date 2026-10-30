//usage: node --max-old-space-size=12000 nested-groups.js <file.heapsnapshot>
//totals for specific nested-object patterns in a heap snapshot: who holds the arrays (with their backing stores),
//all AST `tokens` sub-objects, all symbol `data` objects, and the type chain objects
const fs = require('fs');
const snap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length, EF = meta.edge_fields.length;
const nTypes = meta.node_types[0], eTypes = meta.edge_types[0];
const iType = meta.node_fields.indexOf('type'), iName = meta.node_fields.indexOf('name'), iSize = meta.node_fields.indexOf('self_size'), iEdges = meta.node_fields.indexOf('edge_count');
const eType = meta.edge_fields.indexOf('type'), eName = meta.edge_fields.indexOf('name_or_index'), eTo = meta.edge_fields.indexOf('to_node');
const { nodes, edges, strings } = snap;
const N = nodes.length / NF;
const first = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) { first[i] = e; e += nodes[i * NF + iEdges] * EF; }
first[N] = edges.length;
const type = i => nTypes[nodes[i * NF + iType]], name = i => strings[nodes[i * NF + iName]], size = i => nodes[i * NF + iSize];
const isAstNode = new Set(); //class names that have a `tokens` property somewhere = AST nodes
const elementsOf = i => { for (let e = first[i]; e < first[i + 1]; e += EF) { if (strings[edges[e + eName]] === 'elements' && eTypes[edges[e + eType]] === 'internal') { return edges[e + eTo] / NF; } } return -1; };
const arrays = new Map(), tokensObjs = { count: 0, size: 0 }, dataObjs = new Map();
const add = (m, k, s) => { const g = m.get(k) ?? { count: 0, size: 0 }; g.count++; g.size += s; m.set(k, g); };
for (let i = 0; i < N; i++) {
    if (type(i) !== 'object') { continue; }
    const holder = name(i);
    for (let e = first[i]; e < first[i + 1]; e += EF) {
        if (eTypes[edges[e + eType]] !== 'property') { continue; }
        const to = edges[e + eTo] / NF, prop = strings[edges[e + eName]];
        if (type(to) !== 'object') { continue; }
        if (name(to) === 'Array') {
            const el = elementsOf(to);
            add(arrays, `${holder}.${prop}`, size(to) + (el >= 0 ? size(el) : 0));
        } else if (prop === 'tokens' && name(to) === 'Object' && holder !== 'Object' && holder !== 'Parser' && holder !== 'Lexer') {
            tokensObjs.count++; tokensObjs.size += size(to);
        } else if (prop === 'data' && name(to) === 'Object') {
            add(dataObjs, holder === 'Object' ? 'symbol/cache entry' : holder, size(to));
        }
    }
}
const mb = b => (b / 1048576).toFixed(1).padStart(5) + 'MB';
console.log('== arrays by holder (array object + its backing store)');
let arrTotal = 0; for (const g of arrays.values()) { arrTotal += g.size; }
console.log(mb(arrTotal), 'total in arrays held by object properties');
for (const [k, g] of [...arrays].sort((a, b) => b[1].size - a[1].size).slice(0, 14)) { console.log(mb(g.size), String(g.count).padStart(8), ' ', k); }
console.log('\n== AST node `tokens` sub-objects');
console.log(mb(tokensObjs.size), String(tokensObjs.count).padStart(8));
console.log('\n== `data` objects by holder');
for (const [k, g] of [...dataObjs].sort((a, b) => b[1].size - a[1].size)) { console.log(mb(g.size), String(g.count).padStart(8), ' ', k); }
