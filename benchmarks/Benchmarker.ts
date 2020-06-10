import * as benchmark from 'benchmark';
benchmark.support.decompilation = false;
import { execSync } from 'child_process';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

/**
 * Assumes that the brighterscript project has already been built. 
 */
export class Benchmarker {

    public async run(testName: 'lexer' | 'parser', version: string, iterationCount = 3) {
        iterationCount = iterationCount < 3 ? 3 : iterationCount;
        this.addIterations(testName, version, iterationCount);
        this.version = version;
        await this[testName]();
    }

    private version: string;

    private addIterations(testName: string, version: string, iterationCount: number) {
        let brighterscript: any;
        if (version === 'local') {
            brighterscript = require(`${__dirname}/../dist`);
        } else {
            brighterscript = require('brighterscript');
        }

        for (var i = 0; i < iterationCount; i++) {
            this.iterations.push({
                brighterscript: brighterscript,
                name: `run ${i + 1}:`
            });
        }
    }

    /**
     * An array of brighterscript lib and name. Used to run the tests multiple times to get a better average result
     */
    private iterations = [] as { brighterscript: any, name: string }[];

    public averages = {} as { [testName: string]: number };

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
        console.log(`\n--------lexer (${this.version})--------`);

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
        console.log(`\n--------parser ${this.version}--------`);

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
            let computeAverageOpsPerSec = this.computeAverageOpsPerSec.bind(this);
            suite
                .on('cycle', function (event) {
                    console.log(event.target.toString());
                })
                .on('complete', function () {
                    computeAverageOpsPerSec(suiteName, this);
                    resolve();
                })
                .run({ async: true });
        });
    }

    private computeAverageOpsPerSec(suiteName: string, suite: benchmark.Suite) {
        let values = suite
            //filter out the warmup run
            .filter(x => !(x.name as string).startsWith('warmup'))
            //only keep the ops/sec
            .map(x => x.hz)
            //sort the values
            .sort();
        //throw out the lowest value
        values.splice(0, 1);
        //throw out the highest value
        values.splice(values.length - 1, 1);

        //we should now have the most stable of the run times

        let average = values.reduce((sum, current) => sum + current, 0) / values.length;
        this.averages[suiteName] = average;
    }
}
