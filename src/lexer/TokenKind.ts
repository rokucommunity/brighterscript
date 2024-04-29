export enum TokenKind {
    // parens (and friends)
    LeftParen = 'LeftParen', // (
    RightParen = 'RightParen', // )
    LeftSquareBracket = 'LeftSquareBracket', // [
    RightSquareBracket = 'RightSquareBracket', // ]
    LeftCurlyBrace = 'LeftCurlyBrace', // {
    RightCurlyBrace = 'RightCurlyBrace', // }

    // operators
    Caret = 'Caret', // ^
    Minus = 'Minus', // -
    Plus = 'Plus', // +
    Star = 'Star', // *
    Forwardslash = 'Forwardslash', // /
    Mod = 'Mod', // mod
    Backslash = 'Backslash', // \

    // postfix operators
    PlusPlus = 'PlusPlus', // ++
    MinusMinus = 'MinusMinus', // --

    // bitshift
    LeftShift = 'LeftShift', // <<
    RightShift = 'RightShift', // >>

    // assignment operators
    MinusEqual = 'MinusEqual', // -=
    PlusEqual = 'PlusEqual', // +=
    StarEqual = 'StarEqual', // *=
    ForwardslashEqual = 'ForwardslashEqual', // /=
    BackslashEqual = 'BackslashEqual', // \=
    LeftShiftEqual = 'LeftShiftEqual', // <<=
    RightShiftEqual = 'RightShiftEqual', // >>=

    // comparators
    Less = 'Less', // <
    LessEqual = 'LessEqual', // <=
    Greater = 'Greater', // >
    GreaterEqual = 'GreaterEqual', // >=
    Equal = 'Equal', // =
    LessGreater = 'LessGreater', // BrightScript uses `<>` for "not equal"

    // literals
    Identifier = 'Identifier',
    StringLiteral = 'StringLiteral',
    TemplateStringQuasi = 'TemplateStringQuasi',
    TemplateStringExpressionBegin = 'TemplateStringExpressionBegin',
    TemplateStringExpressionEnd = 'TemplateStringExpressionEnd',
    IntegerLiteral = 'IntegerLiteral',
    FloatLiteral = 'FloatLiteral',
    DoubleLiteral = 'DoubleLiteral',
    LongIntegerLiteral = 'LongIntegerLiteral',
    EscapedCharCodeLiteral = 'EscapedCharCodeLiteral', //this is used to capture things like `\n`, `\r\n` in template strings
    RegexLiteral = 'RegexLiteral',

    //types
    Void = 'Void',
    Boolean = 'Boolean',
    Integer = 'Integer',
    LongInteger = 'LongInteger',
    Float = 'Float',
    Double = 'Double',
    String = 'String',
    Object = 'Object',
    Interface = 'Interface',
    Invalid = 'Invalid',
    Dynamic = 'Dynamic',

    // other symbols
    Dot = 'Dot', // .
    Comma = 'Comma', // ,
    Colon = 'Colon', // :
    Semicolon = 'Semicolon', // ;
    At = 'At', // @
    Callfunc = 'Callfunc', // @.
    Question = 'Question', // ?
    QuestionQuestion = 'QuestionQuestion', // ??
    BackTick = 'BackTick', // `
    QuestionDot = 'QuestionDot', // ?.
    QuestionLeftSquare = 'QuestionLeftSquare', // ?[
    QuestionLeftParen = 'QuestionLeftParen', // ?(
    QuestionAt = 'QuestionAt', // ?@

    // conditional compilation
    HashIf = 'HashIf', // #if
    HashElseIf = 'HashElseIf', // #elseif
    HashElse = 'HashElse', // #else
    HashEndIf = 'HashEndIf', // #endif
    HashConst = 'HashConst', // #const
    HashError = 'HashError', // #error
    HashErrorMessage = 'HashErrorMessage',

    // keywords
    // canonical source: https://sdkdocs.roku.com/display/sdkdoc/Reserved+Words
    And = 'And',
    Box = 'Box',
    CreateObject = 'CreateObject',
    Dim = 'Dim',
    Each = 'Each',
    Else = 'Else',
    Then = 'Then',
    End = 'End',
    EndFunction = 'EndFunction',
    EndFor = 'EndFor',
    EndIf = 'EndIf',
    EndSub = 'EndSub',
    EndWhile = 'EndWhile',
    Eval = 'Eval',
    Exit = 'Exit',
    ExitFor = 'ExitFor', // not technically a reserved word, but definitely a tokenKind
    ExitWhile = 'ExitWhile',
    False = 'False',
    For = 'For',
    ForEach = 'ForEach',
    Function = 'Function',
    GetGlobalAA = 'GetGlobalAA',
    GetLastRunCompileError = 'GetLastRunCompileError',
    GetLastRunRunTimeError = 'GetLastRunRunTimeError',
    Goto = 'Goto',
    If = 'If',
    In = 'In',
    Let = 'Let',
    Next = 'Next',
    Not = 'Not',
    ObjFun = 'ObjFun',
    Or = 'Or',
    Pos = 'Pos',
    Print = 'Print',
    Rem = 'Rem',
    Return = 'Return',
    Step = 'Step',
    Stop = 'Stop',
    Sub = 'Sub',
    Tab = 'Tab',
    To = 'To',
    True = 'True',
    Type = 'Type',
    While = 'While',
    Try = 'Try',
    Catch = 'Catch',
    EndTry = 'EndTry',
    Throw = 'Throw',

    //misc
    Library = 'Library',
    Dollar = '$',

    //brighterscript keywords
    Class = 'Class',
    EndClass = 'EndClass',
    Namespace = 'Namespace',
    EndNamespace = 'EndNamespace',
    Enum = 'Enum',
    EndEnum = 'EndEnum',
    Public = 'Public',
    Protected = 'Protected',
    Private = 'Private',
    Optional = 'Optional',
    As = 'As',
    New = 'New',
    Override = 'Override',
    Import = 'Import',
    EndInterface = 'EndInterface',
    Const = 'Const',
    Continue = 'Continue',
    Typecast = 'Typecast',

    //brighterscript source literals
    LineNumLiteral = 'LineNumLiteral',
    SourceFilePathLiteral = 'SourceFilePathLiteral',
    SourceLineNumLiteral = 'SourceLineNumLiteral',
    FunctionNameLiteral = 'FunctionNameLiteral',
    SourceFunctionNameLiteral = 'SourceFunctionNameLiteral',
    SourceLocationLiteral = 'SourceLocationLiteral',
    PkgPathLiteral = 'PkgPathLiteral',
    PkgLocationLiteral = 'PkgLocationLiteral',

    //comments
    Comment = 'Comment',

    // structural
    Whitespace = 'Whitespace',
    Newline = 'Newline',
    Eof = 'Eof'
}

