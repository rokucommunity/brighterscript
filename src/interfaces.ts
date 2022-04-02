import type { Range, Diagnostic, CodeAction, SemanticTokenTypes, SemanticTokenModifiers } from 'vscode-languageserver';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { TypedFunctionType } from './types/TypedFunctionType';
import type { ParseMode } from './parser/Parser';
import type { Program } from './Program';
import type { ProgramBuilder } from './ProgramBuilder';
import type { FunctionStatement, ClassStatement, InterfaceStatement } from './parser/Statement';
import type { Expression, FunctionExpression } from './parser/Expression';
import type { TranspileState } from './parser/TranspileState';
import type { SourceMapGenerator, SourceNode } from 'source-map';
import type { BscType, SymbolContainer } from './types/BscType';
import type { Token } from './lexer/Token';
import type { AstEditor } from './astUtils/AstEditor';
import type { CustomType } from './types/CustomType';
import type { InterfaceType } from './types/InterfaceType';

export interface BsDiagnostic extends Diagnostic {
    file: BscFile;
    /**
     * A generic data container where additional details of the diagnostic can be stored. These are stripped out before being sent to a languageclient, and not printed to the console.
     */
    data?: any;
}

export type BscFile = BrsFile | XmlFile;

export interface Callable {
    file: BscFile;
    name: string;
    /**
     * Is the callable declared as "sub". If falsey, assumed declared as "function"
     */
    isSub: boolean;
    type: TypedFunctionType;
    /**
     * A short description of the callable. Should be a short sentence.
     */
    shortDescription?: string;
    /**
     * A more lengthy explanation of the callable. This is parsed as markdown
     */
    documentation?: string;
    params: CallableParam[];
    /**
     * The full range of the function or sub.
     */
    range: Range;
    /**
     * The range of the name of this callable
     */
    nameRange?: Range;
    isDeprecated?: boolean;
    getName: (parseMode: ParseMode) => string;
    /**
     * Indicates whether or not this callable has an associated namespace
     */
    hasNamespace: boolean;
    /**
     * Gives access to the whole statement if you need more data than provided by the interface
     */
    functionStatement: FunctionStatement;
}

export interface FunctionCall {
    /**
     * The full range of this function call (from the start of the function name to its closing paren)
     */
    range: Range;
    functionExpression: FunctionExpression;
    file: BscFile;
    name: Token;
    args: CallableArg[];
    nameRange: Range;
    isDottedInvocation: boolean;
}

/**
 * An argument for an expression call.
 */
export interface CallableArg {
    text: string;
    type: BscType;
    range: Range;
    expression: Expression;
}

export interface CallableParam {
    name: string;
    type: BscType;
    /**
     * Is this parameter required or optional?
     */
    isOptional: boolean;
    /**
     * Indicates that an unlimited number of arguments can be passed in
     */
    isRestArgument?: boolean;
}

export interface FileObj {
    src: string;
    dest: string;
}

/**
 * Represents a file import in a component <script> tag
 */
export interface FileReference {
    /**
     * The pkgPath to the referenced file.
     */
    pkgPath: string;
    text: string;
    /**
     * The file that is doing the import. Note this is NOT the file the pkgPath points to.
     */
    sourceFile: XmlFile | BrsFile;
    /**
     * The full range of this file reference.
     * Keep in mind that file references can come from xml script tags
     * as well as bs file import statements.
     * If the range is null, then this import is derived so skip any location-based logic
     */
    filePathRange?: Range;
}

export interface VariableDeclaration {
    name: string;
    type: BscType;
    /**
     * The range for the variable name
     */
    nameRange: Range;
    /**
     * Since only one variable can be declared at a time,
     * we only need to know the line index
     */
    lineIndex: number;
}

export interface LabelDeclaration {
    name: string;
    /**
     * The range for the label name
     */
    nameRange: Range;
    /**
     * The line of the label
     */
    lineIndex: number;
}

/**
 * A wrapper around a callable to provide more information about where it came from
 */
export interface CallableContainer {
    callable: Callable;
    scope: Scope;
}

export type CallableContainerMap = Map<string, CallableContainer[]>;

export interface CommentFlag {
    file: BscFile;
    /**
     * The location of the ignore comment.
     */
    range: Range;
    /**
     * The range that this flag applies to (i.e. the lines that should be suppressed/re-enabled)
     */
    affectedRange: Range;
    codes: DiagnosticCode[] | null;
}

