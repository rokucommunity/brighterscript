import type { TargetOptions } from '../target-runner';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run outside of the test
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });
    if (Object.keys(builder.program.files).length === 0) {
        throw new Error('No files found in program');
    }

    const files = Object.values(builder.program.files);

    //force transpile for every file
    for (const file of files) {
        file.needsTranspiled = true;
    }

    suite.add(fullName, () => {
        for (const file of files) {
            file.transpile();
        }
    }, suiteOptions);
};
