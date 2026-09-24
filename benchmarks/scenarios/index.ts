import * as childProcess from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as yargs from 'yargs';
import type { ScenarioProject } from './ScenarioProjects';
import { loadProjects, prepareProject, resolveBsc, scenariosDir, tempDir } from './ScenarioProjects';
import { analyzeProfile } from './analyzeProfile';

const resultsDir = path.join(scenariosDir, 'results');

interface EditResult {
    file: string;
    scopes: number;
    firstMs: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
}

interface RunResult {
    project: string;
    bsc: string;
    bscVersion: string;
    files: number;
    scopes: number;
    diagnostics: number;
    diagnosticsHash: string;
    coldTotalMs: number;
    coldValidateMs: number;
    coldLoadMs: number;
    heapAfterGcMB: number;
    peakRssMB: number;
    phases: Record<string, number>;
    edits?: Record<string, EditResult>;
    diagnosticsAfterEdits?: number;
    editsRestoredDiagnostics?: boolean;
    heapAfterEditsMB?: number;
}

interface ResultsFile {
    meta: Record<string, any>;
    results: Array<{ project: string; bsc: string; best: RunResult; runs: RunResult[] }>;
}

interface RunOptions {
    projects?: string[];
    bsc: string[];
    runs: number;
    edits: number;
    build: boolean;
    profile?: 'cpu' | 'heap' | 'edits';
    require?: string;
    label?: string;
    diagnostics: boolean;
}

function run(options: RunOptions) {
    let projects = loadProjects();
    if (options.projects?.length > 0) {
        const unknown = options.projects.filter(name => !projects.some(p => p.name === name));
        if (unknown.length > 0) {
            throw new Error(`Unknown project(s): ${unknown.join(', ')}. Available: ${projects.map(p => p.name).join(', ')}`);
        }
        projects = projects.filter(p => options.projects.includes(p.name));
    }
    const bscs = options.bsc.map(bsc => resolveBsc(bsc, options.build));
    const prepared = projects.map(project => ({ project: project, projectDir: prepareProject(project) }));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const label = options.label ?? stamp;
    const profileDir = path.join(resultsDir, 'profiles', label);
    const rawRuns = new Map<string, RunResult[]>();

    //interleave versions within each run so machine noise hits them all roughly equally
    for (let runIndex = 1; runIndex <= options.runs; runIndex++) {
        for (const { project, projectDir } of prepared) {
            for (const bsc of bscs) {
                process.stdout.write(`scenarios: run ${runIndex}/${options.runs} ${project.name} @ ${bsc.label}...`);
                const result = runOne({
                    project: project,
                    projectDir: projectDir,
                    bsc: bsc,
                    options: options,
                    runName: `${project.name}-${bsc.label}-run${runIndex}`,
                    profileDir: profileDir
                });
                console.log(` validate ${result.coldValidateMs}ms, heap ${result.heapAfterGcMB}MB`);
                const key = `${project.name}|${bsc.label}`;
                rawRuns.set(key, [...(rawRuns.get(key) ?? []), result]);
            }
        }
    }

    const resultsFile: ResultsFile = {
        meta: {
            label: label,
            date: new Date().toISOString(),
            runs: options.runs,
            edits: options.edits,
            require: options.require,
            bsc: bscs.map(b => b.label),
            localGit: gitInfo(),
            node: process.version,
            platform: `${os.platform()} ${os.arch()}`,
            cpu: os.cpus()[0]?.model,
            cpuCount: os.cpus().length,
            totalMemGB: Math.round(os.totalmem() / 1073741824)
        },
        results: [...rawRuns].map(([key, runs]) => {
            const [project, bsc] = key.split('|');
            return { project: project, bsc: bsc, best: bestOf(runs), runs: runs };
        })
    };
    const outFile = path.join(resultsDir, `${label}.json`);
    fsExtra.outputJsonSync(outFile, resultsFile, { spaces: 4 });

    console.log('');
    printResults(resultsFile);
    if (bscs.length > 1) {
        console.log('');
        printComparison(resultsFile, resultsFile, bscs[0].label);
    }
    console.log(`\nscenarios: results written to ${path.relative(process.cwd(), outFile)}`);
    if (options.profile) {
        console.log(`scenarios: profiles written to ${path.relative(process.cwd(), profileDir)} (summarize with: npm run benchmark:scenarios -- analyze <file>)`);
    }
}

