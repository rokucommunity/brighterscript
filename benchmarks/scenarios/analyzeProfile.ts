import * as fsExtra from 'fs-extra';

interface CallFrame {
    functionName: string;
    url: string;
    lineNumber: number;
}

/**
 * Summarize a .cpuprofile (self time, inclusive time, self time by file) or a .heapprofile
 * (live sampled memory by allocation site, self and inclusive)
 */
export function analyzeProfile(profilePath: string, top = 40): string {
    const profile = fsExtra.readJsonSync(profilePath);
    if (profilePath.endsWith('.heapprofile')) {
        return analyzeHeapProfile(profile, top);
    }
    return analyzeCpuProfile(profile, top);
}

function shortUrl(url: string) {
    return url
        .replace(/^file:\/\//, '')
        .replace(/.*node_modules\//, 'nm/')
        .replace(/.*\/brighterscript\/(dist|src)\//, '$1/');
}

function frameKey(frame: CallFrame) {
    return `${frame.functionName || '(anon)'} ${shortUrl(frame.url)}:${frame.lineNumber + 1}`;
}

function formatTable(map: Map<string, number>, total: number, top: number, format: (value: number) => string) {
    return [...map]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([key, value]) => `${format(value).padStart(10)} ${(100 * value / total).toFixed(1).padStart(5)}%  ${key}`)
        .join('\n');
}

function analyzeCpuProfile(profile: any, top: number) {
    const nodesById = new Map<number, any>();
    const parentById = new Map<number, number>();
    for (const node of profile.nodes) {
        nodesById.set(node.id, node);
    }
    for (const node of profile.nodes) {
        for (const childId of node.children ?? []) {
            parentById.set(childId, node.id);
        }
    }

    const selfByNode = new Map<number, number>();
    let total = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const delta = profile.timeDeltas[i + 1] ?? 0;
        selfByNode.set(profile.samples[i], (selfByNode.get(profile.samples[i]) ?? 0) + delta);
        total += delta;
    }

    const self = new Map<string, number>();
    const inclusive = new Map<string, number>();
    const byFile = new Map<string, number>();
    for (const [nodeId, time] of selfByNode) {
        const frame = nodesById.get(nodeId).callFrame as CallFrame;
        const key = frameKey(frame);
        self.set(key, (self.get(key) ?? 0) + time);
        const file = shortUrl(frame.url) || frame.functionName;
        byFile.set(file, (byFile.get(file) ?? 0) + time);

        //walk up the stack, counting each function once per sample (recursion would double count otherwise)
        const seen = new Set<string>();
        let currentId = nodeId;
        while (currentId !== undefined) {
            const currentKey = frameKey(nodesById.get(currentId).callFrame);
            if (!seen.has(currentKey)) {
                seen.add(currentKey);
                inclusive.set(currentKey, (inclusive.get(currentKey) ?? 0) + time);
            }
            currentId = parentById.get(currentId);
        }
    }
    const ms = (value: number) => `${(value / 1000).toFixed(0)}ms`;
    return [
        `TOTAL ${(total / 1e6).toFixed(2)}s`,
        '=== SELF ===', formatTable(self, total, top, ms),
        '=== INCLUSIVE ===', formatTable(inclusive, total, top, ms),
        '=== SELF BY FILE ===', formatTable(byFile, total, top, ms)
    ].join('\n');
}

function analyzeHeapProfile(profile: any, top: number) {
    const self = new Map<string, number>();
    const inclusive = new Map<string, number>();
    let total = 0;

    //iterative to avoid blowing the stack on deep allocation trees
    const stack: Array<{ node: any; ancestors: Set<string> }> = [{ node: profile.head, ancestors: new Set() }];
    const subtotals = new Map<any, number>();
    const order: Array<{ node: any; key: string; counted: boolean; parent: any }> = [];
    const parents = new Map<any, any>();
    while (stack.length > 0) {
        const { node, ancestors } = stack.pop();
        const key = frameKey(node.callFrame);
        const size = node.selfSize ?? 0;
        total += size;
        self.set(key, (self.get(key) ?? 0) + size);
        subtotals.set(node, size);
        order.push({ node: node, key: key, counted: !ancestors.has(key), parent: parents.get(node) });
        const childAncestors = new Set(ancestors).add(key);
        for (const child of node.children ?? []) {
            parents.set(child, node);
            stack.push({ node: child, ancestors: childAncestors });
        }
    }
    //children come after their parents in `order`, so walk it backwards to roll sizes up
    for (let i = order.length - 1; i >= 0; i--) {
        const { node, key, counted, parent } = order[i];
        const subtotal = subtotals.get(node);
        if (counted) {
            inclusive.set(key, (inclusive.get(key) ?? 0) + subtotal);
        }
        if (parent) {
            subtotals.set(parent, subtotals.get(parent) + subtotal);
        }
    }
    const mb = (value: number) => `${(value / 1048576).toFixed(1)}MB`;
    return [
        `TOTAL live sampled ${(total / 1048576).toFixed(0)}MB`,
        '=== SELF ===', formatTable(self, total, top, mb),
        '=== INCLUSIVE ===', formatTable(inclusive, total, top, mb)
    ].join('\n');
}