/**
 * The set of all reserved words in the reference BrightScript runtime. These can't be used for any
 * other purpose within a BrightScript file.
 * @see https://sdkdocs.roku.com/display/sdkdoc/Reserved+Words
 */
export const ReservedWords = new Set([
    'and',
    'box',
    'createobject',
    'dim',
    'each',
    'else',
    'endsub',
    'endwhile',
    'eval',
    'exit',
    'exitwhile',
    'false',
    'for',
    'function',
    'getglobalaa',
    'getlastruncompileerror',
    'getlastrunruntimeerror',
    'goto',
    'if',
    'invalid',
    'let',
    'next',
    'not',
    'objfun',
    'or',
    'pos',
    'print',
    'rem',
    'return',
    'run',
    'step',
    'stop',
    'sub',
    'tab',
    'then',
    'throw',
    'to',
    'true',
    'type',
    'while'
]);

/**
 * The set of keywords in the reference BrightScript runtime. Any of these that *are not* reserved
 * words can be used within a BrightScript file for other purposes, e.g. `tab`.
 *
 * Unfortunately there's no canonical source for this!
 */
export const Keywords: Record<string, TokenKind> = {
    as: TokenKind.As,
    and: TokenKind.And,
    continue: TokenKind.Continue,
    dim: TokenKind.Dim,
    end: TokenKind.End,
    then: TokenKind.Then,
    else: TokenKind.Else,
    void: TokenKind.Void,
    boolean: TokenKind.Boolean,
    integer: TokenKind.Integer,
    longinteger: TokenKind.LongInteger,
    float: TokenKind.Float,
    double: TokenKind.Double,
    string: TokenKind.String,
    object: TokenKind.Object,
    interface: TokenKind.Interface,
    dynamic: TokenKind.Dynamic,
    endfor: TokenKind.EndFor,
    'end for': TokenKind.EndFor,
    endfunction: TokenKind.EndFunction,
    'end function': TokenKind.EndFunction,
    endif: TokenKind.EndIf,
    'end if': TokenKind.EndIf,
    endsub: TokenKind.EndSub,
    'end sub': TokenKind.EndSub,
    endwhile: TokenKind.EndWhile,
    'end while': TokenKind.EndWhile,
    exit: TokenKind.Exit,
    'exit for': TokenKind.ExitFor, // note: 'exitfor' (no space) is *not* a keyword
    exitwhile: TokenKind.ExitWhile,
    'exit while': TokenKind.ExitWhile,
    false: TokenKind.False,
    for: TokenKind.For,
    'for each': TokenKind.ForEach, // note: 'foreach' (no space) is *not* a keyword
    function: TokenKind.Function,
    goto: TokenKind.Goto,
    if: TokenKind.If,
    invalid: TokenKind.Invalid,
    let: TokenKind.Let,
    mod: TokenKind.Mod,
    next: TokenKind.Next,
    not: TokenKind.Not,
    or: TokenKind.Or,
    print: TokenKind.Print,
    rem: TokenKind.Rem,
    return: TokenKind.Return,
    step: TokenKind.Step,
    stop: TokenKind.Stop,
    sub: TokenKind.Sub,
    to: TokenKind.To,
    true: TokenKind.True,
    while: TokenKind.While,
    library: TokenKind.Library,
    class: TokenKind.Class,
    endclass: TokenKind.EndClass,
    'end class': TokenKind.EndClass,
    enum: TokenKind.Enum,
    endenum: TokenKind.EndEnum,
    'end enum': TokenKind.EndEnum,
    public: TokenKind.Public,
    protected: TokenKind.Protected,
    private: TokenKind.Private,
    new: TokenKind.New,
    override: TokenKind.Override,
    optional: TokenKind.Optional,
    namespace: TokenKind.Namespace,
    endnamespace: TokenKind.EndNamespace,
    'end namespace': TokenKind.EndNamespace,
    import: TokenKind.Import,
    'line_num': TokenKind.LineNumLiteral,
    'source_file_path': TokenKind.SourceFilePathLiteral,
    'source_line_num': TokenKind.SourceLineNumLiteral,
    'function_name': TokenKind.FunctionNameLiteral,
    'source_function_name': TokenKind.SourceFunctionNameLiteral,
    'source_location': TokenKind.SourceLocationLiteral,
    'pkg_path': TokenKind.PkgPathLiteral,
    'pkg_location': TokenKind.PkgLocationLiteral,
    try: TokenKind.Try,
    catch: TokenKind.Catch,
    endtry: TokenKind.EndTry,
    'end try': TokenKind.EndTry,
    throw: TokenKind.Throw,
    'end interface': TokenKind.EndInterface,
    endinterface: TokenKind.EndInterface,
    const: TokenKind.Const,
    typecast: TokenKind.Typecast
};
//hide the constructor prototype method because it causes issues
Keywords.constructor = undefined;

