import type { BsDiagnostic } from '../../interfaces';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { ProvideSourceFixAllCodeActionsEvent } from '../../interfaces';
import { getRemoveReturnValueChange } from './codeActionHelpers';

export class FixAllCodeActionsProcessor {
    public constructor(
        public event: ProvideSourceFixAllCodeActionsEvent
    ) { }

    public process() {
        const byCode = new Map<number | string, BsDiagnostic[]>();
        for (const diagnostic of this.event.diagnostics) {
            const key = diagnostic.code;
            if (!byCode.has(key)) {
                byCode.set(key, []);
            }
            byCode.get(key).push(diagnostic);
        }

        const voidFunctionReturns = byCode.get(DiagnosticCodeMap.voidFunctionMayNotReturnValue);
        if (voidFunctionReturns) {
            this.processVoidFunctionReturnActions(voidFunctionReturns);
        }
    }

    /**
     * For every `voidFunctionMayNotReturnValue` diagnostic in this file,
     * remove the return value expression, leaving the bare `return` keyword.
     */
    private processVoidFunctionReturnActions(diagnostics: BsDiagnostic[]) {
        const changes = diagnostics.map(diagnostic => getRemoveReturnValueChange(diagnostic, this.event.file.srcPath));
        this.event.actions.push({
            title: 'Remove all void return values',
            kind: 'source.fixAll.brighterscript',
            isPreferred: true,
            changes: changes
        });
    }

}