export type CompilerPluginFactory = () => CompilerPlugin;

export interface CompilerPlugin {
    name: string;
    //ProgramBuilder events
    beforeProgramCreate?: PluginHandler<BeforeProgramCreateEvent>;
    afterProgramCreate?: PluginHandler<AfterProgramCreateEvent>;
    beforePrepublish?: PluginHandler<BeforePrepublishEvent>;
    afterPrepublish?: PluginHandler<AfterPrepublishEvent>;
    beforePublish?: PluginHandler<BeforePublishEvent>;
    afterPublish?: PluginHandler<AfterPublishEvent>;
    //program events
    beforeProgramValidate?: PluginHandler<BeforeProgramValidateEvent>;
    afterProgramValidate?: PluginHandler<AfterProgramValidateEvent>;
    beforeProgramTranspile?: PluginHandler<BeforeProgramTranspileEvent>;
    afterProgramTranspile?: PluginHandler<AfterProgramTranspileEvent>;
    onGetCodeActions?: PluginHandler<OnGetCodeActionsEvent>;
    onGetSemanticTokens?: PluginHandler<OnGetSemanticTokensEvent>;
    //scope events
    afterScopeCreate?: PluginHandler<AfterScopeCreateEvent>;
    beforeScopeDispose?: PluginHandler<BeforeScopeDisposeEvent>;
    afterScopeDispose?: PluginHandler<AfterScopeDisposeEvent>;
    beforeScopeValidate?: PluginHandler<BeforeScopeValidateEvent>;
    onScopeValidate?: PluginHandler<OnScopeValidateEvent>;
    afterScopeValidate?: PluginHandler<AfterScopeValidateEvent>;
    //file events
    beforeFileParse?: PluginHandler<BeforeFileParseEvent>;
    afterFileParse?: PluginHandler<AfterFileParseEvent>;
    /**
     * Called before each file is validated
     */
    beforeFileValidate?: PluginHandler<BeforeFileValidateEvent>;
    /**
     * Called during the file validation process. If your plugin contributes file validations, this is a good place to contribute them.
     */
    onFileValidate?: PluginHandler<OnFileValidateEvent>;
    /**
     * Called after each file is validated
     */
    afterFileValidate?: PluginHandler<AfterFileValidateEvent>;
    beforeFileTranspile?: PluginHandler<BeforeFileTranspileEvent>;
    afterFileTranspile?: PluginHandler<AfterFileTranspileEvent>;
    beforeFileDispose?: PluginHandler<BeforeFileDisposeEvent>;
    afterFileDispose?: PluginHandler<AfterFileDisposeEvent>;
}
export type PluginHandler<T> = (event: T) => void;

export interface BeforeProgramCreateEvent {
    builder: ProgramBuilder;
}
export interface BeforePrepublishEvent {
    builder: ProgramBuilder;
    program: Program;
    files: FileObj[];
}
export interface AfterPrepublishEvent {
    builder: ProgramBuilder;
    program: Program;
    files: FileObj[];
}
export interface BeforePublishEvent {
    builder: ProgramBuilder;
    program: Program;
    files: FileObj[];
}
export interface AfterPublishEvent {
    builder: ProgramBuilder;
    program: Program;
    files: FileObj[];
}
export interface AfterProgramCreateEvent {
    builder: ProgramBuilder;
    program: Program;
}
export interface BeforeProgramValidateEvent {
    program: Program;
}
export interface AfterProgramValidateEvent {
    program: Program;
}
export interface BeforeProgramTranspileEvent {
    program: Program;
    entries: TranspileEntry[];
}
export interface AfterProgramTranspileEvent {
    program: Program;
    entries: TranspileEntry[];
}
export interface OnGetCodeActionsEvent {
    program: Program;
    file: BscFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}