/** Set of all keywords that end blocks. */
export type BlockTerminator =
    | TokenKind.Else
    | TokenKind.EndFor
    | TokenKind.Next
    | TokenKind.EndIf
    | TokenKind.EndWhile
    | TokenKind.EndSub
    | TokenKind.EndFunction
    | TokenKind.EndNamespace
    | TokenKind.EndInterface
    | TokenKind.Catch
    | TokenKind.EndTry;

/** Set of keywords that end non-conditional compilation blocks. */
export const BlockTerminators = [
    TokenKind.Else,
    TokenKind.EndFor,
    TokenKind.Next,
    TokenKind.EndIf,
    TokenKind.EndWhile,
    TokenKind.EndSub,
    TokenKind.EndFunction,
    TokenKind.EndNamespace,
    TokenKind.EndInterface,
    TokenKind.Catch,
    TokenKind.EndTry
];

/** The set of operators valid for use in assignment statements. */
export const AssignmentOperators = [
    TokenKind.Equal,
    TokenKind.MinusEqual,
    TokenKind.PlusEqual,
    TokenKind.StarEqual,
    TokenKind.ForwardslashEqual,
    TokenKind.BackslashEqual,
    TokenKind.LeftShiftEqual,
    TokenKind.RightShiftEqual
];

export const CompoundAssignmentOperators = [
    TokenKind.MinusEqual,
    TokenKind.PlusEqual,
    TokenKind.StarEqual,
    TokenKind.ForwardslashEqual,
    TokenKind.BackslashEqual,
    TokenKind.LeftShiftEqual,
    TokenKind.RightShiftEqual
];

