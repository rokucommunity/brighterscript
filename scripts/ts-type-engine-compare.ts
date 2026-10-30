/**
 * Runs the snippets from a spec file's \`program.setFile()\` calls through both the built-in type checker and the
 * TypeScript type engine, and reports how often they agree on which lines have errors.
 *
 * Usage: npx ts-node --transpile-only scripts/ts-type-engine-compare.ts src/bscPlugin/validation/ScopeValidator.spec.ts
 * Set EXAMPLES=50 to list the titles of the tests where the two disagree.
 */
import * as fs from 'fs';
import { Program } from '../src/Program';
import { TsTypeEngine } from '../src/tsTypeEngine/TsTypeEngine';
const specPath = process.argv[2];
const spec = fs.readFileSync(specPath).toString();
//split into `it(` blocks and pull the setFile calls out of each
const blocks = spec.split(/\n\s*it\(/).slice(1);
//diagnostics the built-in validator reports that aren't about types
const ignoredCodes = ['unused-variable', 'unnecessary-code'];
let total = 0, agree = 0, onlyBsc = 0, onlyTs = 0, partial = 0;
const examples: string[] = [];
for (const block of blocks) {
    const title = /^\s*['"`](.*?)['"`]/.exec(block)?.[1];
    const files = [...block.matchAll(/setFile\(\s*['"`]([^'"`]+\.(?:bs|brs|xml))['"`]\s*,\s*`([^`]*)`/g)];
    if (files.length === 0 || files.some(f => f[2].includes('${'))) {
        continue;
    }
    const program = new Program({ rootDir: '/tmp/rootDir', logLevel: 'error' as any });
    try {
        for (const f of files) {
            program.setFile(f[1], f[2]);
        }
        program.validate();
        const engine = new TsTypeEngine(program);
        const key = (d: any) => `${d.location?.uri?.split('/').pop()}:${d.location?.range.start.line}`;
        const bsc = new Set(program.getDiagnostics().filter(d => !ignoredCodes.includes(String(d.code))).map(key));
        const tsd = new Set(engine.getDiagnostics().map(key));
        engine.dispose();
        total++;
        const same = bsc.size === tsd.size && [...bsc].every(x => tsd.has(x));
        if (same) {
            agree++;
        } else if (tsd.size === 0) {
            onlyBsc++;
            examples.push(`bsc-only: ${title}`);
        } else if (bsc.size === 0) {
            onlyTs++;
            examples.push(`ts-only : ${title}`);
        } else {
            partial++;
            examples.push(`partial : ${title}`);
        }
    } catch (e) {
        //skip snippets the harness can't handle
    } finally {
        program.dispose();
    }
}
console.log(`${specPath.split('/').pop()}: ${total} cases. agree on which lines have type errors: ${agree} (${(agree / total * 100).toFixed(0)}%). only bsc reports: ${onlyBsc}, only ts reports: ${onlyTs}, both report but on different lines: ${partial}`);
if (process.env.EXAMPLES) { console.log(examples.slice(0, +process.env.EXAMPLES).join('\n')); }
