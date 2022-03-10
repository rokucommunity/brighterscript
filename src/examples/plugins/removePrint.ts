import { isBrsFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BeforeFileTranspileEvent, CompilerPlugin } from '../../interfaces';

export default function plugin() {
    return {
        name: 'removePrint',
        beforeFileTranspile: (event: BeforeFileTranspileEvent) => {
            if (isBrsFile(event.file)) {
                // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
                for (const func of event.file.parser.references.functionExpressions) {
                    func.body.walk(createVisitor({
                        PrintStatement: (statement) => {
                            event.editor.overrideTranspileResult(statement, '');
                        }
                    }), {
                        walkMode: WalkMode.visitStatements
                    });
                }
            }
        }
    } as CompilerPlugin;
}
