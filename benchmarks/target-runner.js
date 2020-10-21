const path = require('path');
const fsExtra = require('fs-extra');
const { Suite } = require('benchmark');

const version = process.argv[2];
const target = process.argv[3];
const bscAlias = process.argv[4];
const projectPath = process.argv[5];

const brighterscript = require(path.join(__dirname, 'node_modules', bscAlias));

const addTargetTestFunction = require(path.join(__dirname, 'targets', target));
(async () => {
    const suite = new Suite('parser suite')
        // add listeners
        // .on('cycle', function (event) {
        //     console.log(String(event.target));
        // })
        .on('error', (error) => {
            console.error(error.currentTarget[0].error || error);
        })
        .on('complete', function complete() {
            const resultsPath = path.join(__dirname, 'results.json');
            //write to results.json
            const results = fsExtra.readJsonSync(resultsPath);
            if (!results[target]) {
                results[target] = {};
            }
            if (!results[target][version]) {
                results[target][version] = [];
            }
            results[target][version].push(
                //the ops/sec for the test run
                this[0].hz
            );
            fsExtra.outputFileSync(resultsPath, JSON.stringify(results, null, 4));
        });

    //add the test method. This could be async.
    await Promise.resolve(
        addTargetTestFunction(suite, `${target}@${version}`, brighterscript, projectPath)
    );

    suite.run({ 'async': true });
})().catch(console.error.bind(console));
