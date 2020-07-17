import { Range, Diagnostic } from 'vscode-languageserver';

import { Scope } from './Scope';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { FunctionScope } from './FunctionScope';
import { Type } from './types/BrsType';
import { FunctionType, FunctionTypeParameter } from './types/FunctionType';
import { ParseMode } from './parser/Parser';
import { FunctionStatement } from './parser/Statement';
import { CallExpression } from './parser';

export interface BsDiagnostic extends Diagnostic {
    file: File;
}

export type Callable = FunctionStatement & {
    file: BrsFile | XmlFile;
};

export interface Callable1 {
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
    params: FunctionTypeParameter[];
    /**
     * The full range of the function or sub.
     */
    range: Range;
    /**
     * The range of the name of this callable
     */
    nameRange?: Range;
    isDepricated?: boolean;
    getName: (parseMode: ParseMode) => string;
    /**
     * Indicates whether or not this callable has an associated namespace
     */
    hasNamespace: boolean;
}

export interface FunctionCall {
    call: CallExpression;
    functionScope: FunctionScope;
    file: File;
    name: string;
    args: CallableArg[];
}

/**
 * An argument for an expression call.
 */
export interface CallableArg {
    text: string;
    type: Type;
    range: Range;
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
    type: Type;
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

/**
 * A wrapper around a callable to provide more information about where it came from
 */
export interface CallableContainer {
    callable: Callable;
    scope: Scope;
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
