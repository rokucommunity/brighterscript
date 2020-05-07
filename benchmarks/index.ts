import { Benchmarker } from './Benchmarker';

(async () => {
    const argv = require('yargs')
        .boolean('nosetup')
        .argv;

    var nosetup = argv.nosetup;
    var benchmarkNames = argv._;
    var iterationCount = argv.iterationCount;
    var maxPercentChange = argv.maxPercentChange;

    var benchmarker = new Benchmarker();
    if (nosetup) {
        console.log('Skipping initial setup');
    } else {
        //install npm modules, stuff like that
        benchmarker.prepare();
    }

    //now run all of the benchmarks
    await benchmarker.runAll(benchmarkNames, iterationCount);

    //write a blank line to separate the final results
    console.log('\nFinal Results:');
    let isFailure = false;
    for (let benchmarkName in benchmarker.percentChanges) {
        let percentChange = benchmarker.percentChanges[benchmarkName];
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