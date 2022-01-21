import { expectDiagnostics, expectZeroDiagnostics, getTestGetTypedef } from '../../../testHelpers.spec';
import { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { expect } from 'chai';
import { isBooleanType, isFunctionType, isIntegerType, isStringType } from '../../../astUtils/reflection';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer/Lexer';
import { Parser, ParseMode } from '../../Parser';
import { ClassStatement, InterfaceStatement } from '../../Statement';

describe('InterfaceStatement', () => {
    const rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    const testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    it('allows strange keywords as property names', () => {
        testGetTypedef(`
            interface Person
                public as string
                protected as string
                private as string
                sub as string
                function as string
                interface as string
                endInterface as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('allows strange keywords as method names', () => {
        testGetTypedef(`
            interface Person
                sub public() as string
                sub protected() as string
                sub private() as string
                sub sub() as string
                sub function() as string
                sub interface() as string
                sub endInterface() as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('includes comments', () => {
        testGetTypedef(`
            interface Person
                'some comment
                sub someFunc() as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('includes annotations', () => {
        testGetTypedef(`
            @IFace
            interface Person
                @Method
                sub someFunc() as string
                @Field
                someField as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('allows declaring multiple interfaces in a file', () => {
        program.setFile('source/interfaces.bs', `
            interface Iface1
                name as dynamic
            end interface
            interface IFace2
                prop as dynamic
            end interface
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`
                interface Iface
                end interface
            `);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    it('parses empty interface', () => {
        let { tokens } = Lexer.scan(`
                interface Person
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(InterfaceStatement);
    });

    it('parses interface with fields', () => {
        let { tokens } = Lexer.scan(`
                interface Iface
                    age as integer
                    name as string
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(InterfaceStatement);
    });

    it('parses interface with methods', () => {
        let { tokens } = Lexer.scan(`
                interface Iface
                    function getNum() as integer
                    function getData() as Object
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(InterfaceStatement);
    });

    it('parses interface with classes as fields', () => {
        let { tokens } = Lexer.scan(`
                class Klass
                end class

                interface Iface
                    myKlass as Klass
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(ClassStatement);
        expect(statements[1]).instanceof(InterfaceStatement);
    });

    it('parses classes with interfaces as fields', () => {
        let { tokens } = Lexer.scan(`
                interface Iface
                   age as integer
                end interface

                class Klass
                   myFace as Iface
                end class
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(InterfaceStatement);
        expect(statements[1]).instanceof(ClassStatement);
    });

    it('parses interfaces with inheritance', () => {
        let { tokens } = Lexer.scan(`
                interface Basic
                   varA as string
                end interface

                interface Advanced extends Basic
                    varB as integer
                end interface

                interface Expert extends Advanced
                    varC as float
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(InterfaceStatement);
        expect(statements[1]).instanceof(InterfaceStatement);
        expect(statements[2]).instanceof(InterfaceStatement);
    });

    it('bad property does not invalidate next sibling method', () => {
        let { tokens } = Lexer.scan(`
                interface Person
                     firstName as
                     sub say(words as string)
                end interface
            `);
        let { statements } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        let iFaceStmt = statements[0] as InterfaceStatement;
        expect(iFaceStmt.methods[0]).to.exist;
        expect(iFaceStmt.methods[0].name.text).to.equal('say');
    });

    it('catches interface without name', () => {
        let { tokens } = Lexer.scan(`
                interface
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectDiagnostics(diagnostics, [DiagnosticMessages.expectedIdentifierAfterKeyword('interface')]);
        expect(statements[0]).instanceof(InterfaceStatement);
    });

    it('catches malformed interface', () => {
        let { tokens } = Lexer.scan(`
                interface Person
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectDiagnostics(diagnostics, [DiagnosticMessages.couldNotFindMatchingEndKeyword('interface')]);
        expect(statements[0]).instanceof(InterfaceStatement);
    });

    it('parses multiple interfaces in a row', () => {
        let { tokens } = Lexer.scan(`
                interface IFaceA
                    a as string
                    sub doA()
                end interface
                interface IFaceB
                    b as string
                    sub doB()
                end interface
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(diagnostics);
        expect(statements[0]).instanceof(InterfaceStatement);
        expect(statements[1]).instanceof(InterfaceStatement);
    });

    describe('symbol table', () => {

        it('does not add methods to parser symbol table', () => {
            let parser = Parser.parse(`
                interface Animal
                    sub eat()
                    sub sleep()
                end class
            `, { mode: ParseMode.BrighterScript });

            expect(parser.symbolTable).to.exist;
            expect(parser.symbolTable.getSymbolType('eat')).to.be.undefined;
            expect(parser.symbolTable.getSymbolType('sleep')).to.be.undefined;
        });


        it('adds methods to class statement member symbol table after building', () => {
            let parser = Parser.parse(`
                interface Animal
                    sub eat()
                    sub sleep()
                end interface
            `, { mode: ParseMode.BrighterScript });
            let ifaceStatement = parser.statements[0] as InterfaceStatement;
            ifaceStatement.buildSymbolTable();
            expect(ifaceStatement.memberTable).to.exist;
            expect(isFunctionType(ifaceStatement.memberTable.getSymbolType('eat'))).to.be.true;
            expect(isFunctionType(ifaceStatement.memberTable.getSymbolType('sleep'))).to.be.true;
        });

        it('adds fields to class statement member symbol table after building', () => {
            let parser = Parser.parse(`
                interface Animal
                    teethCount as integer
                    furType as string
                    hasWings as boolean
                end interface
            `, { mode: ParseMode.BrighterScript });
            let ifaceStatement = parser.statements[0] as InterfaceStatement;
            ifaceStatement.buildSymbolTable();
            expect(ifaceStatement.memberTable).to.exist;
            expect(isIntegerType(ifaceStatement.memberTable.getSymbolType('teethCount'))).to.be.true;
            expect(isStringType(ifaceStatement.memberTable.getSymbolType('furType'))).to.be.true;
            expect(isBooleanType(ifaceStatement.memberTable.getSymbolType('hasWings'))).to.be.true;
        });
    });
});
