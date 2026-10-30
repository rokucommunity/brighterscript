//usage: node sites.js <file.heapprofile> [rows]
const p = JSON.parse(require('fs').readFileSync(process.argv[2]));
const natives = new Set(['Map', 'Set', 'push', 'set', 'add', 'assign', 'Proxy', 'concat', 'slice', 'map', 'filter', 'from', 'split', 'join', 'substring', 'toLowerCase', '(anon)', '']);
const label = f => `${f.functionName || '(anon)'} ${(f.url.split('/dist/')[1] ?? f.url.split('/').pop())}:${f.lineNumber + 1}`;
const agg = {}; let total = 0;
function walk(n, stack) {
    const self = n.selfSize ?? 0; total += self;
    if (self) {
        let i = stack.length - 1, k = label(n.callFrame);
        if (natives.has(n.callFrame.functionName) || !n.callFrame.url) {
            while (i >= 0 && (natives.has(stack[i].callFrame.functionName) || !stack[i].callFrame.url)) { i--; }
            k = (n.callFrame.functionName || '(native)') + ' <- ' + (i >= 0 ? label(stack[i].callFrame) : '?');
        }
        agg[k] = (agg[k] ?? 0) + self;
    }
    stack.push(n); for (const c of n.children ?? []) { walk(c, stack); } stack.pop();
}
walk(p.head, []);
console.log('total', (total / 1048576).toFixed(1) + 'MB');
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, +process.argv[3] || 30)) { console.log((v / 1048576).toFixed(1).padStart(6) + 'MB ' + (100 * v / total).toFixed(1).padStart(4) + '%  ' + k); }
