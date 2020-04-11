export enum TokenKind {
    // parens (and friends)
    LeftParen = 'LeftParen', // (
    RightParen = 'RightParen', // )
    LeftSquareBracket = 'LeftSquare', // [
    RightSquareBracket = 'RightSquare', // ]
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
    LessLess = 'LessLess', // <<
    GreaterGreater = 'GreaterGreater', // >>

    // assignment operators
    MinusEqual = 'MinusEqual', // -=
    PlusEqual = 'PlusEqual', // +=
    StarEqual = 'StarEqual', // *=
    ForwardslashEqual = 'ForwardslashEqual', // /=
    BackslashEqual = 'BackslashEqual', // \=
    LessLessEqual = 'LessLessEqual', // <<=
    GreaterGreaterEqual = 'GreaterGreaterEqual', // >>=

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
    IntegerLiteral = 'IntegerLiteral',
    FloatLiteral = 'FloatLiteral',
    DoubleLiteral = 'DoubleLiteral',
    LongIntegerLiteral = 'LongIntegerLiteral',

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

    // other single-character symbols
    Dot = 'Dot', // .
    Comma = 'Comma', // ,
    Colon = 'Colon', // :
    Semicolon = 'Semicolon', // ;
    At = 'At', // @

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
    ElseIf = 'ElseIf',
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

    //brighterscript keywords
    Class = 'Class',
    EndClass = 'EndClass',
    Namespace = 'Namespace',
    EndNamespace = 'EndNamespace',
    Public = 'Public',
    Protected = 'Protected',
    Private = 'Private',
    As = 'As',
    New = 'New',
    Override = 'Override',


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
    'elseif',
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
    'line_num',
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
export const Keywords: { [key: string]: TokenKind } = {
    as: TokenKind.As,
    and: TokenKind.And,
    dim: TokenKind.Dim,
    end: TokenKind.End,
    then: TokenKind.Then,
    else: TokenKind.Else,
    elseif: TokenKind.ElseIf,
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
    'else if': TokenKind.ElseIf,
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
    class: TokenKind.Class,
    endclass: TokenKind.EndClass,
    'end class': TokenKind.EndClass,
    public: TokenKind.Public,
    protected: TokenKind.Protected,
    private: TokenKind.Private,
    new: TokenKind.New,
    override: TokenKind.Override
};

/** Set of all keywords that end blocks. */
export type BlockTerminator =
    | TokenKind.ElseIf
    | TokenKind.Else
    | TokenKind.EndFor
    | TokenKind.Next
    | TokenKind.EndIf
    | TokenKind.EndWhile
    | TokenKind.EndSub
    | TokenKind.EndFunction;

/** The set of operators valid for use in assignment statements. */
export const AssignmentOperators = [
    TokenKind.Equal,
    TokenKind.MinusEqual,
    TokenKind.PlusEqual,
    TokenKind.StarEqual,
    TokenKind.ForwardslashEqual,
    TokenKind.BackslashEqual,
    TokenKind.LessLessEqual,
    TokenKind.GreaterGreaterEqual
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
    TokenKind.ElseIf,
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
    TokenKind.Invalid,
    TokenKind.Let,
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
    TokenKind.Override
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
    TokenKind.Public,
    TokenKind.Protected,
    TokenKind.Private,
    TokenKind.Class,
    TokenKind.New,
    TokenKind.Override
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
    TokenKind.ElseIf,
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
    TokenKind.While
];

export const DisallowedLocalIdentifiersText = new Set([
    'run',
    'line_num',
    ...DisallowedLocalIdentifiers.map(x => x.toLowerCase())
]);
