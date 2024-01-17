import { isBrsFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BeforePrepareFileEvent, CompilerPlugin } from '../../interfaces';

export default function plugin() {
    return {
        name: 'removePrint',
        beforePrepareFile: (event: BeforePrepareFileEvent) => {
            if (isBrsFile(event.file)) {
                // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
                for (const func of event.file.cachedLookups.functionExpressions) {
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
