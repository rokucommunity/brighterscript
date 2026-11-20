import type { BrsFile } from '../../src/files/BrsFile';
import type { TargetOptions } from '../target-runner';
import { createBuilder, getConfig } from '../helpers';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { Lexer } = brighterscript;

    const builder = createBuilder(options);
    //run the first run
    await builder.run(getConfig(options));
    //collect all the brighterscript files
    const brsFiles = Object.values(builder.program!.files as Record<string, BrsFile>).filter(x => x.extension === '.brs' || x.extension === '.bs');
    if (brsFiles.length === 0) {
        throw new Error('No files found in program');
    }
    suite.add(fullName, () => {
        for (let brsFile of brsFiles) {
            Lexer.scan(brsFile.fileContents);
        }
    }, suiteOptions);
};
