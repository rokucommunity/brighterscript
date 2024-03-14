import { expect } from '../../../chai-config.spec';
import { Parser } from '../../Parser';
import { Lexer } from '../../../lexer/Lexer';
import { DisallowedLocalIdentifiersText, TokenKind } from '../../../lexer/TokenKind';
import { Range } from 'vscode-languageserver';
import type { AAMemberExpression } from '../../Expression';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import type { Statement } from '../../AstNode';
import { isAAMemberExpression, isDottedSetStatement } from '../../../astUtils/reflection';

describe('parser', () => {
    describe('`end` keyword', () => {
        it('does not produce diagnostics', () => {
            let { tokens } = Lexer.scan(`
                sub Main()
                    end
                end sub
            `);
            let { diagnostics } = Parser.parse(tokens);
            expect(diagnostics[0]?.message).to.not.exist;
        });
        it('can be used as a property name on objects', () => {
            let { tokens } = Lexer.scan(`
                sub Main()
                    person = {
                        end: true
                    }
                end sub
            `);
            let { diagnostics } = Parser.parse(tokens);
            expect(diagnostics).to.be.lengthOf(0);
        });

        it('is not allowed as a standalone variable', () => {
            //this test depends on token locations, so use the lexer to generate those locations.
            let { tokens } = Lexer.scan(`sub Main()\n    else = true\nend sub`);
            let { diagnostics } = Parser.parse(tokens);
            expect(diagnostics).to.be.lengthOf(1);
            //specifically check for the error location, because the identifier location was wrong in the past
            expect(diagnostics[0].range).to.deep.include(
                Range.create(1, 4, 1, 8)
            );
        });
    });

    it('certain reserved words are allowed as local var identifiers', () => {
        let { tokens } = Lexer.scan(`
            sub Main()
                endfor = true
                double = true
                exitfor = true
                float = true
                foreach = true
                integer = true
                longinteger = true
                string = true
            end sub
        `);
        let { diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('most reserved words are not allowed as local var identifiers', () => {
        let statementList: Statement[][] = [];
        [...DisallowedLocalIdentifiersText].filter(x => x === 'if').forEach((disallowedIdentifier) => {
            //use the lexer to generate tokens because there are many different TokenKind types represented in this list
            let { tokens } = Lexer.scan(`
                sub main()
                    ${disallowedIdentifier} = true
                end sub
            `);
            let { statements, diagnostics } = Parser.parse(tokens);
            if (diagnostics.length === 0) {
                console.log(DisallowedLocalIdentifiersText);
                throw new Error(`'${disallowedIdentifier}' cannot be used as an identifier, but was not detected as an error`);
            }
            statementList.push(statements);
        });
    });

    it('allows certain TokenKinds to be treated as local variables', () => {
        //a few additional keywords that we don't have tokenKinds for
        expectZeroDiagnostics(
            Parser.parse(`
                sub main()
                    Void = true
                    Number = true
                    Boolean = true
                    Integer = true
                    LongInteger = true
                    Float = true
                    Double = true
                    String = true
                    Object = true
                    Interface = true
                    Dynamic = true
                    Class = true
                    Namespace = true
                end sub
            `)
        );
    });

    it('allows certain TokenKinds as object properties', () => {
        let kinds = [
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
            TokenKind.As
        ].map(x => x.toLowerCase());

        for (let kind of kinds) {
            let { tokens } = Lexer.scan(`
                obj = {
                    ${kind}: true
                }
                obj.${kind} = false
                theValue = obj.${kind}
            `);
            let { diagnostics } = Parser.parse(tokens);
            if (diagnostics.length > 0) {
                throw new Error(
                    `Using "${kind}" as object property. Expected no diagnostics, but received: ${JSON.stringify(diagnostics)}`);
            }
            expect(diagnostics).to.be.lengthOf(0);
        }
    });

    it('allows whitelisted reserved words as object properties', () => {
        //use the lexer to generate token list because...this list is huge.
        let { tokens } = Lexer.scan(`
            sub Main()
                person = {}
                person.and = true
                person.box = true
                person.createobject = true
                person.dim = true
                person.double = true
                person.each = true
                person.else = true
                person.elseif = true
                person.end = true
                person.endfor = true
                person.endfunction = true
                person.endif = true
                person.endsub = true
                person.endwhile = true
                person.eval = true
                person.exit = true
                person.exitfor = true
                person.exitwhile = true
                person.false = true
                person.float = true
                person.for = true
                person.foreach = true
                person.function = true
                person.getglobalaa = true
                person.getlastruncompileerror = true
                person.getlastrunruntimeerror = true
                person.goto = true
                person.if = true
                person.integer = true
                person.invalid = true
                person.let = true
                person.line_num = true
                person.longinteger = true
                person.next = true
                person.not = true
                person.objfun = true
                person.or = true
                person.pos = true
                person.print = true
                'this one is broken
                'person.rem = true
                person.return = true
                person.run = true
                person.step = true
                person.stop = true
                person.string = true
                person.sub = true
                person.tab = true
                person.then = true
                person.to = true
                person.true = true
                person.type = true
                person.while = true
            end sub
        `);
        let { diagnostics } = Parser.parse(tokens);
        expect(JSON.stringify(diagnostics[0])).not.to.exist;
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('allows rem as a property name only in certain situations', () => {
        let { tokens } = Lexer.scan(`
            function main ()
                person = {
                    rem: 1
                }
                person = {
                    name: "bob": rem: 2
                }
                person = {
                    rem: 3: name: "bob"
                }
                person.rem = 4
            end function
            `
        );
        let { diagnostics, statements } = Parser.parse(tokens) as any;
        expectZeroDiagnostics(diagnostics);
        const mainStatements = statements[0].func.body.statements;

        // 1st AA has no elements - `rem` denotes comment
        expect(mainStatements[0].value.elements.length).to.eq(0);
        let commentBeforeClose = mainStatements[0].value.tokens.close.leadingTrivia[2];
        expect(commentBeforeClose.kind).to.equal(TokenKind.Comment);
        expect(commentBeforeClose.text).to.equal('rem: 1');

        // 2nd AA has 1 element - `rem` after colon denotes comment, but first AA member is valid
        expect(mainStatements[1].value.elements.length).to.eq(1);
        expect(isAAMemberExpression(mainStatements[1].value.elements[0])).to.true;
        expect(mainStatements[1].value.elements[0].tokens.key.text).to.equal('name');
        expect(mainStatements[1].value.elements[0].value.tokens.value.text).to.equal('"bob"');
        commentBeforeClose = mainStatements[1].value.tokens.close.leadingTrivia[2];
        expect(commentBeforeClose.kind).to.equal(TokenKind.Comment);
        expect(commentBeforeClose.text).to.equal('rem: 2');

        // 3nd AA has no elements - `rem` colons are included in comments
        expect(mainStatements[2].value.elements.length).to.eq(0);
        commentBeforeClose = mainStatements[2].value.tokens.close.leadingTrivia[2];
        expect(commentBeforeClose.kind).to.equal(TokenKind.Comment);
        expect(commentBeforeClose.text).to.equal('rem: 3: name: "bob"');

        // `rem` CAN be uses a property of an AA, when preceded by '.'
        expect(isDottedSetStatement(mainStatements[3])).to.true;
        expect(mainStatements[3].tokens.name.kind).to.equal(TokenKind.Identifier);
        expect(mainStatements[3].tokens.name.text).to.equal('rem');
    });

    it('handles quoted AA keys', () => {
        let { tokens } = Lexer.scan(`
            function main(arg as string)
                twoDimensional = {
                    "has-second-layer": true,
                    level: 1
                    secondLayer: {
                        level: 2
                    }
                }
            end function
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        let element = ((statements as any)[0].func.body.statements[0].value.elements[0] as AAMemberExpression);
        expect(diagnostics[0]?.message).not.to.exist;
        expect(element.tokens.key.text).to.equal('"has-second-layer"');
    });

});
