//usage: node --max-old-space-size=12000 late-props.js <file.heapsnapshot> <ClassName> [ClassName...]
//for each class, which property names show up on some instances but not all (= added after construction), and on how many instances
const fs = require('fs');
const snap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length, EF = meta.edge_fields.length;
const nTypes = meta.node_types[0], eTypes = meta.edge_types[0];
const iType = meta.node_fields.indexOf('type'), iName = meta.node_fields.indexOf('name'), iEdges = meta.node_fields.indexOf('edge_count');
const eType = meta.edge_fields.indexOf('type'), eName = meta.edge_fields.indexOf('name_or_index');
const { nodes, edges, strings } = snap;
const N = nodes.length / NF;
const want = new Set(process.argv.slice(3));
const stats = new Map();
for (let i = 0, e = 0; i < N; i++) {
    const ec = nodes[i * NF + iEdges] * EF;
    const cls = strings[nodes[i * NF + iName]];
    if (nTypes[nodes[i * NF + iType]] === 'object' && want.has(cls)) {
        const s = stats.get(cls) ?? { count: 0, props: new Map() };
        s.count++;
        for (let x = e; x < e + ec; x += EF) {
            if (eTypes[edges[x + eType]] === 'property') { const p = strings[edges[x + eName]]; if (p !== '__proto__') { s.props.set(p, (s.props.get(p) ?? 0) + 1); } }
        }
        stats.set(cls, s);
    }
    e += ec;
}
for (const [cls, s] of stats) {
    const all = [...s.props].filter(([, n]) => n === s.count).map(([p]) => p);
    const some = [...s.props].filter(([, n]) => n !== s.count).map(([p, n]) => `${p} (${n})`);
    console.log(`${cls} x${s.count}\n   on every instance: ${all.join(', ')}\n   on some:           ${some.join(', ') || '-'}`);
}
