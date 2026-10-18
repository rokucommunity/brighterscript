import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { Position, Location, LocationLink } from 'vscode-languageserver';
import * as path from 'path';
import type { SymbolTable } from '../SymbolTable';
import type { FunctionScope } from '../FunctionScope';
import type { Callable, CommentFlag, SerializedCodeFile } from '../interfaces';
import type { Token } from '../lexer/Token';
import type { TokenKind } from '../lexer/TokenKind';
import type { Parser } from '../parser/Parser';
import { ParseMode } from '../parser/Parser';
import type { ClassStatement, MethodStatement, FieldStatement } from '../parser/Statement';
import type { Program } from '../Program';
import { standardizePath as s, util } from '../util';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyChangedEvent, DependencyGraph } from '../DependencyGraph';
import type { AstNode, Expression } from '../parser/AstNode';
import { ReferencesProvider } from '../bscPlugin/references/ReferencesProvider';
import { DocumentSymbolProcessor } from '../bscPlugin/symbols/DocumentSymbolProcessor';
import { WorkspaceSymbolProcessor } from '../bscPlugin/symbols/WorkspaceSymbolProcessor';
import type { BscSymbol } from '../SymbolTable';
import type { SymbolTypeFlag } from '../SymbolTypeFlag';
import { Editor } from '../astUtils/Editor';
import type { BscFile } from './BscFile';
import { DefinitionProvider } from '../bscPlugin/definition/DefinitionProvider';
import { BrsCode } from './BrsCode';

export interface ProvidedSymbol {
    symbol: BscSymbol;
    duplicates: BscSymbol[];
    requiredSymbolNames?: Set<string>;
}
export type ProvidedSymbolMap = Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>;
export type ChangedSymbolMap = Map<SymbolTypeFlag, Set<string>>;

export interface ProvidedSymbolInfo {
    symbolMap: ProvidedSymbolMap;
    changes: ChangedSymbolMap;
}

/**
 * Holds all details about this file within the scope of the whole program
 */
export class BrsFile implements BscFile {
    constructor(options: {
        /**
         * The path to the file in its source location (where the source code lives in the file system)
         */
        srcPath: string;
        /**
         * The path to the file where it should exist in the program. This is similar to pkgPath, but retains its original file extensions from srcPath
         */
        destPath: string;
        /**
         * The final path in the zip. This has the extensions changed. Typically this is the same as destPath, but with file extensions changed for transpiled files.
         */
        pkgPath?: string;
        program: Program;
    }) {
        this.code = new BrsCode({
            document: this,
            program: options?.program,
            onParserRequested: () => this.parseSkippedCode()
        });
        if (options) {
            this.srcPath = s`${options.srcPath}`;
            this.destPath = s`${options.destPath}`;
            this.program = options.program;

            this.extension = util.getExtension(this.srcPath);
            if (options.pkgPath) {
                this.pkgPath = options.pkgPath;
            } else {
                //don't rename .d.bs files to .d.brs
                if (this.extension === '.d.bs') {
                    this.pkgPath = this.destPath;
                } else {
                    this.pkgPath = this.destPath.replace(/\.bs$/i, '.brs');
                }
            }

            //all BrighterScript files need to be transpiled
            if (this.extension?.endsWith('.bs') || this.program?.options?.allowBrighterScriptInBrightScript) {
                this.parseMode = ParseMode.BrighterScript;
            }
            this.isTypedef = this.extension === '.d.bs';
            if (!this.isTypedef) {
                this.typedefKey = util.getTypedefPath(this.srcPath);
            }

            //global file doesn't have a program, so only resolve typedef info if we have a program
            if (this.program) {
                this.resolveTypedef();
            }
        }
    }

    public type = 'BrsFile';

    public srcPath: string;
    public destPath: string;
    public pkgPath: string;

    public program: Program;

    /**
     * The code in this file
     */
    public code: BrsCode;

    /**
     * An editor assigned during the build flow that manages edits that will be undone once the build process is complete.
     */
    public editor?: Editor;

