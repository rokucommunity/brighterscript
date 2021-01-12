import { isBrsFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BscFile, CompilerPlugin } from '../../interfaces';
import { EmptyStatement } from '../../parser/Statement';

// entry point
const pluginInterface: CompilerPlugin = {
    name: 'removePrint',
    afterFileParse: afterFileParse
};
export default pluginInterface;

// note: it is normally not recommended to modify the AST too much at this stage,
// because if the plugin runs in a language-server context it could break intellisense
function afterFileParse(file: BscFile) {
    if (!isBrsFile(file)) {
        return;
    }
    // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
    for (const func of file.parser.references.functionExpressions) {
        func.body.walk(createVisitor({
            PrintStatement: (statement) => new EmptyStatement()
        }), {
            walkMode: WalkMode.visitStatements
        });
    }
}
