import { expect } from '../../../chai-config.spec';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import { Parser, ParseMode } from '../../Parser';
import { Program } from '../../../Program';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
import { isArrayLiteralExpression, isSpreadExpression, isAALiteralExpression, isAssignmentStatement } from '../../../astUtils/reflection';
import type { AssignmentStatement } from '../../Statement';
import type { AALiteralExpression, ArrayLiteralExpression } from '../../Expression';
import type { BrsFile } from '../../../files/BrsFile';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';

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

        it('flags only the inner spread when nested inside a valid outer spread', () => {
            program.setFile('source/main.bs', `
                sub main()
                    alpha = []
                    beta = []
                    charlie = [...alpha, [1, ...beta]]
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere()
            ]);
            //the diagnostic points at `...beta`, not the (valid) outer `...alpha`
            const range = program.getDiagnostics()[0].location.range;
            expect(range.start.line).to.equal(4);
            expect(range.start.character).to.equal(45);
        });

        it('flags spread in a nested AA member', () => {
            program.setFile('source/main.bs', `
                sub main()
                    alpha = []
                    alphaAA = {}
                    result = { a: [...alpha] }
                    other = { ...alphaAA, b: { ...alphaAA } }
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere(),
                DiagnosticMessages.spreadOperatorNotAllowedHere()
            ]);
        });

        it('flags spread in a function argument when the call is assigned to a variable', () => {
            program.setFile('source/main.bs', `
                sub main()
                    alpha = []
                    charlie = callFunction([...alpha])
                    m.delta = callFunction({...alpha})
                end sub
                function callFunction(value)
                    return value
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.spreadOperatorNotAllowedHere(),
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
        describe('spread value type', () => {
            it('flags spreading an integer into an AA literal', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        a = { ...5 }
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.spreadValueTypeMismatch('integer', 'associative array')
                ]);
            });

            it('flags spreading an AA into an array literal', () => {
                program.setFile('source/main.bs', `
                    sub main(someAA as roAssociativeArray)
                        b = [ ...someAA ]
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.spreadValueTypeMismatch('roAssociativeArray', 'array')
                ]);
            });

            it('flags spreading invalid', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        c = { ...invalid }
                        d = [ ...invalid ]
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.spreadValueTypeMismatch('invalid', 'associative array'),
                    DiagnosticMessages.spreadValueTypeMismatch('invalid', 'array')
                ]);
            });

            it('flags spreading a node into an AA literal', () => {
                program.setFile('source/main.bs', `
                    sub main(node as roSGNode)
                        d = { ...node }
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.spreadValueTypeMismatch('roSGNodeNode', 'associative array')
                ]);
            });

            it('flags spreading an array into an AA literal', () => {
                program.setFile('source/main.bs', `
                    sub main(someArray as integer[])
                        e = { ...someArray }
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.spreadValueTypeMismatch('Array<integer>', 'associative array')
                ]);
            });

            it('flags spreading primitives and interfaces into an array literal', () => {
                program.setFile('source/main.bs', `
                    interface Thing
                        color as string
                    end interface
                    sub main(name as string, thing as Thing)
                        f = [ ...name ]
                        g = [ ...thing ]
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.spreadValueTypeMismatch('string', 'array'),
                    DiagnosticMessages.spreadValueTypeMismatch('Thing', 'array')
                ]);
            });

            it('allows dynamic, object, and unresolvable values', () => {
                program.setFile('source/main.bs', `
                    sub main(dyn as dynamic, obj as object)
                        a = { ...dyn }
                        b = [ ...dyn ]
                        c = { ...obj }
                        d = [ ...obj ]
                        e = { ...m.config }
                        f = [ ...m.list ]
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows correctly typed array and AA values', () => {
                program.setFile('source/main.bs', `
                    interface Thing
                        color as string
                    end interface
                    class Widget
                        size = 1
                    end class
                    sub main(someAA as roAssociativeArray, someArray as integer[], thing as Thing, widgetInstance as Widget, roListValue as roList, arr as roArray)
                        a = { ...someAA }
                        b = [ ...someArray ]
                        c = { ...thing }
                        d = { ...widgetInstance }
                        e = [ ...roListValue ]
                        f = [ ...arr ]
                        g = [ ...[1, 2] ]
                        h = { ...{ a: 1 } }
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows a union that could hold an allowed value', () => {
                program.setFile('source/main.bs', `
                    sub main(flag as boolean)
                        x = [1]
                        if flag then x = {}
                        y = { ...x }
                        z = [ ...x ]
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('does not flag AA members that share a name with a built-in method', () => {
                program.setFile('components/Comp.xml', `<?xml version="1.0" encoding="utf-8" ?><component name="Comp" extends="Group"><script uri="Comp.bs"/></component>`);
                program.setFile('components/Comp.bs', `
                    sub init()
                        m.items = [ ...m.items, 1 ]
                        m.count = { ...m.count }
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        it('includes the members of a spread AA literal in the inferred type', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                interface Thing
                    color as string
                    size as integer
                end interface
                sub take(t as Thing)
                end sub
                sub main()
                    defaults = { color: "red", size: 1 }
                    d = { ...defaults, size: 2 }
                    take(d)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const dAssignment = file.ast.findChildren<AssignmentStatement>(isAssignmentStatement).find(x => x.tokens.name.text === 'd');
            const dType = dAssignment.value.getType({ flags: SymbolTypeFlag.runtime });
            expect(dType.getMemberTable().getOwnSymbols(SymbolTypeFlag.runtime).map(x => x.name).sort()).to.eql(['color', 'size']);
            expect(dType.getMemberType('color', { flags: SymbolTypeFlag.runtime }).toString()).to.equal('string');
            expect(dType.getMemberType('size', { flags: SymbolTypeFlag.runtime }).toString()).to.equal('integer');
        });

        it('includes the members of a spread interface-typed value in the inferred type', () => {
            program.setFile('source/main.bs', `
                interface Thing
                    color as string
                    size as integer
                end interface
                sub take(t as Thing)
                end sub
                sub main(defaults as Thing)
                    d = { ...defaults, size: 2 }
                    take(d)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('lets a member after a spread replace the spread member type', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    defaults = { size: 1 }
                    d = { ...defaults, size: "large" }
                    e = { size: "large", ...defaults }
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assignments = file.ast.findChildren<AssignmentStatement>(isAssignmentStatement);
            const dType = assignments.find(x => x.tokens.name.text === 'd').value.getType({ flags: SymbolTypeFlag.runtime });
            expect(dType.getMemberType('size', { flags: SymbolTypeFlag.runtime }).toString()).to.equal('string');
            const eType = assignments.find(x => x.tokens.name.text === 'e').value.getType({ flags: SymbolTypeFlag.runtime });
            expect(eType.getMemberType('size', { flags: SymbolTypeFlag.runtime }).toString()).to.equal('integer');
        });

        it('does not add members when the spread value type is unknown', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(other as dynamic)
                    d = { ...other, size: 2 }
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const dAssignment = file.ast.findChildren<AssignmentStatement>(isAssignmentStatement).find(x => x.tokens.name.text === 'd');
            const dType = dAssignment.value.getType({ flags: SymbolTypeFlag.runtime });
            expect(dType.getMemberTable().getOwnSymbols(SymbolTypeFlag.runtime).map(x => x.name)).to.eql(['size']);
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
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(arr)
                    m.list = __bsc_tmp_spread
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
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(arr)
                    m["list"] = __bsc_tmp_spread
                end sub
            `);
        });

        it('evaluates trailing elements before a call in the index target, matching native order', async () => {
            await testTranspile(`
                sub main()
                    a = [1]
                    store = {}
                    store[nextKey()] = [...a, f()]
                end sub
                function nextKey()
                    return "k"
                end function
                function f()
                    return 1
                end function
            `, `
                sub main()
                    a = [
                        1
                    ]
                    store = {}
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(a)
                    __bsc_tmp_spread.push(f())
                    store[nextKey()] = __bsc_tmp_spread
                end sub

                function nextKey()
                    return "k"
                end function

                function f()
                    return 1
                end function
            `);
        });

        it('evaluates trailing elements before a call in the object of a property target, matching native order', async () => {
            await testTranspile(`
                sub main()
                    a = [1]
                    getObj().list = [...a, f()]
                end sub
                function getObj()
                    return {}
                end function
                function f()
                    return 1
                end function
            `, `
                sub main()
                    a = [
                        1
                    ]
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(a)
                    __bsc_tmp_spread.push(f())
                    getObj().list = __bsc_tmp_spread
                end sub

                function getObj()
                    return {}
                end function

                function f()
                    return 1
                end function
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
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(list)
                    __bsc_tmp_spread.push(4)
                    list = __bsc_tmp_spread
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
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(m.list)
                    __bsc_tmp_spread.push(4)
                    m.list = __bsc_tmp_spread
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

        it('moves a comment before a trailing array element above its push statement', async () => {
            await testTranspile(`
                sub main()
                    a = [1]
                    q = [ ...a
                        ' note
                        1
                    ]
                end sub
            `, `
                sub main()
                    a = [
                        1
                    ]
                    q = []
                    q.append(a)
                    ' note
                    q.push(1)
                end sub
            `);
        });

        it('moves a comment before a trailing AA member above its set statement', async () => {
            await testTranspile(`
                sub main()
                    a = {}
                    q = {
                        ...a
                        ' first
                        foo: 1
                        ' second
                        "bar": 2
                    }
                end sub
            `, `
                sub main()
                    a = {}
                    q = {}
                    q.append(a)
                    ' first
                    q.foo = 1
                    ' second
                    q["bar"] = 2
                end sub
            `);
        });

        it('keeps a same-line comment after a spread out of the next statement', async () => {
            await testTranspile(`
                sub main()
                    a = {}
                    q = { ...a ' c
                        foo: 1 }
                end sub
            `, `
                sub main()
                    a = {}
                    q = {}
                    q.append(a) ' c
                    q.foo = 1
                end sub
            `);
        });

        it('moves a comment before a spread above its append statement', async () => {
            await testTranspile(`
                sub main()
                    a = [1]
                    b = [2]
                    q = [
                        ...a
                        ' merge b too
                        ...b
                    ]
                end sub
            `, `
                sub main()
                    a = [
                        1
                    ]
                    b = [
                        2
                    ]
                    q = []
                    q.append(a)
                    ' merge b too
                    q.append(b)
                end sub
            `);
        });

        it('preserves the case of quoted keys after a spread', async () => {
            await testTranspile(`
                sub main()
                    x = {}
                    r = { ...x, "userId": 1, userName: 2 }
                end sub
            `, `
                sub main()
                    x = {}
                    r = {}
                    r.append(x)
                    r["userId"] = 1
                    r.userName = 2
                end sub
            `);
        });

        it('builds in a temp when a spread of the target follows a leading array element', async () => {
            await testTranspile(`
                sub main()
                    list = [1]
                    list = [0, ...list]
                end sub
            `, `
                sub main()
                    list = [
                        1
                    ]
                    __bsc_tmp_spread = [
                        0
                    ]
                    __bsc_tmp_spread.append(list)
                    list = __bsc_tmp_spread
                end sub
            `);
        });

        it('builds in a temp when a spread of the target follows a leading AA member', async () => {
            await testTranspile(`
                sub main()
                    aa = { b: 2 }
                    aa = { a: 1, ...aa }
                end sub
            `, `
                sub main()
                    aa = {
                        b: 2
                    }
                    __bsc_tmp_spread = {
                        a: 1
                    }
                    __bsc_tmp_spread.append(aa)
                    aa = __bsc_tmp_spread
                end sub
            `);
        });

        it('builds in a temp when a spread reads a property of the target', async () => {
            await testTranspile(`
                sub main()
                    aa = { inner: { b: 2 } }
                    aa = { ...aa.inner, x: 1 }
                end sub
            `, `
                sub main()
                    aa = {
                        inner: {
                            b: 2
                        }
                    }
                    __bsc_tmp_spread = {}
                    __bsc_tmp_spread.append(aa.inner)
                    __bsc_tmp_spread.x = 1
                    aa = __bsc_tmp_spread
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
