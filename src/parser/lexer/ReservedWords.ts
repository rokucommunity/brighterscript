import { TokenKind } from './TokenKind';

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
export const KeyWords: { [key: string]: TokenKind } = {
    and: TokenKind.And,
    dim: TokenKind.Dim,
    then: TokenKind.Then,
    else: TokenKind.Else,
    elseif: TokenKind.ElseIf,
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
    private: TokenKind.Private
};