function runOne(params: { project: ScenarioProject; projectDir: string; bsc: { label: string; bscPath: string }; options: RunOptions; runName: string; profileDir: string }) {
    const { project, projectDir, bsc, options, runName, profileDir } = params;
    const workDir = path.join(tempDir, 'runs', runName);
    fsExtra.emptyDirSync(workDir);
    const outFile = path.join(workDir, 'result.json');

    const bsconfig: Record<string, any> = { ...project.config };
    if (project.bsconfig) {
        bsconfig.project = path.resolve(projectDir, project.bsconfig);
    }
    const argsFile = path.join(workDir, 'args.json');
    fsExtra.outputJsonSync(argsFile, {
        projectName: project.name,
        projectDir: projectDir,
        bscPath: bsc.bscPath,
        bscLabel: bsc.label,
        bsconfig: bsconfig,
        stagingDir: path.join(workDir, 'staging'),
        edits: options.edits,
        editFiles: project.editFiles,
        outFile: outFile,
        writeDiagnostics: options.diagnostics,
        profileEdits: options.profile === 'edits' ? path.join(profileDir, `${runName}-edits.cpuprofile`) : undefined
    });

    const nodeArgs = ['--expose-gc', '--max-old-space-size=16384'];
    if (options.profile === 'cpu') {
        nodeArgs.push('--cpu-prof', `--cpu-prof-dir=${profileDir}`, `--cpu-prof-name=${runName}.cpuprofile`, '--cpu-prof-interval=200');
    } else if (options.profile === 'heap') {
        nodeArgs.push('--heap-prof', `--heap-prof-dir=${profileDir}`, `--heap-prof-name=${runName}.heapprofile`, '--heap-prof-interval=65536');
    }
    if (options.profile) {
        fsExtra.ensureDirSync(profileDir);
    }
    if (options.require) {
        nodeArgs.push('--require', path.resolve(options.require));
    }

    //run from the project dir so bsconfig `require` entries and plugins resolve the same way they would for the project itself
    const child = childProcess.spawnSync(process.execPath, [...nodeArgs, path.join(scenariosDir, 'runScenario.js'), argsFile], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 256 * 1024 * 1024
    });
    if (child.status !== 0 || !fsExtra.pathExistsSync(outFile)) {
        throw new Error(`Scenario run '${runName}' failed (exit code ${child.status}):\n${child.stderr?.toString()}\n${child.stdout?.toString().slice(-4000)}`);
    }
    const result = fsExtra.readJsonSync(outFile) as RunResult;
    if (options.diagnostics) {
        const diagnosticsFile = outFile.replace(/\.json$/, '.diagnostics.txt');
        fsExtra.copySync(diagnosticsFile, path.join(resultsDir, 'diagnostics', `${runName}.txt`));
    }
    return result;
}

/**
 * Best (min) of each timing across runs - min is the most stable estimate on a noisy machine.
 * Diagnostics must be identical across runs, anything else is a bug
 */
function bestOf(runs: RunResult[]): RunResult {
    const best: RunResult = JSON.parse(JSON.stringify(runs[0]));
    const min = (values: number[]) => Math.min(...values.filter(v => typeof v === 'number'));
    for (const key of ['coldTotalMs', 'coldValidateMs', 'coldLoadMs', 'heapAfterGcMB', 'peakRssMB', 'heapAfterEditsMB'] as const) {
        if (typeof best[key] === 'number') {
            best[key] = min(runs.map(r => r[key]));
        }
    }
    for (const phase of Object.keys(best.phases ?? {})) {
        best.phases[phase] = min(runs.map(r => r.phases?.[phase]));
    }
    for (const editName of Object.keys(best.edits ?? {})) {
        for (const key of ['firstMs', 'medianMs', 'minMs', 'maxMs'] as const) {
            best.edits[editName][key] = min(runs.map(r => r.edits?.[editName]?.[key]));
        }
    }
    const hashes = new Set(runs.map(r => r.diagnosticsHash));
    if (hashes.size > 1) {
        console.warn(`scenarios: WARNING - ${best.project}@${best.bsc} produced different diagnostics across runs: ${[...hashes].join(', ')}`);
    }
    best.editsRestoredDiagnostics = runs.every(r => r.editsRestoredDiagnostics !== false);
    return best;
}

const editNames = ['shared-body', 'shared-api', 'leaf-body', 'leaf-api'];

function printResults(resultsFile: ResultsFile) {
    const rows = resultsFile.results.map(({ best }) => [
        best.project,
        `${best.bsc} (${best.bscVersion})`,
        String(best.files),
        String(best.scopes ?? ''),
        `${best.diagnostics} ${best.diagnosticsHash}`,
        `${best.coldLoadMs}`,
        `${best.coldValidateMs}`,
        `${best.heapAfterGcMB}`,
        `${best.peakRssMB}`,
        ...editNames.map(name => (best.edits?.[name] ? `${best.edits[name].medianMs} (${best.edits[name].scopes}sc)` : '-')),
        best.edits ? (best.editsRestoredDiagnostics ? 'yes' : 'NO') : '-'
    ]);
    printTable(['project', 'bsc', 'files', 'scopes', 'diagnostics', 'load ms', 'validate ms', 'heap MB', 'rss MB', ...editNames.map(n => `${n} ms`), 'edits restored'], rows);

    for (const { best } of resultsFile.results) {
        if (best.edits) {
            console.log(`  ${best.project}@${best.bsc} edit targets: ${Object.entries(best.edits).filter(([n]) => n.endsWith('-body')).map(([n, e]) => `${n.replace('-body', '')}=${e.file}`).join(', ')}`);
        }
    }
}

