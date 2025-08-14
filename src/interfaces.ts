import type { Range, CodeAction, Position, CompletionItem, Location, DocumentSymbol, WorkspaceSymbol, Disposable, FileChangeType, CodeDescription, DiagnosticRelatedInformation, DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver-protocol';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { TypedFunctionType } from './types/TypedFunctionType';
import type { ParseMode } from './parser/Parser';
import type { Program } from './Program';
import type { ProgramBuilder } from './ProgramBuilder';
import type { FunctionStatement, NamespaceStatement } from './parser/Statement';
import type { AstNode, Expression } from './parser/AstNode';
import type { TranspileState } from './parser/TranspileState';
import type { SourceNode } from 'source-map';
import type { BscType } from './types/BscType';
import type { Identifier, Token } from './lexer/Token';
import type { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver';
import type { SymbolTable } from './SymbolTable';
import type { SymbolTypeFlag } from './SymbolTypeFlag';
import type { Editor } from './astUtils/Editor';
import type { BscFile } from './files/BscFile';
import type { FileFactory } from './files/Factory';
import type { LazyFileData } from './files/LazyFileData';
import { TokenKind } from './lexer/TokenKind';
import type { BscTypeKind } from './types/BscTypeKind';
import { createToken } from './astUtils/creators';

export interface BsDiagnostic {
    /**
     * The location at which the message applies
     */
    location: Location;
    /**
     * The diagnostic's severity. Can be omitted. If omitted it is up to the
     * client to interpret diagnostics as error, warning, info or hint.
     */
    severity?: DiagnosticSeverity;
    /**
     * The diagnostic's code, which usually appear in the user interface.
     */
    code?: number | string;
    /**
     * An optional property to describe the error code.
     * Requires the code field (above) to be present/not null.
     *
     * @since 3.16.0
     */
    codeDescription?: CodeDescription;
    /**
     * A human-readable string describing the source of this
     * diagnostic, e.g. 'typescript' or 'super lint'. It usually
     * appears in the user interface.
     */
    source?: string;
    /**
     * The diagnostic's message. It usually appears in the user interface
     */
    message: string;
    /**
     * Additional metadata about the diagnostic.
     *
     * @since 3.15.0
     */
    tags?: DiagnosticTag[];
    /**
     * An array of related diagnostic information, e.g. when symbol-names within
     * a scope collide all definitions can be marked via this property.
     */
    relatedInformation?: DiagnosticRelatedInformation[];
    /**
     * A data entry field that is preserved between a `textDocument/publishDiagnostics`
     * notification and `textDocument/codeAction` request.
     *
     * @since 3.16.0
     */
    data?: any;

    /**
     * The code used for this diagnostic in v0
     */
    legacyCode?: number | string;
}

export interface DiagnosticContext {
    scopeSpecific?: boolean;
    scope?: Scope;
    tags?: string[];
    segment?: AstNode;
}

export interface DiagnosticContextPair {
    diagnostic: BsDiagnostic;
    context?: DiagnosticContext;
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

export interface PluginFactoryOptions {
    /**
     * What version of brighterscript is activating this plugin? (Useful for picking different plugins or behavior based on the version of brighterscript)
     */
    version: string;
}
export type PluginFactory = (options?: PluginFactoryOptions) => Plugin;
/**
 * @deprecated use `PluginFactory` instead
 */
export type CompilerPluginFactory = PluginFactory;

/**
 * @deprecated use `Plugin` instead
 */
export type CompilerPlugin = Plugin;

export interface Plugin {
    name: string;
    /**
     * Called before a new program is created
     */
    beforeProvideProgram?(event: BeforeProvideProgramEvent): any;
    provideProgram?(event: ProvideProgramEvent): any;
    /**
     * Called after a new program is created
     */
    afterProvideProgram?(event: AfterProvideProgramEvent): any;


    /**
     * Called before the program gets prepared for building
     */
    beforePrepareProgram?(event: BeforePrepareProgramEvent): any;
    /**
     * Called when the program gets prepared for building
     */
    prepareProgram?(event: PrepareProgramEvent): any;
    /**
     * Called after the program gets prepared for building
     */
    afterPrepareProgram?(event: AfterPrepareProgramEvent): any;


    /**
     * Called before the entire program is validated
     */
    beforeValidateProgram?(event: BeforeValidateProgramEvent): any;
    /**
     * Called before the entire program is validated
     */
    validateProgram?(event: ValidateProgramEvent): any;
    /**
     * Called after the program has been validated
     */
    afterValidateProgram?(event: AfterValidateProgramEvent): any;

    /**
     * Called right before the program is disposed/destroyed
     */
    beforeDisposeProgram?(event: BeforeDisposeProgramEvent): any;
    disposeProgram?(event: DisposeProgramEvent): any;
    afterDisposeProgram?(event: AfterDisposeProgramEvent): any;

    /**
     * Emitted before the program starts collecting completions
     */
    beforeProvideCompletions?(event: BeforeProvideCompletionsEvent): any;
    /**
     * Use this event to contribute completions
     */
    provideCompletions?(event: ProvideCompletionsEvent): any;
    /**
     * Emitted after the program has finished collecting completions, but before they are sent to the client
     */
    afterProvideCompletions?(event: AfterProvideCompletionsEvent): any;


    /**
     * Called before the `provideHover` hook. Use this if you need to prepare any of the in-memory objects before the `provideHover` gets called
     */
    beforeProvideHover?(event: BeforeProvideHoverEvent): any;
    /**
     * Called when bsc looks for hover information. Use this if your plugin wants to contribute hover information.
     */
    provideHover?(event: ProvideHoverEvent): any;
    /**
     * Called after the `provideHover` hook. Use this if you want to intercept or sanitize the hover data (even from other plugins) before it gets sent to the client.
     */
    afterProvideHover?(event: AfterProvideHoverEvent): any;

    /**
     * Called after a scope was created
     */
    beforeProvideScope?(event: BeforeProvideScopeEvent): any;
    provideScope?(event: ProvideScopeEvent): any;
    afterProvideScope?(event: AfterProvideScopeEvent): any;

    beforeDisposeScope?(event: BeforeDisposeScopeEvent): any;
    disposeScope?(event: DisposeScopeEvent): any;
    afterDisposeScope?(event: AfterDisposeScopeEvent): any;

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

    /**
     * Called before the `provideReferences` hook
     */
    beforeProvideReferences?(event: BeforeProvideReferencesEvent): any;
    /**
     * Provide all of the `Location`s where the symbol at the given position is located
     * @param event
     */
    provideReferences?(event: ProvideReferencesEvent): any;
    /**
     * Called after `provideReferences`. Use this if you want to intercept or sanitize the references data provided by bsc or other plugins
     * @param event
     */
    afterProvideReferences?(event: AfterProvideReferencesEvent): any;


    /**
     * Called before the `provideDocumentSymbols` hook
     */
    beforeProvideDocumentSymbols?(event: BeforeProvideDocumentSymbolsEvent): any;
    /**
     * Provide all of the `DocumentSymbol`s for the given file
     * @param event
     */
    provideDocumentSymbols?(event: ProvideDocumentSymbolsEvent): any;
    /**
     * Called after `provideDocumentSymbols`. Use this if you want to intercept or sanitize the document symbols data provided by bsc or other plugins
     * @param event
     */
    afterProvideDocumentSymbols?(event: AfterProvideDocumentSymbolsEvent): any;


    /**
     * Called before the `provideWorkspaceSymbols` hook
     */
    beforeProvideWorkspaceSymbols?(event: BeforeProvideWorkspaceSymbolsEvent): any;
    /**
     * Provide all of the workspace symbols for the entire project
     * @param event
     */
    provideWorkspaceSymbols?(event: ProvideWorkspaceSymbolsEvent): any;
    /**
     * Called after `provideWorkspaceSymbols`. Use this if you want to intercept or sanitize the workspace symbols data provided by bsc or other plugins
     * @param event
     */
    afterProvideWorkspaceSymbols?(event: AfterProvideWorkspaceSymbolsEvent): any;

    //scope events
    beforeValidateScope?(event: BeforeValidateScopeEvent): any;
    validateScope?(event: ValidateScopeEvent): any;
    afterValidateScope?(event: AfterValidateScopeEvent): any;

    beforeProvideCodeActions?(event: BeforeProvideCodeActionsEvent): any;
    provideCodeActions?(event: ProvideCodeActionsEvent): any;
    afterProvideCodeActions?(event: AfterProvideCodeActionsEvent): any;

    beforeProvideSemanticTokens?(event: BeforeProvideSemanticTokensEvent): any;
    provideSemanticTokens?(event: ProvideSemanticTokensEvent): any;
    afterProvideSemanticTokens?(event: AfterProvideSemanticTokensEvent): any;


    /**
     * Called before plugins are asked to provide files to the program. (excludes virtual files produced by `provideFile` events).
     * Call the `setFileData()` method to override the file contents.
     */
    beforeProvideFile?(event: BeforeProvideFileEvent): any;
    /**
     * Give plugins the opportunity to handle processing a file. (excludes virtual files produced by `provideFile` events)
     */
    provideFile?(event: ProvideFileEvent): any;
    /**
     * Called after a file was added to the program. (excludes virtual files produced by `provideFile` events)
     */
    afterProvideFile?(event: AfterProvideFileEvent): any;


    /**
     * Called before a file is added to the program.
     * Includes physical files as well as any virtual files produced by `provideFile` events
     */
    beforeAddFile?(event: BeforeAddFileEvent): any;
    /**
     * Called after a file has been added to the program.
     * Includes physical files as well as any virtual files produced by `provideFile` events
     */
    afterAddFile?(event: AfterAddFileEvent): any;

    /**
     * Called before a file is removed from the program. This includes physical and virtual files
     */
    beforeRemoveFile?(event: BeforeRemoveFileEvent): any;
    /**
     * Called after a file has been removed from the program. This includes physical and virtual files
     */
    afterRemoveFile?(event: AfterRemoveFileEvent): any;


    /**
     * Called before each file is validated
     */
    beforeValidateFile?(event: BeforeValidateFileEvent): any;
    /**
     * Called during the file validation process. If your plugin contributes file validations, this is a good place to contribute them.
     */
    validateFile?(event: ValidateFileEvent): any;
    /**
     * Called after each file is validated
     */
    afterValidateFile?(event: AfterValidateFileEvent): any;


    /**
     * Called right before the program builds (i.e. generates the code and puts it in the stagingDir
     */
    beforeBuildProgram?(event: BeforeBuildProgramEvent): any;
    /**
     * Called right after the program builds (i.e. generates the code and puts it in the stagingDir
     */
    afterBuildProgram?(event: AfterBuildProgramEvent): any;


    /**
     * Before preparing the file for building
     */
    beforePrepareFile?(event: BeforePrepareFileEvent): any;
    /**
     * Prepare the file for building
     */
    prepareFile?(event: PrepareFileEvent): any;
    /**
     * After preparing the file for building
     */
    afterPrepareFile?(event: AfterPrepareFileEvent): any;


    /**
     * Before the program turns all file objects into their final buffers
     */
    beforeSerializeProgram?(event: BeforeSerializeProgramEvent): any;
    /**
     * Emitted right at the start of the program turning all file objects into their final buffers
     */
    serializeProgram?(event: SerializeProgramEvent): any;
    /**
     * After the program turns all file objects into their final buffers
     */
    afterSerializeProgram?(event: AfterSerializeProgramEvent): any;


    /**
     * Before turning the file into its final contents
     */
    beforeSerializeFile?(event: BeforeSerializeFileEvent): any;
    /**
     * Turn the file into its final contents (i.e. transpile a bs file, compress a jpeg, etc)
     */
    serializeFile?(event: SerializeFileEvent): any;
    /**
     * After turning the file into its final contents
     */
    afterSerializeFile?(event: AfterSerializeFileEvent): any;


    /**
     * Called before any files are written
     */
    beforeWriteProgram?(event: BeforeWriteProgramEvent): any;
    /**
     * Called after all files are written
     */
    afterWriteProgram?(event: AfterWriteProgramEvent): any;


    /**
     * Before a file is written to disk. These are raw files that contain the final output. One `File` may produce several of these
     */
    beforeWriteFile?(event: BeforeWriteFileEvent): any;
    /**
     * Called when a file should be persisted (usually writing to storage). These are raw files that contain the final output. One `File` may produce several of these.
     * When a plugin has handled a file, it should be pushed to the `handledFiles` set so future plugins don't write the file multiple times
     */
    writeFile?(event: WriteFileEvent): any;
    /**
     * Before a file is written to disk. These are raw files that contain the final output. One `File` may produce several of these
     */
    afterWriteFile?(event: AfterWriteFileEvent): any;
}
export interface BeforeProvideCodeActionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}
export interface ProvideCodeActionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}
export interface AfterProvideCodeActionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}

