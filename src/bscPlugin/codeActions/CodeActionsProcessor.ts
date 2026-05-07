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
import type { Expression } from '../../parser/AstNode';
import { util } from '../../util';
import { isBrsFile, isCallExpression, isDottedGetExpression, isFunctionExpression, isMethodStatement, isNamedArgumentExpression, isNamespaceStatement, isNewExpression, isVariableExpression, isXmlFile } from '../../astUtils/reflection';
import type { CallExpression, FunctionExpression } from '../../parser/Expression';
import type { MethodStatement, NamespaceStatement } from '../../parser/Statement';
import { WalkMode } from '../../astUtils/visitors';
import { TokenKind } from '../../lexer/TokenKind';
import { getMissingExtendsInsertPosition } from './codeActionHelpers';
import { rangeFromTokenValue } from '../../parser/SGParser';
import type { Range } from 'vscode-languageserver';

export class CodeActionsProcessor {
    public constructor(
        public event: OnGetCodeActionsEvent
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
            } else if (diagnostic.code === DiagnosticCodeMap.namedArgOutOfOrder) {
                this.suggestNamedArgOrderQuickFix(diagnostic as DiagnosticMessageType<'namedArgOutOfOrder'>);
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

        // Suppression actions appear last so real fixes are surfaced first
        for (const diagnostic of this.event.diagnostics) {
            this.suggestDisableDiagnosticQuickFixes(diagnostic);
        }

        this.suggestedImports.clear();
    }

