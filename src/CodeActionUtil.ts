import type { Diagnostic, Position, Range, WorkspaceEdit } from 'vscode-languageserver';
import { CodeActionKind, CodeAction, TextEdit } from 'vscode-languageserver';
import type { BsDiagnostic } from './interfaces';
import util from './util';

export class CodeActionUtil {

    public createCodeAction(obj: CodeActionShorthand) {
        const edit = {
            changes: {}
        } as WorkspaceEdit;
        for (const change of obj.changes) {
            const uri = util.pathToUri(change.filePath);

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
        }
        const action = CodeAction.create(obj.title, edit, obj.kind);
        action.isPreferred = obj.isPreferred;
        action.diagnostics = this.serializableDiagnostics(obj.diagnostics);
        return action;
    }

    public serializableDiagnostics(diagnostics: BsDiagnostic[] | undefined): Diagnostic[] {
        return diagnostics?.map(({ location, severity, code, source, message, relatedInformation }) => ({
            range: location?.range,
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
    diagnostics?: BsDiagnostic[];
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