    /**
     * Will this file result in only comment or whitespace output? If so, it can be excluded from the output if that bsconfig setting is enabled.
     */
    public get canBePruned() {
        let canPrune = true;
        this.ast.walk(createVisitor({
            FunctionStatement: () => {
                canPrune = false;
            },
            ClassStatement: () => {
                canPrune = false;
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
        return canPrune;
    }

    /**
     * The key used to identify this file in the dependency graph. This is set by the BrighterScript program and should not be set by plugins
     */
    public dependencyGraphKey: string;

    /**
     * The all-lowercase extension for this file (including the leading dot)
     */
    public extension: string;


    /**
     * Does this file need to be transpiled?
     * @deprecated use the `.editor` property to push changes to the file, which will force transpilation
     */
    public get needsTranspiled() {
        if (this._needsTranspiled !== undefined) {
            return this._needsTranspiled;
        }
        return !!(this.extension?.endsWith('.bs') || this.program?.options?.allowBrighterScriptInBrightScript || this.editor?.hasChanges);
    }
    public set needsTranspiled(value) {
        this._needsTranspiled = value;
    }
    public _needsTranspiled: boolean;


    /**
     * Parse the code that was skipped during `parse()` because this file has a typedef.
     * Called when something asks for the parser anyway.
     */
    private parseSkippedCode() {
        //remove the typedef file (if it exists)
        this.hasTypedef = false;
        this.typedefFile = undefined;

        //parse the file (it should parse fully since there's no linked typedef
        this.parse(this.fileContents);

        //re-link the typedef (if it exists...which it should)
        this.resolveTypedef();
    }

    public fileContents: string;

    /**
     * If this is a typedef file
     */
    public isTypedef: boolean;

    /**
     * The key to find the typedef file in the program's files map.
     * A falsey value means this file is ineligable for a typedef
     */
    public typedefKey?: string;

    /**
     * If the file was given type definitions during parse
     */
    public hasTypedef;

    /**
     * A reference to the typedef file (if one exists)
     */
    public typedefFile?: BrsFile;

    /**
     * Find and set the typedef variables (if a matching typedef file exists)
     */
    private resolveTypedef() {
        this.typedefFile = this.program.getFile<BrsFile>(this.typedefKey);
        this.hasTypedef = !!this.typedefFile;
    }

    public onDependenciesChanged(event: DependencyChangedEvent) {
        this.resolveTypedef();
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     * @deprecated this does nothing. This functionality is now handled by the file api and will be deleted in v1
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) { }

    /**
     * The list of files that this file depends on
     */
    public get dependencies() {
        const result = this.ownScriptImports.filter(x => !!x.destPath).map(x => x.destPath.toLowerCase());

        //if this is a .brs file, watch for typedef changes
        if (this.extension === '.brs') {
            result.push(
                util.getTypedefPath(this.destPath)
            );
        }
        return result;
    }

    /**
     * Calculate the AST for this file
     * @param fileContents the raw source code to parse
     */
    public parse(fileContents: string) {
        this.fileContents = fileContents;

        //if we have a typedef file, skip parsing this file
        if (this.hasTypedef) {
            //skip validation since the typedef is shadowing this file
            this.isValidated = true;
            return;
        }
        this.code.parse(fileContents);
    }


    /**
     * Builds a list of document symbols for this file. Used by LanguageServer's onDocumentSymbol functionality
     * @deprecated use `DocumentSymbolProvider.process()` instead
     */
    public getDocumentSymbols() {
        return new DocumentSymbolProcessor({
            documentSymbols: [],
            file: this,
            program: this.program
        }).process();
    }

    /**
     * Builds a list of workspace symbols for this file. Used by LanguageServer's onWorkspaceSymbol functionality
     */
    public getWorkspaceSymbols() {
        return new WorkspaceSymbolProcessor({
            program: this.program,
            workspaceSymbols: []
        }).process();
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     * @deprecated use `DefinitionProvider.process()` instead
     */
    public getDefinition(position: Position): Array<Location | LocationLink> {
        return new DefinitionProvider({
            program: this.program,
            file: this,
            position: position,
            definitions: []
        }).process();
    }

    public getClassMemberDefinitions(textToSearchFor: string, file: BrsFile): Location[] {
        let results: Location[] = [];
        //get class fields and members
        const statementHandler = (statement: MethodStatement) => {
            if (statement.getName(file.parseMode).toLowerCase() === textToSearchFor) {
                results.push(util.createLocationFromRange(util.pathToUri(file.srcPath), statement.location?.range));
            }
        };
        const fieldStatementHandler = (statement: FieldStatement) => {
            if (statement.tokens.name.text.toLowerCase() === textToSearchFor) {
                results.push(util.createLocationFromRange(util.pathToUri(file.srcPath), statement.location?.range));
            }
        };
        file.parser.ast.walk(createVisitor({
            MethodStatement: statementHandler,
            FieldStatement: fieldStatementHandler
        }), {
            walkMode: WalkMode.visitStatements
        });

        return results;
    }


    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * look up all references of that identifier (every place that identifier is used across the whole app)
     * @deprecated use `ReferencesProvider.process()` instead
     */
    public getReferences(position: Position): Location[] {
        return new ReferencesProvider({
            program: this.program,
            file: this,
            position: position,
            references: []
        }).process();
    }

    /**
     * Generate the code, map, and typedef for this file
     */
    public serialize(): SerializedCodeFile {
        const result: SerializedCodeFile = {};

        const transpiled = this.transpile();
        if (typeof transpiled.code === 'string') {
            result.code = transpiled.code;
        }
        if (transpiled.map) {
            result.map = transpiled.map.toString();
        }
        //generate the typedef (if this is not a typedef itself, and if enabled)
        if (!this.isTypedef && this.program.options.emitDefinitions) {
            result.typedef = this.getTypedef();
        }
        return result;
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new BrsTranspileState(this);
        state.editor = this.editor ?? new Editor();
        let transpileResult: SourceNode | undefined;

        if (this.needsTranspiled) {
            const astTranspile = this.ast.transpile(state);
            const trailingComments = [];
            if (util.hasLeadingComments(this.parser.eofToken)) {
                if (util.isLeadingCommentOnSameLine(this.ast.statements[this.ast.statements.length - 1]?.location, this.parser.eofToken)) {
                    trailingComments.push(' ');
                } else {
                    trailingComments.push('\n');
                }
                trailingComments.push(...state.transpileLeadingComments(this.parser.eofToken));
            }

            transpileResult = util.sourceNodeFromTranspileResult(null, null, state.srcPath, [...astTranspile, ...trailingComments]);
        } else if (this.program.options.sourceMap) {
            //emit code as-is with a simple map to the original file location
            transpileResult = util.simpleMap(state.srcPath, this.fileContents);
        } else {
            //simple SourceNode wrapping the entire file to simplify the logic below
            transpileResult = new SourceNode(null, null, state.srcPath, this.fileContents);
        }

        //if we created an editor for this flow, undo the edits now
        if (!this.editor) {
            //undo any AST edits that the transpile cycle has made
            state.editor.undoAll();
        }

        if (this.program.options.sourceMap) {
            util.stripTrailingSourceMappingURLComment(transpileResult);
            const stagingFileName = path.basename(state.srcPath).replace(/\.bs$/, '.brs');
            return new SourceNode(null, null, stagingFileName, [
                transpileResult,
                //add the sourcemap reference comment
                state.newline + `'//# sourceMappingURL=./${stagingFileName}.map`
            ]).toStringWithSourceMap({ file: stagingFileName });
        } else {
            return {
                code: transpileResult.toString(),
                map: undefined
            };
        }
    }


    public getTypedef() {
        const state = new BrsTranspileState(this);
        const typedef = this.ast.getTypedef(state);
        const programNode = util.sourceNodeFromTranspileResult(null, null, this.srcPath, typedef);
        return programNode.toString();
    }

    public dispose() {
        this.code?.dispose();

        //deleting these properties result in lower memory usage (garbage collection is magic!)
        delete this.fileContents;
    }

    // Everything below forwards to `this.code`. These keep existing callers working while they move to `BrsCode`,
    // and will be removed once they have.

    public get parseMode() {
        return this.code.parseMode;
    }
    public set parseMode(value: ParseMode) {
        this.code.parseMode = value;
    }

    public get isValidated() {
        return this.code.isValidated;
    }
    public set isValidated(value: boolean) {
        this.code.isValidated = value;
    }

    public get commentFlags() {
        return this.code.commentFlags;
    }
    public set commentFlags(value: CommentFlag[]) {
        this.code.commentFlags = value;
    }

    public get parser() {
        return this.code.parser;
    }

    protected get _parser() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        return this.code['_parser'];
    }
    protected set _parser(value: Parser) {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.code['_parser'] = value;
    }

    protected get _cachedLookups() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        return this.code['_cachedLookups'];
    }

    protected getNamespaceContributions() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        return this.code['getNamespaceContributions']();
    }

    public get ast() {
        return this.code.ast;
    }

    public get functionScopes() {
        return this.code.functionScopes;
    }

    public get scopesByFunc() {
        return this.code.scopesByFunc;
    }

    public get staticCallables() {
        return this.code.staticCallables;
    }
    public set staticCallables(value: Callable[]) {
        this.code.staticCallables = value;
    }

    public get callables() {
        return this.code.callables;
    }

    public get ownScriptImports() {
        return this.code.ownScriptImports;
    }

    public get propertyNameCompletions() {
        return this.code.propertyNameCompletions;
    }

    public get validationSegmenter() {
        return this.code.validationSegmenter;
    }

    public get requiredSymbols() {
        return this.code.requiredSymbols;
    }

    public get providedSymbols() {
        return this.code.providedSymbols;
    }

    public get assignedSymbols() {
        return this.code.assignedSymbols;
    }

    public getTokenAt(position: Position) {
        return this.code.getTokenAt(position);
    }

    public getCurrentOrNextTokenAt(position: Position) {
        return this.code.getCurrentOrNextTokenAt(position);
    }

    public getClosestExpression(position: Position) {
        return this.code.getClosestExpression(position);
    }

    public getClassFileLink(className: string, containingNamespace?: string) {
        return this.code.getClassFileLink(className, containingNamespace);
    }

    public findPropertyNameCompletions() {
        return this.code.findPropertyNameCompletions();
    }

    public getCommentFlags(tokens: Token[]) {
        return this.code.getCommentFlags(tokens);
    }

    public getFunctionScopeAtPosition(position: Position) {
        return this.code.getFunctionScopeAtPosition(position);
    }

    public _getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]) {
        return this.code._getFunctionScopeAtPosition(position, functionScopes);
    }

