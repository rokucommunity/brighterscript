import type { TargetOptions } from '../target-runner';
import * as fsExtra from 'fs-extra';

module.exports = (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder } = brighterscript;
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
        const builder = new ProgramBuilder();
        //register a file resolver to return the in-memory version of the file for every test
        builder.addFileResolver(fileResolver);

        builder.run({
            cwd: projectPath,
            createPackage: false,
            copyToStaging: false,
            //disable diagnostic reporting (they still get collected)
            diagnosticFilters: ['**/*'],
            logLevel: 'error',
            ...options.additionalConfig
        }).then(() => {
            if (Object.keys(builder.program.files).length === 0) {
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