/** List of TokenKinds that are permitted as property names. */
export const AllowedProperties = [
    TokenKind.As,
    TokenKind.And,
    TokenKind.Box,
    TokenKind.CreateObject,
    TokenKind.Dim,
    TokenKind.Then,
    TokenKind.Else,
    TokenKind.End,
    TokenKind.EndFunction,
    TokenKind.EndFor,
    TokenKind.EndIf,
    TokenKind.EndSub,
    TokenKind.EndWhile,
    TokenKind.Eval,
    TokenKind.Exit,
    TokenKind.ExitFor,
    TokenKind.ExitWhile,
    TokenKind.False,
    TokenKind.For,
    TokenKind.ForEach,
    TokenKind.Function,
    TokenKind.GetGlobalAA,
    TokenKind.GetLastRunCompileError,
    TokenKind.GetLastRunRunTimeError,
    TokenKind.Goto,
    TokenKind.If,
    TokenKind.In,
    TokenKind.Invalid,
    TokenKind.Let,
    TokenKind.Mod,
    TokenKind.Next,
    TokenKind.Not,
    TokenKind.ObjFun,
    TokenKind.Or,
    TokenKind.Pos,
    TokenKind.Print,
    TokenKind.Rem,
    TokenKind.Return,
    TokenKind.Step,
    TokenKind.Stop,
    TokenKind.Sub,
    TokenKind.Tab,
    TokenKind.To,
    TokenKind.True,
    TokenKind.Type,
    TokenKind.While,
    TokenKind.Library,
    TokenKind.Void,
    TokenKind.Boolean,
    TokenKind.Integer,
    TokenKind.LongInteger,
    TokenKind.Float,
    TokenKind.Double,
    TokenKind.String,
    TokenKind.Object,
    TokenKind.Interface,
    TokenKind.Dynamic,
    TokenKind.Void,
    TokenKind.As,
    TokenKind.Public,
    TokenKind.Protected,
    TokenKind.Private,
    TokenKind.Class,
    TokenKind.New,
    TokenKind.Override,
    TokenKind.Optional,
    TokenKind.Namespace,
    TokenKind.EndNamespace,
    TokenKind.Import,
    TokenKind.LineNumLiteral,
    TokenKind.SourceFilePathLiteral,
    TokenKind.SourceLineNumLiteral,
    TokenKind.FunctionNameLiteral,
    TokenKind.SourceFunctionNameLiteral,
    TokenKind.SourceLocationLiteral,
    TokenKind.PkgPathLiteral,
    TokenKind.PkgLocationLiteral,
    TokenKind.Try,
    TokenKind.Catch,
    TokenKind.EndTry,
    TokenKind.Throw,
    TokenKind.EndInterface,
    TokenKind.Const,
    TokenKind.Continue,
    TokenKind.Typecast
];

