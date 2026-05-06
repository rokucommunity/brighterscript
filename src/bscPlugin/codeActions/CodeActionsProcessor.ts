import { CodeActionKind } from 'vscode-languageserver';
import { codeActionUtil } from '../../CodeActionUtil';
import type { DeleteChange, InsertChange, ReplaceChange } from '../../CodeActionUtil';
import type { DiagnosticMessageType } from '../../DiagnosticMessages';
import { DiagnosticCodeMap } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile } from '../../files/BscFile';
import type { XmlFile } from '../../files/XmlFile';
<<<<<<< HEAD
import type { BsDiagnostic, ProvideCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import { isBrsFile, isFunctionExpression, isVariableExpression, isVoidType } from '../../astUtils/reflection';
=======
import type { BscFile, BsDiagnostic, OnGetCodeActionsEvent } from '../../interfaces';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import { isBrsFile, isFunctionExpression, isMethodStatement } from '../../astUtils/reflection';
>>>>>>> master
import type { FunctionExpression } from '../../parser/Expression';
import type { MethodStatement } from '../../parser/Statement';
import { WalkMode } from '../../astUtils/visitors';
import { TokenKind } from '../../lexer/TokenKind';
<<<<<<< HEAD
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
=======
import { getMissingExtendsInsertPosition } from './codeActionHelpers';
>>>>>>> master

export class CodeActionsProcessor {
    public constructor(
        public event: ProvideCodeActionsEvent
    ) {

    }

    /**
     * Processes all diagnostics in the event and emits code actions for each recognized diagnostic code.
     */
    public process() {
        // First pass: individual fixes for each diagnostic at the cursor position
        for (const diagnostic of this.event.diagnostics) {
            if (diagnostic.code === DiagnosticCodeMap.cannotFindName || diagnostic.code === DiagnosticCodeMap.cannotFindFunction) {
                this.suggestCannotFindNameQuickFix(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                this.suggestClassImportQuickFix(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.xmlComponentMissingExtendsAttribute) {
                this.suggestMissingExtendsQuickFix(diagnostic as any);
            } else if (diagnostic.code === DiagnosticCodeMap.voidFunctionMayNotReturnValue) {
                this.suggestVoidFunctionReturnQuickFixes([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.nonVoidFunctionMustReturnValue) {
                this.suggestNonVoidFunctionReturnQuickFixes([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.referencedFileDoesNotExist) {
                this.suggestRemoveScriptImportQuickFixes([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent) {
                this.suggestRemoveScriptImportQuickFixes([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.unnecessaryCodebehindScriptImport) {
                this.suggestRemoveScriptImportQuickFixes([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.scriptImportCaseMismatch) {
                this.suggestScriptImportCasingQuickFixes([diagnostic as DiagnosticMessageType<'scriptImportCaseMismatch'>]);
            } else if (diagnostic.code === DiagnosticCodeMap.missingOverrideKeyword) {
                this.suggestMissingOverrideQuickFixes([diagnostic]);
            } else if (diagnostic.code === DiagnosticCodeMap.cannotUseOverrideKeywordOnConstructorFunction) {
                this.suggestRemoveOverrideFromConstructorQuickFixes([diagnostic]);
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
                    this.suggestVoidFunctionReturnQuickFixes(allInFile);
                } else if (code === DiagnosticCodeMap.nonVoidFunctionMustReturnValue) {
                    this.suggestNonVoidFunctionReturnQuickFixes(allInFile);
                } else if (code === DiagnosticCodeMap.unnecessaryCodebehindScriptImport) {
                    this.suggestRemoveScriptImportQuickFixes(allInFile);
                } else if (code === DiagnosticCodeMap.cannotUseOverrideKeywordOnConstructorFunction) {
                    this.suggestRemoveOverrideFromConstructorQuickFixes(allInFile);
                } else if (code === DiagnosticCodeMap.referencedFileDoesNotExist) {
                    this.suggestRemoveScriptImportQuickFixes(allInFile);
                } else if (code === DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent) {
                    this.suggestRemoveScriptImportQuickFixes(allInFile);
                } else if (code === DiagnosticCodeMap.scriptImportCaseMismatch) {
                    this.suggestScriptImportCasingQuickFixes(allInFile as DiagnosticMessageType<'scriptImportCaseMismatch'>[]);
                } else if (code === DiagnosticCodeMap.missingOverrideKeyword) {
                    this.suggestMissingOverrideQuickFixes(allInFile);
                }
            }
        }

        // Import fix-all aggregates across multiple codes so it runs as its own step
        if (
            eventCodes.has(DiagnosticCodeMap.cannotFindName) ||
            eventCodes.has(DiagnosticCodeMap.cannotFindFunction) ||
            eventCodes.has(DiagnosticCodeMap.classCouldNotBeFound)
        ) {
            this.suggestMissingImportsFixAllQuickFix();
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
    private suggestImportQuickFix(diagnostic: Diagnostic, key: string, files: BscFile[]) {
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

    /**
     * Suggests import statements for an unresolved name (function, class, namespace, or enum).
     */
    private suggestCannotFindNameQuickFix(diagnostic: DiagnosticMessageType<'cannotFindName'>) {
        //skip if not a BrighterScript file
        const file = this.event.program.getFile(diagnostic.location?.uri);
        if (!file || (file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerName = (diagnostic.data.fullName ?? diagnostic.data.name).toLowerCase();

        this.suggestImportQuickFix(
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

    /**
     * Suggests import statements for an unresolved class name.
     */
    private suggestClassImportQuickFix(diagnostic: DiagnosticMessageType<'classCouldNotBeFound'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerClassName = diagnostic.data.className.toLowerCase();
        this.suggestImportQuickFix(
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
    private suggestMissingImportsFixAllQuickFix() {
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
                const cannotFindNameDiagnostic = diagnostic as DiagnosticMessageType<'cannotFindName'>;
                const lowerName = (cannotFindNameDiagnostic.data?.fullName ?? cannotFindNameDiagnostic.data?.name)?.toLowerCase();
                if (lowerName) {
                    files = [
                        ...file.program.findFilesForFunction(lowerName),
                        ...file.program.findFilesForClass(lowerName),
                        ...file.program.findFilesForNamespace(lowerName),
                        ...file.program.findFilesForEnum(lowerName)
                    ];
                }
            } else if (diagnostic.code === DiagnosticCodeMap.classCouldNotBeFound) {
                const classCouldNotBeFoundDiagnostic = diagnostic as DiagnosticMessageType<'classCouldNotBeFound'>;
                const lowerClassName = classCouldNotBeFoundDiagnostic.data?.className?.toLowerCase();
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

    /**
     * Adds code actions to insert a missing `extends` attribute on an XML component tag.
     * Offers Group, Task, and ContentNode as common choices.
     */
    private suggestMissingExtendsQuickFix(diagnostic: DiagnosticMessageType<'xmlComponentMissingExtendsAttribute'>) {
        const srcPath = this.event.file.srcPath;
        const pos = getMissingExtendsInsertPosition(this.event.file as XmlFile);
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

<<<<<<< HEAD
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
=======
    /**
     * Adds code actions to resolve a `voidFunctionMayNotReturnValue` diagnostic.
     * Offers removing the return value, converting sub→function, or removing an `as void` return type.
     */
    private suggestVoidFunctionReturnQuickFixes(diagnostics: Diagnostic[]) {
        const changes = diagnostics.map(d => this.getRemoveReturnValueChange(d));
        this.emitOrFixAll(`Remove return value`, `Fix all: Remove void return values`, changes, diagnostics[0]);

        //contextual BrsFile actions only apply to the individual (single-violation) case
        if (changes.length === 1 && isBrsFile(this.event.file)) {
            const diagnostic = diagnostics[0];
            const expression = this.event.file.getClosestExpression(diagnostic.range.start);
>>>>>>> master
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
<<<<<<< HEAD
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
=======
                            { type: 'replace', filePath: this.event.file.srcPath, range: func.functionType.range, newText: functionTypeText },
                            //end function
                            { type: 'replace', filePath: this.event.file.srcPath, range: func.end.range, newText: endFunctionTypeText }
>>>>>>> master
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
<<<<<<< HEAD
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
=======
                        changes: [this.getRemoveFunctionReturnTypeChange(func)]
>>>>>>> master
                    })
                );
            }
        }
    }

<<<<<<< HEAD
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
=======
    /**
     * Adds code actions to resolve a `nonVoidFunctionMustReturnValue` diagnostic.
     * Offers removing the return type from a sub, adding `as void` to a function, or converting function→sub.
     */
    private suggestNonVoidFunctionReturnQuickFixes(diagnostics: Diagnostic[]) {
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
>>>>>>> master
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

<<<<<<< HEAD
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
=======
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
                addVoidChanges.push({
                    type: 'insert',
                    filePath: this.event.file.srcPath,
                    position: fn.rightParen.range.end,
                    newText: ` ${asText ?? 'as'} ${voidText ?? 'void'}`
                });
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

    /**
     * Adds code actions to delete one or more unnecessary or broken script import lines.
     */
    private suggestRemoveScriptImportQuickFixes(diagnostics: Diagnostic[]) {
        const titles: Record<number, [string, string]> = {
            [DiagnosticCodeMap.unnecessaryScriptImportInChildFromParent]: ['Remove redundant script import', 'Fix all: Remove redundant script imports'],
            [DiagnosticCodeMap.unnecessaryCodebehindScriptImport]: ['Remove unnecessary codebehind import', 'Fix all: Remove unnecessary codebehind imports']
        };
        const [singleTitle, fixAllTitle] = titles[diagnostics[0]?.code] ?? ['Remove script import', 'Fix all: Remove script imports'];
        const changes = diagnostics.map<DeleteChange>(diagnostic => {
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
        });
        this.emitOrFixAll(singleTitle, fixAllTitle, changes, diagnostics[0]);
    }

    /**
     * Adds code actions to correct the casing of script import paths to match the actual file name on disk.
     */
    private suggestScriptImportCasingQuickFixes(diagnostics: DiagnosticMessageType<'scriptImportCaseMismatch'>[]) {
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

    /**
     * Adds code actions to insert the missing `override` keyword before a method declaration.
     */
    private suggestMissingOverrideQuickFixes(diagnostics: Diagnostic[]) {
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
>>>>>>> master
            }
        }, { walkMode: WalkMode.visitStatementsRecursive });

<<<<<<< HEAD
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
=======
            if (insertPosition) {
                changes.push({
                    type: 'insert',
                    filePath: file.srcPath,
                    position: insertPosition,
                    newText: 'override '
                });
>>>>>>> master
    }
}

this.emitOrFixAll(
    `Add missing 'override' keyword`,
    `Fix all: Add missing 'override' keywords`,
    changes,
    diagnostics[0]
);
    }

    /**
     * Adds code actions to remove the invalid `override` keyword from a constructor method.
     */
    private suggestRemoveOverrideFromConstructorQuickFixes(diagnostics: Diagnostic[]) {
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

    // ---- change helpers ----

    /**
     * Builds a delete change that removes the return value from a `return <expr>` statement,
     * leaving just a bare `return`.
     */
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
}