export interface BeforeProvideProgramEvent {
    builder: ProgramBuilder;
    program?: Program;
}
export interface ProvideProgramEvent {
    builder: ProgramBuilder;
    program?: Program;
}
export interface AfterProvideProgramEvent {
    builder: ProgramBuilder;
    program: Program;
}

export interface BeforeValidateProgramEvent {
    program: Program;
}
export type ValidateProgramEvent = BeforeValidateProgramEvent;
export interface AfterValidateProgramEvent extends BeforeValidateProgramEvent {
    /**
     * Was the validation cancelled? Will be false if the validation was completed
     */
    wasCancelled: boolean;
}


export interface ProvideCompletionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    /**
     * The scopes this file is a member of. If the file is a member of no scopes, this will be an empty array.
     * Plugins can use `event.program.globalScope` if the file is not a member of any scopes
     */
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

export interface BeforeProvideScopeEvent {
    program: Program;
    scope: Scope;
}
export interface ProvideScopeEvent {
    program: Program;
    scope: Scope;
}
export interface AfterProvideScopeEvent {
    program: Program;
    scope: Scope;
}
export interface BeforeDisposeScopeEvent {
    program: Program;
    scope: Scope;
}
export interface DisposeScopeEvent {
    program: Program;
    scope: Scope;
}
export interface AfterDisposeScopeEvent {
    program: Program;
    scope: Scope;
}
export interface BeforeValidateScopeEvent {
    program: Program;
    scope: Scope;
}
export type AfterValidateScopeEvent = BeforeValidateScopeEvent;

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

