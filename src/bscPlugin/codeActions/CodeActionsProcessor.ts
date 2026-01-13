import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile } from '../../files/BscFile';
import type { XmlFile } from '../../files/XmlFile';
import type { BsDiagnostic, ProvideCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import { isBrsFile, isFunctionExpression, isVariableExpression, isVoidType } from '../../astUtils/reflection';
import type { FunctionExpression } from '../../parser/Expression';
import { TokenKind } from '../../lexer/TokenKind';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';

export class CodeActionsProcessor {
    public constructor(
        public event: ProvideCodeActionsEvent
    ) {

    }

    public process() {
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.cannotFindName || diagnostic.code === DiagnosticCodeMap.cannotFindFunction) {
                this.suggestCannotFindName(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.addMissingExtends(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.voidFunctionMayNotReturnValue) {
                this.addVoidFunctionReturnActions(diagnostic);
            } else if (diagnostic.code === DiagnosticCodeMap.nonVoidFunctionMustReturnValue) {
                this.addNonVoidFunctionReturnActions(diagnostic);
            }
        }
    }

    private suggestedImports = new Set<string>();

    /**
     * Generic import suggestion function. Shouldn't be called directly from the main loop, but instead called by more specific diagnostic handlers
     */
    private suggestImports(diagnostic: BsDiagnostic, key: string, files: BscFile[]) {
        //skip if we already have this suggestion
        if (this.suggestedImports.has(key) || !isBrsFile(this.event.file)) {
            return;
        }

        this.suggestedImports.add(key);
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const importStatements = this.event.file['_cachedLookups'].importStatements;
        //find the position of the first import statement, or the top of the file if there is none
        const insertPosition = importStatements[importStatements.length - 1]?.tokens.import?.location?.range?.start ?? util.createPosition(0, 0);

        //find all files that reference this function
        for (const file of files) {
            const destPath = util.sanitizePkgPath(file.destPath);
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `import "${destPath}"`,
                    diagnostics: [diagnostic],
                    isPreferred: false,
                    kind: CodeActionKind.QuickFix,
                    changes: [{
                        type: 'insert',
                        filePath: this.event.file.srcPath,
                        position: insertPosition,
                        newText: `import "${destPath}"\n`
                    }]
                })
            );
        }
    }

    private suggestCannotFindName(diagnostic: DiagnosticMessageType<'cannotFindName'>) {
        //skip if not a BrighterScript file
        const file = this.event.program.getFile(diagnostic.location?.uri);
        if (!file || (file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerName = (diagnostic.data.fullName ?? diagnostic.data.name).toLowerCase();

        this.suggestImports(
            diagnostic,
            lowerName,
            [
                ...this.event.program.findFilesForFunction(lowerName),
                ...this.event.program.findFilesForClass(lowerName),
                ...this.event.program.findFilesForNamespace(lowerName),
                ...this.event.program.findFilesForEnum(lowerName)
            ]
        );
    }

    private addMissingExtends(diagnostic: DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>) {
        const srcPath = this.event.file.srcPath;
        const { componentElement } = (this.event.file as XmlFile).parser.ast;
        //inject new attribute after the final attribute, or after the `<component` if there are no attributes
        const pos = (componentElement.attributes[componentElement.attributes.length - 1] ?? componentElement.tokens.startTagName)?.location?.range.end;
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

    private addVoidFunctionReturnActions(diagnostic: BsDiagnostic) {
        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: `Remove return value`,
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'delete',
                    filePath: this.event.file.srcPath,
                    range: util.createRange(
                        diagnostic.location.range.start.line,
                        diagnostic.location.range.start.character + 'return'.length,
                        diagnostic.location.range.end.line,
                        diagnostic.location.range.end.character
                    )
                }]
            })
        );
        if (isBrsFile(this.event.file)) {
            const expression = this.event.file.getClosestExpression(diagnostic.location.range.start);
            const func = expression.findAncestor<FunctionExpression>(isFunctionExpression);

            //if we're in a sub and we do not have a return type, suggest converting to a function
            if (func.tokens.functionType.kind === TokenKind.Sub && !func.returnTypeExpression) {
                //find the first function in a file that uses the `function` keyword
                const referenceFunction = this.event.file.parser.ast.findChild<FunctionExpression>((node) => {
                    return isFunctionExpression(node) && node.tokens.functionType.kind === TokenKind.Function;
                });
                const functionTypeText = referenceFunction?.tokens.functionType.text ?? 'function';
                const endFunctionTypeText = referenceFunction?.tokens.endFunctionType?.text ?? 'end function';
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Convert ${func.tokens.functionType.text} to ${functionTypeText}`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [
                            //function
                            {
                                type: 'replace',
                                filePath: this.event.file.srcPath,
                                range: func.tokens.functionType.location.range,
                                newText: functionTypeText
                            },
                            //end function
                            {
                                type: 'replace',
                                filePath: this.event.file.srcPath,
                                range: func.tokens.endFunctionType.location.range,
                                newText: endFunctionTypeText
                            }
                        ]
                    })
                );
            }

            //function `as void` return type. Suggest removing the return type
            if (func.tokens.functionType.kind === TokenKind.Function && isVoidType(func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime }))) {
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Remove return type from function declaration`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [{
                            type: 'delete',
                            filePath: this.event.file.srcPath,
                            // )| as void|
                            range: util.createRange(
                                func.tokens.rightParen.location.range.start.line,
                                func.tokens.rightParen.location.range.start.character + 1,
                                func.returnTypeExpression.location.range.end.line,
                                func.returnTypeExpression.location.range.end.character
                            )
                        }]
                    })
                );
            }
        }
    }

    private addNonVoidFunctionReturnActions(diagnostic: BsDiagnostic) {
        if (isBrsFile(this.event.file)) {
            const expression = this.event.file.getClosestExpression(diagnostic.location.range.start);
            const func = expression.findAncestor<FunctionExpression>(isFunctionExpression);

            //`sub as <non-void type>`, suggest removing the return type
            if (
                func.tokens.functionType.kind === TokenKind.Sub &&
                //has a return type
                func.returnTypeExpression &&
                //is not `as void`
                !(isVariableExpression(func.returnTypeExpression.expression) && func.returnTypeExpression.expression.tokens.name.text?.toLowerCase() === 'void')
            ) {
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Remove return type from sub declaration`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [{
                            type: 'delete',
                            filePath: this.event.file.srcPath,
                            // )| as void|
                            range: util.createRange(
                                func.tokens.rightParen.location.range.start.line,
                                func.tokens.rightParen.location.range.start.character + 1,
                                func.returnTypeExpression.location.range.end.line,
                                func.returnTypeExpression.location.range.end.character
                            )
                        }]
                    })
                );
            }

            //function with no return type.
            if (func.tokens.functionType.kind === TokenKind.Function && !func.returnTypeExpression) {
                //find tokens for `as` and `void` in the file if possible
                let asText: string;
                let voidText: string;
                let subText: string;
                let endSubText: string;
                for (const token of this.event.file.parser.tokens) {
                    if (asText && voidText && subText && endSubText) {
                        break;
                    }
                    if (token?.kind === TokenKind.As) {
                        asText = token?.text;
                    } else if (token?.kind === TokenKind.Void) {
                        voidText = token?.text;
                    } else if (token?.kind === TokenKind.Sub) {
                        subText = token?.text;
                    } else if (token?.kind === TokenKind.EndSub) {
                        endSubText = token?.text;
                    }
                }

                //suggest converting to `as void`
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Add void return type to function declaration`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [{
                            type: 'insert',
                            filePath: this.event.file.srcPath,
                            position: func.tokens.rightParen.location.range.end,
                            newText: ` ${asText ?? 'as'} ${voidText ?? 'void'}`
                        }]
                    })
                );
                //suggest converting to sub
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Convert function to sub`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [{
                            type: 'replace',
                            filePath: this.event.file.srcPath,
                            range: func.tokens.functionType.location.range,
                            newText: subText ?? 'sub'
                        }, {
                            type: 'replace',
                            filePath: this.event.file.srcPath,
                            range: func.tokens.endFunctionType.location.range,
                            newText: endSubText ?? 'end sub'
                        }]
                    })
                );
            }
        }
    }
}
