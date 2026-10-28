import { isBrsCodeSegment } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BeforePrepareBrsCodeSegmentEvent, Plugin } from '../../interfaces';

export default function plugin() {
    return {
        name: 'removePrint',
        //runs for all BrightScript code, wherever it lives (`.brs`/`.bs` files and `<script>` blocks in xml files)
        beforePrepareBrsCodeSegment: (event: BeforePrepareBrsCodeSegmentEvent) => {
            if (isBrsCodeSegment(event.codeSegment)) {
                // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
                event.codeSegment.ast.walk(createVisitor({
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
