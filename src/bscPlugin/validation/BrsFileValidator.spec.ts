import { expect } from '../../chai-config.spec';
import type { BrsFile } from '../../files/BrsFile';
import type { AALiteralExpression, DottedGetExpression, FunctionExpression } from '../../parser/Expression';
import type { AssignmentStatement, ClassStatement, ForEachStatement, FunctionStatement, NamespaceStatement, PrintStatement } from '../../parser/Statement';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expectDiagnostics, expectHasDiagnostics, expectTypeToBe, expectZeroDiagnostics, rootDir } from '../../testHelpers.spec';
import { Program } from '../../Program';
import { isAssignmentStatement, isClassStatement, isForEachStatement, isFunctionExpression, isFunctionParameterExpression, isFunctionStatement, isNamespaceStatement, isPrintStatement, isReturnStatement } from '../../astUtils/reflection';
import { util, standardizePath as s } from '../../util';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { ClassType } from '../../types/ClassType';
import { FloatType } from '../../types/FloatType';
import { IntegerType } from '../../types/IntegerType';
import { InterfaceType } from '../../types/InterfaceType';
import { StringType } from '../../types/StringType';
import { ArrayType } from '../../types/ArrayType';
import { DynamicType } from '../../types/DynamicType';
import { TypedFunctionType } from '../../types/TypedFunctionType';
import { ParseMode } from '../../parser/Parser';
import type { ExtraSymbolData } from '../../interfaces';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import { EnumType } from '../../types';

