/**
 * Compares the built-in validator and the TypeScript type engine on a generated project: cold, after a declaration change,
 * and after a body-only change. FILES and COMPONENTS env vars control the size.
 *
 * Usage: npx ts-node --transpile-only scripts/ts-type-engine-benchmark.ts
 */
import { Program } from '../src/Program';
import { TsTypeEngine } from '../src/tsTypeEngine/TsTypeEngine';
const FILES = +(process.env.FILES ?? 300);
const COMPONENTS = +(process.env.COMPONENTS ?? 40);
const program = new Program({ rootDir: '/tmp/rootDir', logLevel: 'error' as any });
function fileText(i: number, extra = '') {
    let s = `namespace Lib${i}\n`;
    s += `    interface Item${i}\n        id as integer\n        name as string\n        tags as string[]\n    end interface\n`;
    s += `    class Model${i}\n        items as Item${i}[] = []\n        count as integer = 0\n`;
    s += `        sub add(item as Item${i})\n            m.items.push(item)\n            m.count += 1\n        end sub\n`;
    s += `        function names() as string[]\n            result = []\n            for each item in m.items\n                result.push(item.name + "!")\n            end for\n            return result\n        end function\n    end class\n`;
    for (let f = 0; f < 10; f++) {
        s += `    function fn${f}(a as integer, b as string) as string\n        x = a * 2 + ${f}\n        if x > 10 then\n            b = b + "big"\n        end if\n        model = new Model${i}()\n        model.add({ id: x, name: b, tags: ["a"] })\n        ${i > 0 ? `y = Lib${i - 1}.fn${f}(x, b)\n` : ''}        return b + model.names()[0]\n    end function\n`;
    }
    s += extra + `end namespace\n`;
    return s;
}
for (let i = 0; i < FILES; i++) {
    program.setFile(`source/lib${i}.bs`, fileText(i));
}
for (let c = 0; c < COMPONENTS; c++) {
    //each component pulls in 20 of the shared library files
    const scripts = Array.from({ length: 20 }, (_, k) => `<script uri="pkg:/source/lib${(c * 7 + k) % FILES}.bs" />`).join('\n');
    program.setFile(`components/Comp${c}.xml`, `<?xml version="1.0" encoding="utf-8" ?>\n<component name="Comp${c}" extends="Group">\n${scripts}\n</component>`);
}
const fileCount = FILES;
const totalLines = FILES * fileText(1).split('\n').length;
let t = Date.now();
program.validate();
const bscCold = Date.now() - t;
const engine = new TsTypeEngine(program);
t = Date.now();
let d = engine.getDiagnostics();
const tsCold = Date.now() - t;
console.log(`files=${fileCount} lines=${totalLines} componentScopes=${COMPONENTS}`);
console.log(`cold: bsc validate ${bscCold}ms, ts engine ${tsCold}ms, ts diagnostics=${d.length}, bsc diagnostics=${program.getDiagnostics().length}`);
if (d.length) { console.log(d.slice(0, 5).map(x => x.location.uri.split('/').pop() + ' ' + x.message)); }
//edit one file that's in the source scope and some component scopes
program.setFile(`source/lib5.bs`, fileText(5, `    function added() as integer\n        return "oops"\n    end function\n`));
t = Date.now();
program.validate();
const bscWarm = Date.now() - t;
t = Date.now();
d = engine.getDiagnostics();
const tsWarm = Date.now() - t;
console.log(`after editing one file: bsc validate ${bscWarm}ms, ts engine ${tsWarm}ms, ts diagnostics=${d.length}`);
//edit only a function body: the file's declarations don't change, so only that file needs re-checking
program.setFile(`source/lib5.bs`, fileText(5, `    function added() as integer
        return "still oops" + "!"
    end function
`));
t = Date.now();
program.validate();
const bscBody = Date.now() - t;
t = Date.now();
d = engine.getDiagnostics();
console.log(`after a body-only edit: bsc validate ${bscBody}ms, ts engine ${Date.now() - t}ms, ts diagnostics=${d.length}`);
console.log(`heap used ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)}MB`);
