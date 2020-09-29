import { isBrsFile } from '../../astUtils/reflection';
import { createStatementVisitor, walkStatements } from '../../astUtils/visitors';
import { BrsFile } from '../../files/BrsFile';
import { XmlFile } from '../../files/XmlFile';
import { CompilerPlugin } from '../../interfaces';
import { EmptyStatement } from '../../parser/Statement';

// entry point
const pluginInterface: CompilerPlugin = {
    name: 'removePrint',
    afterFileParse: afterFileParse
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
        const visitor = createStatementVisitor({
            PrintStatement: (statement) => new EmptyStatement()
        });
        walkStatements(fun.body, visitor);
    });
}
