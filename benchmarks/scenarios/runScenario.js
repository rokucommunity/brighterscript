/**
 * Child process for a single scenario run. Plain JS on purpose - loading ts-node here would put the
 * TypeScript compiler in the same heap we're trying to measure.
 *
 * Usage: node --expose-gc runScenario.js <path-to-args.json>
 * Writes a JSON result to `args.outFile`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const inspector = require('inspector');

const args = JSON.parse(fs.readFileSync(process.argv[2]).toString());

if (typeof global.gc !== 'function') {
    throw new Error('runScenario.js must be run with --expose-gc');
}

const bsc = require(args.bscPath);
const { ProgramBuilder } = bsc;

/** @type {() => any} */
let builderProgram;

const now = () => performance.now();
const round = (n) => Math.round(n * 10) / 10;
const heapMB = () => round(process.memoryUsage().heapUsed / 1048576);

function fullGc() {
    global.gc();
    global.gc();
}

/**
 * Time every Sequencer action by label (validate phases). Internal API, so it's best-effort:
 * older/newer versions without a Sequencer just won't report phases
 */
const phaseTimes = new Map();
let trackPhases = false;
try {
    const { Sequencer } = require(path.join(args.bscPath, 'dist', 'common', 'Sequencer'));
    const runActionSync = Sequencer.prototype.runActionSync;
    Sequencer.prototype.runActionSync = function (action) {
        if (!trackPhases) {
            return runActionSync.call(this, action);
        }
        const start = now();
        try {
            return runActionSync.call(this, action);
        } finally {
            const label = action.groupLabel ?? action.label;
            phaseTimes.set(label, (phaseTimes.get(label) ?? 0) + now() - start);
        }
    };
} catch { }

function diagnosticsSnapshot(program) {
    const lines = program.getDiagnostics().map(d => {
        const uri = (d.location?.uri ?? d.file?.srcPath ?? '').replace(/\\/g, '/');
        const start = d.location?.range?.start ?? d.range?.start;
        return `${path.relative(args.projectDir, uri.replace(/^file:\/\//, ''))}:${start?.line}:${start?.character} ${d.code} ${d.message}`;
    }).sort();
    return {
        count: lines.length,
        hash: crypto.createHash('md5').update(lines.join('\n')).digest('hex').slice(0, 12),
        lines: lines
    };
}

function postToInspector(session, method, params) {
    return new Promise((resolve, reject) => {
        session.post(method, params ?? {}, (err, result) => (err ? reject(err) : resolve(result)));
    });
}

async function main() {
    const result = {
        project: args.projectName,
        bsc: args.bscLabel,
        bscVersion: require(path.join(args.bscPath, 'package.json')).version
    };

    fullGc();
    const heapBefore = heapMB();

    const builder = new ProgramBuilder();
    //diagnostics are still collected, we just don't want them spamming the console
    builder.printDiagnostics = () => { };

    let validateMs;
    builderProgram = () => builder.program;
    const program = builderProgram;
    const origValidate = bsc.Program.prototype.validate;
    bsc.Program.prototype.validate = function (...rest) {
        const start = now();
        try {
            return origValidate.apply(this, rest);
        } finally {
            validateMs ??= now() - start;
        }
    };

    trackPhases = true;
    const coldStart = now();
    await builder.run({
        ...args.bsconfig,
        cwd: args.projectDir,
        noEmit: true,
        validate: true,
        createPackage: false,
        copyToStaging: false,
        watch: false,
        logLevel: args.bsconfig.logLevel ?? 'error',
        stagingDir: args.stagingDir
    });
    const coldTotalMs = now() - coldStart;
    trackPhases = false;
    bsc.Program.prototype.validate = origValidate;

    const files = Object.values(program().files);
    if (files.length === 0) {
        throw new Error(`No files found in program for project '${args.projectName}'`);
    }
    const coldDiagnostics = diagnosticsSnapshot(program());

    fullGc();
    Object.assign(result, {
        files: files.length,
        scopes: program().getAllUserScopes?.().length,
        diagnostics: coldDiagnostics.count,
        diagnosticsHash: coldDiagnostics.hash,
        coldTotalMs: round(coldTotalMs),
        coldValidateMs: round(validateMs),
        coldLoadMs: round(coldTotalMs - validateMs),
        heapAfterGcMB: round(heapMB() - heapBefore),
        phases: Object.fromEntries(
            [...phaseTimes].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, round(v)])
        )
    });
    if (args.writeDiagnostics) {
        fs.writeFileSync(args.outFile.replace(/\.json$/, '.diagnostics.txt'), coldDiagnostics.lines.join('\n'));
    }

    if (args.edits > 0) {
        let session;
        if (args.profileEdits) {
            session = new inspector.Session();
            session.connect();
            await postToInspector(session, 'Profiler.enable');
            await postToInspector(session, 'Profiler.setSamplingInterval', { interval: 200 });
            await postToInspector(session, 'Profiler.start');
        }
        result.edits = runEdits();
        if (session) {
            const { profile } = await postToInspector(session, 'Profiler.stop');
            fs.writeFileSync(args.profileEdits, JSON.stringify(profile));
        }
        const afterEdits = diagnosticsSnapshot(program());
        //every edit gets reverted, so diagnostics should be exactly what we started with
        result.diagnosticsAfterEdits = afterEdits.count;
        result.editsRestoredDiagnostics = afterEdits.hash === coldDiagnostics.hash;
        fullGc();
        result.heapAfterEditsMB = round(heapMB() - heapBefore);
    }

    result.peakRssMB = round(process.resourceUsage().maxRSS / 1024);
    fs.writeFileSync(args.outFile, JSON.stringify(result, null, 4));
}

