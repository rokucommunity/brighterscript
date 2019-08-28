export enum Lexeme {
    // parens (and friends)
    LeftParen = 'LeftParen',
    RightParen = 'RightParen',
    LeftSquare = 'LeftSquare',
    RightSquare = 'RightSquare',
    LeftBrace = 'LeftBrace',
    RightBrace = 'RightBrace',

    // operators
    Caret = 'Caret',
    Minus = 'Minus',
    Plus = 'Plus',
    Star = 'Star',
    Slash = 'Slash',
    Mod = 'Mod',
    Backslash = 'Backslash',

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
    SlashEqual = 'SlashEqual', // /=
    BackslashEqual = 'BackslashEqual', // \=
    LeftShiftEqual = 'LeftShiftEqual', // <<=
    RightShiftEqual = 'RightShiftEqual', // >>=

    // comparators
    Less = 'Less',
    LessEqual = 'LessEqual',
    Greater = 'Greater',
    GreaterEqual = 'GreaterEqual',
    Equal = 'Equal',
    LessGreater = 'LessGreater', // BrightScript uses `<>` for "not equal"

    // literals
    Identifier = 'Identifier',
    String = 'String',
    Integer = 'Integer',
    Float = 'Float',
    Double = 'Double',
    LongInteger = 'LongInteger',

    // other single-character symbols
    Dot = 'Dot',
    Comma = 'Comma',
    Colon = 'Colon',
    Semicolon = 'Semicolon',

    // conditional compilation
    HashIf = 'HashIf',
    HashElseIf = 'HashElseIf',
    HashElse = 'HashElse',
    HashEndIf = 'HashEndIf',
    HashConst = 'HashConst',
    HashError = 'HashError',
    HashErrorMessage = 'HashErrorMessage',

    // keywords
    // canonical source: https://sdkdocs.roku.com/display/sdkdoc/Reserved+Words
    And = 'And',
    Box = 'Box',
    CreateObject = 'CreateObject',
    Dim = 'Dim',
    Else = 'Else',
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
    Invalid = 'Invalid',
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
    Public = 'Public',
    Protected = 'Protected',
    Private = 'Private',

    //comments
    Comment = 'SingleLineComment',

    // structural
    Newline = 'Newline',
    Eof = 'Eof'
}
