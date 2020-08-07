"use strict";
exports.__esModule = true;
var parser_1 = require("../../dist/parser");
var astUtils_1 = require("../../dist/astUtils");
// entry point
var pluginInterface = {
    name: 'removePrint',
    fileParsed: fileParsed
};
exports["default"] = pluginInterface;
function fileParsed(file) {
    // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
    file.parser.functionExpressions.forEach(function (fun) {
        var visitor = astUtils_1.createStatementEditor({
            PrintStatement: function (statement) { return new parser_1.EmptyStatement(); }
        });
        astUtils_1.editStatements(fun.body, visitor);
    });
}
