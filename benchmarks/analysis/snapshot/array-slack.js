//usage: node --max-old-space-size=12000 array-slack.js <file.heapsnapshot>
//unused capacity in arrays' backing stores, by who holds the array: slack = backing store size - (header + 8 bytes per element in use)
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
const lengthOf = arr => { let n = 0; for (let e = first[arr]; e < first[arr + 1]; e += EF) { if (eTypes[edges[e + eType]] === 'element') { n++; } } return n; };
const elementsOf = i => { for (let e = first[i]; e < first[i + 1]; e += EF) { if (strings[edges[e + eName]] === 'elements' && eTypes[edges[e + eType]] === 'internal') { return edges[e + eTo] / NF; } } return -1; };
const groups = new Map();
let totalSlack = 0, totalArrays = 0;
for (let i = 0; i < N; i++) {
    if (type(i) !== 'object') { continue; }
    for (let e = first[i]; e < first[i + 1]; e += EF) {
        if (eTypes[edges[e + eType]] !== 'property') { continue; }
        const prop = strings[edges[e + eName]];
        if (prop === '__proto__') { continue; }
        const to = edges[e + eTo] / NF;
        if (type(to) !== 'object' || name(to) !== 'Array') { continue; }
        const el = elementsOf(to);
        if (el < 0) { continue; }
        const used = Math.max(lengthOf(to), lengthOf(el));
        const slack = Math.max(0, size(el) - (16 + 8 * used));
        const k = `${name(i)}.${prop}`;
        const g = groups.get(k) ?? { count: 0, slack: 0, used: 0, empty: 0 };
        g.count++; g.slack += slack; g.used += used; if (used === 0) { g.empty++; }
        groups.set(k, g);
        totalSlack += slack; totalArrays++;
    }
}
const mb = b => (b / 1048576).toFixed(2).padStart(5) + 'MB';
console.log(mb(totalSlack), 'unused capacity across', totalArrays, 'arrays held by properties');
console.log('  slack    arrays   avg len  empty   holder');
for (const [k, g] of [...groups].sort((a, b) => b[1].slack - a[1].slack).slice(0, 16)) {
    console.log(mb(g.slack), String(g.count).padStart(8), (g.used / g.count).toFixed(1).padStart(8), String(g.empty).padStart(7), '  ', k);
}