/** List of TokenKind that are allowed as local var identifiers. */
export const AllowedLocalIdentifiers = [
    TokenKind.EndFor,
    TokenKind.ExitFor,
    TokenKind.ForEach,
    TokenKind.Void,
    TokenKind.Boolean,
    TokenKind.Integer,
    TokenKind.LongInteger,
    TokenKind.Float,
    TokenKind.Double,
    TokenKind.String,
    TokenKind.Object,
    TokenKind.Interface,
    TokenKind.Dynamic,
    TokenKind.Void,
    TokenKind.As,
    TokenKind.Library,
    TokenKind.Public,
    TokenKind.Protected,
    TokenKind.Private,
    TokenKind.Class,
    TokenKind.New,
    TokenKind.Override,
    TokenKind.Optional,
    TokenKind.Namespace,
    TokenKind.EndNamespace,
    TokenKind.Import,
    TokenKind.Try,
    TokenKind.Catch,
    TokenKind.EndTry,
    TokenKind.Const,
    TokenKind.Continue,
    TokenKind.In,
    TokenKind.Typecast
];

export const BrighterScriptSourceLiterals = [
    TokenKind.SourceFilePathLiteral,
    TokenKind.SourceLineNumLiteral,
    TokenKind.FunctionNameLiteral,
    TokenKind.SourceFunctionNameLiteral,
    TokenKind.SourceLocationLiteral,
    TokenKind.PkgPathLiteral,
    TokenKind.PkgLocationLiteral
];

/**
 * List of string versions of TokenKind and various globals that are NOT allowed as local var identifiers.
 * Used to throw more helpful "you can't use a reserved word as an identifier" errors.
 */
export const DisallowedLocalIdentifiers = [
    TokenKind.And,
    TokenKind.Box,
    TokenKind.CreateObject,
    TokenKind.Dim,
    TokenKind.Each,
    TokenKind.Else,
    TokenKind.End,
    TokenKind.EndFunction,
    TokenKind.EndIf,
    TokenKind.EndSub,
    TokenKind.EndWhile,
    TokenKind.Eval,
    TokenKind.Exit,
    TokenKind.ExitWhile,
    TokenKind.False,
    TokenKind.For,
    TokenKind.Function,
    TokenKind.GetGlobalAA,
    TokenKind.GetLastRunCompileError,
    TokenKind.GetLastRunRunTimeError,
    TokenKind.Goto,
    TokenKind.If,
    TokenKind.Invalid,
    TokenKind.Let,
    TokenKind.Next,
    TokenKind.Not,
    TokenKind.ObjFun,
    TokenKind.Or,
    TokenKind.Pos,
    TokenKind.Print,
    //technically you aren't allowed to make a local var for Rem, but it's a comment so that'll never actually cause a compile error
    TokenKind.Rem,
    TokenKind.Return,
    TokenKind.Step,
    TokenKind.Sub,
    TokenKind.Tab,
    TokenKind.Then,
    TokenKind.To,
    TokenKind.True,
    TokenKind.Type,
    TokenKind.While,
    TokenKind.LineNumLiteral,
    TokenKind.SourceFilePathLiteral,
    TokenKind.SourceLineNumLiteral,
    TokenKind.FunctionNameLiteral,
    TokenKind.SourceFunctionNameLiteral,
    TokenKind.SourceLocationLiteral,
    TokenKind.PkgPathLiteral,
    TokenKind.PkgLocationLiteral,
    TokenKind.Throw
];

