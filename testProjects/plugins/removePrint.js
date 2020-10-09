"use strict";
exports.__esModule = true;
var parser_1 = require("../../dist/parser");
var astUtils_1 = require("../../dist/astUtils");
// entry point
var pluginInterface = {
    name: 'removePrint',
    afterFileParse: afterFileParse
};
exports["default"] = pluginInterface;
// note: it is normally not recommended to modify the AST too much at this stage,
// because if the plugin runs in a language-server context it could break intellisense
function afterFileParse(file) {
    if (!astUtils_1.isBrsFile(file)) {
        return;
    }
    // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
    file.parser.functionExpressions.forEach(function (fun) {
        var visitor = astUtils_1.createStatementVisitor({
            PrintStatement: function (statement) { return new parser_1.EmptyStatement(); }
        });
        astUtils_1.walkStatements(fun.body, visitor);
    });
}
