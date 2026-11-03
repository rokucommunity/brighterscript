import type { TargetOptions } from '../target-runner';
import { createBuilder, getConfig } from '../helpers';
import * as fsExtra from 'fs-extra';

module.exports = (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
        const cache = new Map();
    const fileResolver = (filePath) => {
        if (!cache.has(filePath)) {
            let result = fsExtra.readFile(filePath).then((value) => {
                return value.toString();
            });
            cache.set(filePath, result);
            return result;
        } else {
            return cache.get(filePath);
        }
    };

    suite.add(fullName, (deferred) => {
        const builder = createBuilder(options);
        //register a file resolver to return the in-memory version of the file for every test
        builder.addFileResolver(fileResolver);

        builder.run(getConfig(options)).then(() => {
            if (Object.keys(builder.program!.files).length === 0) {
                throw new Error('No files found in program');
            } else {
                deferred.resolve();
            }
        }).catch((error) => {
            deferred.reject(error);
            console.error(error);
        });
    }, {
        ...suiteOptions,
        'defer': true
    });
};
