//usage: node native-callers.js <file.heapprofile>
const p = JSON.parse(require('fs').readFileSync(process.argv[2]));
const natives = new Set(['Map', 'Set', 'push', 'set', 'add', 'assign', 'Proxy']);
const agg = {};
const total = { v: 0 };
function walk(n, parent) {
    const self = (n.selfSize ?? 0);
    total.v += self;
    const fn = n.callFrame.functionName;
    if (natives.has(fn) && parent) {
        const k = `${fn} <- ${parent.callFrame.functionName || '(anon)'} ${parent.callFrame.url.split('/dist/')[1] ?? ''}:${parent.callFrame.lineNumber + 1}`;
        agg[k] = (agg[k] ?? 0) + self;
    }
    for (const c of n.children ?? []) { walk(c, n); }
}
walk(p.head, null);
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 22)) { console.log((v / 1048576).toFixed(1).padStart(6) + 'MB', k); }
