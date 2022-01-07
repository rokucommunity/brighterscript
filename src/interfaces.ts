import type { Range, Diagnostic, CodeAction, SemanticTokenTypes, SemanticTokenModifiers } from 'vscode-languageserver';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { FunctionScope } from './FunctionScope';
import type { FunctionType } from './types/FunctionType';
import type { ParseMode } from './parser/Parser';
import type { Program, SourceObj, TranspileObj } from './Program';
import type { ProgramBuilder } from './ProgramBuilder';
import type { Expression, FunctionStatement } from './parser';
import type { TranspileState } from './parser/TranspileState';
import type { SourceNode } from 'source-map';
import type { BscType } from './types/BscType';
import type { AstEditor } from './astUtils/AstEditor';

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
    range: Range;
}

export interface CallableParam {
    name: string;
    type: BscType;
    isOptional?: boolean;
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
    pathAbsolute: string;
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
    beforeProgramTranspile?: (program: Program, entries: TranspileObj[]) => void;
    afterProgramTranspile?: (program: Program, entries: TranspileObj[]) => void;
    onGetCodeActions?: PluginHandler<OnGetCodeActionsEvent>;
    onGetSemanticTokens?: PluginHandler<OnGetSemanticTokensEvent>;
    //scope events
    afterScopeCreate?: (scope: Scope) => void;
    beforeScopeDispose?: (scope: Scope) => void;
    afterScopeDispose?: (scope: Scope) => void;
    beforeScopeValidate?: ValidateHandler;
    afterScopeValidate?: ValidateHandler;
    //file events
    beforeFileParse?: (source: SourceObj) => void;
    afterFileParse?: (file: BscFile) => void;
    afterFileValidate?: (file: BscFile) => void;
    beforeFileTranspile?: PluginHandler<BeforeFileTranspileEvent>;
    afterFileTranspile?: PluginHandler<AfterFileTranspileEvent>;
    beforeFileDispose?: (file: BscFile) => void;
    afterFileDispose?: (file: BscFile) => void;
}
export type PluginHandler<T> = (event: T) => void;

export interface OnGetCodeActionsEvent {
    program: Program;
    file: BscFile;
    range: Range;
    scopes: Scope[];
    diagnostics: BsDiagnostic[];
    codeActions: CodeAction[];
}

export interface OnGetSemanticTokensEvent {
    program: Program;
    file: BscFile;
    scopes: Scope[];
    semanticTokens: SemanticToken[];
}

export interface BeforeFileTranspileEvent {
    file: BscFile;
    outputPath: string;
    /**
     * An editor that can be used to transform properties or arrays. Once the `afterFileTranspile` event has fired, these changes will be reverted,
     * restoring the objects to their prior state. This is useful for changing code right before a file gets transpiled, but when you don't want
     * the changes to persist in the in-memory file.
     */
    editor: AstEditor;
}

export interface AfterFileTranspileEvent {
    file: BscFile;
    outputPath: string;
    /**
     * An editor that can be used to transform properties or arrays. Once the `afterFileTranspile` event has fired, these changes will be reverted,
     * restoring the objects to their prior state. This is useful for changing code right before a file gets transpiled, but when you don't want
     * the changes to persist in the in-memory file.
     */
    editor: AstEditor;
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

export type FileResolver = (pathAbsolute: string) => string | undefined | Thenable<string | undefined> | void;

export interface ExpressionInfo {
    expressions: Expression[];
    varExpressions: Expression[];
    uniqueVarNames: string[];
}

export type DiagnosticCode = number | string;