export interface AfterScopeCreateEvent {
    program: Program;
    scope: Scope;
}
export interface BeforeScopeDisposeEvent {
    program: Program;
    scope: Scope;
}
export interface AfterScopeDisposeEvent {
    program: Program;
    scope: Scope;
}
export interface BeforeScopeValidateEvent {
    program: Program;
    scope: Scope;
}
export interface AfterScopeValidateEvent {
    program: Program;
    scope: Scope;
}
export interface OnScopeGetCodeActionsEvent {
    program: Program;
    scope: Scope;
    file: BscFile;
    range: Range;
    /**
     * A filtered list of diagnostics whose lines touch the lines of the given range
     */
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}
export interface BeforeFileParseEvent {
    program: Program;
    srcPath: string;
    source: string;
}
export interface AfterFileParseEvent {
    program: Program;
    file: BscFile;
}
export interface OnGetSemanticTokensEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
    scopes: Scope[];
    semanticTokens: SemanticToken[];
}
export interface BeforeFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}
export interface OnFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}
export interface AfterFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}

export interface BeforeFileTranspileEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    outputPath: string;
    /**
     * An editor that can be used to transform properties or arrays. Once the `afterFileTranspile` event has fired, these changes will be reverted,
     * restoring the objects to their prior state. This is useful for changing code right before a file gets transpiled, but when you don't want
     * the changes to persist in the in-memory file.
     */
    editor: Editor;
}

export interface AfterFileTranspileEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    outputPath: string;
    /**
     * The resulting transpiled file contents
     */
    code: string;
    /**
     * The sourceMaps for the generated code (if emitting source maps is enabled)
     */
    map?: SourceMapGenerator;
    /**
     * The generated type definition file contents (if emitting type definitions are enabled)
     */
    typedef?: string;
    /**
     * An editor that can be used to transform properties or arrays. Once the `afterFileTranspile` event has fired, these changes will be reverted,
     * restoring the objects to their prior state. This is useful for changing code right before a file gets transpiled, but when you don't want
     * the changes to persist in the in-memory file.
     */
    editor: Editor;
}
export interface BeforeFileDisposeEvent {
    program: Program;
    file: BscFile;
}
export interface AfterFileDisposeEvent {
    program: Program;
    file: BscFile;
}
export interface OnFileGetCodeActionsEvent {
    program: Program;
    file: BscFile;
    range: Range;
    /**
     * A filtered list of diagnostics whose lines touch the lines of the given range
     */
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}

export interface TranspileEntry {
    file: BscFile;
    outputPath: string;
}

export interface OnScopeValidateEvent {
    program: Program;
    scope: Scope;
}

export type Editor = Pick<AstEditor, 'addToArray' | 'hasChanges' | 'removeFromArray' | 'setArrayValue' | 'setProperty' | 'overrideTranspileResult'>;

export interface SemanticToken {
    range: Range;
    tokenType: SemanticTokenTypes;
    /**
     * An optional array of modifiers for this token
     */
    tokenModifiers?: SemanticTokenModifiers[];
}

export interface TypedefProvider {
    getTypedef(state: TranspileState): Array<SourceNode | string>;
}

export type TranspileResult = Array<(string | SourceNode)>;

/**
 * @param srcPath The absolute path to the source file on disk
 */
export type FileResolver = (srcPath: string) => string | undefined | Thenable<string | undefined> | void;

export interface ExpressionInfo {
    expressions: Expression[];
    varExpressions: Expression[];
    uniqueVarNames: string[];
}

export type DiagnosticCode = number | string;

export interface FileLink<T> {
    item: T;
    file: BrsFile;
}

/**
 * Common interface to support Statements which define entities that have a member table
 * e.g. Class, Interface
 */
export interface MemberSymbolTableProvider extends SymbolContainer {
    buildSymbolTable(parent?: InheritableStatement): void;
    hasParent(): boolean;
    getPossibleFullParentNames(): string[];
    getName(parseMode: ParseMode): string;
    getThisBscType(): BscType;
}

export type InheritableStatement = ClassStatement | InterfaceStatement;

export type InheritableType = CustomType | InterfaceType;

/**
 * Options for the parser functionDeclaration() method
 */
export interface FunctionDeclarationParseOptions {
    /**
     * Function should have a name. Add a diagnostic if it is not there
     * False for for anonymous functions
     */
    hasName?: boolean;
    /**
     * Function should have a body. Add a diagnostic if it is not there
     * False for for functions defined in Interfaces
     */
    hasBody?: boolean;
    /**
    * Function should have an end token. Add a diagnostic if it is not there
    * False for for functions defined in Interfaces
    */
    hasEnd?: boolean;
    /**
     *This function is only callable as a member for a class or interface, etc.
     */
    onlyCallableAsMember?: boolean;
}
