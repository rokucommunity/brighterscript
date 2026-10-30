//usage: node --max-old-space-size=12000 empty-containers.js <bscDir> <args.json> [rows]   (run from the project dir)
//validate a project, then walk everything reachable from the program and report Maps/Sets/arrays/plain objects that are empty, by holder
const { types } = require('util');
const bsc = require(process.argv[2]);
const args = require(process.argv[3]);
const COST = { Map: 184, Set: 152, Array: 32, Object: 56 }; //measured cost of an empty one
(async () => {
    const builder = new bsc.ProgramBuilder();
    builder.printDiagnostics = () => { };
    await builder.run({ ...args.bsconfig, cwd: args.projectDir, noEmit: true, validate: true, createPackage: false, watch: false, logLevel: 'error' });
    const seen = new Set();
    const stats = new Map();
    const record = (kind, label, empty) => {
        const k = `${kind.padEnd(6)} ${label}`;
        const s = stats.get(k) ?? { kind: kind, total: 0, empty: 0 };
        s.total++; if (empty) { s.empty++; }
        stats.set(k, s);
    };
    const stack = [[builder.program, 'Program']];
    while (stack.length > 0) {
        const [value, label] = stack.pop();
        if (value === null || typeof value !== 'object' || seen.has(value)) { continue; }
        seen.add(value);
        if (types.isProxy(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || Buffer.isBuffer(value)) { continue; }
        if (value instanceof Map) {
            record('Map', label, value.size === 0);
            for (const [k, v] of value) { stack.push([k, label + '<key>']); stack.push([v, label + '<value>']); }
        } else if (value instanceof Set) {
            record('Set', label, value.size === 0);
            for (const v of value) { stack.push([v, label + '<item>']); }
        } else if (Array.isArray(value)) {
            record('Array', label, value.length === 0);
            for (const v of value) { stack.push([v, label + '[]']); }
        } else {
            const proto = Object.getPrototypeOf(value);
            const cls = proto === Object.prototype || proto === null ? 'Object' : (proto.constructor?.name || 'anon');
            let keys;
            try { keys = Object.keys(value); } catch { continue; }
            if (cls === 'Object') { record('Object', label, keys.length === 0); }
            //label children by their holder's class (plain objects keep the path, so eg. symbol `data` objects stay distinguishable)
            const prefix = cls === 'Object' ? label : cls;
            for (const key of keys) {
                let v;
                try { v = value[key]; } catch { continue; }
                if (v && typeof v === 'object') { stack.push([v, `${prefix}.${key}`]); }
            }
        }
    }
    const rows = [...stats.entries()].filter(([, s]) => s.empty >= 200).map(([k, s]) => ({ k: k, ...s, wasted: s.empty * COST[s.kind] }))
        .sort((a, b) => b.wasted - a.wasted).slice(0, +process.argv[4] || 30);
    let total = 0; for (const [, s] of stats) { total += s.empty * COST[s.kind]; }
    console.log(`objects walked: ${seen.size}, empty containers cost ~${(total / 1048576).toFixed(1)}MB in total`);
    console.log('  wasted    empty /  total   holder');
    for (const r of rows) { console.log(((r.wasted / 1048576).toFixed(2) + 'MB').padStart(8), String(r.empty).padStart(8), '/', String(r.total).padEnd(8), r.k); }
})();
