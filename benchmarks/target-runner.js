const path = require('path');
const fsExtra = require('fs-extra');
const { Suite } = require('benchmark');
const version = process.argv[2];
const target = process.argv[3];
const bscAlias = process.argv[4];
const brighterscript = require(path.join(__dirname, 'node_modules', bscAlias));

const addTargetTestFunction = require(path.join(__dirname, 'targets', target));

const suite = new Suite('parser suite')
    // add listeners
    .on('cycle', function (event) {
        // console.log(String(event.target));
    })
    .on('error', (error) => {
        console.error(error.currentTarget[0].error || error);
    })
    .on('complete', function () {
        const resultsPath = path.join(__dirname, 'results.json')
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

addTargetTestFunction(suite, `${target}@${version}`, brighterscript);

suite.run({ 'async': true });