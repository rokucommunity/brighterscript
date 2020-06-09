import { execSync } from 'child_process';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import * as semverExtra from 'semver-extra';
import * as benchmark from 'benchmark';

(async () => {
    const argv = require('yargs')
        .boolean('nosetup')
        .argv;

    var doSetup = !argv.nosetup;
    var benchmarkNames = argv._;
    if (benchmarkNames.length === 0) {
        benchmarkNames = ['lexer', 'parser'];
    }
    var iterationCount = argv.iterationCount;
    var maxPercentChange = argv.maxPercentChange;

    var latestBrighterScriptVersion = semverExtra.maxStable(
        JSON.parse(
            execSync('npm view brighterscript versions --json').toString()
        )
    );

    //install the npm version and the local version and build the local version
    if (doSetup) {
        console.log('deleting benchmarks/node_modules');
        fsExtra.remove(`${__dirname}/node_modules`);

        console.log('deleting benchmarks/package.json');
        fsExtra.remove(`${__dirname}/node_modules/package.json`);

        console.log(`installing brighterscript@${latestBrighterScriptVersion}`);
        execSync(`npm init -y`, {
            cwd: __dirname,
            stdio: 'inherit'
        });
        execSync(`npm --cache-min 9999999 i brighterscript@${latestBrighterScriptVersion}`, {
            cwd: __dirname,
            stdio: 'inherit'
        });

        console.log('building local brighterscript');
        execSync('npm run build', {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });
    }

    //the process passes data around by writing to a results.json file. create that file now
    fsExtra.writeFileSync(path.join(__dirname, 'results.json'), '{}');

    //there's a strange performance issue where, when running multiple versions of the brighterscript npm module at the same time,
    //whichever one was included first is faster. So we need to run each benchmark on its own process to get more normalized results
    for (let benchmarkName of benchmarkNames) {
        execSync(`npx ts-node single-run.ts --test-name ${benchmarkName} --brightscript-version local --iteration-count ${iterationCount}`, {
            stdio: "inherit",
            cwd: __dirname
        });
        execSync(`npx ts-node single-run.ts --test-name ${benchmarkName} --brightscript-version ${latestBrighterScriptVersion} --iteration-count ${iterationCount}`, {
            stdio: "inherit",
            cwd: __dirname
        });
    }

    //load the results json file
    let averages = JSON.parse(
        fsExtra.readFileSync(path.join(__dirname, 'results.json')).toString()
    );

    //write a blank line to separate the final results
    console.log('\nFinal Results:');
    let isFailure = false;
    for (let benchmarkName in averages) {
        let local = averages[benchmarkName].local;
        let npm = averages[benchmarkName][latestBrighterScriptVersion];
        let percentChange = (local - npm) / npm * 100;
        //round the value to 3 decimal places
        percentChange = Math.round(percentChange * 100) / 100;

        let changeText = percentChange < 0 ? 'decreased' : 'increased';

        console.log(`'${benchmarkName}' ${changeText} performance by ${percentChange}%`);

        if (
            //if we are configured to fail on percent change
            maxPercentChange !== undefined &&
            //the change is less than 0 (i.e. decrease in performance)
            percentChange < 0 &&
            //the change is larger than the acceptable percentage
            Math.abs(percentChange) > parseFloat(maxPercentChange)
        ) {
            isFailure = true;
            console.log(`'${benchmarkName}' failed because ${percentChange}% is above the threshold of ${maxPercentChange}%`);
        }
    }

    if (isFailure) {
        process.exit(-1);
    }
})();

function computePercentChange(suiteName: string, suite: benchmark.Suite) {
    let npmValues = suite.filter(x => !(x.name as string).startsWith('local')).map(x => x.hz);
    let originalNumber = npmValues.reduce((sum, current) => sum + current, 0) / npmValues.length;

    let localValues = suite.filter(x => (x.name as string).startsWith('local')).map(x => x.hz);
    let newNumber = localValues.reduce((sum, current) => sum + current, 0) / localValues.length;

    let percentIncrease = (newNumber - originalNumber) / originalNumber * 100;
    //round the value to 3 decimal places
    percentIncrease = Math.round(percentIncrease * 100) / 100;
    this.percentChanges[suiteName] = percentIncrease;
}