export interface ProvideReferencesEvent<TFile = BscFile> {
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
    references: Location[];
}
export type BeforeProvideReferencesEvent<TFile = BscFile> = ProvideReferencesEvent<TFile>;
export type AfterProvideReferencesEvent<TFile = BscFile> = ProvideReferencesEvent<TFile>;


export interface ProvideDocumentSymbolsEvent<TFile = BscFile> {
    program: Program;
    /**
     * The file that the `documentSymbol` request was invoked in
     */
    file: TFile;
    /**
     * The result list of symbols
     */
    documentSymbols: DocumentSymbol[];
}
export type BeforeProvideDocumentSymbolsEvent<TFile = BscFile> = ProvideDocumentSymbolsEvent<TFile>;
export type AfterProvideDocumentSymbolsEvent<TFile = BscFile> = ProvideDocumentSymbolsEvent<TFile>;


export interface ProvideWorkspaceSymbolsEvent {
    program: Program;
    /**
     * The result list of symbols
     */
    workspaceSymbols: WorkspaceSymbol[];
}
export type BeforeProvideWorkspaceSymbolsEvent = ProvideWorkspaceSymbolsEvent;
export type AfterProvideWorkspaceSymbolsEvent = ProvideWorkspaceSymbolsEvent;


export interface BeforeProvideSemanticTokensEvent<T extends BscFile = BscFile> {
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
export interface ProvideSemanticTokensEvent<T extends BscFile = BscFile> {
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
export interface AfterProvideSemanticTokensEvent<T extends BscFile = BscFile> {
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

export type BeforeValidateFileEvent = ValidateFileEvent;
export interface ValidateFileEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}
export type AfterValidateFileEvent<T extends BscFile = BscFile> = ValidateFileEvent;

export interface ValidateFileEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}
export interface TranspileEntry {
    file: BscFile;
    outputPath: string;
}


export interface ScopeValidationOptions {
    filesToBeValidatedInScopeContext?: Set<BscFile>;
    changedSymbols?: Map<SymbolTypeFlag, Set<string>>;
    changedFiles?: BscFile[];
    force?: boolean;
    initialValidation?: boolean;
}

export interface ValidateScopeEvent {
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

export interface BeforeAddFileEvent<TFile extends BscFile = BscFile> {
    file: TFile;
    program: Program;
}
export type AfterAddFileEvent<TFile extends BscFile = BscFile> = BeforeAddFileEvent<TFile>;

export interface BeforeRemoveFileEvent<TFile extends BscFile = BscFile> {
    file: TFile;
    program: Program;
}
export type AfterRemoveFileEvent<TFile extends BscFile = BscFile> = BeforeRemoveFileEvent<TFile>;

export type BeforePrepareProgramEvent = PrepareProgramEvent;
/**
 * Event for when the program prepares itself for building
 */
export interface PrepareProgramEvent {
    program: Program;
    editor: Editor;
    files: BscFile[];
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
    /**
     * The scope that was linked for this event. A file may be included in multiple scopes, but we choose the most relevant scope.
     * Plugins may unlink this scope and link another one, but must then reassign this property to that new scope so that other
     * plugins can reference it.
     */
    scope: Scope;
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
export type SerializeProgramEvent = BeforeSerializeProgramEvent;
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
     * The scope that was linked for this event. A file may be included in multiple scopes, but we choose the most relevant scope.
     * Plugins may unlink this scope and link another one, but must then reassign this property to that new scope so that other
     * plugins can reference it.
     */
    scope: Scope;
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
export interface BeforeDisposeProgramEvent {
    program: Program;
}
export interface DisposeProgramEvent {
    program: Program;
}
export interface AfterDisposeProgramEvent {
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
    getTypedef(state: TranspileState): TranspileResult;
}

export type TranspileResult = Array<(string | SourceNode | TranspileResult)>;

/**
 * This is the type that the SourceNode class is declared as taking in its constructor.
 * The actual type that SourceNode accepts is the more permissive TranspileResult, but
 * we need to use this declared type for some type casts.
 */
export type FlattenedTranspileResult = Array<string | SourceNode>;

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
    /**
     * What AST node defined this symbol?
     */
    definingNode?: AstNode;
    /**
     * Description of this symbol
     */
    description?: string;
    /**
     * the higher the number, the lower the priority
     */
    completionPriority?: number;
    /**
     * Flags for this symbol
     */
    flags?: SymbolTypeFlag;
    /**
     * this symbol comes from an ancestor symbol table
     */
    memberOfAncestor?: boolean;
    /**
     * Do not merge this symbol when merging symbol tables
     */
    doNotMerge?: boolean;
    /**
     * is this symbol an alias?
     */
    isAlias?: boolean;
    /**
     * Is this symbol an instance of the type.
     *
     * `true` means `true`, and `false` or `undefined` means `false`,
     *
     * so check for `=== true` or `!== true`
     */
    isInstance?: boolean;
    /**
     * Is this type as defined in a doc comment?
     */
    isFromDocComment?: boolean;
    /**
     * Is this symbol built in to Brightscript?
     */
    isBuiltIn?: boolean;
    /**
     * Was this a result of a callfunc?
     */
    isFromCallFunc?: boolean;
    /**
     * Some symbols can be used in the same node they are defined in
     * For example, loop variables in for loops
     */
    canUseInDefinedAstNode?: boolean;
}

export interface GetTypeOptions {
    flags: SymbolTypeFlag;
    typeChain?: TypeChainEntry[];
    data?: ExtraSymbolData;
    /**
     * get the type of this expression, NOT its return type
     */
    ignoreCall?: boolean;
    onlyCacheResolvedTypes?: boolean;
    ignoreCacheForRetrieval?: boolean;
    isExistenceTest?: boolean;
    preferDocType?: boolean;
    /**
     * For narrowing the type, which statement are we concerned with in the current block?
     */
    statementIndex?: number | 'end';
    ignoreParentTables?: boolean;
}

export class TypeChainEntry {
    constructor(options: {
        name: string;
        type: BscType;
        data: ExtraSymbolData;
        location?: Location;
        separatorToken?: Token;
        astNode: AstNode;
    }) {
        this.name = options.name;
        // make a copy of this data
        this.data = { ...options.data };
        this.type = options.type;
        this._location = options.location;
        this.separatorToken = options.separatorToken ?? createToken(TokenKind.Dot);
        this.astNode = options.astNode;
        this.isResolved = this.type?.isResolvable();
    }

