import { expect } from 'chai';
import { tokenDefaults } from '../../../astUtils/creators';
import type { Token } from '../../../lexer/Token';
import { TokenKind } from '../../../lexer/TokenKind';
import { trim } from '../../../testHelpers.spec';
import type { NodeChild, ParseError } from '../BsParser';
import { Node } from '../BsParser';
import { BsParser } from '../BsParser';
const tokenKindByText = new Map(
    Object.entries(tokenDefaults).map(x => [x[1].toLowerCase(), x[0] as TokenKind])
);
tokenKindByText.set('\r\n', TokenKind.Newline);

/**
 * Test the parse method.
 * @param source the source code to be parsed
 * @param expectedAst the expected AST. This supports shorthand.
 * @param doTrim should the source be trimmed before testing
 */
export function testParse(source: string | string[], expectedAst: ExpectedAst) {
    let text: string;
    if (Array.isArray(source)) {
        text = source.join('');
    } else {
        text = trim(source);
    }
    const parser = BsParser.parse(text);
    const ast = parser.ast;

    expect(
        normalize(ast, expectedAst)
    ).to.eql(
        expectedAst
    );
    return parser;
}

/**
 * Convert the `actual` node into the test format based on the `expected` structure.
 * This will do things like extract just the token value, or full token, or node.
 */
function normalize(actual: NodeChild, expected: ExpectedAst) {
    //both are nodes
    if (expected instanceof Node && actual instanceof Node) {
        //normalize actual's children
        for (let i = 0; i < expected.children.length; i++) {
            //only normalize data that exists in actual
            if (actual.children?.[i]) {
                actual.children[i] = normalize(actual.children[i], expected.children[i] as any) as any;
            }
        }

        //expected is an array, so lift actual's children into an array
    } else if (Array.isArray(expected) && actual instanceof Node) {
        let result = actual.children;
        for (let i = 0; i < expected.length; i++) {
            //only normalize data that exists in actual
            if (result[i]) {
                result[i] = normalize(result[i], expected[i]) as any;
            }
        }
        return result;

        //look for a token value from actual
    } else if (typeof expected === 'string' && 'text' in actual) {
        return actual.text;

        //return `actual` as-is
    } else {
        return actual;
    }
}

type ExpectedAst = Node | string | Token | ParseError | Array<ExpectedAst>;