export const DisallowedLocalIdentifiersText = new Set([
    'run',
    ...DisallowedLocalIdentifiers.map(x => x.toLowerCase())
]);

/**
 * List of string versions of TokenKind and various globals that are NOT allowed as scope function names.
 * Used to throw more helpful "you can't use a reserved word as a function name" errors.
 */
export const DisallowedFunctionIdentifiers = [
    TokenKind.And,
    TokenKind.CreateObject,
    TokenKind.Dim,
    TokenKind.Each,
    TokenKind.Else,
    TokenKind.End,
    TokenKind.EndFunction,
    TokenKind.EndIf,
    TokenKind.EndSub,
    TokenKind.EndWhile,
    TokenKind.Exit,
    TokenKind.ExitWhile,
    TokenKind.False,
    TokenKind.For,
    TokenKind.Function,
    TokenKind.Goto,
    TokenKind.If,
    TokenKind.Invalid,
    TokenKind.Let,
    TokenKind.Next,
    TokenKind.Not,
    TokenKind.ObjFun,
    TokenKind.Or,
    TokenKind.Print,
    TokenKind.Rem,
    TokenKind.Return,
    TokenKind.Step,
    TokenKind.Sub,
    TokenKind.Tab,
    TokenKind.Then,
    TokenKind.To,
    TokenKind.True,
    TokenKind.Type,
    TokenKind.While,
    TokenKind.Throw
];

export const DisallowedFunctionIdentifiersText = new Set([
    'run',
    ...DisallowedFunctionIdentifiers.map(x => x.toLowerCase())
]);


/** List of TokenKind that are used as declared types on parameters/functions in Brightscript*/
export const DeclarableTypes = [
    TokenKind.Boolean,
    TokenKind.Integer,
    TokenKind.LongInteger,
    TokenKind.Float,
    TokenKind.Double,
    TokenKind.String,
    TokenKind.Object,
    TokenKind.Dynamic,
    TokenKind.Void,
    TokenKind.Function
];

/** List of TokenKind that will not break parsing a TypeExpression in Brighterscript*/
export const AllowedTypeIdentifiers = [
    ...AllowedProperties
];


/**
 * The tokens that might preceed a regex literal
 */
export const PreceedingRegexTypes = new Set([
    TokenKind.Print,
    TokenKind.Question,
    TokenKind.QuestionQuestion,
    TokenKind.LeftSquareBracket,
    TokenKind.LeftParen,
    TokenKind.LeftCurlyBrace,
    TokenKind.Caret,
    TokenKind.Minus,
    TokenKind.Plus,
    TokenKind.Star,
    TokenKind.Forwardslash,
    TokenKind.Mod,
    TokenKind.Backslash,
    TokenKind.LeftShift,
    TokenKind.RightShift,
    TokenKind.MinusEqual,
    TokenKind.PlusEqual,
    TokenKind.StarEqual,
    TokenKind.ForwardslashEqual,
    TokenKind.BackslashEqual,
    TokenKind.LeftShiftEqual,
    TokenKind.RightShiftEqual,
    TokenKind.Less,
    TokenKind.LessEqual,
    TokenKind.Greater,
    TokenKind.GreaterEqual,
    TokenKind.Equal,
    TokenKind.LessGreater,
    TokenKind.And,
    TokenKind.Or,
    TokenKind.If,
    TokenKind.Not,
    TokenKind.To,
    TokenKind.Newline,
    TokenKind.Throw,
    TokenKind.Throw,
    TokenKind.Colon,
    TokenKind.Semicolon
]);

/**
 * The tokens that may be in leading trivia
 */
export const AllowedTriviaTokens: ReadonlyArray<TokenKind> = [
    TokenKind.Newline,
    TokenKind.Whitespace,
    TokenKind.Comment,
    TokenKind.Colon
];
