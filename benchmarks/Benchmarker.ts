import * as benchmark from 'benchmark';
benchmark.support.decompilation = false;
import { execSync } from 'child_process';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semverExtra from 'semver-extra';

/**
 * Assumes that the brighterscript project has already been built. 
 */
export class Benchmarker {

    public async runAll(tests, doSetup = true, iterationCount = 3) {
        if (doSetup) {
            this.prepare();
        }
        this.addIterations(iterationCount);
        tests = tests?.length > 0 ? tests : ['lexer', 'parser'];
        for (var testName of tests) {

            await this[testName]();
        }
    }

    public prepare() {
        console.log('deleting benchmarks/node_modules');
        fsExtra.remove(`${__dirname}/node_modules`);

        console.log('deleting benchmarks/package.json');
        fsExtra.remove(`${__dirname}/node_modules/package.json`);

        console.log(`installing brighterscript@${this.latestBrighterScriptVersion}`);
        execSync(`npm init -y`, {
            cwd: __dirname,
            stdio: 'inherit'
        });
        execSync(`npm --cache-min 9999999 i brighterscript@${this.latestBrighterScriptVersion}`, {
            cwd: __dirname,
            stdio: 'inherit'
        });

        console.log('building local brighterscript');
        execSync('npm run build', {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });
    }

    private addIterations(iterationCount: number) {
        let stuff = [
            [require('brighterscript'), this.latestBrighterScriptVersion],
            [require(`${__dirname}/../dist`), 'local']
        ];

        for (let j = 0; j < 2; j++) {
            for (var i = 0; i < iterationCount; i++) {
                this.iterations.push({
                    brighterscript: stuff[j][0],
                    name: `${stuff[j][1]} (${i + 1})`
                });
            }
        }
    }

    /**
     * An array of brighterscript lib and name. Used to run the tests multiple times to get a better average result
     */
    private iterations = [] as { brighterscript: any, name: string }[];
    public hasFailures = false;

    /**
     * Map of percent change by benchmark name.
     * The value is always "The percent the current code changed from the latest release"
     */
    public percentChanges = {} as { [benchmarkName: string]: number };

    private get latestBrighterScriptVersion() {
        if (!this._latestBrighterScriptVersion) {
            //computing latest brighterscript version         
            var versions = JSON.parse(
                execSync('npm view brighterscript versions --json').toString()
            );
            this._latestBrighterScriptVersion = semverExtra.maxStable(versions) as string;
        }
        return this._latestBrighterScriptVersion;
    }
    private _latestBrighterScriptVersion: string;

    private getTestFile(name: string) {
        if (!this.testFileCache[name]) {
            let fileContents = fsExtra.readFileSync(
                path.join(__dirname, 'testFiles', name)
            ).toString();
            this.testFileCache[name] = fileContents;
        }
        return this.testFileCache[name];
    }
    private testFileCache = {} as { [name: string]: string };


    /**
     * Lexer benchmark
     */
    public async lexer() {
        console.log('\n--------lexer benchmarks--------');

        var sourceFile = this.getTestFile('100-functions.brs');
        let suite = new benchmark.Suite();
        let lexer;
        this.iterations.forEach((iteration) => {
            suite.add(iteration.name, {
                fn() {
                    lexer.scan(sourceFile);
                },
                setup: function () {
                    lexer = new iteration.brighterscript.Lexer();
                },
                teardown: function () {
                    lexer = undefined;
                },
                onError: console.error.bind(console)
            });
        });

        await this.runSuite('lexer', suite);
    }

    /**
     * Parser benchmark
     */
    public async parser() {
        console.log('\n--------parser benchmarks--------');

        var giant = this.getTestFile('100-functions.brs');
        let suite = new benchmark.Suite();
        var parser;
        var tokens;
        this.iterations.forEach((iteration) => {
            suite.add(iteration.name, {
                fn() {
                    parser.parse(tokens);
                },
                setup: function () {
                    let lexer = new iteration.brighterscript.Lexer();
                    tokens = lexer.scan(giant).tokens;
                    parser = new iteration.brighterscript.Parser();
                },
                teardown: function () {
                    tokens = undefined;
                    parser = undefined;
                },
                onError: console.error.bind(console)
            });
        });

        await this.runSuite('parser', suite);
    }

    public async runSuite(suiteName: string, suite: benchmark.Suite) {
        return new Promise((resolve) => {
            let computePercentChange = this.computePercentChange.bind(this);
            suite
                .on('cycle', function (event) {
                    console.log(event.target.toString());
                })
                .on('complete', function () {
                    console.log(`\nresults: `);
                    for (var i = 0; i < this.length; i++) {
                        // console.log(`${ this[i].name }: ${ Math.round(this[i].hz * 100) / 100 } ops / sec`);
                        console.log(this[i].toString());
                    }
                    computePercentChange(suiteName, this);
                    resolve();
                })
                .run({ async: true });
        });
    }

    private computePercentChange(suiteName: string, suite: benchmark.Suite) {
        let npmValues = suite.filter(x => !(x.name as string).startsWith('local')).map(x => x.hz);
        let originalNumber = npmValues.reduce((sum, current) => sum + current, 0) / npmValues.length;

        let localValues = suite.filter(x => (x.name as string).startsWith('local')).map(x => x.hz);
        let newNumber = localValues.reduce((sum, current) => sum + current, 0) / localValues.length;

        let percentIncrease = (newNumber - originalNumber) / originalNumber * 100;
        //round the value to 3 decimal places
        percentIncrease = Math.round(percentIncrease * 100) / 100;
        this.percentChanges[suiteName] = percentIncrease;
    }
}
