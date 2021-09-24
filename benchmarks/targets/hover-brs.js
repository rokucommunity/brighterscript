module.exports = async (suite, name, brighterscript, projectPath, options) => {
    const { ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run so we we can focus the test on validate
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });
    const files = Object.values(builder.program.files).filter(x => ['.brs', '.bs'].includes(x.extension));
    if (files.length === 0) {
        console.log('[hover-brs] No brs|bs files found in program');
        return;
    }

    suite.add(name, () => {
        for (const file of files) {
            // Hover every 20th token
            for (let i = 0; i < file.parser.tokens.length; i += 20) {
                const token = file.parser.tokens[i];
                file.getHover(token.range.end);
            }
        }
    }, options);
};
