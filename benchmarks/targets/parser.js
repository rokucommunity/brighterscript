const fs = require('fs');
const path = require('path');

module.exports = (suite, name, brighterscript) => {
    const { Lexer, Parser } = brighterscript;

    const text = fs.readFileSync(path.join(__dirname, '..', 'Requests.brs')).toString();
    const tokens = Lexer.scan(text).tokens;

    suite.add(name, function () {
        Parser.parse(tokens);
    });
}