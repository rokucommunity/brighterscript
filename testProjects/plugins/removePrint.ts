import { CompilerPlugin, BrsFile, XmlFile } from '../../dist';
import { EmptyStatement } from '../../dist/parser';
import { createStatementEditor, editStatements, isBrsFile } from '../../dist/astUtils';

// entry point
const pluginInterface: CompilerPlugin = {
    name: 'removePrint',
    afterFileParse
};
export default pluginInterface;

// note: it is normally not recommended to modify the AST too much at this stage,
// because if the plugin runs in a language-server context it could break intellisense
function afterFileParse(file: (BrsFile | XmlFile)) {
    if (!isBrsFile(file)) {
        return;
    }
    // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
    file.parser.functionExpressions.forEach((fun) => {
        const visitor = createStatementEditor({
            PrintStatement: (statement) => new EmptyStatement()
        });
        editStatements(fun.body, visitor);
    });
}
