import type { TargetOptions } from '../target-runner';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder, Lexer } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error',
        ...options.additionalConfig
    });
    //collect all the brighterscript files
    const brsFiles = Object.values(builder.program.files).filter(x => x.extension === '.brs' || x.extension === '.bs');
    if (brsFiles.length === 0) {
        throw new Error('No files found in program');
    }
    suite.add(fullName, () => {
        for (let brsFile of brsFiles) {
            Lexer.scan(brsFile.fileContents);
        }
    }, suiteOptions);
};
