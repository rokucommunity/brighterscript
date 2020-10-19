
const fsExtra = require('fs-extra');
const syncRequest = require('sync-request');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

class Runner {
    constructor(versions, targets, iterations) {
        this.versions = versions;
        this.targets = targets;
        this.iterations = iterations;
    }
    async run() {
        // this.downloadBrsFile();
        // this.prepare();
        this.runBenchmarks();
    }

    /**
     * Download the `Requests.brs` file from rokucommunity, it has some decent variety
     */
    downloadBrsFile() {
        const brsFilePath = path.join(__dirname, 'Requests.brs');
        //download the latest copy of roku-requests
        if (!fsExtra.pathExistsSync(brsFilePath)) {
            console.log('benchmark: Downloading Requests.brs');
            const response = syncRequest('GET', 'https://raw.githubusercontent.com/rokucommunity/roku-requests/master/src/source/Requests.brs')
            fsExtra.writeFileSync(brsFilePath, response.getBody());
            console.log('benchmark: Downloading Requests.brs complete');
        } else {
            console.log('benchmark: Downloading Requests.brs skipped: already downloaded');
        }
    }


    /**
     * Clean out the node_modules folder for this folder, and load it up with the information needed for the versions in question
     */
    prepare() {
        console.log('benchmark: Clearing previous benchmark results');
        fsExtra.outputFileSync(path.join(__dirname, 'results.json'), '[]');

        console.log('benchmark: Clearing any existing node_modules folder');
        const nodeModulesDir = path.join(__dirname, 'node_modules');
        fsExtra.ensureDirSync(nodeModulesDir);
        //delete anything that was there previously
        fsExtra.emptyDirSync(nodeModulesDir);

        const dependencies = {};
        for (var i = 0; i < this.versions.length; i++) {
            dependencies[`brighterscript${i + 1}`] = `npm:brighterscript@${this.versions[i]}`;
        }
        console.log('benchmark: Writing package.json');
        //write a package.json for this project
        fsExtra.outputFileSync(path.join(__dirname, 'package.json'), JSON.stringify({
            dependencies: dependencies
        }, null, 4));
        console.log('benchmark: npm install');
        //install packages
        spawnSync(
            process.platform.startsWith('win') ? 'npm.cmd' : 'npm',
            ['install'],
            {
                stdio: 'inherit',
                cwd: __dirname
            }
        );
    }

    runBenchmarks() {
        //run one target at a time
        for (let target of this.targets) {
            //run each of the versions within this target
            for (var versionIndex = 0; versionIndex < this.versions.length; versionIndex++) {
                const version = this.versions[versionIndex];
                //run the same test several times and take an average
                for (var iteration = 0; iteration < this.iterations; iteration++) {
                    process.stdout.clearLine();
                    process.stdout.cursorTo(0);
                    process.stdout.write(`Benchmarking ${target}@${version} (${iteration + 1} of ${this.iterations})`);

                    execSync(`node target-runner.js "${version}" "${target}" brighterscript${versionIndex + 1}`, {
                        cwd: path.join(__dirname),
                        stdio: 'inherit'
                    });
                }
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
                process.stdout.write(`Benchmarking ${target}@${version} (done)`);
            }
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            //log the final results to the console
            this.logTargetResults(target);
            process.stdout.write('\n');
        }
    }

    logTargetResults(target) {
        const results = fsExtra.readJsonSync(path.join(__dirname, 'results.json'));
        for (let version of this.versions) {
            const versionResults = results[target][version];
            const average = versionResults.reduce((a, b) => { return a + b; }, 0) / versionResults.length;
            console.log(`${target}@${version} x ${average.toFixed(3).toLocaleString('en')} ops/sec`);
        }
    }
}

const runner = new Runner(['0.16.4', '0.16.9'], ['lexer', 'parser', 'lex-parse-validate'], 1);
runner.run();