function printComparison(before: ResultsFile, after: ResultsFile, baselineBsc?: string) {
    const rows = [] as string[][];
    for (const b of after.results) {
        if (baselineBsc && b.bsc === baselineBsc && before === after) {
            continue;
        }
        let a: ResultsFile['results'][0];
        if (before === after) {
            a = before.results.find(x => x.project === b.project && x.bsc === baselineBsc);
        } else {
            a = before.results.find(x => x.project === b.project && x.bsc === b.bsc);
            //different labels (eg. `local` on two branches) - only pair them up when it's unambiguous
            const beforeForProject = before.results.filter(x => x.project === b.project);
            const afterForProject = after.results.filter(x => x.project === b.project);
            if (!a && beforeForProject.length === 1 && afterForProject.length === 1) {
                a = beforeForProject[0];
            }
        }
        if (!a) {
            continue;
        }
        const delta = (x: number, y: number) => {
            if (typeof x !== 'number' || typeof y !== 'number') {
                return '-';
            }
            const pct = x === 0 ? 0 : (100 * (y - x) / x);
            return `${x} → ${y} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`;
        };
        rows.push([
            b.project,
            `${a.bsc} → ${b.bsc}`,
            a.best.diagnosticsHash === b.best.diagnosticsHash ? 'same' : `CHANGED ${a.best.diagnostics} → ${b.best.diagnostics}`,
            delta(a.best.coldLoadMs, b.best.coldLoadMs),
            delta(a.best.coldValidateMs, b.best.coldValidateMs),
            delta(a.best.heapAfterGcMB, b.best.heapAfterGcMB),
            ...editNames.map(name => delta(a.best.edits?.[name]?.medianMs, b.best.edits?.[name]?.medianMs))
        ]);
    }
    printTable(['project', 'bsc', 'diagnostics', 'load ms', 'validate ms', 'heap MB', ...editNames.map(n => `${n} ms`)], rows);
}

function printTable(headers: string[], rows: string[][]) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
    const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ');
    console.log(line(headers));
    console.log(widths.map(w => '-'.repeat(w)).join('  '));
    for (const row of rows) {
        console.log(line(row));
    }
}

function gitInfo() {
    try {
        const cwd = path.join(scenariosDir, '..', '..');
        const git = (cmd: string) => childProcess.execSync(`git ${cmd}`, { cwd: cwd, stdio: 'pipe' }).toString().trim();
        return { branch: git('rev-parse --abbrev-ref HEAD'), sha: git('rev-parse --short HEAD'), dirty: git('status --porcelain').length > 0 };
    } catch {
        return undefined;
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs
    .scriptName('benchmark:scenarios')
    .usage('$0 <command>')
    .command('run', 'Run the scenarios (cold load/validate, memory, edit re-validation) against one or more projects', (y) => {
        return y
            .option('projects', { type: 'array', string: true, description: 'Project names from projects.json / projects.local.json. Defaults to all' })
            .option('bsc', { type: 'array', string: true, default: ['local'], description: '"local", a path to a brighterscript package, or an npm version. The first one is the baseline when comparing' })
            .option('runs', { type: 'number', default: 3, description: 'Runs per project/bsc. Timings report the best (min) run' })
            .option('edits', { type: 'number', default: 5, description: 'Edits per edit scenario. 0 skips edit re-validation' })
            .option('build', { type: 'boolean', default: false, description: 'Run `npm run build` before using "local"' })
            .option('profile', { choices: ['cpu', 'heap', 'edits'] as const, description: 'Capture a .cpuprofile of the whole run, a .heapprofile, or a .cpuprofile of just the edit re-validation' })
            .option('require', { type: 'string', description: 'Module to preload in each run (eg. a monkeypatch to prototype a change without touching src)' })
            .option('label', { type: 'string', description: 'Name for the results file. Defaults to a timestamp' })
            .option('diagnostics', { type: 'boolean', default: false, description: 'Also save the full diagnostics list for each run to results/diagnostics' });
    }, (argv) => {
        run(argv as unknown as RunOptions);
    })
    .command('compare <before> <after>', 'Compare two results files', (y) => {
        return y
            .positional('before', { type: 'string', demandOption: true })
            .positional('after', { type: 'string', demandOption: true });
    }, (argv) => {
        const load = (file: string) => fsExtra.readJsonSync(fsExtra.pathExistsSync(file) ? file : path.join(resultsDir, file)) as ResultsFile;
        printComparison(load(argv.before), load(argv.after));
    })
    .command('analyze <profile>', 'Summarize a .cpuprofile or .heapprofile', (y) => {
        return y
            .positional('profile', { type: 'string', demandOption: true })
            .option('top', { type: 'number', default: 40 });
    }, (argv) => {
        console.log(analyzeProfile(argv.profile, argv.top));
    })
    .demandCommand(1)
    .strict()
    .help()
    .argv;
