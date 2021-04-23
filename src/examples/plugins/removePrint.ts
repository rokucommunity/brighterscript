import { isBrsFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { CompilerPlugin } from '../../interfaces';
import { EmptyStatement } from '../../parser/Statement';

export default function plugin() {
    return {
        name: 'removePrint',
        // note: it is normally not recommended to modify the AST too much at this stage,
        // because if the plugin runs in a language-server context it could break intellisense
        afterFileParse: ({ file }) => {
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
    } as CompilerPlugin;
}
