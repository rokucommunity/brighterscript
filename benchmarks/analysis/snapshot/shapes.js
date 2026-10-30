//usage: node --max-old-space-size=12000 shapes.js <file.heapsnapshot> [rows]
//group live objects in a heap snapshot by class (or, for plain objects, by their property names), and say who holds each plain-object shape
const fs = require('fs');
const snap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length, EF = meta.edge_fields.length;
const nTypes = meta.node_types[0], eTypes = meta.edge_types[0];
const iType = meta.node_fields.indexOf('type'), iName = meta.node_fields.indexOf('name'), iSize = meta.node_fields.indexOf('self_size'), iEdges = meta.node_fields.indexOf('edge_count');
const eType = meta.edge_fields.indexOf('type'), eName = meta.edge_fields.indexOf('name_or_index'), eTo = meta.edge_fields.indexOf('to_node');
const { nodes, edges, strings } = snap;
const nodeCount = nodes.length / NF;
const firstEdge = new Uint32Array(nodeCount + 1);
for (let i = 0, e = 0; i < nodeCount; i++) { firstEdge[i] = e; e += nodes[i * NF + iEdges] * EF; }
firstEdge[nodeCount] = edges.length;
const typeOf = i => nTypes[nodes[i * NF + iType]];
const nameOf = i => strings[nodes[i * NF + iName]];
//a plain object's shape = its sorted property names
const shapeOf = i => {
    const props = [];
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
        if (eTypes[edges[e + eType]] === 'property') { const n = strings[edges[e + eName]]; if (n !== '__proto__') { props.push(n); } }
    }
    return '{' + props.sort().join(',') + '}';
};
const groups = new Map();
const keyOf = i => {
    const t = typeOf(i);
    if (t !== 'object') { return null; }
    const n = nameOf(i);
    return n === 'Object' ? 'Object ' + shapeOf(i) : n;
};
const keys = new Array(nodeCount);
for (let i = 0; i < nodeCount; i++) {
    const k = keyOf(i); keys[i] = k;
    if (!k) { continue; }
    const g = groups.get(k) ?? { count: 0, size: 0, holders: new Map() };
    g.count++; g.size += nodes[i * NF + iSize];
    groups.set(k, g);
}
//who holds each plain-object shape: "<parent class>.<property>"
for (let i = 0; i < nodeCount; i++) {
    if (!keys[i]) { continue; }
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
        if (eTypes[edges[e + eType]] !== 'property') { continue; }
        const to = edges[e + eTo] / NF;
        const k = keys[to];
        if (!k || !k.startsWith('Object ')) { continue; }
        const g = groups.get(k);
        const h = `${keys[i].startsWith('Object ') ? 'Object' : keys[i]}.${strings[edges[e + eName]]}`;
        g.holders.set(h, (g.holders.get(h) ?? 0) + 1);
    }
}
const mb = b => (b / 1048576).toFixed(1).padStart(5) + 'MB';
const rows = [...groups].sort((a, b) => b[1].size - a[1].size).slice(0, +process.argv[3] || 40);
for (const [k, g] of rows) {
    const holders = [...g.holders].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([h, n]) => `${h} x${n}`).join(', ');
    console.log(mb(g.size), String(g.count).padStart(8), ' ', k.length > 95 ? k.slice(0, 92) + '...' : k, holders ? `  <- ${holders}` : '');
}
