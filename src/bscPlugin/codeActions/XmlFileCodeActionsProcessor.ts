import type { CodeAction, Range } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import codeActionUtil from '../../CodeActionUtil';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { BsDiagnostic } from '../../interfaces';

export class XmlFileCodeActionsProcessor {
    public constructor(
        public file: XmlFile,
        public range: Range,
        public diagnostics: BsDiagnostic[],
        public codeActions: CodeAction[]
    ) {

    }

    public process() {
        for (const diagnostic of this.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.addMissingExtends();
            }
        }
    }

    private addMissingExtends() {
        const { component } = this.file.parser.ast;
        //inject new attribute after the final attribute, or after the `<component` if there are no attributes
        const pos = (component.attributes[component.attributes.length - 1] ?? component.tag).range.end;
        this.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "Group"`,
                // diagnostics: [diagnostic],
                isPreferred: true,
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: this.file.pathAbsolute,
                    position: pos,
                    newText: ' extends="Group"'
                }]
            })
        );
        this.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "Task"`,
                // diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: this.file.pathAbsolute,
                    position: pos,
                    newText: ' extends="Task"'
                }]
            })
        );
        this.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "ContentNode"`,
                // diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: this.file.pathAbsolute,
                    position: pos,
                    newText: ' extends="ContentNode"'
                }]
            })
        );
    }
}
