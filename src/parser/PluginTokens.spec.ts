/* eslint no-template-curly-in-string: 0 */
import { expect } from '../chai-config.spec';
import { TokenKind } from '../lexer/TokenKind';
import type { Token } from '../lexer/Token';
import { createIdentifier, createIntegerLiteral, createStringLiteral, createToken, createVariableExpression } from '../astUtils/creators';
import {
    AALiteralExpression,
    AAMemberExpression,
    ArrayLiteralExpression,
    BinaryExpression,
    CallExpression,
    DottedGetExpression,
    FunctionExpression,
    FunctionParameterExpression,
    GroupingExpression,
    IndexedGetExpression,
    TemplateStringExpression,
    TemplateStringQuasiExpression,
    LiteralExpression,
    TernaryExpression,
    TypeExpression,
    UnaryExpression
} from './Expression';
import { AssignmentStatement, Block, ClassStatement, FieldStatement, ForEachStatement, FunctionStatement, IfStatement, MethodStatement, NamespaceStatement, PrintStatement, ReturnStatement, Body } from './Statement';
import { Parser } from './Parser';

/**
 * Plugins frequently create AST nodes from tokens that have no location and no leading trivia.
 * These tests verify that `toString()` still produces valid (reasonably formatted) code for those nodes.
 */
