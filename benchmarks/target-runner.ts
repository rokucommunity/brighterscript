import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type Benchmark from 'benchmark';
import { Suite, formatNumber } from 'benchmark';
import * as readline from 'readline';
import * as chalk from 'chalk';
import * as inspector from 'inspector';

let idx = 2;
const extraNamePadding = 20;

const version = process.argv[idx++];
const maxVersionLength = parseInt(process.argv[idx++]);
const target = process.argv[idx++];
const maxTargetLength = parseInt(process.argv[idx++]);
const bscAlias = process.argv[idx++];
const projectPath = process.argv[idx++];
const quick = JSON.parse(process.argv[idx++]);
const profile = JSON.parse(process.argv[idx++]);
const config = JSON.parse(process.argv[idx++]);

const profileTitle = `${target}@${version}`;

const brighterscript = require(path.join(__dirname, 'node_modules', bscAlias));

const addTargetTestFunction = require(path.join(__dirname, 'targets', target));
(async () => {

    //built-in inspector instead of v8-profiler-next, which is a native module that no longer builds on current node
    const session = new inspector.Session();
    if (profile) {
        session.connect();
        session.post('Profiler.enable');
        session.post('Profiler.start');
    }

    const suite = new Suite('parser suite', {
        // minSamples: 30000,
        // initCount: 30000,
        // minTime: 30000,
        // maxTime: -Infinity
    })
        .on('add', (event) => {
            event.target.on('start cycle', function startCycle() {
                const bench = this;
                const size = bench.stats.sample.length;

                if (!bench.aborted) {
                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(
                        bench.name + ' x ' + formatNumber(bench.count) + ' (' +
                        size + ' sample' + (size === 1 ? '' : 's') + ') ' + formatNumber(bench.hz.toFixed(3)) + ' ops/sec'
                    );
                }
            });
        })
        .on('error', (error) => {
            console.error(error.currentTarget[0].error || error);
        })
        .on('complete', function complete() {
            for (let i = 0; i < this.length; i++) {
                let result = this[i];
                //write the final result to output
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                const formattedHz = formatNumber(result.hz.toFixed(3));
                let [name] = result.name.split('@');
                console.log(
                    `${name.padStart(maxTargetLength + extraNamePadding, ' ')}@${version.padEnd(maxVersionLength, ' ')}`,
                    '-'.repeat(' ###,###,###.###'.length - formattedHz.length),
                    chalk.yellow(formattedHz), 'ops/sec'
                );

                if (profile) {
                    session.post('Profiler.stop', (error, result) => {
                        if (error) {
                            console.error(error);
                            return;
                        }
                        fsExtra.outputJsonSync(path.join(__dirname, '.tmp', 'profiles', `${Date.now()}-${profileTitle}.cpuprofile`), result.profile);
                    });
                }
            }
        });
    //add the test method. This could be async.
    await Promise.resolve(
        addTargetTestFunction({
            suite: suite,
            name: target,
            version: version,
            fullName: `${target}@${version}`,
            brighterscript: brighterscript,
            projectPath: projectPath,
            //benchmark.js defaults to at least 5 samples over up to ~5s. `--quick` trades precision for speed
            suiteOptions: quick ? { minSamples: 2, maxTime: 1 } : {},
            additionalConfig: config
        })
    );

    suite.run({ 'async': true });
})().catch(console.error.bind(console));

export interface TargetOptions {
    suite: Suite;
    name: string;
    version: string;
    fullName: string;
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    brighterscript: typeof import('../src');
    projectPath: string;
    suiteOptions: Benchmark.Options;
    additionalConfig: Record<string, unknown>;
}
