import type { CodeAction, Range } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { XmlFile } from '../../files/XmlFile';
import type { BsDiagnostic } from '../../interfaces';
import util from '../../util';

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
        //add the attribute at the end of the first attribute, or after the `<component` if no attributes
        const pos = (this.file.parser.ast.component.attributes[0] ?? this.file.parser.ast.component.tag).range.end;
        this.codeActions.push(
            util.createCodeAction({
                title: `Add default extends attribute`,
                // diagnostics: [diagnostic],
                isPreferred: true,
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: this.file.pathAbsolute,
                    position: util.createPosition(pos.line, pos.character),
                    newText: ' extends="Group"'
                }]
            })
        );
    }
}
