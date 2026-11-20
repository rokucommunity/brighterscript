import type { TargetOptions } from '../target-runner';
import { createBuilder, getConfig, getTranspiler } from '../helpers';

module.exports = async (options: TargetOptions) => {
    const { suite, fullName, brighterscript, suiteOptions } = options;
    const { isBrsFile, isXmlFile } = brighterscript;

    const builder = createBuilder(options);
    //run the first run outside of the test
    await builder.run(getConfig(options));
    if (Object.keys(builder.program!.files).length === 0) {
        throw new Error('No files found in program');
    }

    const transpiler = getTranspiler(builder);
    const files = Object.values(builder.program!.files).filter((x: any) => (isXmlFile(x)) && transpiler.canTranspile(x)) as any[];
    if (files.length === 0) {
        console.log('[transpile-xml] No xml files found in program');
        return;
    }

    //force transpile for every file
    for (const file of files) {
        file.needsTranspiled = true;
    }

    suite.add(fullName, (deferred) => {
        Promise.all(
            files.map(file => transpiler.transpile(file))
        ).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
