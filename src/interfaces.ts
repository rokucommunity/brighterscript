import type { Range, Diagnostic, CodeAction, SemanticTokenTypes, SemanticTokenModifiers, Position, CompletionItem, Location } from 'vscode-languageserver';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { FunctionScope } from './FunctionScope';
import type { TypedFunctionType } from './types/TypedFunctionType';
import type { ParseMode } from './parser/Parser';
import type { Program } from './Program';
import type { ProgramBuilder } from './ProgramBuilder';
import type { ClassStatement, ConstStatement, EnumStatement, FunctionStatement, NamespaceStatement } from './parser/Statement';
import type { AstNode, Expression, Statement } from './parser/AstNode';
import type { TranspileState } from './parser/TranspileState';
import type { SourceNode } from 'source-map';
import type { BscType } from './types/BscType';
import type { Editor } from './astUtils/Editor';
import type { Identifier, Token } from './lexer/Token';
import type { BscFile } from './files/BscFile';
import type { FileFactory } from './files/Factory';
import type { LazyFileData } from './files/LazyFileData';
import type { SymbolTable } from './SymbolTable';
import type { SymbolTypeFlag } from './SymbolTableFlag';
import type { CallExpression } from './parser/Expression';
import { createToken } from './astUtils/creators';
import { TokenKind } from './lexer/TokenKind';

export interface BsDiagnostic extends Diagnostic {
    file: BscFile;
    /**
     * A generic data container where additional details of the diagnostic can be stored. These are stripped out before being sent to a languageclient, and not printed to the console.
     */
    data?: any;
}

export enum DiagnosticOrigin {
    Program = 'Program',
    Scope = 'Scope',
    File = 'File',
    ASTSegment = 'AstSegment'
}

export interface BsDiagnosticWithOrigin extends BsDiagnostic {
    origin: DiagnosticOrigin;
    astSegment?: AstNode;
}

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
    expression: CallExpression;
    functionScope: FunctionScope;
    file: BscFile;
    name: string;
    args: CallableArg[];
    nameRange: Range;
}

/**
 * An argument for an expression call.
 */
export interface CallableArg {
    text: string;
    type: BscType;
    typeToken: Token;
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
     * The destPath for the referenced file.
     */
    destPath: string;
    text: string;
    /**
     * The file that is doing the import. Note this is NOT the file the destPath points to.
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
    getType: () => BscType;
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
    /**
     * Called before a new program is created
     */
    beforeProgramCreate?: PluginHandler<BeforeProgramCreateEvent>;
    /**
     * Called after a new program is created
     */
    afterProgramCreate?: PluginHandler<AfterProgramCreateEvent>;


    /**
     * Called before the program gets prepared for building
     */
    beforePrepareProgram?: PluginHandler<BeforePrepareProgramEvent>;
    /**
     * Called when the program gets prepared for building
     */
    prepareProgram?: PluginHandler<PrepareProgramEvent>;
    /**
     * Called after the program gets prepared for building
     */
    afterPrepareProgram?: PluginHandler<AfterPrepareProgramEvent>;


    /**
     * Called before the entire program is validated
     */
    beforeProgramValidate?: PluginHandler<BeforeProgramValidateEvent>;
    /**
     * Called before the entire program is validated
     */
    onProgramValidate?: PluginHandler<OnProgramValidateEvent>;
    /**
     * Called after the program has been validated
     */
    afterProgramValidate?: PluginHandler<AfterProgramValidateEvent>;

    /**
     * Called right before the program is disposed/destroyed
     */
    beforeProgramDispose?: PluginHandler<BeforeProgramDisposeEvent>;

    /**
     * Emitted before the program starts collecting completions
     */
    beforeProvideCompletions?: PluginHandler<BeforeProvideCompletionsEvent>;
    /**
     * Use this event to contribute completions
     */
    provideCompletions?: PluginHandler<ProvideCompletionsEvent>;
    /**
     * Emitted after the program has finished collecting completions, but before they are sent to the client
     */
    afterProvideCompletions?: PluginHandler<AfterProvideCompletionsEvent>;


