const path = require('path');
const fsExtra = require('fs-extra');
const { Suite, formatNumber } = require('benchmark');
const readline = require('readline');
const chalk = require('chalk');
const v8Profiler = require('v8-profiler-next');

let idx = 2;

const version = process.argv[idx++];
const maxVersionLength = process.argv[idx++];
const target = process.argv[idx++];
const maxTargetLength = process.argv[idx++];
const bscAlias = process.argv[idx++];
const projectPath = process.argv[idx++];
const quick = JSON.parse(process.argv[idx++]);
const profile = JSON.parse(process.argv[idx++]);

const profileTitle = `${target}@${version}`;

const brighterscript = require(path.join(__dirname, 'node_modules', bscAlias));

const addTargetTestFunction = require(path.join(__dirname, 'targets', target));
(async () => {

    if (profile) {
        // set generateType 1 to generate new format for cpuprofile parsing in vscode.
        v8Profiler.setGenerateType(1);
        v8Profiler.startProfiling(profileTitle, true);
    }

    const suite = new Suite('parser suite', {
        minSamples: 30000,
        initCount: 30000,
        minTime: 30000,
        maxTime: -Infinity
    })
        .on('add', (event) => {
            event.target.on('start cycle', function startCycle() {
                const bench = this;
                const size = bench.stats.sample.length;

                if (!bench.aborted) {
                    readline.clearLine(process.stdout);
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
            const hz = this[0].hz;
            //write the final result to output
            readline.clearLine(process.stdout);
            readline.cursorTo(process.stdout, 0);
            const formattedHz = formatNumber(hz.toFixed(3));
            console.log(
                `${target.padStart(maxTargetLength, ' ')}@${version.padEnd(maxVersionLength, ' ')}`,
                '-'.repeat(' ###,###,###.###'.length - formattedHz.length),
                chalk.yellow(formattedHz), 'ops/sec'
            );

            if (profile) {
                const profile = v8Profiler.stopProfiling(profileTitle);
                profile.export((error, result) => {
                    fsExtra.writeFileSync(`${Date.now()}-${profileTitle}.cpuprofile`, result);
                    profile.delete();
                });
            }
        });
    //add the test method. This could be async.
    await Promise.resolve(
        addTargetTestFunction(suite, `${target}@${version}`, brighterscript, projectPath, {
            minTime: quick ? undefined : 3.5
        })
    );

    suite.run({ 'async': true });
})().catch(console.error.bind(console));