    public getNamespaceStatementForPosition(position: Position) {
        return this.code.getNamespaceStatementForPosition(position);
    }

    public getPartialVariableName(currentToken: Token, excludeTokens: TokenKind[] = null) {
        return this.code.getPartialVariableName(currentToken, excludeTokens);
    }

    public isPositionNextToTokenKind(position: Position, tokenKind: TokenKind) {
        return this.code.isPositionNextToTokenKind(position, tokenKind);
    }

    public isTokenNextToTokenKind(closestToken: Token, tokenKind: TokenKind) {
        return this.code.isTokenNextToTokenKind(closestToken, tokenKind);
    }

    public getTokenBefore(currentToken: Token, tokenKind?: TokenKind) {
        return this.code.getTokenBefore(currentToken, tokenKind);
    }

    public tokenFollows(currentToken: Token, tokenKind: TokenKind) {
        return this.code.tokenFollows(currentToken, tokenKind);
    }

    public getTokensUntil(currentToken: Token, tokenKind: TokenKind, direction: -1 | 1 = 1) {
        return this.code.getTokensUntil(currentToken, tokenKind, direction);
    }

    public getNextTokenByPredicate(currentToken: Token, test: (Token) => boolean, direction: -1 | 1 = 1) {
        return this.code.getNextTokenByPredicate(currentToken, test, direction);
    }

    public getPreviousToken(token: Token) {
        return this.code.getPreviousToken(token);
    }

    public calleeStartsWithNamespace(callee: Expression) {
        return this.code.calleeStartsWithNamespace(callee);
    }

    public getClosestToken(position: Position) {
        return this.code.getClosestToken(position);
    }

    public getClassMethod(classStatement: ClassStatement, name: string, walkParents = true) {
        return this.code.getClassMethod(classStatement, name, walkParents);
    }

    public getNamespaceSymbolTable(allowCache = true) {
        return this.code.getNamespaceSymbolTable(allowCache);
    }

    public processSymbolInformation() {
        return this.code.processSymbolInformation();
    }

    public unlinkNamespaceSymbolTables() {
        return this.code.unlinkNamespaceSymbolTables();
    }

    public populateNameSpaceSymbolTable(namespaceSymbolTable: SymbolTable) {
        return this.code.populateNameSpaceSymbolTable(namespaceSymbolTable);
    }

    public markSegmentAsValidated(node: AstNode) {
        return this.code.markSegmentAsValidated(node);
    }

    public getNamespaceLookupObject() {
        return this.code.getNamespaceLookupObject();
    }
}
