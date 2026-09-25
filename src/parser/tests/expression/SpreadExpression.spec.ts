import { expect } from '../../../chai-config.spec';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import { Parser, ParseMode } from '../../Parser';
import { Program } from '../../../Program';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
import { isArrayLiteralExpression, isSpreadExpression, isAALiteralExpression } from '../../../astUtils/reflection';
import type { AssignmentStatement } from '../../Statement';
import type { AALiteralExpression, ArrayLiteralExpression } from '../../Expression';

describe('SpreadExpression', () => {
    function parseFirstAssignmentValue(source: string, mode = ParseMode.BrighterScript) {
        let { ast, diagnostics } = Parser.parse(source, { mode: mode });
        let assignStmt = (ast.statements[0] as any).func.body.statements[0] as AssignmentStatement;
        return { value: assignStmt.value, diagnostics: diagnostics };
    }

    describe('lexer', () => {
        it('tokenizes ... as DotDotDot', () => {
            let { tokens } = Lexer.scan('...');
            expect(tokens[0].kind).to.equal(TokenKind.DotDotDot);
        });

        it('does not tokenize .. as DotDotDot', () => {
            let { tokens } = Lexer.scan('..');
            expect(tokens[0].kind).to.equal(TokenKind.Dot);
            expect(tokens[1].kind).to.equal(TokenKind.Dot);
        });
    });

    describe('parser - array spread', () => {
        it('parses spread in array literal', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [1, ...arr, 2]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let arrayLit = value as ArrayLiteralExpression;
            expect(isArrayLiteralExpression(arrayLit)).to.be.true;
            expect(arrayLit.hasSpread).to.be.true;
            expect(arrayLit.elements).to.have.lengthOf(3);
            expect(isSpreadExpression(arrayLit.elements[1])).to.be.true;
        });

        it('parses spread as first element', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [...arr]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let arrayLit = value as ArrayLiteralExpression;
            expect(arrayLit.hasSpread).to.be.true;
            expect(arrayLit.elements).to.have.lengthOf(1);
            expect(isSpreadExpression(arrayLit.elements[0])).to.be.true;
        });

        it('parses multiple spreads', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [...arr1, ...arr2]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let arrayLit = value as ArrayLiteralExpression;
            expect(arrayLit.hasSpread).to.be.true;
            expect(arrayLit.elements).to.have.lengthOf(2);
            expect(isSpreadExpression(arrayLit.elements[0])).to.be.true;
            expect(isSpreadExpression(arrayLit.elements[1])).to.be.true;
        });

        it('hasSpread is false when no spread elements', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [1, 2, 3]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            expect((value as ArrayLiteralExpression).hasSpread).to.be.false;
        });

        it('flags spread as a BrighterScript-only feature in brs mode', () => {
            let { diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [...arr]
                end sub
            `, ParseMode.BrightScript);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('spread operator')
            ]);
        });
    });

    describe('parser - AA spread', () => {
        it('parses spread in AA literal', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = {a: 1, ...obj, b: 2}
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let aaLit = value as AALiteralExpression;
            expect(isAALiteralExpression(aaLit)).to.be.true;
            expect(aaLit.hasSpread).to.be.true;
            expect(aaLit.elements).to.have.lengthOf(3);
            expect(isSpreadExpression(aaLit.elements[1])).to.be.true;
        });

        it('parses spread as first element in AA', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = {...obj}
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let aaLit = value as AALiteralExpression;
            expect(aaLit.hasSpread).to.be.true;
            expect(aaLit.elements).to.have.lengthOf(1);
            expect(isSpreadExpression(aaLit.elements[0])).to.be.true;
        });

        it('parses multiple spreads in AA', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = {...obj1, ...obj2}
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let aaLit = value as AALiteralExpression;
            expect(aaLit.hasSpread).to.be.true;
            expect(aaLit.elements).to.have.lengthOf(2);
        });

        it('flags spread as a BrighterScript-only feature in brs mode', () => {
            let { diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = {...obj}
                end sub
            `, ParseMode.BrightScript);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('spread operator')
            ]);
        });
    });

    describe('transpile', () => {
        let rootDir = process.cwd();
        let program: Program;
        let testTranspile = getTestTranspile(() => [program, rootDir]);

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });
        afterEach(() => {
            program.dispose();
        });

        it('transpiles array spread to IIFE with append', async () => {
            await testTranspile(`
                sub main()
                    arr = [10, 20]
                    result = [1, ...arr, 2]
                end sub
            `, `
                sub main()
                    arr = [
                        10
                        20
                    ]
                    result = (function(arr)
                        __bsc_tmp = []
                        __bsc_tmp.push(1)
                        __bsc_tmp.append(arr)
                        __bsc_tmp.push(2)
                        return __bsc_tmp
                    end function)(arr)
                end sub
            `);
        });

        it('transpiles array with only spread', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    result = [...arr]
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    result = (function(arr)
                        __bsc_tmp = []
                        __bsc_tmp.append(arr)
                        return __bsc_tmp
                    end function)(arr)
                end sub
            `);
        });

        it('transpiles array with multiple spreads', async () => {
            await testTranspile(`
                sub main()
                    arr1 = [1]
                    arr2 = [2]
                    result = [...arr1, ...arr2]
                end sub
            `, `
                sub main()
                    arr1 = [
                        1
                    ]
                    arr2 = [
                        2
                    ]
                    result = (function(arr1, arr2)
                        __bsc_tmp = []
                        __bsc_tmp.append(arr1)
                        __bsc_tmp.append(arr2)
                        return __bsc_tmp
                    end function)(arr1, arr2)
                end sub
            `);
        });

        it('transpiles AA spread to IIFE with append', async () => {
            await testTranspile(`
                sub main()
                    obj = {}
                    result = {a: 1, ...obj, b: 2}
                end sub
            `, `
                sub main()
                    obj = {}
                    result = (function(obj)
                        __bsc_tmp = {}
                        __bsc_tmp.a = 1
                        __bsc_tmp.append(obj)
                        __bsc_tmp.b = 2
                        return __bsc_tmp
                    end function)(obj)
                end sub
            `);
        });

        it('transpiles AA with only spread', async () => {
            await testTranspile(`
                sub main()
                    obj = {}
                    result = {...obj}
                end sub
            `, `
                sub main()
                    obj = {}
                    result = (function(obj)
                        __bsc_tmp = {}
                        __bsc_tmp.append(obj)
                        return __bsc_tmp
                    end function)(obj)
                end sub
            `);
        });

        it('passes locals referenced by non-spread elements into the IIFE', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    x = 2
                    result = [x, ...arr, x + 1]
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    x = 2
                    result = (function(arr, x)
                        __bsc_tmp = []
                        __bsc_tmp.push(x)
                        __bsc_tmp.append(arr)
                        __bsc_tmp.push(x + 1)
                        return __bsc_tmp
                    end function)(arr, x)
                end sub
            `);
        });

        it('does not pass non-referenceable global functions into the IIFE', async () => {
            await testTranspile(`
                sub main()
                    obj = {}
                    result = {...obj, node: createObject("roSGNode", "Node")}
                end sub
            `, `
                sub main()
                    obj = {}
                    result = (function(obj)
                        __bsc_tmp = {}
                        __bsc_tmp.append(obj)
                        __bsc_tmp.node = createObject("roSGNode", "Node")
                        return __bsc_tmp
                    end function)(obj)
                end sub
            `);
        });

        it('does not use IIFE for arrays without spread', async () => {
            await testTranspile(`
                sub main()
                    result = [1, 2, 3]
                end sub
            `, `
                sub main()
                    result = [
                        1
                        2
                        3
                    ]
                end sub
            `);
        });

        it('does not use IIFE for AAs without spread', async () => {
            await testTranspile(`
                sub main()
                    result = {a: 1, b: 2}
                end sub
            `, `
                sub main()
                    result = {
                        a: 1
                        b: 2
                    }
                end sub
            `);
        });
    });
});
