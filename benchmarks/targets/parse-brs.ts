import type { TargetOptions } from '../target-runner';
import { createBuilder, getConfig } from '../helpers';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const builder = createBuilder(options);
    //run the first run
    await builder.run(getConfig(options));
    //collect all the brs file contents
    const files = Object.values(builder.program!.files).filter(x => ['.brs', '.bs', '.d.bs'].includes(brighterscript.util.getExtension(x.srcPath)!)).map(x => ({
        destPath: x.destPath ?? x.pkgPath,
        fileContents: (x as any).fileContents
    }));
    if (files.length === 0) {
        console.log('[parse-brs] No brs files found in program');
        return;
    }

    const setFileFuncName = builder.program!['setFile'] ? 'setFile' : 'addOrReplaceFile';

    suite.add(fullName, (deferred) => {
        const promises: unknown[] = [];
        for (const file of files) {
            promises.push(
                builder.program![setFileFuncName](file.destPath, file.fileContents)
            );
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        Promise.all(promises).then(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
