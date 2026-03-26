import type { Diagnostic } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DeleteChange, InsertChange, ReplaceChange } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { BscFile, BsDiagnostic, OnGetCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import { isBrsFile, isFunctionExpression, isMethodStatement } from '../../astUtils/reflection';
import type { FunctionExpression } from '../../parser/Expression';
import type { MethodStatement } from '../../parser/Statement';
import { WalkMode } from '../../astUtils/visitors';
import { TokenKind } from '../../lexer/TokenKind';

export class CodeActionsProcessor {
    public constructor(
        public event: OnGetCodeActionsEvent
    ) {

    }

    public process() {
        // First pass: individual fixes for each diagnostic at the cursor position
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.cannotFindName || diagnostic.code === DiagnosticCodeMap.cannotFindFunction) {
                this.suggestCannotFindName(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                this.suggestClassImports(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.addMissingExtends(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.voidFunctionMayNotReturnValue) {
                this.addVoidFunctionReturnActions([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.nonVoidFunctionMustReturnValue) {
                this.addNonVoidFunctionReturnActions([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.referencedFileDoesNotExist) {
                this.addRemoveScriptImportActions([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent) {
                this.addRemoveScriptImportActions([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.unnecessaryCodebehindScriptImport) {
                this.addRemoveScriptImportActions([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.scriptImportCaseMismatch) {
                this.addScriptImportCasingFix([diagnostic as DiagnosticMessageType<'scriptImportCaseMismatch'>]);
            } else if (diagnostic.code === DiagnosticCodeMap.missingOverrideKeyword) {
                this.addMissingOverrideActions([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.cannotUseOverrideKeywordOnConstructorFunction) {
                this.addRemoveOverrideFromConstructorActions([diagnostic]);
            }
        }

        // Second pass: fix-all actions for any code that appeared in the event.
        // Also makes sure that fix-all actions appear after individual fixes
        const eventCodes = new Set(this.event.diagnostics.map(d => d.code));
        const fixAllDiagsByCode = this.collectFixAllDiagnostics(eventCodes);

        // only offer fix-all when there are multiple instances of the same issue in the file
        for (const [code, allInFile] of fixAllDiagsByCode) {
            if (allInFile.length > 1) {
                if (code === DiagnosticCodeMap.voidFunctionMayNotReturnValue) {
                    this.addVoidFunctionReturnActions(allInFile);
                } else if (code === DiagnosticCodeMap.nonVoidFunctionMustReturnValue) {
                    this.addNonVoidFunctionReturnActions(allInFile);
                } else if (code === DiagnosticCodeMap.unnecessaryCodebehindScriptImport) {
                    this.addRemoveScriptImportActions(allInFile);
                } else if (code === DiagnosticCodeMap.cannotUseOverrideKeywordOnConstructorFunction) {
                    this.addRemoveOverrideFromConstructorActions(allInFile);
                } else if (code === DiagnosticCodeMap.referencedFileDoesNotExist) {
                    this.addRemoveScriptImportActions(allInFile);
                } else if (code === DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent) {
                    this.addRemoveScriptImportActions(allInFile);
                } else if (code === DiagnosticCodeMap.scriptImportCaseMismatch) {
                    this.addScriptImportCasingFix(allInFile as DiagnosticMessageType<'scriptImportCaseMismatch'>[]);
                } else if (code === DiagnosticCodeMap.missingOverrideKeyword) {
                    this.addMissingOverrideActions(allInFile);
                }
            }
        }

        // Import fix-all aggregates across multiple codes so it runs as its own step
        if (
            eventCodes.has(DiagnosticCodeMap.cannotFindName) ||
            eventCodes.has(DiagnosticCodeMap.cannotFindFunction) ||
            eventCodes.has(DiagnosticCodeMap.classCouldNotBeFound)
        ) {
            this.addAutoFixableMissingImportsFixAll();
        }

        this.suggestedImports.clear();
    }

    /**
     * Builds a map of diagnostic code → all matching diagnostics in the current file for each
     * code in `eventCodes`. Scope-level codes are not present in `file.getDiagnostics()` so they
     * are sourced from `program.getDiagnostics()` (fetched lazily, only when needed).
     */
    private collectFixAllDiagnostics(eventCodes: Set<number | string>): Map<number | string, BsDiagnostic[]> {
        const scopeLevelCodes = new Set<number | string>([
            DiagnosticCodeMap.referencedFileDoesNotExist,
            DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent,
            DiagnosticCodeMap.scriptImportCaseMismatch,
            DiagnosticCodeMap.missingOverrideKeyword
        ]);

        const fileDiagsByCode = new Map<number | string, BsDiagnostic[]>();
        for (const d of this.event.file.getDiagnostics()) {
            if (!fileDiagsByCode.has(d.code)) {
                fileDiagsByCode.set(d.code, []);
            }
            fileDiagsByCode.get(d.code).push(d);
        }

        const allScopeFileDiags: BsDiagnostic[] = [...eventCodes].some(c => scopeLevelCodes.has(c))
            ? this.event.program.getDiagnostics().filter(d => (d as BsDiagnostic).file === this.event.file) as BsDiagnostic[]
            : [];

        const result = new Map<number | string, BsDiagnostic[]>();
        for (const code of eventCodes) {
            result.set(
                code,
                scopeLevelCodes.has(code)
                    ? allScopeFileDiags.filter(d => d.code === code)
                    : fileDiagsByCode.get(code) ?? []
            );
        }
        return result;
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

    /**
     * Scans all import-related diagnostics in the file and emits a single composite
     * "Fix all: Add missing imports" action when 2+ unambiguous imports are needed.
     * Ambiguous names (multiple possible source files) are excluded since we cannot
     * automatically choose one.
     */
    private addAutoFixableMissingImportsFixAll() {
        if (!isBrsFile(this.event.file) || this.event.file.parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const file = this.event.file;
        const importStatements = file.parser.references.importStatements;
        const insertPosition = importStatements[importStatements.length - 1]?.importToken.range?.start ?? util.createPosition(0, 0);

        const changes: InsertChange[] = [];
        const addedPaths = new Set<string>();

        // cannotFindName/classCouldNotBeFound are scope-level diagnostics, so we must
        // use program.getDiagnostics() (filtered by file) rather than file.getDiagnostics().
        const allFileDiagnostics = this.event.program.getDiagnostics().filter(d => d.file === file);

        for (const diagnostic of allFileDiagnostics) {
            let files: BscFile[] = [];

            if (diagnostic.code === DiagnosticCodeMap.cannotFindName || diagnostic.code === DiagnosticCodeMap.cannotFindFunction) {
                const d = diagnostic as DiagnosticMessageType<'cannotFindName'>;
                const lowerName = (d.data?.fullName ?? d.data?.name)?.toLowerCase();
                if (lowerName) {
                    files = [
                        ...file.program.findFilesForFunction(lowerName),
                        ...file.program.findFilesForClass(lowerName),
                        ...file.program.findFilesForNamespace(lowerName),
                        ...file.program.findFilesForEnum(lowerName)
                    ];
                }
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                const d = diagnostic as DiagnosticMessageType<'classCouldNotBeFound'>;
                const lowerClassName = d.data?.className?.toLowerCase();
                if (lowerClassName) {
                    files = file.program.findFilesForClass(lowerClassName);
                }
            }

            //skip ambiguous names — we can't choose a file automatically
            if (files.length !== 1) {
                continue;
            }

            const pkgPath = util.getRokuPkgPath(files[0].pkgPath);
            if (!addedPaths.has(pkgPath)) {
                addedPaths.add(pkgPath);
                changes.push({
                    type: 'insert',
                    filePath: file.srcPath,
                    position: insertPosition,
                    newText: `import "${pkgPath}"\n`
                });
            }
        }

        if (changes.length > 1) {
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `Fix all: Auto fixable missing imports`,
                    kind: CodeActionKind.QuickFix,
                    changes: changes
                })
            );
        }
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

    // ---- change helpers ----

    private getRemoveReturnValueChange(diagnostic: Diagnostic): DeleteChange {
        return {
            type: 'delete',
            filePath: this.event.file.srcPath,
            range: util.createRange(
                diagnostic.range.start.line,
                diagnostic.range.start.character + 'return'.length,
                diagnostic.range.end.line,
                diagnostic.range.end.character
            )
        };
    }

    /**
     * Builds the change that deletes `) as <type>` from a function/sub declaration.
     * Used for both `as void` on a function and any return type on a sub.
     */
    private getRemoveFunctionReturnTypeChange(func: FunctionExpression): DeleteChange {
        return {
            type: 'delete',
            filePath: this.event.file.srcPath,
            // )| as <type>|
            range: util.createRange(
                func.rightParen.range.start.line,
                func.rightParen.range.start.character + 1,
                func.returnTypeToken.range.end.line,
                func.returnTypeToken.range.end.character
            )
        };
    }

    private getAddVoidReturnTypeChange(func: FunctionExpression, asText: string, voidText: string): InsertChange {
        return {
            type: 'insert',
            filePath: this.event.file.srcPath,
            position: func.rightParen.range.end,
            newText: ` ${asText} ${voidText}`
        };
    }

    /**
     * Emits a single code action when there is exactly one change, or a "fix all" composite
     * action when there are multiple changes (same pattern as ESLint's "Fix all X problems").
     * Does nothing when the changes array is empty.
     */
    private emitOrFixAll(
        singleTitle: string,
        fixAllTitle: string,
        changes: Array<InsertChange | DeleteChange | ReplaceChange>,
        diagnostic: Diagnostic
    ) {
        if (changes.length === 0) {
            return;
        }
        if (changes.length === 1) {
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: singleTitle,
                    diagnostics: [diagnostic],
                    kind: CodeActionKind.QuickFix,
                    changes: changes
                })
            );
        } else {
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: fixAllTitle,
                    kind: CodeActionKind.QuickFix,
                    changes: changes
                })
            );
        }
    }

    // ---- action adders ----

    private addVoidFunctionReturnActions(diagnostics: Diagnostic[]) {
        const changes = diagnostics.map(d => this.getRemoveReturnValueChange(d));
        this.emitOrFixAll(`Remove return value`, `Fix all: Remove void return values`, changes, diagnostics[0]);

        //contextual BrsFile actions only apply to the individual (single-violation) case
        if (changes.length === 1 && isBrsFile(this.event.file)) {
            const diagnostic = diagnostics[0];
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
                            { type: 'replace', filePath: this.event.file.srcPath, range: func.functionType.range, newText: functionTypeText },
                            //end function
                            { type: 'replace', filePath: this.event.file.srcPath, range: func.end.range, newText: endFunctionTypeText }
                        ]
                    })
                );
            }

            //function `as void` return type. Suggest removing the return type
            if (func.functionType.kind === TokenKind.Function && func.returnTypeToken?.kind === TokenKind.Void) {
                this.event.codeActions.push(
                    codeActionUtil.createCodeAction({
                        title: `Remove return type from function declaration`,
                        diagnostics: [diagnostic],
                        kind: CodeActionKind.QuickFix,
                        changes: [this.getRemoveFunctionReturnTypeChange(func)]
                    })
                );
            }
        }
    }

    private addNonVoidFunctionReturnActions(diagnostics: Diagnostic[]) {
        if (!isBrsFile(this.event.file)) {
            return;
        }
        const file = this.event.file;

        //find tokens for `as`, `void`, `sub`, `end sub` in the file if possible
        let asText: string;
        let voidText: string;
        let subText: string;
        let endSubText: string;
        for (const token of file.parser.tokens) {
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

        // Build per-fix-type change arrays, deduplicating by enclosing function so that one
        // function with multiple bare returns only contributes one change.
        const removeReturnTypeChanges: DeleteChange[] = [];
        const addVoidChanges: InsertChange[] = [];
        const seenFunctions = new Set<string>();

        for (const d of diagnostics) {
            const expr = file.getClosestExpression(d.range.start);
            const fn = expr?.findAncestor<FunctionExpression>(isFunctionExpression);
            if (!fn) {
                continue;
            }
            const fnKey = `${fn.range.start.line}:${fn.range.start.character}`;
            if (seenFunctions.has(fnKey)) {
                continue;
            }
            seenFunctions.add(fnKey);

            if (fn.functionType.kind === TokenKind.Sub && fn.returnTypeToken && fn.returnTypeToken.kind !== TokenKind.Void) {
                removeReturnTypeChanges.push(this.getRemoveFunctionReturnTypeChange(fn));
            } else if (fn.functionType.kind === TokenKind.Function && !fn.returnTypeToken) {
                addVoidChanges.push(this.getAddVoidReturnTypeChange(fn, asText ?? 'as', voidText ?? 'void'));
            }
        }

        this.emitOrFixAll(
            `Remove return type from sub declaration`,
            `Fix all: Remove return type from sub declarations`,
            removeReturnTypeChanges,
            diagnostics[0]
        );

        this.emitOrFixAll(
            `Add void return type to function declaration`,
            `Fix all: Add void return type to function declarations`,
            addVoidChanges,
            diagnostics[0]
        );

        //'Convert function to sub' has no fix-all variant; only add it for the individual case
        if (addVoidChanges.length === 1 && diagnostics.length === 1) {
            const func = file.getClosestExpression(diagnostics[0].range.start).findAncestor<FunctionExpression>(isFunctionExpression);
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `Convert function to sub`,
                    diagnostics: [diagnostics[0]],
                    kind: CodeActionKind.QuickFix,
                    changes: [
                        { type: 'replace', filePath: file.srcPath, range: func.functionType.range, newText: subText ?? 'sub' },
                        { type: 'replace', filePath: file.srcPath, range: func.end.range, newText: endSubText ?? 'end sub' }
                    ]
                })
            );
        }
    }

    // ---- script import fixes ----

    private getRemoveScriptImportLineChange(diagnostic: Diagnostic): DeleteChange {
        return {
            type: 'delete',
            filePath: this.event.file.srcPath,
            range: util.createRange(
                diagnostic.range.start.line,
                0,
                diagnostic.range.start.line + 1,
                0
            )
        };
    }

    private addRemoveScriptImportActions(diagnostics: Diagnostic[]) {
        const titles: Record<number, [string, string]> = {
            [DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent]: ['Remove redundant script import', 'Fix all: Remove redundant script imports'],
            [DiagnosticCodeMap.unnecessaryCodebehindScriptImport]: ['Remove unnecessary codebehind import', 'Fix all: Remove unnecessary codebehind imports']
        };
        const [singleTitle, fixAllTitle] = titles[diagnostics[0]?.code] ?? ['Remove script import', 'Fix all: Remove script imports'];
        const changes = diagnostics.map(d => this.getRemoveScriptImportLineChange(d));
        this.emitOrFixAll(singleTitle, fixAllTitle, changes, diagnostics[0]);
    }

    private addScriptImportCasingFix(diagnostics: DiagnosticMessageType<'scriptImportCaseMismatch'>[]) {
        const changes: ReplaceChange[] = [];
        for (const diagnostic of diagnostics) {
            const correctFilePath = diagnostic.data?.correctFilePath;
            if (!correctFilePath) {
                continue;
            }
            changes.push({
                type: 'replace',
                filePath: this.event.file.srcPath,
                range: diagnostic.range,
                newText: correctFilePath
            });
        }
        this.emitOrFixAll(
            'Fix script import path casing',
            'Fix all: Fix script import path casing',
            changes,
            diagnostics[0]
        );
    }

    // ---- override keyword fixes ----

    private addMissingOverrideActions(diagnostics: Diagnostic[]) {
        if (!isBrsFile(this.event.file)) {
            return;
        }
        const file = this.event.file;
        const changes: InsertChange[] = [];

        for (const diagnostic of diagnostics) {
            let insertPosition: { line: number; character: number } | undefined;
            file.ast.walk((node) => {
                if (
                    isMethodStatement(node) &&
                    node.range?.start?.line === diagnostic.range.start.line &&
                    node.range?.start?.character === diagnostic.range.start.character
                ) {
                    insertPosition = (node as MethodStatement).func.functionType?.range?.start;
                }
            }, { walkMode: WalkMode.visitStatementsRecursive });

            if (insertPosition) {
                changes.push({
                    type: 'insert',
                    filePath: file.srcPath,
                    position: insertPosition,
                    newText: 'override '
                });
            }
        }

        this.emitOrFixAll(
            `Add missing 'override' keyword`,
            `Fix all: Add missing 'override' keywords`,
            changes,
            diagnostics[0]
        );
    }

    private addRemoveOverrideFromConstructorActions(diagnostics: Diagnostic[]) {
        const changes: DeleteChange[] = diagnostics.map(d => ({
            type: 'delete' as const,
            filePath: this.event.file.srcPath,
            // delete "override " — the keyword token plus the trailing space before function/sub
            range: util.createRange(
                d.range.start.line,
                d.range.start.character,
                d.range.end.line,
                d.range.end.character + 1
            )
        }));
        this.emitOrFixAll(
            `Remove 'override' from constructor`,
            `Fix all: Remove 'override' from constructors`,
            changes,
            diagnostics[0]
        );
    }
}
