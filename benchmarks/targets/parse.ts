import type { BrsFile } from '../../src';
import type { TargetOptions } from '../target-runner';
import { createBuilder, getConfig } from '../helpers';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { Parser } = brighterscript;

    const builder = createBuilder(options);
    //run the first run
    await builder.run(getConfig(options));
    //collect all the brighterscript files
    const brsFiles = Object.values(builder.program!.files as Record<string, BrsFile>).filter(x => x.extension === '.brs' || x.extension === '.bs') as Array<BrsFile>;
    if (brsFiles.length === 0) {
        throw new Error('No files found in program');
    }

    suite.add(fullName, () => {
        for (let brsFile of brsFiles) {
            Parser.parse(brsFile.parser.tokens);
        }
    }, suiteOptions);
};
