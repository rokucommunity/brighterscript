const fs = require('fs');
const path = require('path');

module.exports = (suite, name, brighterscript) => {
    const filePath = path.join(__dirname, '..', 'Requests.brs');
    const ProgramBuilder = brighterscript.ProgramBuilder;

    suite.add(name, function (deferred) {
        var builder = new ProgramBuilder();
        builder.run({
            files: [{
                src: filePath,
                dest: 'source/main.brs'
            }],
            createPackage: false,
            copyToStaging: false,
            logLevel: 'error'
        }).then(() => {
            deferred.resolve();
        });
    }, {
        'defer': true
    });
}