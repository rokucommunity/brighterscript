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
    BooleanLiteral = 'BooleanLiteral',
    IdentifierLiteral = 'IdentifierLiteral',
    StringLiteral = 'StringLiteral',
    IntegerLiteral = 'IntegerLiteral',
    FloatLiteral = 'FloatLiteral',
    DoubleLiteral = 'DoubleLiteral',
    LongIntegerLiteral = 'LongIntegerLiteral',

    //types
    Void = 'Void',
    Number = 'Number',
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
    ExitFor = 'ExitFor', // not technically a reserved word, but definitely a lexeme
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
    Class = 'Class',
    EndClass = 'EndClass',
    Namespace = 'Namespace',
    EndNamespace = 'EndNamespace',
    Public = 'Public',
    Protected = 'Protected',
    Private = 'Private',

    //comments
    Comment = 'Comment',

    // structural
    Whitespace = 'Whitespace',
    Newline = 'Newline',
    Eof = 'Eof'
}

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

/** List of Lexemes that are permitted as property names. */
export const AllowedProperties = [
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
    TokenKind.While
];

/** List of Lexeme that are allowed as local var identifiers. */
export const AllowedLocalIdentifiers = [TokenKind.EndFor, TokenKind.ExitFor, TokenKind.ForEach];

/**
 * List of string versions of Lexeme and various globals that are NOT allowed as local var identifiers.
 * Used to throw more helpful "you can't use a reserved word as an identifier" errors.
 */
export const DisallowedLocalIdentifiers = new Set(
    [
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
        'run',
        TokenKind.Step,
        TokenKind.Sub,
        TokenKind.Tab,
        'then',
        TokenKind.To,
        TokenKind.True,
        TokenKind.Type,
        TokenKind.While,
        'line_num'
    ].map(x => x.toLowerCase())
);

export enum CommentKind {
    SingleQuote = 'SingleQuote',
    Rem = 'Rem',
    Block = 'Block'
}
