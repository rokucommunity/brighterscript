const fs = require('fs');
const path = require('path');

module.exports = (suite, name, brighterscript) => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'Requests.brs')).toString();
    const Lexer = brighterscript.Lexer;

    suite.add(name, function () {
        Lexer.scan(text);
    });
}