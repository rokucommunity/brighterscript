//usage: node site-diff.js <before.heapprofile> <after.heapprofile>
const fs = require('fs');
const natives = new Set(['Map', 'Set', 'push', 'set', 'add', 'assign', 'Proxy', 'concat', 'slice', 'map', 'filter', 'from', 'split', 'join', 'substring', 'toLowerCase', '(anon)', '']);
const label = f => `${f.functionName || '(anon)'} ${(f.url.split('/dist/')[1] ?? f.url.split('/').pop())}`;
function sites(file) {
    const p = JSON.parse(fs.readFileSync(file)); const agg = {};
    (function walk(n, stack) {
        const self = n.selfSize ?? 0;
        if (self) {
            let i = stack.length - 1, k = label(n.callFrame);
            if (natives.has(n.callFrame.functionName) || !n.callFrame.url) {
                while (i >= 0 && (natives.has(stack[i].callFrame.functionName) || !stack[i].callFrame.url)) { i--; }
                k = (n.callFrame.functionName || '(native)') + ' <- ' + (i >= 0 ? label(stack[i].callFrame) : '?');
            }
            agg[k] = (agg[k] ?? 0) + self;
        }
        stack.push(n); for (const c of n.children ?? []) { walk(c, stack); } stack.pop();
    })(p.head, []);
    return agg;
}
const a = sites(process.argv[2]), b = sites(process.argv[3]);
const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
const rows = [...keys].map(k => [k, (b[k] ?? 0) - (a[k] ?? 0)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 14);
for (const [k, d] of rows) { console.log(((d > 0 ? '+' : '') + (d / 1048576).toFixed(1) + 'MB').padStart(9), k); }
