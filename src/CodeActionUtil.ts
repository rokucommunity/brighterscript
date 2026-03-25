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
            } else if (change.type === 'delete') {
                edit.changes![uri].push(
                    TextEdit.del(change.range)
                );
            }
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
    changes: Array<InsertChange | ReplaceChange | DeleteChange>;
}

/**
 * Represents a single named "source fix all" action that a plugin contributes.
 * Each action becomes a separate entry in VS Code's Source Actions menu.
 * Plugins are responsible for merging all their changes into the `changes` array.
 */
export interface SourceFixAllCodeAction {
    title: string;
    /**
     * The LSP code action kind. Should start with `source.fixAll`.
     * Use a sub-kind like `source.fixAll.brighterscript.imports` to create
     * a distinct named entry in the Source Actions menu.
     * Defaults to `source.fixAll.brighterscript`.
     */
    kind?: string;
    isPreferred?: boolean;
    changes: Array<InsertChange | ReplaceChange | DeleteChange>;
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

export interface DeleteChange {
    filePath: string;
    type: 'delete';
    range: Range;
}


export const codeActionUtil = new CodeActionUtil();
