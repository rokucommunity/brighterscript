import type { CodeActionKind, Diagnostic, Position, Range, WorkspaceEdit } from 'vscode-languageserver';
import { CodeAction, TextEdit, CreateFile, DeleteFile, RenameFile, TextDocumentEdit } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

export class CodeActionUtil {

    public createCodeAction(obj: CodeActionShorthand) {
        const edit = {
            changes: {}
        } as WorkspaceEdit;
        for (const change of obj.changes) {
            const uri = URI.file(change.filePath).toString();

            //create the edit changes array for this uri
            if (!edit.changes[uri]) {
                edit.changes[uri] = [];
            }
            if (change.type === 'insert') {
                edit.changes[uri].push(
                    TextEdit.insert(change.position, change.newText)
                );
            } else if (change.type === 'replace') {
                TextEdit.replace(change.range, change.newText);
            }
        }
        return CodeAction.create(obj.title, edit);
    }

    private rangeToKey(range: Range) {
        return `${range?.start?.line}:${range?.start?.character},${range?.end?.line}:${range?.end?.character}`;
    }

    /**
     * Generate a unique key for each code action, and only keep one of each action
     */
    public dedupe(codeActions: CodeAction[]) {
        const resultMap = {} as Record<string, CodeAction>;

        for (const codeAction of codeActions) {
            const keyParts = [
                `${codeAction.command}-${codeAction.isPreferred}-${codeAction.kind}-${codeAction.title}`
            ];
            for (let diagnostic of codeAction.diagnostics ?? []) {
                keyParts.push(
                    `${diagnostic.code}-${diagnostic.message}-${diagnostic.severity}-${diagnostic.source}-${diagnostic.tags?.join('-')}-${this.rangeToKey(diagnostic.range)}`
                );
            }
            const edits = [] as TextEdit[];
            for (let changeKey of Object.keys(codeAction.edit?.changes ?? {}).sort()) {
                edits.push(
                    ...codeAction.edit.changes[changeKey]
                );
            }
            for (let change of codeAction?.edit.documentChanges ?? []) {
                if (TextDocumentEdit.is(change)) {
                    keyParts.push(change.textDocument.uri);
                    edits.push(
                        ...change.edits
                    );
                } else if (CreateFile.is(change)) {
                    keyParts.push(
                        `${change.kind}-${change.uri}-${change.options.ignoreIfExists}-${change.options.overwrite}`
                    );
                } else if (RenameFile.is(change)) {
                    keyParts.push(
                        `${change.kind}-${change.oldUri}-${change.newUri}-${change.options.ignoreIfExists}-${change.options.overwrite}`
                    );
                } else if (DeleteFile.is(change)) {
                    keyParts.push(
                        `${change.kind}-${change.uri}-${change.options.ignoreIfNotExists}-${change.options.recursive}`
                    );
                }

            }
            for (let edit of edits) {
                keyParts.push(
                    `${edit.newText}-${this.rangeToKey(edit.range)}`
                );
            }

            const key = keyParts.sort().join('|');
            resultMap[key] = codeAction;
        }
        return Object.values(resultMap);
    }
}

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
