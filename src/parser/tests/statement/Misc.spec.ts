import { expect } from 'chai';

import { Parser } from '../../Parser';
import { Lexer, DisallowedLocalIdentifiersText, TokenKind } from '../../../lexer';
import { Range } from 'vscode-languageserver';

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
        let statementList = [];
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
        let { tokens } = Lexer.scan(`
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
            end sub
        `);
        let { diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
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
        expect(diagnostics).to.exist.and.be.lengthOf(0, 'Error count should be 0');
        expect(statements[0].func.body.statements[0].value.elements[0].text).to.equal('rem: 1');
        expect(statements[0].func.body.statements[1].value.elements[1].text).to.equal('rem: 2');
        expect(statements[0].func.body.statements[2].value.elements[0].text).to.equal('rem: 3: name: "bob"');
        expect(statements[0].func.body.statements[3].name.text).to.equal('rem');
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
        expect(diagnostics[0]?.message).not.to.exist;
        expect((statements[0] as any).func.body.statements[0].value.elements[0].keyToken.text).to.equal('"has-second-layer"');
        expect((statements[0] as any).func.body.statements[0].value.elements[0].key.value).to.equal('has-second-layer');
    });

    it('extracts property names for completion', () => {
        const { tokens } = Lexer.scan(`
            function main(arg as string)
                aa1 = {
                    "sprop1": 0,
                    prop1: 1
                    prop2: {
                        prop3: 2
                    }
                }
                aa2 = {
                    prop4: {
                        prop5: 5,
                        "sprop2": 0,
                        prop6: 6
                    },
                    prop7: 7
                }
                calling({
                    prop8: 8,
                    prop9: 9
                })
                aa1.field1 = 1
                aa1.field2.field3 = 2
                calling(aa2.field4, 3 + aa2.field5.field6)
            end function
        `);

        const expected = [
            'field1', 'field2', 'field3', 'field4', 'field5', 'field6',
            'prop1', 'prop2', 'prop3', 'prop4', 'prop5', 'prop6', 'prop7', 'prop8', 'prop9'
        ];

        const parser = Parser.parse(tokens);
        const { propertyHints: initialHints } = parser.references;
        expect(Object.keys(initialHints).sort()).to.deep.equal(expected, 'Initial hints');

        parser.invalidateReferences();
        const { propertyHints: refreshedHints } = parser.references;
        expect(Object.keys(refreshedHints).sort()).to.deep.equal(expected, 'Refreshed hints');
    });

    it('extracts property names matching JavaScript reserved names', () => {
        const { tokens } = Lexer.scan(`
            function main(arg as string)
                aa1 = {
                    "constructor": 0,
                    constructor: 1
                    valueOf: {
                        toString: 2
                    }
                }
                aa1.constructor = 1
                aa1.valueOf.toString = 2
            end function
        `);

        const expected = [
            'constructor', 'valueOf', 'toString'
        ];

        const parser = Parser.parse(tokens);
        const { propertyHints: initialHints } = parser.references;
        expect(Object.keys(initialHints).sort()).to.deep.equal(expected, 'Initial hints');

        parser.invalidateReferences();
        const { propertyHints: refreshedHints } = parser.references;
        expect(Object.keys(refreshedHints).sort()).to.deep.equal(expected, 'Refreshed hints');
    });
});
