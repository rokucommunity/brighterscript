const fs = require('fs');
const path = require('path');

module.exports = (suite, name, brighterscript, projectPath) => {
    const ProgramBuilder = brighterscript.ProgramBuilder;

    suite.add(name, (deferred) => {
        const builder = new ProgramBuilder();
        builder.run({
            cwd: projectPath,
            rootDir: projectPath,
            createPackage: false,
            copyToStaging: false,
            //ignore all diagnostics
            diagnosticFilters: ['**/*'],
            logLevel: 'error'
        }).then(() => {
            deferred.resolve();
        });
    }, {
        'defer': true
    });
};