    get location(): Location {
        return this._location ?? this.astNode?.location;
    }

    public readonly name: string;
    public readonly type: BscType;
    public readonly data: ExtraSymbolData;
    private readonly _location: Location;
    public readonly separatorToken: Token;
    public isResolved: boolean;
    public astNode: AstNode;
}

export interface TypeChainProcessResult {
    /**
     * The name of the last item in the chain, OR the first unresolved item in the chain
     */
    itemName: string;
    /**
     * The TypeKind of the item of `itemName`
     */
    itemTypeKind: BscTypeKind | string;
    /**
     * The name of the parent of the item of `itemName`
     */
    itemParentTypeName: string;
    /**
     * The TypeKind of the parent of the item of `itemName`
     */
    itemParentTypeKind: BscTypeKind | string;
    /**
     * The complete chain leading up to the item of `itemName`
     */
    fullNameOfItem: string;
    /**
     * The complete chain (even including unresolved items)
     */
    fullChainName: string;
    /**
     * the range of the first unresolved item
     */
    location: Location;
    /**
     * Does the chain contain a dynamic type?
     */
    containsDynamic: boolean;
    /**
     * The AstNode of the item
     */
    astNode: AstNode;
    /**
     * Does the chain contain a type that crossed a callFunc boundary?
     */
    crossedCallFunc: boolean;
}

export interface TypeCompatibilityData {
    missingFields?: { name: string; expectedType: BscType }[];
    fieldMismatches?: { name: string; expectedType: BscType; actualType: BscType }[];
    parameterMismatches?: { index: number; expectedOptional?: boolean; actualOptional?: boolean; data: TypeCompatibilityData }[];
    returnTypeMismatch?: TypeCompatibilityData;
    expectedParamCount?: number;
    actualParamCount?: number;
    expectedVariadic?: boolean;
    actualVariadic?: boolean;
    depth?: number;
    // override for diagnostic message - useful for Arrays with different default types
    actualType?: BscType;
    expectedType?: BscType;
    allowNameEquality?: boolean;
    unresolveableTarget?: string;
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
    isTopLevel: boolean;
    namespaceStatements?: NamespaceStatement[];
    symbolTable: SymbolTable;
}

export interface ScopeNamespaceContainer {
    namespaceContainers: NamespaceContainer[];
    symbolTable: SymbolTable;
    firstInstance: NamespaceContainer;
}

/**
 * Use Writable<T> to remove readonly flag from properties in T
 * Be careful!
 */
export type Writeable<T> = { -readonly [P in keyof T]: T[P] };
export type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> };
export type DisposableLike = Disposable | (() => any);

export type MaybePromise<T> = T | Promise<T>;

export interface FileChange {
    /**
     * Absolute path to the source file
     */
    srcPath: string;
    /**
     * What type of change was this.
     */
    type: FileChangeType;
    /**
     * If provided, this is the new contents of the file. If not provided, the file will be read from disk
     */
    fileContents?: string;
    /**
     * If true, this file change can have a project created exclusively for it, it no other projects handled it
     */
    allowStandaloneProject?: boolean;
}
