import type { ExecSyncOptions, SpawnSyncOptions } from 'child_process';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
const cwd = __dirname;
const tempDir = path.join(cwd, '.tmp');
let nodeArgs = ['--max-old-space-size=8192'];

clean();

import * as fsExtra from 'fs-extra';
import * as yargs from 'yargs';
import * as rimraf from 'rimraf';
import * as fastGlob from 'fast-glob';

interface RunnerOptions {
    versions: string[];
    targets: string[];
    noprepare: boolean;
    project: string;
    quick: boolean;
    profile: boolean;
    tar: boolean;
}
class Runner {
    constructor(
        private options: RunnerOptions
    ) {
    }

    run() {
        try {
            this.downloadFiles();

            if (!this.options.noprepare) {
                this.prepare();
            }
            this.runBenchmarks();
        } finally { }
    }

    /**
     * Download the necessary files
     */
    downloadFiles() {
        //ensure the `.tmp` folder exists
        fsExtra.ensureDirSync(tempDir);

        //use the given project, or use the default
        this.options.project = this.options.project || 'https://github.com/chtaylo2/Roku-GooglePhotos';

        if (this.options.project.startsWith('https://')) {
            const projectName = this.options.project.split('/').pop()!;
            const projectDir = path.join(tempDir, projectName);

            //if no project was specified, download the default.
            if (!fsExtra.pathExistsSync(projectDir)) {
                console.log(`benchmark: Downloading project for validation benchmarking: ${this.options.project}`);
                execSync(`npx degit "${this.options.project}" "${projectName}"`, {
                    cwd: tempDir
                });
            }
            //store the file system path for the project
            this.options.project = projectDir;
        }
    }

    buildCurrent() {
        const bscDir = path.resolve(__dirname, '..');
        console.log('benchmark: build current brighterscript');
        execSync('npm run build', {
            cwd: bscDir
        });
        return 'file:' + path.resolve(bscDir);
    }

    buildCurrentTarball() {
        const bscDir = path.resolve(__dirname, '..');
        this.buildCurrent();
        console.log('benchmark: pack current brighterscript');
        //pack the package
        const filename = execSync('npm pack', { cwd: bscDir, stdio: 'pipe' }).toString().trim();

        //move the tarball to temp to declutter the outer project
        let newFilename = path.join(tempDir, path.basename(filename).replace('.tgz', `${Date.now()}.tgz`));
        fsExtra.renameSync(`${bscDir}/${filename}`, newFilename);

        //return path to the tarball
        return path.resolve(newFilename);
    }

    /**
     * Clean out the node_modules folder for this folder, and load it up with the information needed for the versions in question
     */
    prepare() {
        const dependencies = {};
        console.log(`benchmark: using versions: ${this.options.versions}`);
        for (let i = 0; i < this.options.versions.length; i++) {
            const version = this.options.versions[i];
            const name = `brighterscript${i + 1}`;
            let location: string;

            //if the version is "current", then make a local copy of the package from the dist folder to install (because npm link makes things slower)
            if (version === 'local') {
                location = this.options.tar ? this.buildCurrentTarball() : this.buildCurrent();
            } else {
                location = `npm:brighterscript@${version}`;
            }
            execSync(`npm i ${name}@${location}`);
        }
        console.log('benchmark: npm install');
        //install packages
        execSync('npm install');
    }

    runBenchmarks() {
        console.log('benchmark: Running benchmarks: \n');
        const maxVersionLength = this.options.versions.reduce((acc, curr) => {
            return curr.length > acc ? curr.length : acc;
        }, 0);

        const maxTargetLength = this.options.targets.reduce((acc, curr) => {
            return curr.length > acc ? curr.length : acc;
        }, 0);

        if (this.options.profile) {
            console.log('Deleting previous profile runs\n');
            rimraf.sync(path.join(__dirname, 'isolate-*'));
        }

        //run one target at a time
        for (const target of this.options.targets) {
            //run each of the versions within this target
            for (let versionIndex = 0; versionIndex < this.options.versions.length; versionIndex++) {
                const version = this.options.versions[versionIndex];
                process.stdout.write(`Benchmarking ${target}@${version}`);
                const alias = `brighterscript${versionIndex + 1}`;

                //get the list of current profiler logs
                const beforeLogs = fastGlob.sync('isolate-*.log', {
                    cwd: cwd
                });

                execSync(`node ${nodeArgs.join(' ')} ${this.options.profile ? '--prof ' : ''}target-runner.js "${version}" "${maxVersionLength}" "${target}" "${maxTargetLength}" "${alias}" "${this.options.project}" "${this.options.quick}"`);
                if (this.options.profile) {
                    const logFile = fastGlob.sync('isolate-*.log', {
                        cwd: cwd
                    }).filter(x => !beforeLogs.includes(x))[0];

                    execSync(`node --prof-process ${logFile} > "${logFile.replace(/\.log$/, '')} (${target} ${version}).txt"`);
                    execSync(`node --prof-process --preprocess -j ${logFile} > "${logFile.replace(/\.log$/, '')} (${target} ${version}).json"`);
                }
            }
            //print a newline to separate the targets
            console.log('');
        }
    }
}

let targets = fsExtra.readdirSync('./targets').map(x => x.replace('.js', ''));

let options = yargs
    .usage('$0', 'bsc benchmark tool')
    .help('help', 'View help information about this tool.')
    .option('versions', {
        type: 'array',
        default: ['local', 'latest'],
        description: 'The versions to benchmark. should be a semver value, or "local" for the current project.'
    })
    .option('targets', {
        type: 'array',
        choices: targets,
        default: targets,
        description: 'Which benchmark targets should be run',
        defaultDescription: JSON.stringify(targets)
    })
    .option('noprepare', {
        type: 'boolean',
        alias: 'noinstall',
        description: 'Skip running npm install. Use this to speed up subsequent runs of the same test',
        default: false
    })
    .option('project', {
        type: 'string',
        description: 'File path to a project that should be used for complex benchmarking (like validation). If omitted, the tool will download and use https://github.com/chtaylo2/Roku-GooglePhotos'
    })
    .option('quick', {
        type: 'boolean',
        alias: 'fast',
        description: 'run a quick benchmark rather than the lower more precise version',
        default: false
    })
    .option('profile', {
        type: 'boolean',
        alias: 'prof',
        description: 'Enable nodejs profiling of each benchmark run',
        default: false
    })
    .option('tar', {
        type: 'boolean',
        description: 'use a npm-packed tarball for local files instead of using the files directly',
        default: true
    })
    .strict()
    .check(argv => {
        const idx = argv.versions.indexOf('latest');
        if (idx > -1) {
            //look up the latest version of brighterscript
            argv.versions[idx] = execSync('npm show brighterscript version', { stdio: 'pipe' }).toString().trim();
        }
        return true;
    })
    .argv;
const runner = new Runner(options as any);
runner.run();

function execSync(command: string, options: ExecSyncOptions = {}) {
    console.log(command);
    return childProcess.execSync(command, { stdio: 'inherit', cwd: cwd, ...options });
}

function clean() {
    //delete any brighterscript dependencies listed in package.json
    const deps = Object.keys(
        JSON.parse(
            fs.readFileSync(`${cwd}/package.json`)?.toString()
        ).dependencies
    ).filter(x => /brighterscript\d+/.exec(x));
    if (deps?.length > 0) {
        execSync(`npm remove ${deps.join(' ')}`);
    }
    execSync('npm install');
}
