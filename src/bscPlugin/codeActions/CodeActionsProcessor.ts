import type { Diagnostic, Position } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { isBrsFile } from '../../astUtils';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { BscFile, OnGetCodeActionsEvent } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import { ParseMode } from '../../parser';
import { util } from '../../util';

export class CodeActionsProcessor {
    public constructor(
        public event: OnGetCodeActionsEvent
    ) {

    }

    public process() {
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.callToUnknownFunction) {
                this.suggestFunctionImports(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                this.suggestClassImports(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.addMissingExtends(diagnostic as any);
            }
        }

        if (isBrsFile(this.event.file)) {
            const token = this.event.file.getTokenAt(this.event.range.start);
            const previousToken = this.event.file.getPreviousToken(token);
            const lowerText = token?.text?.toLowerCase();

            //brighterscript-specific code actions
            if (this.event.file.extension === '.bs') {
                if (lowerText === 'callfunc' && previousToken.kind === TokenKind.Dot) {
                    this.suggestCallfuncOperator(token, previousToken);
                }
            }
        }
    }

    /**
     * Suggest refactoring callfunc calls to use the callfunc operator instead
     */
    private suggestCallfuncOperator(token: Token, previousToken: Token) {
        const file = this.event.file as BrsFile;
        const openParenToken = file.getNextToken(token);
        const functionNameToken = file.getNextToken(openParenToken);

        const comma = file.getNextToken(functionNameToken, TokenKind.Comma);
        let endPosition: Position;
        //consume the comma and any space up until the next token
        if (comma) {
            const tokenAfterComma = file.getNextToken(comma);
            endPosition = tokenAfterComma?.range.start ?? comma?.range.end;
        } else {
            endPosition = functionNameToken.range.end;
        }


        //if we have the necessary tokens
        if (openParenToken?.kind === TokenKind.LeftParen && functionNameToken?.kind === TokenKind.StringLiteral) {
            //replace leading and trailing quotes
            const functionName = functionNameToken.text.replace(/^"/, '').replace(/"$/, '');
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `Refactor to use callfunc operator`,
                    isPreferred: false,
                    kind: CodeActionKind.QuickFix,
                    changes: [{
                        type: 'replace',
                        filePath: this.event.file.pathAbsolute,
                        newText: `@.${functionName}(`,
                        range: util.createRangeFromPositions(previousToken.range.start, endPosition)
                    }]
                })
            );
        }
    }

    private suggestedImports = new Set<string>();

    /**
     * Generic import suggestion function. Shouldn't be called directly from the main loop, but instead called by more specific diagnostic handlers
     */
    private suggestImports(diagnostic: Diagnostic, key: string, files: BscFile[]) {
        //skip if we already have this suggestion
        if (this.suggestedImports.has(key)) {
            return;
        }

        this.suggestedImports.add(key);
        const importStatements = (this.event.file as BrsFile).parser.references.importStatements;
        //find the position of the first import statement, or the top of the file if there is none
        const insertPosition = importStatements[importStatements.length - 1]?.importToken.range?.start ?? util.createPosition(0, 0);

        //find all files that reference this function
        for (const file of files) {
            const pkgPath = util.getRokuPkgPath(file.pkgPath);
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `import "${pkgPath}"`,
                    diagnostics: [diagnostic],
                    isPreferred: false,
                    kind: CodeActionKind.QuickFix,
                    changes: [{
                        type: 'insert',
                        filePath: this.event.file.pathAbsolute,
                        position: insertPosition,
                        newText: `import "${pkgPath}"\n`
                    }]
                })
            );
        }
    }

    private suggestFunctionImports(diagnostic: DiagnosticMessageType<'callToUnknownFunction'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerFunctionName = diagnostic.data.functionName.toLowerCase();
        this.suggestImports(
            diagnostic,
            lowerFunctionName,
            this.event.file.program.findFilesForFunction(lowerFunctionName)
        );
    }

    private suggestClassImports(diagnostic: DiagnosticMessageType<'classCouldNotBeFound'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerClassName = diagnostic.data.className.toLowerCase();
        this.suggestImports(
            diagnostic,
            lowerClassName,
            this.event.file.program.findFilesForClass(lowerClassName)
        );
    }

    private addMissingExtends(diagnostic: DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>) {
        const srcPath = this.event.file.pathAbsolute;
        const { component } = (this.event.file as XmlFile).parser.ast;
        //inject new attribute after the final attribute, or after the `<component` if there are no attributes
        const pos = (component.attributes[component.attributes.length - 1] ?? component.tag).range.end;
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "Group"`,
                diagnostics: [diagnostic],
                isPreferred: true,
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: srcPath,
                    position: pos,
                    newText: ' extends="Group"'
                }]
            })
        );
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "Task"`,
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: srcPath,
                    position: pos,
                    newText: ' extends="Task"'
                }]
            })
        );
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Extend "ContentNode"`,
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'insert',
                    filePath: srcPath,
                    position: pos,
                    newText: ' extends="ContentNode"'
                }]
            })
        );
    }
}
