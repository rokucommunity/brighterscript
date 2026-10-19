import { isBrsCode } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BeforePrepareCodeEvent, Plugin } from '../../interfaces';

export default function plugin() {
    return {
        name: 'removePrint',
        //runs for all BrightScript code, wherever it lives (`.brs`/`.bs` files and `<script>` blocks in xml files)
        beforePrepareCode: (event: BeforePrepareCodeEvent) => {
            if (isBrsCode(event.code)) {
                // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
                event.code.ast.walk(createVisitor({
                    PrintStatement: (statement) => {
                        event.editor.overrideTranspileResult(statement, '');
                    }
                }), {
                    walkMode: WalkMode.visitExpressionsRecursive
                });
            }
        }
    } as Plugin;
}
