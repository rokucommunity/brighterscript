import type { BrsFile, BsConfig } from '../../src';
import type { TargetOptions } from '../target-runner';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder, Parser } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        noEmit: true,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error',
        ...options.additionalConfig
    } as BsConfig & Record<string, any>);
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