    /**
     * Called before the `provideHover` hook. Use this if you need to prepare any of the in-memory objects before the `provideHover` gets called
     */
    beforeProvideHover?: PluginHandler<BeforeProvideHoverEvent>;
    /**
     * Called when bsc looks for hover information. Use this if your plugin wants to contribute hover information.
     */
    provideHover?: PluginHandler<ProvideHoverEvent>;
    /**
     * Called after the `provideHover` hook. Use this if you want to intercept or sanitize the hover data (even from other plugins) before it gets sent to the client.
     */
    afterProvideHover?: PluginHandler<AfterProvideHoverEvent>;

    /**
     * Called after a scope was created
     */
    afterScopeCreate?: PluginHandler<AfterScopeCreateEvent>;

    beforeScopeDispose?: PluginHandler<BeforeScopeDisposeEvent>;
    onScopeDispose?: PluginHandler<OnScopeDisposeEvent>;
    afterScopeDispose?: PluginHandler<AfterScopeDisposeEvent>;

    beforeScopeValidate?: PluginHandler<BeforeScopeValidateEvent>;
    /**
     * Called before the `provideDefinition` hook
     */
    beforeProvideDefinition?(event: BeforeProvideDefinitionEvent): any;
    /**
     * Provide one or more `Location`s where the symbol at the given position was originally defined
     * @param event
     */
    provideDefinition?(event: ProvideDefinitionEvent): any;
    /**
     * Called after `provideDefinition`. Use this if you want to intercept or sanitize the definition data provided by bsc or other plugins
     * @param event
     */
    afterProvideDefinition?(event: AfterProvideDefinitionEvent): any;

    //scope events
    onScopeValidate?: PluginHandler<OnScopeValidateEvent>;
    afterScopeValidate?: PluginHandler<BeforeScopeValidateEvent>;

    onGetCodeActions?: PluginHandler<OnGetCodeActionsEvent>;
    onGetSemanticTokens?: PluginHandler<OnGetSemanticTokensEvent>;


    /**
     * Called before plugins are asked to provide files to the program. (excludes virtual files produced by `provideFile` events).
     * Call the `setFileData()` method to override the file contents.
     */
    beforeProvideFile?: PluginHandler<BeforeProvideFileEvent>;
    /**
     * Give plugins the opportunity to handle processing a file. (excludes virtual files produced by `provideFile` events)
     */
    provideFile?: PluginHandler<ProvideFileEvent>;
    /**
     * Called after a file was added to the program. (excludes virtual files produced by `provideFile` events)
     */
    afterProvideFile?: PluginHandler<AfterProvideFileEvent>;


    /**
     * Called before a file is added to the program.
     * Includes physical files as well as any virtual files produced by `provideFile` events
     */
    beforeFileAdd?: PluginHandler<BeforeFileAddEvent>;
    /**
     * Called after a file has been added to the program.
     * Includes physical files as well as any virtual files produced by `provideFile` events
     */
    afterFileAdd?: PluginHandler<AfterFileAddEvent>;

    /**
     * Called before a file is removed from the program. This includes physical and virtual files
     */
    beforeFileRemove?: PluginHandler<BeforeFileRemoveEvent>;
    /**
     * Called after a file has been removed from the program. This includes physical and virtual files
     */
    afterFileRemove?: PluginHandler<AfterFileRemoveEvent>;


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


    /**
     * Called right before the program builds (i.e. generates the code and puts it in the stagingDir
     */
    beforeBuildProgram?: PluginHandler<BeforeBuildProgramEvent>;
    /**
     * Called right after the program builds (i.e. generates the code and puts it in the stagingDir
     */
    afterBuildProgram?: PluginHandler<AfterBuildProgramEvent>;


    /**
     * Before preparing the file for building
     */
    beforePrepareFile?: PluginHandler<BeforePrepareFileEvent>;
    /**
     * Prepare the file for building
     */
    prepareFile?: PluginHandler<PrepareFileEvent>;
    /**
     * After preparing the file for building
     */
    afterPrepareFile?: PluginHandler<AfterPrepareFileEvent>;


    /**
     * Before the program turns all file objects into their final buffers
     */
    beforeSerializeProgram?: PluginHandler<BeforeSerializeProgramEvent>;
    /**
     * Emitted right at the start of the program turning all file objects into their final buffers
     */
    onSerializeProgram?: PluginHandler<OnSerializeProgramEvent>;
    /**
     * After the program turns all file objects into their final buffers
     */
    afterSerializeProgram?: PluginHandler<AfterSerializeProgramEvent>;


