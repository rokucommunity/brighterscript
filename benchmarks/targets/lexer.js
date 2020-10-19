const fs = require('fs');
const path = require('path');

module.exports = async (suite, name, brighterscript, projectPath) => {
    const { Lexer, ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run
    await builder.run({
        rootDir: projectPath,
        createPackage: false,
        copyToStaging: false,
        //ignore all diagnostics
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });
    //collect all the brighterscript files
    const brsFiles = Object.values(builder.program.files).filter(x => x.extension === '.brs' || x.extension === '.bs');

    suite.add(name, () => {
        for (let brsFile of brsFiles) {
            Lexer.scan(brsFile.fileContents);
        }
    });
};
