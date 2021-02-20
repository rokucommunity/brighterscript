module.exports = async (suite, name, brighterscript, projectPath, options) => {
    const { ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });
    //collect all the XML files
    const files = Object.values(builder.program.files).filter(x => x.extension === '.xml');
    //flag every file for transpilation
    for (const file of files) {
        file.needsTranspiled = true;
    }
    if (files.length === 0) {
        console.log('[xml-transpile] No XML files found in program');
        return;
    }
    suite.add(name, () => {
        for (const x of files) {
            x.transpile();
        }
    }, options);
};
