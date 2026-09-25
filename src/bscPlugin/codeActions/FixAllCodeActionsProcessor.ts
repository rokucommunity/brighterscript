import type { BsDiagnostic } from '../../interfaces';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { OnGetSourceFixAllCodeActionsEvent } from '../../interfaces';
import { isXmlFile } from '../../astUtils/reflection';
import { getMissingExtendsInsertPosition, getRemoveReturnValueChange } from './codeActionHelpers';

export class FixAllCodeActionsProcessor {
    public constructor(
        public event: OnGetSourceFixAllCodeActionsEvent
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

        const missingExtends = byCode.get(DiagnosticCodeMap.xmlComponentMissingExtendsAttribute);
        if (missingExtends) {
            this.processMissingExtends(missingExtends as DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>[]);
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

    /**
     * For every `xmlComponentMissingExtendsAttribute` diagnostic in this file,
     * insert `extends="Group"` — the same choice marked `isPreferred` in the
     * per-diagnostic quick-fix.
     */
    private processMissingExtends(diagnostics: DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>[]) {
        if (!isXmlFile(this.event.file)) {
            return;
        }

        const changes = diagnostics.map(() => ({
            type: 'insert' as const,
            filePath: this.event.file.srcPath,
            position: getMissingExtendsInsertPosition(this.event.file as XmlFile),
            newText: ' extends="Group"'
        }));

        this.event.actions.push({
            title: 'Add missing extends attributes',
            kind: 'source.fixAll.brighterscript',
            isPreferred: true,
            changes: changes
        });
    }
}
