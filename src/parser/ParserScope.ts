import type { Identifier } from '../lexer/Token';
import {
    NamespaceStatement,
} from './Statement';
import {
    FunctionExpression,
} from './Expression';

/**
 * A parser scope is a small, short-lived token that represents "how deep" we are when parsing scope
 * (it's totally unrelated to the much longer-lived Scope logic in the main folder, representing all of
 * the files and their functions and qualified names, etc.).
 *
 * The way the body of each scope is parsed is a little different, and how much data we can scrape up
 * before it starts is different, so each type of scope has a "best-effort" description of how it
 * was initialized.
 */
export class ParserScope { }

export class NamespaceScope extends ParserScope {
    constructor(public namespaceStatement: NamespaceStatement) {
        super();
    }
}

export class FunctionScope extends ParserScope {
    constructor(public functionExpression: FunctionExpression) {
        super();
    }
}

export class ClassScope extends ParserScope {
    constructor(public className: Identifier) {
        super();
    }
}