    /**
     * Before turning the file into its final contents
     */
    beforeSerializeFile?: PluginHandler<BeforeSerializeFileEvent>;
    /**
     * Turn the file into its final contents (i.e. transpile a bs file, compress a jpeg, etc)
     */
    serializeFile?: PluginHandler<SerializeFileEvent>;
    /**
     * After turning the file into its final contents
     */
    afterSerializeFile?: PluginHandler<AfterSerializeFileEvent>;


    /**
     * Called before any files are written
     */
    beforeWriteProgram?: PluginHandler<BeforeWriteProgramEvent>;
    /**
     * Called after all files are written
     */
    afterWriteProgram?: PluginHandler<AfterWriteProgramEvent>;


    /**
     * Before a file is written to disk. These are raw files that contain the final output. One `File` may produce several of these
     */
    beforeWriteFile?: PluginHandler<BeforeWriteFileEvent>;
    /**
     * Called when a file should be persisted (usually writing to storage). These are raw files that contain the final output. One `File` may produce several of these.
     * When a plugin has handled a file, it should be pushed to the `handledFiles` set so future plugins don't write the file multiple times
     */
    writeFile?: PluginHandler<WriteFileEvent>;
    /**
     * Before a file is written to disk. These are raw files that contain the final output. One `File` may produce several of these
     */
    afterWriteFile?: PluginHandler<AfterWriteFileEvent>;
}
export type PluginHandler<T, R = void> = (event: T) => R;

export interface OnGetCodeActionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}

export interface BeforeProgramCreateEvent {
    builder: ProgramBuilder;
}
export interface AfterProgramCreateEvent {
    builder: ProgramBuilder;
    program: Program;
}

export interface BeforeProgramValidateEvent {
    program: Program;
}
export type OnProgramValidateEvent = BeforeProgramValidateEvent;
export type AfterProgramValidateEvent = BeforeProgramValidateEvent;


export interface ProvideCompletionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    scopes: Scope[];
    position: Position;
    completions: CompletionItem[];
}
export type BeforeProvideCompletionsEvent<TFile extends BscFile = BscFile> = ProvideCompletionsEvent<TFile>;
export type AfterProvideCompletionsEvent<TFile extends BscFile = BscFile> = ProvideCompletionsEvent<TFile>;

export interface BeforeBuildProgramEvent {
    program: Program;
    files: BscFile[];
    editor: Editor;
}
export type AfterBuildProgramEvent = BeforeBuildProgramEvent;

export interface ProvideHoverEvent {
    program: Program;
    file: BscFile;
    position: Position;
    scopes: Scope[];
    hovers: Hover[];
}
export interface Hover {
    /**
     * The contents of the hover, written in markdown. If you want to display code in the hover, use code blocks, like this:
     * ```text
     *      ```brighterscript
     *      some = "code" + "here"
     *      ```
     * ```
     */
    contents: string | string[];
    /**
     * An optional range
     */
    range?: Range;
}
export type BeforeProvideHoverEvent = ProvideHoverEvent;
export type AfterProvideHoverEvent = ProvideHoverEvent;

export interface AfterScopeCreateEvent {
    program: Program;
    scope: Scope;
}
export interface BeforeScopeDisposeEvent {
    program: Program;
    scope: Scope;
}
export interface OnScopeDisposeEvent {
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
export type AfterScopeValidateEvent = BeforeScopeValidateEvent;

export interface BeforeFileParseEvent {
    program: Program;
    srcPath: string;
    source: string;
}
export interface OnFileParseEvent {
    program: Program;
    srcPath: string;
    source: string;
}
export interface AfterFileParseEvent {
    program: Program;
    file: BscFile;
}
export interface ProvideDefinitionEvent<TFile = BscFile> {
    program: Program;
    /**
     * The file that the getDefinition request was invoked in
     */
    file: TFile;
    /**
     * The position in the text document where the getDefinition request was invoked
     */
    position: Position;
    /**
     * The list of locations for where the item at the file and position was defined
     */
    definitions: Location[];
}
export type BeforeProvideDefinitionEvent<TFile = BscFile> = ProvideDefinitionEvent<TFile>;
export type AfterProvideDefinitionEvent<TFile = BscFile> = ProvideDefinitionEvent<TFile>;


export interface OnGetSemanticTokensEvent<T extends BscFile = BscFile> {
    /**
     * The program this file is from
     */
    program: Program;
    /**
     * The file to get semantic tokens for
     */
    file: T;
    /**
     * The list of scopes that this file is a member of
     */
    scopes: Scope[];
    /**
     * The list of semantic tokens being produced during this event.
     */
    semanticTokens: SemanticToken[];
}

export type BeforeFileValidateEvent = OnFileValidateEvent;
export interface OnFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}
export type AfterFileValidateEvent = OnFileValidateEvent;

