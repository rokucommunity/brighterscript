import type { Diagnostic, Position, Range, WorkspaceEdit } from 'vscode-languageserver';
import { CodeActionKind, CodeAction, TextEdit } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

export class CodeActionUtil {

    public createCodeAction(obj: CodeActionShorthand) {
        const edit = {
            changes: {}
        } as WorkspaceEdit;
        for (const change of obj.changes) {
            const uri = URI.file(change.filePath).toString();

            //justification: `edit` is defined above so we know that `edit.changes` is defined.
            /* eslint-disable @typescript-eslint/no-non-null-assertion,  @typescript-eslint/no-unnecessary-type-assertion */

            //create the edit changes array for this uri
            if (!edit.changes![uri]) {
                edit.changes![uri] = [];
            }
            if (change.type === 'insert') {
                edit.changes![uri].push(
                    TextEdit.insert(change.position, change.newText)
                );
            } else if (change.type === 'replace') {
                edit.changes![uri].push(
                    TextEdit.replace(change.range, change.newText)
                );
            }

            /* eslint-enable @typescript-eslint/no-non-null-assertion,  @typescript-eslint/no-unnecessary-type-assertion */
        }
        const action = CodeAction.create(obj.title, edit, obj.kind);
        action.isPreferred = obj.isPreferred;
        action.diagnostics = this.serializableDiagnostics(obj.diagnostics);
        return action;
    }

    public serializableDiagnostics(diagnostics: Diagnostic[] | undefined) {
        return diagnostics?.map(({ range, severity, code, source, message, relatedInformation }) => ({
            range: range,
            severity: severity,
            source: source,
            code: code,
            message: message,
            relatedInformation: relatedInformation
        }));
    }
}

export { CodeActionKind };

export interface CodeActionShorthand {
    title: string;
    diagnostics?: Diagnostic[];
    kind?: CodeActionKind;
    isPreferred?: boolean;
    changes: Array<InsertChange | ReplaceChange>;
}

export interface InsertChange {
    filePath: string;
    newText: string;
    type: 'insert';
    position: Position;
}

export interface ReplaceChange {
    filePath: string;
    newText: string;
    type: 'replace';
    range: Range;
}

export const codeActionUtil = new CodeActionUtil();
