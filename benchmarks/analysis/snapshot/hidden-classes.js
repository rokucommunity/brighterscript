//usage: node --max-old-space-size=12000 hidden-classes.js <file.heapsnapshot> [rows]
//per constructor (plain objects grouped together): instances, distinct hidden classes, instances with an out-of-object property store, and dictionary-mode instances
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
const groups = new Map();
for (let i = 0; i < N; i++) {
    if (type(i) !== 'object') { continue; }
    let map = -1, propsStore = -1;
    for (let e = first[i]; e < first[i + 1]; e += EF) {
        if (eTypes[edges[e + eType]] !== 'internal') { continue; }
        const n = strings[edges[e + eName]];
        if (n === 'map') { map = edges[e + eTo]; } else if (n === 'properties') { propsStore = edges[e + eTo] / NF; }
    }
    const k = name(i);
    const g = groups.get(k) ?? { count: 0, maps: new Map(), outOfObject: 0, outBytes: 0, dict: 0 };
    g.count++;
    g.maps.set(map, (g.maps.get(map) ?? 0) + 1);
    if (propsStore >= 0 && size(propsStore) > 16) {
        //a hash-table property store means dictionary mode, otherwise it's fields that didn't fit in the object itself
        if (/Dictionary|hash/i.test(name(propsStore)) || type(propsStore) === 'hash') { g.dict++; } else { g.outOfObject++; g.outBytes += size(propsStore); }
    }
    groups.set(k, g);
}
const interesting = [...groups].filter(([k, g]) => g.count >= 1000 && !/^system|^\(|^Array$|^Function$|^String$|^Object$/.test(k));
console.log('instances  hidden classes (top: count)          out-of-object (bytes)   dictionary   constructor');
for (const [k, g] of interesting.sort((a, b) => b[1].count - a[1].count).slice(0, +process.argv[3] || 35)) {
    const top = [...g.maps.values()].sort((a, b) => b - a).slice(0, 3).join('/');
    console.log(String(g.count).padStart(9), String(g.maps.size).padStart(6), ('(' + top + ')').padEnd(26), String(g.outOfObject).padStart(8), ('(' + (g.outBytes / 1048576).toFixed(2) + 'MB)').padStart(10), String(g.dict).padStart(9), '  ', k);
}
const plain = groups.get('Object');
console.log(`\nplain objects: ${plain.count} instances, ${plain.maps.size} hidden classes, ${plain.outOfObject} out-of-object (${(plain.outBytes / 1048576).toFixed(2)}MB), ${plain.dict} dictionary-mode`);