/**
 * Pick edit targets: a script file in the most scopes (the expensive case when typing in a shared
 * utility file), and the largest script file that's only in one scope
 */
function pickEditTargets() {
    const program = builderProgram();
    const scriptFiles = Object.values(program.files).filter(f => /\.bs$|\.brs$/i.test(f.srcPath) && !/\.d\.bs$/i.test(f.srcPath));
    const byName = (relPath) => {
        const file = program.getFile(path.resolve(args.projectDir, relPath));
        if (!file) {
            throw new Error(`Edit target '${relPath}' not found in project '${args.projectName}'`);
        }
        return file;
    };
    const info = scriptFiles.map(f => ({ file: f, scopes: program.getScopesForFile(f).length, size: f.fileContents?.length ?? 0 }));
    const shared = args.editFiles?.shared ? byName(args.editFiles.shared) : info.sort((a, b) => (b.scopes - a.scopes) || (b.size - a.size))[0]?.file;
    const leaf = args.editFiles?.leaf ? byName(args.editFiles.leaf) : info.filter(x => x.scopes === 1).sort((a, b) => b.size - a.size)[0]?.file;
    return { shared: shared, leaf: leaf };
}


function runEdits() {
    const targets = pickEditTargets();
    const results = {};
    for (const [targetName, file] of Object.entries(targets)) {
        if (!file) {
            continue;
        }
        for (const kind of ['body', 'api']) {
            results[`${targetName}-${kind}`] = runEditLoop(file.srcPath, kind);
        }
    }
    return results;
}

/**
 * Simulate typing in one file: `body` appends a comment (no provided symbols change), `api` adds a
 * new function (provided symbols change, so dependents get re-validated). Reverts at the end
 */
function runEditLoop(srcPath, kind) {
    const program = builderProgram();
    //grab these fresh - setFile() disposes the old file object and clears its fileContents
    const file = program.getFile(srcPath);
    //destPath, not pkgPath - pkgPath is the transpiled .brs path for .bs files
    const destPath = file.destPath;
    const original = file.fileContents;
    const isBs = /\.bs$/i.test(srcPath);
    const times = [];
    for (let i = 0; i < args.edits; i++) {
        const text = kind === 'body'
            ? `${original}\n' benchmark edit ${i}\n`
            : `${original}\nfunction __benchmarkEdit${i}(a${isBs ? ' as integer' : ''})${isBs ? ' as integer' : ''}\n    return a + ${i}\nend function\n`;
        const start = now();
        program.setFile({ src: srcPath, dest: destPath }, text);
        program.validate();
        times.push(now() - start);
    }
    program.setFile({ src: srcPath, dest: destPath }, original);
    program.validate();

    const sorted = [...times].sort((a, b) => a - b);
    return {
        file: path.relative(args.projectDir, srcPath).replace(/\\/g, '/'),
        scopes: program.getScopesForFile(program.getFile(srcPath)).length,
        firstMs: round(times[0]),
        medianMs: round(sorted[sorted.length >> 1]),
        minMs: round(sorted[0]),
        maxMs: round(sorted[sorted.length - 1])
    };
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
