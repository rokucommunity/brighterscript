const fsExtra = require('fs-extra');
const syncRequest = require('sync-request');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const yargs = require('yargs');
const readline = require('readline');
const rimraf = require('rimraf');
const glob = require('glob');

class Runner {
    constructor(options) {
        this.versions = options.versions;
        this.targets = options.targets;
        this.noprepare = options.noprepare;
        this.project = options.project;
        this.quick = options.quick;
        this.profile = options.profile;
    }
    run() {
        this.downloadFiles();

        if (!this.noprepare) {
            this.prepare();
        }
        this.runBenchmarks();
    }

    /**
     * Download the necessary files
     */
    downloadFiles() {
        const tempDir = path.join(__dirname, '.tmp');
        //ensure the `.tmp` folder exists
        fsExtra.ensureDirSync(tempDir);

        //use the given project, or use the default
        this.project = this.project || 'https://github.com/chtaylo2/Roku-GooglePhotos';

        if (this.project.startsWith('https://')) {
            const projectName = this.project.split('/').pop();
            const projectDir = path.join(tempDir, projectName);

            //if no project was specified, download the default.
            if (!fsExtra.pathExistsSync(projectDir)) {
                console.log(`benchmark: Downloading project for validation benchmarking: ${this.project}`);
                spawnSync(
                    process.platform.startsWith('win') ? 'npx.cmd' : 'npx',
                    ['degit', this.project, projectName],
                    {
                        stdio: 'inherit',
                        cwd: tempDir
                    }
                );
            }
            //store the file system path for the project
            this.project = projectDir;
        }
    }

    buildCurrentTarball() {
        const bscDir = path.resolve(__dirname, '..');
        console.log('benchmark: build current brighterscript');
        this.npmSync(['run', 'build'], {
            cwd: bscDir
        });
        console.log('benchmark: pack current brighterscript');
        const filename = this.npmSync(['pack'], { cwd: bscDir, stdio: 'pipe' }).stdout.toString().trim();
        return path.resolve(bscDir, filename);
    }

    /**
     * Clean out the node_modules folder for this folder, and load it up with the information needed for the versions in question
     */
    prepare() {
        console.log('benchmark: Clearing any existing node_modules folder');
        const nodeModulesDir = path.join(__dirname, 'node_modules');
        fsExtra.ensureDirSync(nodeModulesDir);
        //delete anything that was there previously
        fsExtra.emptyDirSync(nodeModulesDir);

        const dependencies = {};
        for (let i = 0; i < this.versions.length; i++) {
            const version = this.versions[i];
            const name = `brighterscript${i + 1}`;

            //if the version is "current", then make a local copy of the package from the dist folder to install (because npm link makes things slower)
            if (version === 'local') {
                dependencies[name] = this.buildCurrentTarball();
            } else {
                dependencies[name] = `npm:brighterscript@${version}`;
            }
        }
        console.log('benchmark: Writing package.json');
        //write a package.json for this project
        fsExtra.outputFileSync(path.join(__dirname, 'package.json'), JSON.stringify({
            dependencies: dependencies
        }, null, 4));
        console.log('benchmark: npm install');
        //install packages
        this.npmSync(['install']);
    }

    npmSync(args, options = {}) {
        return spawnSync(
            process.platform.startsWith('win') ? 'npm.cmd' : 'npm',
            args,
            {
                stdio: 'inherit',
                cwd: __dirname,
                ...options
            }
        );
    }

    runBenchmarks() {
        console.log('benchmark: Running benchmarks: \n');
        const maxVersionLength = this.versions.reduce((acc, curr) => {
            return curr.length > acc ? curr.length : acc;
        }, 0);

        const maxTargetLength = this.targets.reduce((acc, curr) => {
            return curr.length > acc ? curr.length : acc;
        }, 0);

        if (this.profile) {
            console.log('Deleting previous profile runs\n');
            rimraf.sync(path.join(__dirname, 'isolate-*'));
        }

        //run one target at a time
        for (const target of this.targets) {
            //run each of the versions within this target
            for (let versionIndex = 0; versionIndex < this.versions.length; versionIndex++) {
                const version = this.versions[versionIndex];
                process.stdout.write(`Benchmarking ${target}@${version}`);
                const alias = `brighterscript${versionIndex + 1}`;

                //get the list of current profiler logs
                const beforeLogs = glob.sync('isolate-*.log', {
                    cwd: __dirname
                });

                execSync(`node ${this.profile ? '--prof ' : ''}target-runner.js "${version}" "${maxVersionLength}" "${target}" "${maxTargetLength}" "${alias}" "${this.project}" "${this.quick}"`, {
                    cwd: path.join(__dirname),
                    stdio: 'inherit'
                });
                if (this.profile) {
                    const logFile = glob.sync('isolate-*.log', {
                        cwd: __dirname
                    }).filter(x => !beforeLogs.includes(x))[0];

                    execSync(`node --prof-process ${logFile} > "${logFile.replace(/\.log$/, '')} (${target} ${version}).txt"`, {
                        cwd: path.join(__dirname)
                    });
                    execSync(`node --prof-process --preprocess -j ${logFile} > "${logFile.replace(/\.log$/, '')} (${target} ${version}).json"`, {
                        cwd: path.join(__dirname)
                    });
                }
            }
            //print a newline to separate the targets
            console.log('');
        }
    }
}

let targets = fsExtra.readdirSync(path.join(__dirname, 'targets')).map(x => x.replace('.js', ''));

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
    .strict()
    .check(argv => {
        const idx = argv.versions.indexOf('latest');
        if (idx > -1) {
            //look up the latest version of brighterscript
            argv.versions[idx] = spawnSync(process.platform.startsWith('win') ? 'npm.cmd' : 'npm', ['show', 'brighterscript', 'version']).stdout.toString().trim();
        }
        return true;
    })
    .argv;
const runner = new Runner(options);
runner.run();