describe('BrsFileValidator', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    it('links dotted get expression parents', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                print {}.beta.charlie
            end sub
        `);
        program.validate();
        const func = (file.parser.ast.statements[0] as FunctionStatement);
        const print = func.func.body.statements[0] as PrintStatement;
        expect(print.parent).to.equal(func.func.body);

        const charlie = print.expressions[0] as DottedGetExpression;
        expect(charlie.parent).to.equal(print);

        const beta = charlie.obj as DottedGetExpression;
        expect(beta.parent).to.equal(charlie);

        const aaLiteral = beta.obj as AALiteralExpression;
        expect(aaLiteral.parent).to.equal(beta);
    });

    it('links namespace name dotted get parents', () => {
        const { ast } = program.setFile<BrsFile>('source/main.bs', `
            namespace alpha.bravo
                class Delta extends alpha.bravo.Charlie
                end class
                class Charlie
                end class
            end namespace
        `);
        const namespace = ast.findChild<NamespaceStatement>(isNamespaceStatement)!;
        const deltaClass = namespace.findChild<ClassStatement>(isClassStatement)!;
        expect(deltaClass.parent).to.equal(namespace.body);

        const charlie = (deltaClass.parentClassName!.expression as DottedGetExpression);
        expect(charlie.parent).to.equal(deltaClass.parentClassName);

        const bravo = charlie.obj as DottedGetExpression;
        expect(bravo.parent).to.equal(charlie);

        const alpha = bravo.obj as DottedGetExpression;
        expect(alpha.parent).to.equal(bravo);
    });

    describe('namespace validation', () => {
        it('succeeds if namespaces are defined inside other namespaces', () => {
            program.setFile<BrsFile>('source/main.bs', `
                namespace alpha
                    ' random comment
                    namespace bravo
                        ' random comment
                        sub main()
                        end sub
                    end namespace
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
        it('fails if namespaces are defined inside a function', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function f()
                    namespace alpha
                    end namespace
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace')
            ]);
        });
    });

    it('allows classes in correct locations', () => {
        program.setFile('source/main.bs', `
            class Alpha
            end class
            namespace Beta
                class Charlie
                end class
                namespace Delta
                    class Echo
                    end class
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags classes in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                class Alpha
                end class
                if true then
                    class Beta
                    end class
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('class'),
            location: { range: util.createRange(2, 16, 2, 27) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('class'),
            location: { range: util.createRange(5, 20, 5, 30) }
        }]);
    });

    it('allows enums in correct locations', () => {
        program.setFile('source/main.bs', `
            enum Alpha
                value1
            end enum
            namespace Beta
                enum Charlie
                    value1
                end enum
                namespace Delta
                    enum Echo
                        value1
                    end enum
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags enums in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                enum Alpha
                    value1
                end enum
                if true then
                    enum Beta
                        value1
                    end enum
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('enum'),
            location: { range: util.createRange(2, 16, 2, 26) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('enum'),
            location: { range: util.createRange(6, 20, 6, 29) }
        }]);
    });

    it('allows functions in correct locations', () => {
        program.setFile('source/main.bs', `
            function Alpha()
            end function
            namespace Beta
                function Charlie()
                end function
                namespace Delta
                    function Echo()
                    end function
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags functions in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                function Alpha()
                end function
                if true then
                    function Beta()
                    end function
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('function'),
            location: { range: util.createRange(2, 16, 2, 30) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('function'),
            location: { range: util.createRange(5, 20, 5, 33) }
        }]);
    });

    it('allows namespaces in correct locations', () => {
        program.setFile('source/main.bs', `
            namespace Alpha
            end namespace
            namespace Beta
                namespace Charlie
                end namespace
                namespace Delta
                    namespace Echo
                    end namespace
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags namespaces in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                namespace Alpha
                end namespace
                if true then
                    namespace Beta
                    end namespace
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace'),
            location: { range: util.createRange(2, 16, 2, 31) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace'),
            location: { range: util.createRange(5, 20, 5, 34) }
        }]);
    });

    it('allows interfaces in correct locations', () => {
        program.setFile('source/main.bs', `
            interface Alpha
                prop as string
            end interface
            namespace Beta
                interface Charlie
                    prop as string
                end interface
                namespace Delta
                    interface Echo
                        prop as string
                    end interface
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags interfaces in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                interface Alpha
                    prop as string
                end interface
                if true then
                    interface Beta
                        prop as string
                    end interface
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('interface'),
            location: { range: util.createRange(2, 16, 2, 31) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('interface'),
            location: { range: util.createRange(6, 20, 6, 34) }
        }]);
    });

    it('allows consts in correct locations', () => {
        program.setFile('source/main.bs', `
            const Alpha = 1
            namespace Beta
                const Charlie = 2
                namespace Delta
                    const Echo = 3
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags consts in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                const Alpha = 1
                if true then
                    const Beta = 2
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('const'),
            location: { range: util.createRange(2, 16, 2, 27) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('const'),
            location: { range: util.createRange(4, 20, 4, 30) }
        }]);
    });

    describe('for each', () => {
        it('handles getting default type of array of AAs with reference types', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                function test()
                    settings = []
                    screensData = [
                        { id: "home", actions: [Actions.TrackUser1, Actions.Next], listMode: ListModes.Avatar },
                        { id: "home", actions: [Actions.TrackUser1, Actions.Next], listMode: ListModes.Small },
                        { id: "test", actions: [Actions.TrackUser2, Actions.Next], listMode: ListModes.Profile },
                        { id: "autoplay", actions: [Actions.TrackUser2, Actions.Next], listMode: ListModes.Large }
                    ]

                    for each screenData in screensData
                        if screenData.id = "test"
                            settings.push(screenData)
                        end if
                    end for
                    return settings
                end function

                enum Actions
                    TrackUser1
                    TrackUser2
                    Next
                end enum

                enum ListModes
                    Avatar
                    Small
                    Profile
                    Large
                end enum
            `);

            program.validate();
            expectZeroDiagnostics(program);
            const forStmt = mainFile.ast.findChild<ForEachStatement>(isForEachStatement);
            const insideFor = forStmt.body.statements[0];
            const screensDataType = insideFor.getSymbolTable().getSymbolType('screensData', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(screensDataType, ArrayType);
            const screenDataType = insideFor.getSymbolTable().getSymbolType('screenData', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(screenDataType, AssociativeArrayType);
        });

        it('handles getting default type of array of reference types', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                function test()
                    result = []
                    actions = [Actions.TrackUser1, Actions.Next2]

                    for each action in actions
                        if action = Actions.Next2
                            actions.push(action)
                        end if
                    end for
                    return result
                end function

                enum Actions
                    TrackUser1
                    TrackUser2
                    Next2
                end enum
            `);

            program.validate();
            expectZeroDiagnostics(program);
            const forStmt = mainFile.ast.findChild<ForEachStatement>(isForEachStatement);
            const insideFor = forStmt.body.statements[0];
            const actionsType = insideFor.getSymbolTable().getSymbolType('actions', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(actionsType, ArrayType);
            const actionType = insideFor.getSymbolTable().getSymbolType('action', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(actionType, DynamicType);
        });
    });


    describe('typecast statement', () => {
        it('allows being at start of file', () => {
            program.setFile('source/main.bs', `
                typecast m as object

                sub noop()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if more than one usage per block', () => {
            program.setFile('source/main.bs', `
                typecast m as object
                typecast m as integer

                sub noop()
                    typecast m as object
                    typecast m as string
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of function or namespace').message,
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of function or namespace').message
            ]);
        });

        it('has diagnostic if not typecasting m', () => {
            program.setFile('source/main.bs', `
                typecast alpha.beta.notM as object ' error

                const notM = "also not m"

                sub noop()
                    typecast notM as object ' error
                end sub

                sub foo()
                    typecast M as object ' no error!
                end sub

                namespace alpha.beta
                    const notM = "namespaced not m"
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.invalidTypecastStatementApplication('alpha.beta.notM').message,
                DiagnosticMessages.invalidTypecastStatementApplication('notM').message
            ]);
        });

        it('has diagnostic if not first in file', () => {
            program.setFile('source/main.bs', `
                sub noop()
                end sub

                typecast m as object
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of function or namespace').message
            ]);
        });

        it('allows being at start of function ', () => {
            program.setFile('source/main.bs', `
                interface Thing
                    value as integer
                end interface

                sub noop()
                    typecast m as Thing
                    print m.value
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic when not at start of function', () => {
            program.setFile('source/main.bs', `
                interface Thing
                    value as integer
                end interface

                sub noop()
                    print m.value
                    typecast m as Thing
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of function or namespace').message
            ]);
        });

        it('sets the type of m', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as integer
                end interface

                interface Thing2
                    value as string
                end interface

                interface Thing3
                    value as float
                end interface
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                typecast m as Thing1

                sub func1()
                    x = m.value
                    print x
                end sub

                sub func2()
                    typecast m as Thing2
                    x = m.value
                    print x
                end sub

                sub func3()
                    aa = {
                        innerFunc: sub()
                            typecast m as Thing3
                            x = m.value
                            print x
                        end sub
                    }
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assigns = [] as Array<AssignmentStatement>;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            // func1 - uses file level typecast
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);

            // func2 - uses func level typecast
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing2');
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), StringType);

            // func3 - uses innerFunc level typecast
            expectTypeToBe(assigns[2].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[2].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing3');
            expectTypeToBe(assigns[2].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), FloatType);
        });

        it('should allow classes to override m typecast', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as integer
                end interface
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                typecast m as Thing1

                class TestKlass
                    value as string

                    sub method1()
                        x = m.value
                        print x
                    end sub

                    sub method2()
                        typecast m as Thing1
                        x = m.value
                        print x
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assigns = [] as Array<AssignmentStatement>;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            // method1 - uses class 'm'
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), ClassType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('TestKlass');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), StringType);

            // method2 - uses func level typecast
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);
        });

        it('has diagnostic when used in a class', () => {
            program.setFile('source/main.bs', `
                class TestKlass
                    typecast m as object

                    value as string

                    sub method1()
                        x = m.value
                        print x
                    end sub
                end class
            `);
            program.validate();
            expectHasDiagnostics(program);
        });

        it('is allowed in namespace', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as integer
                end interface
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"

                namespace Alpha.Beta
                    typecast m as Thing1

                    sub method1()
                        x = m.value
                        print x
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            // find places in AST where "x" is assigned
            const assigns = [] as Array<AssignmentStatement>;
            file.ast.walk(createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            // method1 - uses Thing1 'm'
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);
        });
    });


    describe('alias statement', () => {
        it('allows being at start of file', () => {
            program.setFile('source/main.bs', `
                alias x = lcase
                sub noop()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('no diagnostic if more than one usage per block', () => {
            program.setFile('source/main.bs', `
                alias x = lcase
                alias y = Str
                sub noop()
                   print x(y(1))
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if used not at top of file', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    alias x = lcase
                    sub noop()
                        alias y = str
                        print "hello"
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('alias', 'at the top of the file').message,
                DiagnosticMessages.unexpectedStatementLocation('alias', 'at the top of the file').message
            ]);
        });

        it('sets the type of the name', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as string
                end interface
                namespace alpha.beta
                    function piAsStr()
                        return "3.14"
                    end function
                    const eulerAsStr = "2.78"
                end namespace
                function lowercase(text as string) as string
                    return lcase(text)
                end function
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                alias t = Thing1
                alias p = alpha.beta.piAsStr
                alias e = alpha.beta.eulerAsStr
                alias l = lowercase
                namespace ns1.ns2
                    function lowercase(x as integer) as integer
                        return x
                    end function
                    sub func1(usedAsType as t)
                        x = usedAsType.value
                        print
                        print l(x)
                        print l(p())
                        print l(e)
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            let func: FunctionExpression;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                FunctionStatement: (stmt) => {
                    if (stmt.getName(ParseMode.BrighterScript) === 'ns1.ns2.func1') {
                        func = stmt.func;
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            const symbolTable = func.getSymbolTable();

            expectTypeToBe(symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }), InterfaceType);
            const tType = symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }) as InterfaceType;
            expect(tType.name).to.eq('Thing1');
            expectTypeToBe(symbolTable.getSymbolType('p', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
            expectTypeToBe(symbolTable.getSymbolType('e', { flags: SymbolTypeFlag.runtime }), StringType);
            expectTypeToBe(symbolTable.getSymbolType('l', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        });

        it('has diagnostic when rhs not found', () => {
            program.setFile('source/main.bs', `
                alias x = notThere
                sub noop()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('notThere').message
            ]);
        });

    });

    describe('type statement', () => {
        it('allows being at top of ast', () => {
            program.setFile('source/main.bs', `
                type x = string
                sub noop(input as x)
                    print input
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('no diagnostic if more than one usage per block', () => {
            program.setFile('source/main.bs', `
                type x = string
                type y = integer
                sub noop(input as x) as y
                   return input.len()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if used not at top of file', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub noop()
                        type y = string
                        print "hello"
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('type').message
            ]);
        });

        it('sets the type of the name', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as string
                end interface
                namespace alpha.beta
                    enum someEnum
                        up = "up"
                        down = "down"
                    end enum
                end namespace
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                type t = Thing1
                type t2 = alpha.beta.someEnum

                namespace ns1.ns2
                    function getDirection(x as t) as t2
                        if x.value = "go up" then
                            return alpha.beta.someEnum.up
                        else
                            return alpha.beta.someEnum.down
                        end if
                    end function
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            let func: FunctionExpression;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                FunctionStatement: (stmt) => {
                    if (stmt.getName(ParseMode.BrighterScript) === 'ns1.ns2.getDirection') {
                        func = stmt.func;
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            const symbolTable = func.getSymbolTable();

            expectTypeToBe(symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }), InterfaceType);
            const tType = symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }) as InterfaceType;
            expect(tType.name).to.eq('Thing1');

            expectTypeToBe(symbolTable.getSymbolType('t2', { flags: SymbolTypeFlag.typetime }), EnumType);
            const t2Type = symbolTable.getSymbolType('t2', { flags: SymbolTypeFlag.typetime }) as EnumType;
            expect(t2Type.name).to.eq('alpha.beta.someEnum');
        });

        it('has diagnostic when rhs not found', () => {
            program.setFile('source/main.bs', `
                type x = notThere
                sub noop()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('notThere').message
            ]);
        });

    });

    describe('conditional compile', () => {
        it('allows top level definitions inside #if block', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = true
                #if debug
                function f()
                    return 3.14
                end function
                #end if
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not allow top level definitions inside #if block inside a function', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = true
                function f()
                    #if debug
                    namespace alpha
                    end namespace
                    #end if
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace')
            ]);
        });

        it('shows diagnostic for #error', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = true
                function f()
                    #if debug
                    #error This is a conditional compile error
                    #end if
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.hashError('This is a conditional compile error')
            ]);
        });

        it('does not show diagnostic for #error when inside false CC block', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = false
                function f()
                    #if debug
                    #error This is a conditional compile error
                    #end if
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('types', () => {
        it('sets assignments of invalid as dynamic', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test()
                    channel = invalid
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.body.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const channelType = table.getSymbolType('channel', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(channelType, DynamicType);
        });

        it('sets default arg of invalid as dynamic', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test(channel = invalid)
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.body.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const channelType = table.getSymbolType('channel', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(channelType, DynamicType);
        });
    });

    describe('instances of types', () => {
        it('sets assigned variables as instances', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
            sub makeKlass()
                x = new Klass()
            end sub

            class Klass
            end class
        `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.body.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const xType = table.getSymbolType('x', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(xType, ClassType);
            expect(data.isInstance).to.be.true;
            expect(table.isSymbolTypeInstance('x')).to.be.true;
        });

        it('sets params as instances', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
            sub makeKlass(x as Klass, n = x.name)
            end sub

            class Klass
                name as string
            end class
        `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const xType = table.getSymbolType('x', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(xType, ClassType);
            expect(data.isInstance).to.be.true;
            expect(table.isSymbolTypeInstance('x')).to.be.true;
            const nType = table.getSymbolType('n', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(nType, StringType);
            expect(data.isInstance).to.be.true;
            expect(table.isSymbolTypeInstance('n')).to.be.true;
        });

        it('allows super as instance', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
            class SuperKlass
                name as string
                sub new(name as string)
                    m.name = name
                end sub
            end class

            class Klass extends SuperKlass
                sub new()
                    super("hello")
                end sub

                function getName()
                    return super.name
                end function
            end class
        `);
            program.validate();
            expectZeroDiagnostics(program);
            const klass = file.ast.statements[1] as ClassStatement;
            const newTable = klass.methods[0].func.body.getSymbolTable();
            let data = {} as ExtraSymbolData;
            const newSuperType = newTable.getSymbolType('super', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(newSuperType, ClassType);
            expect(data.isInstance).to.be.true;

            const getNameTable = klass.methods[0].func.body.getSymbolTable();
            data = {} as ExtraSymbolData;
            const getNameSuperType = getNameTable.getSymbolType('super', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(getNameSuperType, ClassType);
            expect(data.isInstance).to.be.true;
        });
    });

    describe('types in comments', () => {

        describe('@param', () => {
            it('uses @param type in brs file', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {string} name
                    function sayHello(name)
                        print "Hello " + name
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                let data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    StringType
                );
                data = {};
                const printSymbolTable = file.ast.findChild(isPrintStatement).getSymbolTable();
                expectTypeToBe(
                    printSymbolTable.getSymbolType('name', {
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    StringType
                );
                expect(data.isFromDocComment).to.be.true;
            });

            it('handles no type in @param tag', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param  name
                    function sayHello(name)
                        print "Hello " + name
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                let data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    DynamicType
                );
                data = {};
                const printSymbolTable = file.ast.findChild(isPrintStatement).getSymbolTable();
                expectTypeToBe(
                    printSymbolTable.getSymbolType('name', {
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    DynamicType
                );
            });

            it('uses @param type in brs file that can refer to a custom type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {Klass} myClass
                    function sayHello(myClass)
                        print "Hello " + myClass.name
                    end function
                `);
                program.setFile<BrsFile>('source/klass.bs', `
                    class Klass
                        name as string
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcParamExpr = file.ast.findChild(isFunctionParameterExpression);
                expectTypeToBe(
                    funcParamExpr.getType({
                        flags: SymbolTypeFlag.typetime, data: data
                    }),
                    ClassType
                );
                const myClassType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('myClass', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(myClassType, ClassType);
                expectTypeToBe(myClassType.getMemberType('name', { flags: SymbolTypeFlag.runtime }), StringType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('uses @param type in brs file that can refer to a built in type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {roDeviceInfo} info
                    function sayHello(info)
                        print "Hello " + info.getModel()
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.typetime, data: data
                    }),
                    InterfaceType
                );
                const infoType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('info', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(infoType, InterfaceType);
                expectTypeToBe(infoType.getMemberType('getModel', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('allows jsdoc comment style /** prefix', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' /**
                    ' * @param {string} info
                    ' */
                    function sayHello(info)
                        print "Hello " + info
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    StringType
                );
                const infoType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('info', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(infoType, StringType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('ignores types it cannot find', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {TypeNotThere} info
                    function sayHello(info)
                        print "Hello " + info.prop
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('TypeNotThere').message
                ]);
                const data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    DynamicType
                );
                const infoType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('info', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(infoType, DynamicType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('allows built-in type in @param in Brightscript mode', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {roAssociativeArray} thing
                    function sayHello(thing)
                        print "Hello " + thing.name
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                let data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    InterfaceType
                );
                data = {};
                const printSymbolTable = file.ast.findChild(isPrintStatement).getSymbolTable();
                const thingType = printSymbolTable.getSymbolType('thing', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(thingType, InterfaceType);
                expect(thingType.toString()).to.eql('roAssociativeArray');
                expect(data.isFromDocComment).to.be.true;
            });
        });

        describe('@return', () => {
            it('uses @return type in brs file', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {string}
                    function getPie()
                        return "pumpkin"
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, StringType);
            });

            it('allows unknown type when using @return tag', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {TypeNotThere}
                    function getPie()
                        return "pumpkin"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('TypeNotThere').message
                ]);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, DynamicType);
            });

            it('validates return statements against @return tag with valid type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {integer}
                    function getPie()
                        return "pumpkin"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.returnTypeMismatch('string', 'integer').message
                ]);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, IntegerType);
            });

            it('checks return statements against @return tag with valid custom type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {alpha.Klass}
                    function getPie()
                        return alpha_Klass()
                    end function
                `);
                program.setFile<BrsFile>('source/klass.bs', `
                    namespace alpha
                        class Klass
                            name as string
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.typetime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, ClassType);
            });

            it('validates return statements against @return tag with valid custom type', () => {
                program.setFile<BrsFile>('source/main.brs', `
                    ' @return {alpha.Klass}
                    function getPie()
                        return "foo"
                    end function
                `);
                program.setFile<BrsFile>('source/klass.bs', `
                    namespace alpha
                        class Klass
                            name as string
                        end class
                    end namespace
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.returnTypeMismatch('string', 'alpha.Klass').message
                ]);
            });
        });

        describe('@type', () => {
            it('uses @type type in brs file', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    function getPie() as string
                        ' @type {string}
                        pieType = getFruit()
                        return pieType
                    end function

                    function getFruit()
                        return "apple"
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const returnStmt = funcStmt.findChild(isReturnStatement);
                const varType = returnStmt.getSymbolTable().getSymbolType('pieType', { flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(varType, StringType);
            });

            it('allows unknown type when using @type tag', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `

                    function getValue()
                        ' @type {unknown}
                        something = {}
                        return something
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('unknown').message
                ]);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, DynamicType);
            });

            it('treats variable as type given in @type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    function getModelName()
                        ' @type {roDeviceInfo}
                        info = getData()
                        return info.getModel()
                    end function

                    function getData()
                        return {}
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const assignStmt = file.ast.findChild(isAssignmentStatement);
                const infoType = assignStmt.getSymbolTable().getSymbolType('info', { flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(infoType, InterfaceType);
                expect(infoType.toString()).to.eq('roDeviceInfo');
                expect(data.isFromDocComment).to.be.true;
            });

        });

        // Skipped until we can figure out how to handle @var tags
        describe.skip('@var', () => {
            it('uses @var type in brs file to define types of variables', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    function getPie() as string
                        ' @var {string} someDate
                        if m.top.isTrue
                            someDate = getDate()
                        else
                            someDate = m.date2
                        end if

                        if m.someProp
                            someDate = m.someProp.date
                        end if

                        return someDate
                    end function

                    function getDate()
                        return "Dec 25"
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const returnStmt = funcStmt.findChild(isReturnStatement);
                const varType = returnStmt.getSymbolTable().getSymbolType('someDate', { flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(varType, StringType);
            });
        });
    });

    describe('try/catch', () => {
        it('allows omitting the exception variable in standard brightscript mode', () => {
            program.setFile('source/main.brs', `
                sub new()
                    try
                        print "hello"
                    catch
                        print "error"
                    end try
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('shows diagnostic when omitting the exception variable in standard brightscript mode', () => {
            program.setFile('source/main.brs', `
                sub new()
                    try
                        print "hello"
                    catch
                        print "error"
                    end try
                end sub
            `);
            expectDiagnostics(program, []);
        });

        it('shows diagnostics when using  when omitting the exception variable in standard brightscript mode', () => {
            program.setFile('source/main.brs', `
                sub new()
                    try
                        print "hello"
                    catch
                        print "error"
                    end try
                end sub
            `);
            expectDiagnostics(program, []);
        });
    });

    describe('function return values', () => {
        it('catches sub with return value', () => {
            program.setFile('source/main.brs', `
                sub test()
                    return true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(2, 20, 2, 31, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches sub as void with return value', () => {
            program.setFile('source/main.brs', `
                sub test() as void
                    return true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(2, 20, 2, 31, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches function as void with return value', () => {
            program.setFile('source/main.brs', `
                function test() as void
                    return true
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('function'),
                    location: util.createLocation(2, 20, 2, 31, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches sub as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub test() as integer
                    return
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('sub'),
                    location: util.createLocation(2, 20, 2, 26, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
        });

        it('catches function without return value', () => {
            program.setFile('source/main.brs', `
                function test()
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                location: util.createLocation(2, 20, 2, 26, s`${rootDir}/source/main.brs`)
            }]);
        });

        it('catches function as <type> without return value', () => {
            program.setFile('source/main.brs', `
                function test() as integer
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                    location: util.createLocation(2, 20, 2, 26, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
        });

        it('catches anon sub with return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = sub()
                        return true
                    end sub
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(3, 24, 3, 35, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})]
            );
        });

        it('catches sub as void with return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = sub() as void
                        return true
                    end sub
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(3, 24, 3, 35, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches function as void with return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = function() as void
                        return true
                    end function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('function'),
                    location: util.createLocation(3, 24, 3, 35, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches sub as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = sub() as integer
                        return
                    end sub
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('sub'),
                    location: util.createLocation(3, 24, 3, 30, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
        });

        it('catches function without return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = function()
                        return
                    end function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                location: util.createLocation(3, 24, 3, 30, s`${rootDir}/source/main.brs`)
            }]);
        });

        it('catches function as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = function() as integer
                        return
                    end function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                    location: util.createLocation(3, 24, 3, 30, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
        });
    });
});