    /**
     * For any diagnostic with a code, offers two quick-fix actions:
     *   - "Disable {code} for this line": adds the code to an existing `bs:disable-line` or
     *     `bs:disable-next-line` directive on/above the diagnostic if present, otherwise inserts
     *     a new `bs:disable-next-line: {code}` comment on the line above.
     *   - "Disable {code} for this file": adds the code to an existing header-level `bs:disable`
     *     directive if present, otherwise inserts a new `bs:disable: {code}` at the top of the file.
     *
     * Comment placement and the line-vs-next-line preference are centralized here so they can be
     * revisited without touching the directive parser.
     */
    private suggestDisableDiagnosticQuickFixes(diagnostic: BsDiagnostic) {
        const code = diagnostic.code;
        if (code === undefined || code === null) {
            return;
        }
        const file = this.event.file;
        if (!isBrsFile(file) && !isXmlFile(file)) {
            return;
        }
        const codeStr = String(code);
        const isXml = isXmlFile(file);
        //existing.forLine: any line/next-line directive on or above the diagnostic line that the line action could extend
        //existing.forFile: any header-level bs:disable that the file action could extend
        const existing = this.findExistingDisableDirectives(file, diagnostic.range.start.line);

        //format helpers wrap the directive body in the right comment syntax (`'` for brs, `<!-- -->` for xml)
        const formatLineDirective = (token: 'line' | 'next-line', codes: string[]) => {
            const body = `bs:disable-${token}: ${codes.join(' ')}`;
            return isXml ? `<!-- ${body} -->` : `' ${body}`;
        };
        const formatBlockDirective = (codes: string[]) => {
            const body = `bs:disable: ${codes.join(' ')}`;
            return isXml ? `<!-- ${body} -->` : `' ${body}`;
        };

        // ---- "disable for this line" ----
        //the two lambdas passed to getDiagnosticSuppressionChange are the "extend existing" and "insert fresh" branches:
        //  1) rebuild the existing directive comment with the new code merged into its code list (preserving line vs next-line)
        //  2) insert a fresh `bs:disable-next-line: {code}` on the line above the diagnostic, matching its indent
        const indent = ' '.repeat(diagnostic.range.start.character);
        const lineAction = this.getDiagnosticSuppressionChange(
            existing.forLine,
            codeStr,
            () => formatLineDirective(existing.forLine!.type as 'line' | 'next-line', this.mergeCodes(existing.forLine?.codes, codeStr)),
            () => ({
                position: util.createPosition(diagnostic.range.start.line, 0),
                newText: `${indent}${formatLineDirective('next-line', [codeStr])}\n`
            })
        );
        if (lineAction) {
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `Disable ${code} for this line: ${diagnostic.message}`,
                    diagnostics: [diagnostic],
                    kind: CodeActionKind.QuickFix,
                    changes: [lineAction]
                })
            );
        }

        // ---- "disable for this file" ----
        //same pattern as above, but operating on the header-level bs:disable directive:
        //  1) rebuild the existing header directive with the new code appended
        //  2) insert a fresh `bs:disable: {code}` at the file header (top of brs, or after `<?xml ?>` for xml)
        const fileAction = this.getDiagnosticSuppressionChange(
            existing.forFile,
            codeStr,
            () => formatBlockDirective(this.mergeCodes(existing.forFile?.codes, codeStr)),
            () => {
                const headerInsert = this.getDisableFileInsertion(file);
                return {
                    position: headerInsert.position,
                    newText: headerInsert.prefix + formatBlockDirective([codeStr]) + headerInsert.suffix
                };
            }
        );
        if (fileAction) {
            this.event.codeActions.push(
                codeActionUtil.createCodeAction({
                    title: `Disable ${code} for this file: ${diagnostic.message}`,
                    diagnostics: [diagnostic],
                    kind: CodeActionKind.QuickFix,
                    changes: [fileAction]
                })
            );
        }
    }

    /**
     * Returns the file change that suppresses `codeStr` via a directive comment, or `null` when no
     * change is needed (the existing directive already covers the code, or already suppresses
     * everything). When `existing` is set, the result is a replace that swaps the directive comment
     * for the text from `buildReplacementText`. When `existing` is null, the result is an insert
     * built from `buildInsert`.
     */
    private getDiagnosticSuppressionChange(
        existing: ExistingDirective | null,
        codeStr: string,
        buildReplacementText: () => string,
        buildInsert: () => { position: ReturnType<typeof util.createPosition>; newText: string }
    ): InsertChange | ReplaceChange | null {
        if (existing) {
            //existing directive without specific codes already suppresses everything; no-op
            if (existing.codes.length === 0) {
                return null;
            }
            //the new code is already in the directive; no-op
            if (existing.codes.some(c => c.toLowerCase() === codeStr.toLowerCase())) {
                return null;
            }
            return {
                type: 'replace',
                filePath: this.event.file.srcPath,
                range: existing.range,
                newText: buildReplacementText()
            };
        }
        const insert = buildInsert();
        return {
            type: 'insert',
            filePath: this.event.file.srcPath,
            position: insert.position,
            newText: insert.newText
        };
    }

    private mergeCodes(existingCodes: string[] | undefined, newCode: string): string[] {
        return [...(existingCodes ?? []), newCode];
    }

    /**
     * Walks the file's tokens and returns existing `bs:disable-{line,next-line}` and header-level
     * `bs:disable` directives that would cover the diagnostic on `diagLine`. Used so the suppression
     * quick fixes can extend an existing directive instead of stacking new ones.
     */
    private findExistingDisableDirectives(file: BscFile, diagLine: number): { forLine: ExistingDirective | null; forFile: ExistingDirective | null } {
        const isXml = isXmlFile(file);
        const tokens: any[] = (file as any).parser?.tokens ?? [];
        let inHeader = true;
        let forLine: ExistingDirective | null = null;
        let forFile: ExistingDirective | null = null;
        for (const token of tokens) {
            const isComment = isXml ? token.tokenType?.name === 'Comment' : token.kind === TokenKind.Comment;
            if (!isComment) {
                if (isXml) {
                    if (token.tokenType?.name === 'OPEN') {
                        inHeader = false;
                    }
                } else if (token.kind !== TokenKind.Newline && token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Eof) {
                    inHeader = false;
                }
                continue;
            }
            const tokenRange: Range = isXml ? rangeFromTokenValue(token) : token.range;
            const tokenText: string = isXml ? token.image : token.text;
            const parsed = parseDisableComment(tokenText);
            if (!parsed) {
                continue;
            }
            const directive: ExistingDirective = { type: parsed.directiveType, codes: parsed.codes, range: tokenRange };
            if (!forLine && parsed.directiveType === 'line' && tokenRange.start.line === diagLine) {
                forLine = directive;
            } else if (!forLine && parsed.directiveType === 'next-line' && tokenRange.start.line === diagLine - 1) {
                forLine = directive;
            } else if (!forFile && parsed.directiveType === 'block' && inHeader) {
                //only header-level `bs:disable` directives are extended for the file-level quick fix
                forFile = directive;
            }
        }
        return { forLine: forLine, forFile: forFile };
    }

    /**
     * Decides where in the file a header-level `bs:disable` directive should be inserted, returning
     * the position plus any prefix/suffix needed so the directive lands on its own line in
     * the header (before the first executable statement / root XML element).
     */
    private getDisableFileInsertion(file: BscFile): { position: ReturnType<typeof util.createPosition>; prefix: string; suffix: string } {
        if (isXmlFile(file)) {
            //insert after the `<?xml ?>` declaration if present, otherwise at the very top
            const declCloseToken = file.parser.tokens?.find(t => (t as any).tokenType?.name === 'SPECIAL_CLOSE');
            if (declCloseToken) {
                const endLine = (declCloseToken as any).endLine - 1;
                const endColumn = (declCloseToken as any).endColumn;
                return {
                    position: util.createPosition(endLine, endColumn),
                    prefix: '\n',
                    suffix: ''
                };
            }
        }
        return {
            position: util.createPosition(0, 0),
            prefix: '',
            suffix: '\n'
        };
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

    /**
     * Suggests import statements for an unresolved name (function, class, namespace, or enum).
     */
    private suggestCannotFindNameQuickFix(diagnostic: DiagnosticMessageType<'cannotFindName'>) {
        //skip if not a BrighterScript file
        if ((diagnostic.file as BrsFile).parseMode !== ParseMode.BrighterScript) {
            return;
        }
        const lowerName = (diagnostic.data.fullName ?? diagnostic.data.name).toLowerCase();

        this.suggestImportQuickFix(
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

            //skip ambiguous names; we can't choose a file automatically
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
     * Suggests reordering named arguments to declaration order.
     */
    private suggestNamedArgOrderQuickFix(diagnostic: DiagnosticMessageType<'namedArgOutOfOrder'>) {
        if (!isBrsFile(this.event.file)) {
            return;
        }
        const closestExpression = this.event.file.getClosestExpression(diagnostic.range.start);
        const callExpression = (
            isCallExpression(closestExpression)
                ? closestExpression
                : closestExpression?.findAncestor<CallExpression>(isCallExpression)
        );
        if (!callExpression || callExpression.args.length < 2) {
            return;
        }

        const parameters = this.getCallExpressionParameters(callExpression);
        if (!parameters) {
            return;
        }

        const argsWithParamIndex = [] as Array<{ arg: Expression; paramIndex: number }>;
        let expectedParamIndex = 0;
        let hasNamedArg = false;

        for (const arg of callExpression.args) {
            if (!isNamedArgumentExpression(arg)) {
                // Quick-fix can only reorder arguments; it cannot repair invalid syntax/shape such as
                // positional args after named args or positional args beyond parameter count.
                if (hasNamedArg || expectedParamIndex >= parameters.length) {
                    return;
                }
                argsWithParamIndex.push({ arg: arg, paramIndex: expectedParamIndex });
                expectedParamIndex++;
                continue;
            }

            hasNamedArg = true;
            const namedArg = arg;
            const paramIndex = parameters.findIndex(p => p.name.text.toLowerCase() === namedArg.name.text.toLowerCase());
            // Unknown names and duplicate parameter targets are invalid; do not offer a reorder fix.
            if (paramIndex < 0 || argsWithParamIndex.some(x => x.paramIndex === paramIndex)) {
                return;
            }
            argsWithParamIndex.push({ arg: namedArg, paramIndex: paramIndex });
            expectedParamIndex = paramIndex + 1;
        }

        const sortedArgs = [...argsWithParamIndex].sort((a, b) => a.paramIndex - b.paramIndex);
        const sortedArgText = sortedArgs.map(x => util.getTextForRange(this.event.file.fileContents, x.arg.range)).join(', ');
        const firstArg = callExpression.args[0];
        const lastArg = callExpression.args[callExpression.args.length - 1];
        if (!firstArg?.range || !lastArg?.range) {
            return;
        }

        this.event.codeActions.push(
            codeActionUtil.createCodeAction({
                title: 'Reorder named arguments to match function declaration',
                diagnostics: [diagnostic],
                kind: CodeActionKind.QuickFix,
                changes: [{
                    type: 'replace',
                    filePath: this.event.file.srcPath,
                    range: util.createRangeFromPositions(firstArg.range.start, lastArg.range.end),
                    newText: sortedArgText
                }]
            })
        );
    }

    private getCallExpressionParameters(callExpression: CallExpression) {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        if (!scope) {
            return undefined;
        }
        if (isNewExpression(callExpression.parent)) {
            const newExpression = callExpression.parent;
            const className = newExpression.className.getName(ParseMode.BrighterScript);
            const containingNamespace = newExpression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase();
            const classLink = scope.getClassFileLink(className, containingNamespace);
            if (!classLink) {
                return undefined;
            }
            return util.getClassConstructorParams(classLink.item, scope, containingNamespace);
        }
        if (isVariableExpression(callExpression.callee)) {
            return this.getCallableParametersByName(callExpression.callee.name.text.toLowerCase());
        }
        if (isDottedGetExpression(callExpression.callee)) {
            const brsName = util.resolveNamespaceCallableName(callExpression.callee, scope);
            if (!brsName) {
                return undefined;
            }
            return this.getCallableParametersByName(brsName.toLowerCase());
        }
    }

    private getCallableParametersByName(lowerName: string) {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        if (!scope) {
            return undefined;
        }
        const callable = scope.getCallableByName(lowerName);
        return callable?.functionStatement?.func?.parameters;
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

    /**
     * Adds code actions to remove the invalid `override` keyword from a constructor method.
     */
    private suggestRemoveOverrideFromConstructorQuickFixes(diagnostics: Diagnostic[]) {
        const changes: DeleteChange[] = diagnostics.map(d => ({
            type: 'delete' as const,
            filePath: this.event.file.srcPath,
            // delete "override " (the keyword token plus the trailing space before function/sub)
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

interface ExistingDirective {
    type: 'line' | 'next-line' | 'block';
    codes: string[];
    range: Range;
}

/**
 * Parses a comment's text and returns the directive details if it is one. Recognizes
 * `'`, `rem`, and `<!-- -->` comment styles. Returns `null` for comments that aren't directives.
 * `block` covers `bs:disable`. The `bs:enable` partner isn't surfaced since the quick fix only
 * extends `bs:disable` directives.
 */
function parseDisableComment(text: string): { directiveType: 'line' | 'next-line' | 'block'; codes: string[] } | null {
    let inner = text;
    if (inner.startsWith('<!--')) {
        inner = inner.slice('<!--'.length);
        if (inner.endsWith('-->')) {
            inner = inner.slice(0, -('-->'.length));
        }
    } else if (inner.startsWith(`'`)) {
        inner = inner.slice(1);
    } else if (/^rem\b/i.test(inner)) {
        inner = inner.slice('rem'.length);
    }
    inner = inner.trimStart();
    const lower = inner.toLowerCase();
    //match longest-prefix first so `bs:disable-line` doesn't get parsed as `bs:disable`
    let directiveType: 'line' | 'next-line' | 'block';
    let prefixLength: number;
    if (lower.startsWith('bs:disable-next-line')) {
        directiveType = 'next-line';
        prefixLength = 'bs:disable-next-line'.length;
    } else if (lower.startsWith('bs:disable-line')) {
        directiveType = 'line';
        prefixLength = 'bs:disable-line'.length;
    } else if (lower.startsWith('bs:disable')) {
        directiveType = 'block';
        prefixLength = 'bs:disable'.length;
    } else {
        return null;
    }
    inner = inner.slice(prefixLength);
    if (inner.startsWith(':')) {
        inner = inner.slice(1);
    }
    const codes = inner.trim().length === 0 ? [] : inner.trim().split(/\s+/);
    return { directiveType: directiveType, codes: codes };
}
