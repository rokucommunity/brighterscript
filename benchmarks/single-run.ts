import { Benchmarker } from './Benchmarker';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

const argv = require('yargs')
    .argv;

(async () => {
    var benchmarker = new Benchmarker();
    await benchmarker.run(argv.testName, argv.brightscriptVersion, argv.iterationCount);
    let averages = JSON.parse(
        fsExtra.readFileSync('results.json').toString()
    );
    for (let key in benchmarker.averages) {
        if (!averages[key]) {
            averages[key] = {};
        }
        averages[key][argv.brightscriptVersion] = benchmarker.averages[key];
    }
    fsExtra.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(averages));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});