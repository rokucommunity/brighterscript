import { Range, Diagnostic } from 'vscode-languageserver';

import { Scope } from './Scope';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { FunctionScope } from './FunctionScope';
import { BrsType } from './types/BrsType';
import { FunctionType } from './types/FunctionType';
import { ParseMode } from './parser/Parser';
import { Program, SourceObj, TranspileEntry } from './Program';
import { ProgramBuilder } from './ProgramBuilder';

export interface BsDiagnostic extends Diagnostic {
    file: File;
}

export interface Callable {
    file: BrsFile | XmlFile;
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
    type: BrsType;
    range: Range;
}

export interface CallableParam {
    name: string;
    type: BrsType;
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
    type: BrsType;
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

//copied from brs (since it's not exported from there)
export enum ValueKind {
    Invalid = 0,
    Boolean = 1,
    String = 2,
    Int32 = 3,
    Int64 = 4,
    Float = 5,
    Double = 6,
    Callable = 7,
    Uninitialized = 8,
    Dynamic = 9,
    Void = 10,
    Object = 11
}

/**
 * A wrapper around a callable to provide more information about where it came from
 */
export interface CallableContainer {
    callable: Callable;
    scope: Scope;
}

export interface CallableContainerMap {
    [name: string]: CallableContainer[];
}

export interface CommentFlag {
    file: BrsFile;
    /**
     * The location of the ignore comment.
     */
    range: Range;
    /**
     * The range that this flag applies to (i.e. the lines that should be suppressed/re-enabled)
     */
    affectedRange: Range;
    codes: number[] | null;
}

type ValidateHandler = (scope: Scope, files: (BrsFile | XmlFile)[], callables: CallableContainerMap) => void;

export interface CompilerPlugin {
    name: string;
    beforeProgramCreate?: (builder: ProgramBuilder) => void;
    afterProgramCreate?: (program: Program) => void;
    beforePrepublish?: (files: FileObj[]) => void;
    afterPrepublish?: (files: FileObj[]) => void;
    beforePublish?: (files: FileObj[]) => void;
    afterPublish?: (files: FileObj[]) => void;
    beforeProgramValidate?: (program: Program) => void;
    afterProgramValidate?: (program: Program) => void;
    afterScopeCreate?: (scope: Scope) => void;
    afterScopeDispose?: (scope: Scope) => void;
    beforeScopeValidate?: ValidateHandler;
    afterScopeValidate?: ValidateHandler;
    beforeFileParse?: (source: SourceObj) => void;
    afterFileParse?: (file: (BrsFile | XmlFile)) => void;
    afterFileValidate?: (file: (BrsFile | XmlFile)) => void;
    beforeTranspile?: (entries: TranspileEntry[]) => void;
    afterTranspile?: (entries: TranspileEntry[]) => void;
}
