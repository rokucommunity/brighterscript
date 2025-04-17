import type { Diagnostic } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { BscFile, OnGetCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import { isBrsFile, isFunctionExpression } from '../../astUtils/reflection';
import type { FunctionExpression } from '../../parser/Expression';
import { TokenKind } from '../../lexer/TokenKind';

export class CodeActionsProcessor {
    public constructor(
        public event: OnGetCodeActionsEvent
    ) {

    }

    public process() {
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.cannotFindName || diagnostic.code === DiagnosticCodeMap.cannotFindFunction) {
                this.suggestCannotFindName(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                this.suggestClassImports(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.addMissingExtends(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.voidFunctionMayNotReturnValue) {
                this.addVoidFunctionReturnSuggestions(diagnostic);
            }
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
                        filePath: this.event.file.srcPath,
                        position: insertPosition,
                        newText: `import "${pkgPath}"\n`
                    }]
                })
            );
        }
    }

    private suggestCannotFindName(diagnostic: DiagnosticMessageType<'cannotFindName'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerName = (diagnostic.data.fullName ?? diagnostic.data.name).toLowerCase();

        this.suggestImports(
            diagnostic,
            lowerName,
            [
                ...this.event.file.program.findFilesForFunction(lowerName),
                ...this.event.file.program.findFilesForClass(lowerName),
                ...this.event.file.program.findFilesForNamespace(lowerName),
                ...this.event.file.program.findFilesForEnum(lowerName)
            ]
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
        const srcPath = this.event.file.srcPath;
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

    private addVoidFunctionReturnSuggestions(diagnostic: Diagnostic) {
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Remove return value`,
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'delete',
                    filePath: this.event.file.srcPath,
                    range: util.createRange(
                        diagnostic.range.start.line,
                        diagnostic.range.start.character + 'return'.length,
                        diagnostic.range.end.line,
                        diagnostic.range.end.character
                    )
                }]
            })
        );
        if (isBrsFile(this.event.file)) {
            const expression = this.event.file.getClosestExpression(diagnostic.range.start);
            const func = expression.findAncestor<FunctionExpression>(isFunctionExpression);

            //if we're in a sub and we do not have a return type, suggest converting to a function
            if (func.functionType.kind === TokenKind.Sub && !func.returnTypeToken) {
                //find the first function in a file that uses the `function` keyword
                const referenceFunction = this.event.file.parser.ast.findChild<FunctionExpression>((node) => {
                    return isFunctionExpression(node) && node.functionType.kind === TokenKind.Function;
                });
                const functionTypeText = referenceFunction?.functionType.text ?? 'function';
                const endFunctionTypeText = referenceFunction?.end?.text ?? 'end function';
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Convert ${func.functionType.text} to ${functionTypeText}`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [
                            //function
                            {
                                type: 'replace',
                                filePath: this.event.file.srcPath,
                                range: func.functionType.range,
                                newText: functionTypeText
                            },
                            //end function
                            {
                                type: 'replace',
                                filePath: this.event.file.srcPath,
                                range: func.end.range,
                                newText: endFunctionTypeText
                            }
                        ]
                    })
                );
            }
        }
    }

}