export interface OnFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}
export interface TranspileEntry {
    file: BscFile;
    outputPath: string;
}

export interface ScopeValidationOptions {
    changedFiles?: BscFile[];
    changedSymbols?: Map<SymbolTypeFlag, Set<string>>;
    force?: boolean;
}

export interface OnScopeValidateEvent {
    program: Program;
    scope: Scope;
    changedFiles?: BscFile[];
    changedSymbols?: Map<SymbolTypeFlag, Set<string>>;
}

export interface AfterFileTranspileEvent<TFile extends BscFile = BscFile> {
    /**
     * The program this event was triggered for
     */
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
    map?: string;
    /**
     * The generated type definition file contents (if emitting type definitions are enabled)
     */
    typedef?: string;
}

export type BeforeProvideFileEvent<TFile extends BscFile = BscFile> = ProvideFileEvent<TFile>;
export interface ProvideFileEvent<TFile extends BscFile = BscFile> {
    /**
     * The lower-case file extension for the srcPath. (i.e. ".brs", ".xml")
     */
    srcExtension: string;
    /**
     * The srcPath for the file. (i.e. `/user/bob/projects/VideoApp/source/main.bs`)
     */
    srcPath: string;
    /**
     * The destPath for the file. (i.e. for `/user/bob/projects/VideoApp/source/main.bs`, destPath would be `source/main.bs`)
     */
    destPath: string;

    /**
     * A lazy-loading container for this file's data. Call `.get()` to lazy load the data, and `.set()` to override file contents
     */
    data: LazyFileData;

    /**
     * An array of files that should be added to the program as a result of this event
     */
    files: TFile[];
    /**
     * The program for this event
     */
    program: Program;
    /**
     * A factory used to create new instances of the BrighterScript built-in file types. This mitigates the issue
     * of a plugin's version of a File not being the same as the LanguageServer or CLI version of BrighterScript
     * (due to npm installing multiple versions of brighterscript)
     */
    fileFactory: FileFactory;
}
export type AfterProvideFileEvent<TFile extends BscFile = BscFile> = ProvideFileEvent<TFile>;

export interface BeforeFileAddEvent<TFile extends BscFile = BscFile> {
    file: TFile;
    program: Program;
}
export type AfterFileAddEvent<TFile extends BscFile = BscFile> = BeforeFileAddEvent<TFile>;

export interface BeforeFileRemoveEvent<TFile extends BscFile = BscFile> {
    file: TFile;
    program: Program;
}
export type AfterFileRemoveEvent<TFile extends BscFile = BscFile> = BeforeFileRemoveEvent<TFile>;

export type BeforePrepareProgramEvent = PrepareProgramEvent;
/**
 * Event for when the program prepares itself for building
 */
export interface PrepareProgramEvent {
    program: Program;
    editor: Editor;
}
export type AfterPrepareProgramEvent = PrepareProgramEvent;


export type BeforePrepareFileEvent<TFile extends BscFile = BscFile> = PrepareFileEvent<TFile>;
/**
 * Prepare the file for building
 */
export interface PrepareFileEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    editor: Editor;
}
export type OnPrepareFileEvent<TFile extends BscFile = BscFile> = PrepareFileEvent<TFile>;
export type AfterPrepareFileEvent<TFile extends BscFile = BscFile> = PrepareFileEvent<TFile>;


/**
 * A container that holds the code, map, and typedef for serialized code files.
 */
export interface SerializedCodeFile {
    code?: string;
    map?: string;
    typedef?: string;
}

export interface BeforeSerializeProgramEvent {
    program: Program;
    files: BscFile[];
    result: Map<BscFile, SerializedFile[]>;
}
export type OnSerializeProgramEvent = BeforeSerializeProgramEvent;
export type AfterSerializeProgramEvent = BeforeSerializeProgramEvent;

