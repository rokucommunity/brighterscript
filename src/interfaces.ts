import type { Range, Diagnostic, CodeAction, SemanticTokenTypes, SemanticTokenModifiers, Position, CompletionItem } from 'vscode-languageserver';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { FunctionScope } from './FunctionScope';
import type { FunctionType } from './types/FunctionType';
import type { ParseMode } from './parser/Parser';
import type { Program, SourceObj, TranspileObj } from './Program';
import type { ProgramBuilder } from './ProgramBuilder';
import type { FunctionStatement } from './parser/Statement';
import type { Expression } from './parser/AstNode';
import type { TranspileState } from './parser/TranspileState';
import type { SourceMapGenerator, SourceNode } from 'source-map';
import type { BscType } from './types/BscType';
import type { AstEditor } from './astUtils/AstEditor';
import type { Token } from './lexer/Token';

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
    type: FunctionType;
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
    functionScope: FunctionScope;
    file: File;
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

export interface File {
    /**
     * The absolute path to the file, relative to the pkg
     */
    pkgPath: string;
    srcPath: string;
    getDiagnostics(): BsDiagnostic[];
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

type ValidateHandler = (scope: Scope, files: BscFile[], callables: CallableContainerMap) => void;

export type CompilerPluginFactory = () => CompilerPlugin;

export interface CompilerPlugin {
    name: string;
    //program events
    beforeProgramCreate?: (builder: ProgramBuilder) => void;
    beforePrepublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterPrepublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    beforePublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterPublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterProgramCreate?: (program: Program) => void;
    beforeProgramValidate?: (program: Program) => void;
    afterProgramValidate?: (program: Program) => void;
    beforeProgramTranspile?: (program: Program, entries: TranspileObj[], editor: AstEditor) => void;
    afterProgramTranspile?: (program: Program, entries: TranspileObj[], editor: AstEditor) => void;
    beforeProgramDispose?: (program: Program) => void;
    onGetCodeActions?: PluginHandler<OnGetCodeActionsEvent>;

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

    onGetSemanticTokens?: PluginHandler<OnGetSemanticTokensEvent>;
    //scope events
    afterScopeCreate?: (scope: Scope) => void;
    beforeScopeDispose?: (scope: Scope) => void;
    afterScopeDispose?: (scope: Scope) => void;
    beforeScopeValidate?: ValidateHandler;
    onScopeValidate?: PluginHandler<OnScopeValidateEvent>;
    afterScopeValidate?: ValidateHandler;
    //file events
    beforeFileParse?: (source: SourceObj) => void;
    afterFileParse?: (file: BscFile) => void;
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
    afterFileValidate?: (file: BscFile) => void;
    beforeFileTranspile?: PluginHandler<BeforeFileTranspileEvent>;
    afterFileTranspile?: PluginHandler<AfterFileTranspileEvent>;
    beforeFileDispose?: (file: BscFile) => void;
    afterFileDispose?: (file: BscFile) => void;
}
export type PluginHandler<T, R = void> = (event: T) => R;

export interface OnGetCodeActionsEvent {
    program: Program;
    file: BscFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}

export interface ProvideCompletionsEvent<TFile extends BscFile = BscFile> {
    program: Program;
    file: TFile;
    scopes: Scope[];
    position: Position;
    completions: CompletionItem[];
}
export type BeforeProvideCompletionsEvent<TFile extends BscFile = BscFile> = ProvideCompletionsEvent<TFile>;
export type AfterProvideCompletionsEvent<TFile extends BscFile = BscFile> = ProvideCompletionsEvent<TFile>;

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

export interface BeforeFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}

export interface OnFileValidateEvent<T extends BscFile = BscFile> {
    program: Program;
    file: T;
}

export interface OnScopeValidateEvent {
    program: Program;
    scope: Scope;
}

export type Editor = Pick<AstEditor, 'addToArray' | 'hasChanges' | 'removeFromArray' | 'setArrayValue' | 'setProperty' | 'overrideTranspileResult' | 'arrayPop' | 'arrayPush' | 'arrayShift' | 'arraySplice' | 'arrayUnshift' | 'removeProperty' | 'edit'>;

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