describe('Plugin-contributed AST nodes', () => {
    it('adds spaces around binary operators', () => {
        const expr = new BinaryExpression({
            left: createIntegerLiteral('5'),
            operator: createToken(TokenKind.Plus),
            right: createIntegerLiteral('3')
        });
        expect(expr.toString()).to.eql('5 + 3');
    });

    it('adds spaces around all binary operators', () => {
        for (const kind of [TokenKind.Plus, TokenKind.Minus, TokenKind.Star, TokenKind.Forwardslash, TokenKind.Backslash, TokenKind.Mod, TokenKind.Caret, TokenKind.Equal, TokenKind.LessGreater, TokenKind.Less, TokenKind.LessEqual, TokenKind.Greater, TokenKind.GreaterEqual, TokenKind.And, TokenKind.Or]) {
            const operator = createToken(kind);
            const expr = new BinaryExpression({
                left: createIntegerLiteral('5'),
                operator: operator,
                right: createIntegerLiteral('3')
            });
            expect(expr.toString()).to.eql(`5 ${operator.text} 3`);
        }
    });

    it('handles nested binary expressions', () => {
        const expr = new BinaryExpression({
            left: new GroupingExpression({
                leftParen: createToken(TokenKind.LeftParen),
                expression: new BinaryExpression({
                    left: createIntegerLiteral('5'),
                    operator: createToken(TokenKind.Plus),
                    right: createIntegerLiteral('3')
                }),
                rightParen: createToken(TokenKind.RightParen)
            }),
            operator: createToken(TokenKind.Star),
            right: createIntegerLiteral('2')
        });
        expect(expr.toString()).to.eql('(5 + 3) * 2');
    });

    it('does not add spaces to tokens parsed from source code', () => {
        const parsed = Parser.parse('x = 5+3').ast.statements[0] as AssignmentStatement;
        expect(parsed.value.toString()).to.eql(' 5+3');
    });

    it('adds spaces before synthetic tokens next to parsed tokens', () => {
        const parsed = Parser.parse('x = 5').ast.statements[0] as AssignmentStatement;
        const expr = new BinaryExpression({
            left: parsed.value,
            operator: createToken(TokenKind.Plus),
            right: createIntegerLiteral('3')
        });
        expect(expr.toString()).to.eql(' 5 + 3');
    });

    it('respects leading trivia provided by plugins', () => {
        const operator = createToken(TokenKind.Plus);
        operator.leadingTrivia = [createToken(TokenKind.Whitespace, '   ')];
        const expr = new BinaryExpression({
            left: createIntegerLiteral('5'),
            operator: operator,
            right: createIntegerLiteral('3')
        });
        expect(expr.toString()).to.eql('5   + 3');
    });

    it('handles unary expressions', () => {
        expect(new UnaryExpression({
            operator: createToken(TokenKind.Minus),
            right: createIntegerLiteral('5')
        }).toString()).to.eql('-5');

        expect(new UnaryExpression({
            operator: createToken(TokenKind.Not),
            right: createVariableExpression('isEnabled')
        }).toString()).to.eql('not isEnabled');
    });

    it('handles assignments', () => {
        expect(new AssignmentStatement({
            name: createIdentifier('x'),
            equals: createToken(TokenKind.Equal),
            value: createIntegerLiteral('10')
        }).toString()).to.eql('x = 10');
    });

    it('handles call expressions without commas', () => {
        expect(new CallExpression({
            callee: createVariableExpression('doSomething'),
            openingParen: createToken(TokenKind.LeftParen),
            args: [createIntegerLiteral('1'), createStringLiteral('two'), createVariableExpression('three')],
            closingParen: createToken(TokenKind.RightParen)
        }).toString()).to.eql('doSomething(1, "two", three)');
    });

    it('handles dotted and indexed gets', () => {
        const dotted = new DottedGetExpression({
            obj: createVariableExpression('m'),
            dot: createToken(TokenKind.Dot),
            name: createIdentifier('name')
        });
        expect(dotted.toString()).to.eql('m.name');

        expect(new IndexedGetExpression({
            obj: dotted,
            openingSquare: createToken(TokenKind.LeftSquareBracket),
            indexes: [createIntegerLiteral('0'), createIntegerLiteral('1')],
            closingSquare: createToken(TokenKind.RightSquareBracket)
        }).toString()).to.eql('m.name[0, 1]');
    });

    it('handles array and AA literals', () => {
        expect(new ArrayLiteralExpression({
            open: createToken(TokenKind.LeftSquareBracket),
            elements: [createIntegerLiteral('1'), createIntegerLiteral('2')],
            close: createToken(TokenKind.RightSquareBracket)
        }).toString()).to.eql('[1, 2]');

        expect(new AALiteralExpression({
            open: createToken(TokenKind.LeftCurlyBrace),
            elements: [
                new AAMemberExpression({
                    key: createIdentifier('name'),
                    colon: createToken(TokenKind.Colon),
                    value: createStringLiteral('bob')
                }),
                new AAMemberExpression({
                    key: createIdentifier('age'),
                    colon: createToken(TokenKind.Colon),
                    value: createIntegerLiteral('42')
                })
            ],
            close: createToken(TokenKind.RightCurlyBrace)
        }).toString()).to.eql('{\nname: "bob"\nage: 42\n}');
    });

    it('handles ternary expressions', () => {
        expect(new TernaryExpression({
            test: createVariableExpression('isEnabled'),
            questionMark: createToken(TokenKind.Question),
            consequent: createIntegerLiteral('1'),
            colon: createToken(TokenKind.Colon),
            alternate: createIntegerLiteral('2')
        }).toString()).to.eql('isEnabled ? 1 : 2');
    });

    it('handles template strings without begin and end tokens', () => {
        expect(new TemplateStringExpression({
            openingBacktick: createToken(TokenKind.BackTick),
            quasis: [
                new TemplateStringQuasiExpression({ expressions: [new LiteralExpression({ value: createToken(TokenKind.TemplateStringQuasi, 'hello ') })] }),
                new TemplateStringQuasiExpression({ expressions: [] })
            ],
            expressions: [createVariableExpression('name')],
            closingBacktick: createToken(TokenKind.BackTick)
        }).toString()).to.eql('`hello ${name}`');
    });

    it('handles functions', () => {
        const func = new FunctionStatement({
            name: createIdentifier('add'),
            func: new FunctionExpression({
                functionType: createToken(TokenKind.Function),
                leftParen: createToken(TokenKind.LeftParen),
                parameters: [
                    new FunctionParameterExpression({
                        name: createIdentifier('a'),
                        as: createToken(TokenKind.As),
                        typeExpression: new TypeExpression({ expression: createVariableExpression('integer') })
                    }),
                    new FunctionParameterExpression({
                        name: createIdentifier('b'),
                        equals: createToken(TokenKind.Equal),
                        defaultValue: createIntegerLiteral('1')
                    })
                ],
                rightParen: createToken(TokenKind.RightParen),
                as: createToken(TokenKind.As),
                returnTypeExpression: new TypeExpression({ expression: createVariableExpression('integer') }),
                body: new Block({
                    statements: [
                        new ReturnStatement({
                            return: createToken(TokenKind.Return),
                            value: new BinaryExpression({
                                left: createVariableExpression('a'),
                                operator: createToken(TokenKind.Plus),
                                right: createVariableExpression('b')
                            })
                        })
                    ]
                }),
                endFunctionType: createToken(TokenKind.EndFunction)
            })
        });
        expect(func.toString()).to.eql(
            'function add(a as integer, b = 1) as integer\n' +
            'return a + b\n' +
            'end function'
        );
    });

    it('handles control flow', () => {
        const ifStatement = new IfStatement({
            if: createToken(TokenKind.If),
            condition: createVariableExpression('isEnabled'),
            then: createToken(TokenKind.Then),
            thenBranch: new Block({
                statements: [new PrintStatement({ print: createToken(TokenKind.Print), expressions: [createStringLiteral('yes')] })]
            }),
            else: createToken(TokenKind.Else),
            elseBranch: new Block({
                statements: [new PrintStatement({ print: createToken(TokenKind.Print), expressions: [createStringLiteral('no')] })]
            }),
            endIf: createToken(TokenKind.EndIf)
        });
        expect(ifStatement.toString()).to.eql('if isEnabled then\nprint "yes"\nelse\nprint "no"\nend if');

        const forEach = new ForEachStatement({
            forEach: createToken(TokenKind.ForEach),
            item: createIdentifier('item'),
            in: createToken(TokenKind.In),
            target: createVariableExpression('items'),
            body: new Block({ statements: [] }),
            endFor: createToken(TokenKind.EndFor)
        });
        expect(forEach.toString()).to.eql('for each item in items\nend for');
    });

    it('handles classes and namespaces', () => {
        const namespace = new NamespaceStatement({
            namespace: createToken(TokenKind.Namespace),
            nameExpression: createVariableExpression('alpha'),
            body: new Body({
                statements: [
                    new ClassStatement({
                        class: createToken(TokenKind.Class),
                        name: createIdentifier('Person'),
                        body: [
                            new FieldStatement({
                                accessModifier: createToken(TokenKind.Public),
                                name: createIdentifier('name'),
                                as: createToken(TokenKind.As),
                                typeExpression: new TypeExpression({ expression: createVariableExpression('string') })
                            }),
                            new MethodStatement({
                                modifiers: [createToken(TokenKind.Private)],
                                override: createToken(TokenKind.Override),
                                name: createIdentifier('speak'),
                                func: new FunctionExpression({
                                    functionType: createToken(TokenKind.Sub),
                                    leftParen: createToken(TokenKind.LeftParen),
                                    rightParen: createToken(TokenKind.RightParen),
                                    body: new Block({ statements: [] }),
                                    endFunctionType: createToken(TokenKind.EndSub)
                                })
                            })
                        ],
                        endClass: createToken(TokenKind.EndClass)
                    })
                ]
            }),
            endNamespace: createToken(TokenKind.EndNamespace)
        });
        expect(namespace.toString()).to.eql(
            'namespace alpha\n' +
            'class Person\n' +
            'public name as string\n' +
            'private override sub speak()\n' +
            'end sub\n' +
            'end class\n' +
            'end namespace'
        );
    });

    it('handles nodes with missing children', () => {
        expect(new BinaryExpression({ left: undefined, operator: undefined, right: undefined }).toString()).to.eql('');
        expect(new CallExpression({ callee: createVariableExpression('doSomething') }).toString()).to.eql('doSomething');
        expect(new PrintStatement({ print: createToken(TokenKind.Print), expressions: [] }).toString()).to.eql('print');
    });

    it('handles tokens with empty or missing text', () => {
        expect(new BinaryExpression({
            left: new LiteralExpression({ value: { kind: TokenKind.IntegerLiteral } as Token }),
            operator: createToken(TokenKind.Plus, ''),
            right: createIntegerLiteral('')
        }).toString()).to.eql('');
    });

    it('produces code that can be parsed again', () => {
        const parser = Parser.parse(`
            sub main()
            end sub
        `);
        const func = parser.ast.statements[0] as FunctionStatement;
        func.func.body.statements.push(
            new AssignmentStatement({
                name: createIdentifier('x'),
                equals: createToken(TokenKind.Equal),
                value: new CallExpression({
                    callee: createVariableExpression('doSomething'),
                    openingParen: createToken(TokenKind.LeftParen),
                    args: [createIntegerLiteral('1'), createIntegerLiteral('2')],
                    closingParen: createToken(TokenKind.RightParen)
                })
            })
        );
        const reparsed = Parser.parse(parser.ast.toString());
        expect(reparsed.diagnostics).to.be.empty;
        expect(reparsed.ast.toString()).to.eql(parser.ast.toString());
    });
});