/**
 * During the `SerializeFile` events, this is how plugins will contribute file data for a specific file
 */
export interface SerializedFile {
    /**
     * The raw data for this file (i.e. a binary buffer for a .jpeg file, or the transpiled code for a .bs file)
     */
    data: Buffer;
    /**
     * The pkgPath for this chunk of data.
     */
    pkgPath: string;
}

export type BeforeSerializeFileEvent<TFile extends BscFile = BscFile> = SerializeFileEvent<TFile>;
export interface SerializeFileEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    /**
     * The list of all files created across all the `SerializeFile` events.
     * The key is the pkgPath of the file, and the
     */
    result: Map<TFile, SerializedFile[]>;
}
export type AfterSerializeFileEvent<TFile extends BscFile = BscFile> = SerializeFileEvent<TFile>;


export interface BeforeWriteProgramEvent {
    program: Program;
    stagingDir: string;
    files: Map<BscFile, SerializedFile[]>;
}
export type AfterWriteProgramEvent = BeforeWriteProgramEvent;


export type BeforeWriteFileEvent = WriteFileEvent;
export interface WriteFileEvent {
    program: Program;
    file: SerializedFile;
    /**
     * The full path to where the file was (or will be) written to.
     */
    outputPath: string;
    /**
     * A set of all files that have been properly written. Plugins should add any handled files to this list so future plugins don't write then again
     */
    processedFiles: Set<SerializedFile>;
}
export type AfterWriteFileEvent = BeforeWriteFileEvent;

export interface TranspileObj {
    file: BscFile;
    /**
     * The absolute path to where the file should be written during build. (i.e. somewhere inside the stagingDir)
     */
    outputPath: string;
}

export interface BeforeFileDisposeEvent {
    program: Program;
    file: BscFile;
}
export type AfterFileDisposeEvent = BeforeFileDisposeEvent;
export interface BeforeProgramDisposeEvent {
    program: Program;
}

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

export type FileResolver = (srcPath: string) => string | Buffer | undefined | Thenable<string | Buffer | undefined> | void;

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

export interface ExtraSymbolData {
    definingNode?: AstNode;
    description?: string;
    completionPriority?: number; // the higher the number, the lower the priority
    flags?: SymbolTypeFlag;
    memberOfAncestor?: boolean; // this symbol comes from an ancestor symbol table
}

export interface GetTypeOptions {
    flags: SymbolTypeFlag;
    typeChain?: TypeChainEntry[];
    data?: ExtraSymbolData;
    ignoreCall?: boolean; // get the type of this expression, NOT it's return type
    onlyCacheResolvedTypes?: boolean;
    ignoreCacheForRetrieval?: boolean;
}

export class TypeChainEntry {
    public data: ExtraSymbolData;
    constructor(public name: string, public type: BscType, data: ExtraSymbolData, public range: Range, public separatorToken: Token = createToken(TokenKind.Dot)) {
        if (data) {
            // make a copy of this data
            this.data = { ...data };
        }
    }
    get isResolved() {
        return this.type?.isResolvable();
    }
}

export interface TypeChainProcessResult {
    itemName: string;
    itemParentTypeName: string;
    fullNameOfItem: string;
    fullChainName: string;
    range: Range;
    containsDynamic: boolean;
}

export interface TypeCompatibilityData {
    missingFields?: { name: string; expectedType: BscType }[];
    fieldMismatches?: { name: string; expectedType: BscType; actualType: BscType }[];
    depth?: number;
}

export interface NamespaceContainer {
    file: BscFile;
    fullName: string;
    fullNameLower: string;
    parentNameLower: string;
    nameParts: Identifier[];
    nameRange: Range;
    lastPartName: string;
    lastPartNameLower: string;
    functionStatements: Map<string, FunctionStatement>;
    isTopLevel: boolean;
    namespaceStatements?: NamespaceStatement[];
    statements?: Statement[];
    classStatements?: Map<string, ClassStatement>;
    enumStatements?: Map<string, EnumStatement>;
    constStatements?: Map<string, ConstStatement>;
    namespaces?: Map<string, NamespaceContainer>;
    symbolTable: SymbolTable;
}
