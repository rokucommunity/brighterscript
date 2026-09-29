import { expect } from '../../../chai-config.spec';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import { Parser, ParseMode } from '../../Parser';
import { Program } from '../../../Program';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
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
            expect(arrayLit.elements).to.have.lengthOf(2);
            expect(isSpreadExpression(arrayLit.elements[0])).to.be.true;
            expect(isSpreadExpression(arrayLit.elements[1])).to.be.true;
        });

        it('parses plain arrays without spread elements', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [1, 2, 3]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            expect((value as ArrayLiteralExpression).elements.some(e => isSpreadExpression(e))).to.be.false;
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

    describe('parser - whitespace after ...', () => {
        it('allows spread when the operand is directly next to ...', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [...arr, ...m.list, ...getItems()]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            expect((value as ArrayLiteralExpression).elements).to.have.lengthOf(3);
        });

        it('allows whitespace between ... and its operand in an array literal', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [... arr, ...  m.list]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let arrayLit = value as ArrayLiteralExpression;
            expect(arrayLit.elements).to.have.lengthOf(2);
            expect(isSpreadExpression(arrayLit.elements[0])).to.be.true;
            expect(isSpreadExpression(arrayLit.elements[1])).to.be.true;
        });

        it('allows whitespace between ... and its operand in an AA literal', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = {... other}
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            let aaLit = value as AALiteralExpression;
            expect(aaLit.elements).to.have.lengthOf(1);
            expect(isSpreadExpression(aaLit.elements[0])).to.be.true;
        });

        it('allows a tab between ... and its operand', () => {
            let { value, diagnostics } = parseFirstAssignmentValue(`
                sub main()
                    result = [...\tarr]
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            expect(isSpreadExpression((value as ArrayLiteralExpression).elements[0])).to.be.true;
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

    describe('validation', () => {
        let rootDir = process.cwd();
        let program: Program;

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });
        afterEach(() => {
            program.dispose();
        });

        it('allows spread when the literal is assigned to a variable, property, or index', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = [1]
                    a = [...arr]
                    m.b = [...arr]
                    m["c"] = {...m}
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags spread in a function argument', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = [1]
                    takesArray([...arr])
                end sub
                sub takesArray(value)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere()
            ]);
        });

        it('flags spread in a return statement', () => {
            program.setFile('source/main.bs', `
                function main()
                    arr = [1]
                    return [...arr]
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere()
            ]);
        });

        it('flags spread in a nested literal', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = [1]
                    result = [[...arr]]
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere()
            ]);
        });

        it('flags spread in an augmented assignment', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = [1]
                    arr += [...arr]
                end sub
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere()
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

        it('keeps leading elements in the literal and appends the rest', async () => {
            await testTranspile(`
                sub main()
                    defaults = [1, 2]
                    result = [0, ...defaults, 4]
                end sub
            `, `
                sub main()
                    defaults = [
                        1
                        2
                    ]
                    result = [
                        0
                    ]
                    result.append(defaults)
                    result.push(4)
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
                    result = []
                    result.append(arr)
                end sub
            `);
        });

        it('preserves element order across multiple spreads', async () => {
            await testTranspile(`
                sub main()
                    arr1 = [1]
                    arr2 = [2]
                    result = [...arr1, 5, ...arr2]
                end sub
            `, `
                sub main()
                    arr1 = [
                        1
                    ]
                    arr2 = [
                        2
                    ]
                    result = []
                    result.append(arr1)
                    result.push(5)
                    result.append(arr2)
                end sub
            `);
        });

        it('transpiles AA spread with leading and trailing members', async () => {
            await testTranspile(`
                sub main()
                    obj = {}
                    result = {a: 1, ...obj, b: 2}
                end sub
            `, `
                sub main()
                    obj = {}
                    result = {
                        a: 1
                    }
                    result.append(obj)
                    result.b = 2
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
                    result = {}
                    result.append(obj)
                end sub
            `);
        });

        it('uses indexed set for string-literal and computed keys after a spread', async () => {
            await testTranspile(`
                const KEY = "k"
                sub main()
                    obj = {}
                    result = {...obj, "my-key": 1, [KEY]: 2}
                end sub
            `, `
                sub main()
                    obj = {}
                    result = {}
                    result.append(obj)
                    result["my-key"] = 1
                    result["k"] = 2
                end sub
            `);
        });

        it('never groups trailing AA members into an append', async () => {
            await testTranspile(`
                sub main()
                    obj = {}
                    result = {...obj, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8}
                end sub
            `, `
                sub main()
                    obj = {}
                    result = {}
                    result.append(obj)
                    result.a = 1
                    result.b = 2
                    result.c = 3
                    result.d = 4
                    result.e = 5
                    result.f = 6
                    result.g = 7
                    result.h = 8
                end sub
            `);
        });

        it('keeps pushing trailing array elements below the append threshold', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    result = [...arr, 1, 2, 3, 4, 5, 6, 7]
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    result = []
                    result.append(arr)
                    result.push(1)
                    result.push(2)
                    result.push(3)
                    result.push(4)
                    result.push(5)
                    result.push(6)
                    result.push(7)
                end sub
            `);
        });

        it('appends a long run of trailing array elements as one literal', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    result = [...arr, 1, 2, 3, 4, 5, 6, 7, 8, ...arr]
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    result = []
                    result.append(arr)
                    result.append([
                        1
                        2
                        3
                        4
                        5
                        6
                        7
                        8
                    ])
                    result.append(arr)
                end sub
            `);
        });

        it('builds in a temp when assigned to a property', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    m.list = [...arr]
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    __bsc_tmp_list = []
                    __bsc_tmp_list.append(arr)
                    m.list = __bsc_tmp_list
                end sub
            `);
        });

        it('builds in a temp when assigned to an index', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    m["list"] = [...arr]
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    __bsc_tmp_list = []
                    __bsc_tmp_list.append(arr)
                    m["list"] = __bsc_tmp_list
                end sub
            `);
        });

        it('names the temp after a variable or numeric index key', async () => {
            await testTranspile(`
                sub main()
                    arr = [1]
                    key = "list"
                    m[key] = [...arr]
                    m.rows[0] = [...arr]
                    m["first name"] = {...arr}
                end sub
            `, `
                sub main()
                    arr = [
                        1
                    ]
                    key = "list"
                    __bsc_tmp_key = []
                    __bsc_tmp_key.append(arr)
                    m[key] = __bsc_tmp_key
                    __bsc_tmp_0 = []
                    __bsc_tmp_0.append(arr)
                    m.rows[0] = __bsc_tmp_0
                    __bsc_tmp_first_name = {}
                    __bsc_tmp_first_name.append(arr)
                    m["first name"] = __bsc_tmp_first_name
                end sub
            `);
        });

        it('builds in a temp when a trailing element reads the target variable', async () => {
            await testTranspile(`
                sub main()
                    list = [1]
                    list = [...list, 4]
                end sub
            `, `
                sub main()
                    list = [
                        1
                    ]
                    __bsc_tmp_list = []
                    __bsc_tmp_list.append(list)
                    __bsc_tmp_list.push(4)
                    list = __bsc_tmp_list
                end sub
            `);
        });

        it('temp path keeps the original property value readable', async () => {
            await testTranspile(`
                sub main()
                    m.list = [...m.list, 4]
                end sub
            `, `
                sub main()
                    __bsc_tmp_list = []
                    __bsc_tmp_list.append(m.list)
                    __bsc_tmp_list.push(4)
                    m.list = __bsc_tmp_list
                end sub
            `);
        });

        it('does not use a temp for a local target that is not read by trailing elements', async () => {
            await testTranspile(`
                sub main()
                    other = [1]
                    list = [...other]
                end sub
            `, `
                sub main()
                    other = [
                        1
                    ]
                    list = []
                    list.append(other)
                end sub
            `);
        });

        it('still lowers a ternary inside a trailing AA member', async () => {
            await testTranspile(`
                sub main()
                    obj = {}
                    x = true
                    result = {...obj, b: x ? 1 : 2}
                end sub
            `, `
                sub main()
                    obj = {}
                    x = true
                    result = {}
                    result.append(obj)
                    if x then
                        result.b = 1
                    else
                        result.b = 2
                    end if
                end sub
            `);
        });

        it('leaves arrays without spread untouched', async () => {
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

        it('leaves AAs without spread untouched', async () => {
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
