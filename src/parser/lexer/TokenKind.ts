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

export enum CommentKind {
    SingleQuote = 'SingleQuote',
    Rem = 'Rem',
    Block = 'Block'
}
