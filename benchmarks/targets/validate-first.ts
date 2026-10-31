import type { TargetOptions } from '../target-runner';
import { createBuilder, getConfig } from '../helpers';
import * as fsExtra from 'fs-extra';

/**
 * Benchmarks the cost of the very first `validate()` call on a freshly-loaded program
 * (i.e. `Program.isFirstValidation === true`), as opposed to the `validate` target, which
 * benchmarks re-validating an already-warmed-up program. A lot of validate-time work (building
 * initial scope symbol tables, cross-scope resolution caches, etc.) only happens once per
 * program, so this models the "cold start" cost of an editor/CLI opening a project for the
 * first time - which can be significantly more expensive than any subsequent re-validate.
 *
 * Each benchmark sample needs its own never-before-validated `Program`, so a small queue of
 * freshly-loaded (parsed, but not yet validated) builders is kept pre-built and replenished in
 * the background; the timed portion of each sample is just the `validate()` call itself.
 */
module.exports = async (options: TargetOptions) => {
    const { suite, fullName, brighterscript, projectPath, suiteOptions } = options;
    //cache file contents in memory so repeatedly loading/parsing fresh programs isn't dominated by disk I/O
    const fileContentsCache = new Map();
    const fileResolver = (filePath) => {
        if (!fileContentsCache.has(filePath)) {
            let result = fsExtra.readFile(filePath).then((value) => {
                return value.toString();
            });
            fileContentsCache.set(filePath, result);
            return result;
        } else {
            return fileContentsCache.get(filePath);
        }
    };

    async function createUnvalidatedBuilder() {
        const builder = createBuilder(options);
        builder.addFileResolver(fileResolver);
        await builder.load(getConfig(options));
        if (Object.keys(builder.program!.files).length === 0) {
            throw new Error('No files found in program');
        }
        return builder;
    }

    const QUEUE_SIZE = 15;
    const queue: Array<ReturnType<typeof createUnvalidatedBuilder>> = [];

    //keep the queue topped up in the background so a sample is rarely (ideally never) stuck
    //waiting on a full load+parse cycle inside the timed portion of the benchmark
    function replenishQueue() {
        while (queue.length < QUEUE_SIZE) {
            queue.push(createUnvalidatedBuilder());
        }
    }
    replenishQueue();
    //wait for the initial queue to be fully loaded before starting the benchmark
    await Promise.all(queue);

    suite.add(fullName, (deferred) => {
        const builderPromise = queue.shift() ?? createUnvalidatedBuilder();
        replenishQueue();

        builderPromise.then((builder) => {
            return Promise.resolve(builder.program!.validate());
        }).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
