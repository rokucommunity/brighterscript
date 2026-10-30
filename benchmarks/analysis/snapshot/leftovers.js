//usage: node --max-old-space-size=12000 leftovers.js <file.heapsnapshot>
//remaining hidden-class problems: classes with >1 hidden class or out-of-object stores, and plain-object shapes that got fields added later
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
const isPluginCopy = i => false;
const classes = new Map(), shapes = new Map();
const holderOf = new Int32Array(N).fill(-1), holderProp = new Array(N);
for (let i = 0; i < N; i++) {
    if (type(i) !== 'object') { continue; }
    for (let e = first[i]; e < first[i + 1]; e += EF) {
        if (eTypes[edges[e + eType]] === 'property') { const to = edges[e + eTo] / NF; if (holderOf[to] < 0) { holderOf[to] = i; holderProp[to] = strings[edges[e + eName]]; } }
    }
}
for (let i = 0; i < N; i++) {
    if (type(i) !== 'object') { continue; }
    let map = -1, store = -1; const props = [];
    for (let e = first[i]; e < first[i + 1]; e += EF) {
        const et = eTypes[edges[e + eType]], n = strings[edges[e + eName]];
        if (et === 'internal' && n === 'map') { map = edges[e + eTo]; } else if (et === 'internal' && n === 'properties') { store = edges[e + eTo] / NF; } else if (et === 'property' && n !== '__proto__') { props.push(n); }
    }
    const spilled = store >= 0 && size(store) > 16;
    const cls = name(i);
    if (cls === 'Object') {
        if (!spilled) { continue; }
        const k = '{' + props.sort().join(',') + '}';
        const h = holderOf[i] >= 0 ? `${name(holderOf[i])}.${holderProp[i]}` : '?';
        const g = shapes.get(k) ?? { count: 0, bytes: 0, holders: new Map() };
        g.count++; g.bytes += size(store); g.holders.set(h, (g.holders.get(h) ?? 0) + 1);
        shapes.set(k, g);
    } else {
        const g = classes.get(cls) ?? { count: 0, maps: new Map(), spilled: 0, bytes: 0 };
        g.count++; g.maps.set(map, (g.maps.get(map) ?? 0) + 1);
        if (spilled) { g.spilled++; g.bytes += size(store); }
        classes.set(cls, g);
    }
}
const kb = b => (b / 1024).toFixed(0).padStart(6) + 'KB';
console.log('== classes (>=100 instances) with more than one hidden class or out-of-object stores');
console.log(' spilled  instances  classes (top counts)        name');
for (const [k, g] of [...classes].filter(([k, g]) => g.count >= 100 && (g.maps.size > 1 || g.spilled > 0) && !/^system|^\(|^Array$|^Function$|^Map$|^Set$|^String$|^Module$|^Error$/.test(k)).sort((a, b) => b[1].bytes - a[1].bytes || b[1].count - a[1].count).slice(0, 25)) {
    console.log(kb(g.bytes), String(g.count).padStart(9), String(g.maps.size).padStart(4), ('(' + [...g.maps.values()].sort((a, b) => b - a).slice(0, 4).join('/') + ')').padEnd(24), k);
}
console.log('\n== plain-object shapes with out-of-object stores (fields added after creation)');
for (const [k, g] of [...shapes].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 14)) {
    const h = [...g.holders].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([x, n]) => `${x} x${n}`).join(', ');
    console.log(kb(g.bytes), String(g.count).padStart(8), ' ', k.length > 80 ? k.slice(0, 77) + '...' : k, ' <-', h);
}
