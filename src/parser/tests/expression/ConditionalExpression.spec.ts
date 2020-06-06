/* eslint-disable @typescript-eslint/no-for-in-array */
import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { TokenKind, Lexer } from '../../../lexer';
import { Parser, ParseMode } from '../../Parser';
import { token, EOF } from '../Parser.spec';
import { BrsString, BrsBoolean } from '../../../brsTypes';
import { AssignmentStatement, ExpressionStatement } from '../../Statement';
import {TranspileState} from "../../TranspileState";

describe('parser conditional expressions', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`true ? "human" : "Zombie"`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    describe('conditional expressions as statements', () => {
        it('basic statement', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.QuestionMark, '?'),
                token(TokenKind.StringLiteral, 'Human', new BrsString('Human')),
                token(TokenKind.Colon, ':'),
                token(TokenKind.StringLiteral, 'Zombie', new BrsString('Zombie')),
                EOF
            ], { mode: ParseMode.BrighterScript });

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        // //expect(statements).toMatchSnapshot();
        });


        it(`supports various tests with primitive values:`, () => {
        //test as property
            for (const test in [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()',
                'm.myZombies[3].ifFed = true'
            ]) {

                let { tokens } = Lexer.scan(`${test} ? "human" : "zombie"`);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(ExpressionStatement);
            }
        });

        it(`supports non-primitive consequents:`, () => {
        //test as property
            for (const consequent in [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()',
                'm.myZombies[3].ifFed = true',
                'getZombieName'
            ]) {

                let { tokens } = Lexer.scan(`true ? ${consequent} : "zombie"`);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(ExpressionStatement);
            }
        });

        it(`supports non-primitive alternates:`, () => {
        //test as property
            for (const alternate in [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()',
                'm.myZombies[3].ifFed = true',
                'getZombieName'
            ]) {

                let { tokens } = Lexer.scan(`true ? "zombie" : ${alternate}`);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(ExpressionStatement);
            }
        });
    });
    describe('in assignment', () => {
        it(`simple case`, () => {
            let { tokens } = Lexer.scan(`a = true ? "human" : "zombie"`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line arrays case`, () => {
            let { tokens } = Lexer.scan(`a = true ? [
          "one"
          "two"
          "three"] : [
          "one"
          "two"
          "three"]`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
        it(`single line assoc array`, () => {
            let { tokens } = Lexer.scan(`a = true ? {"a":"a"} : {}`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
        it(`multi line assoc array`, () => {
            let { tokens } = Lexer.scan(`a = true ? {"a":"a"} : {
          "b": "test"
          }`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
        it(`multi line assoc array - both sides`, () => {
            let { tokens } = Lexer.scan(`a = true ? {
          "a":"a"
          "b":"b"
          } : {
          "b": "test"
          }`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`in func call`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains(a = true ? {"a":"a"} : {"b":"b"})`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

    });
});

describe('transpilation', () => {
    it('transpiles simple case', () => {
        let { tokens } = Lexer.scan(`true ? "human" : "Zombie"`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });

        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    it('generates scope for complex case', () => {
        let { tokens } = Lexer.scan(`true ? m.a + m.b(m.a, var1) : var2.name + process([var3, var4])`);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
        statements[0].transpile(null)
    });
});
