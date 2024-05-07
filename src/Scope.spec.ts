import { expect } from './chai-config.spec';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import util, { standardizePath as s } from './util';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import PluginInterface from './PluginInterface';
import { expectDiagnostics, expectDiagnosticsIncludes, expectTypeToBe, expectZeroDiagnostics, trim } from './testHelpers.spec';
import { Logger } from './Logger';
import type { BrsFile } from './files/BrsFile';
import type { AssignmentStatement, ForEachStatement, NamespaceStatement } from './parser/Statement';
import type { CompilerPlugin, OnScopeValidateEvent } from './interfaces';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import { EnumMemberType, EnumType } from './types/EnumType';
import { ClassType } from './types/ClassType';
import { BooleanType } from './types/BooleanType';
import { StringType } from './types/StringType';
import { IntegerType } from './types/IntegerType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { NamespaceType } from './types/NamespaceType';
import { DoubleType } from './types/DoubleType';
import { UnionType } from './types/UnionType';
import { isBlock, isForEachStatement, isFunctionExpression, isFunctionStatement, isNamespaceStatement } from './astUtils/reflection';
import { ArrayType } from './types/ArrayType';
import { AssociativeArrayType } from './types/AssociativeArrayType';
import { InterfaceType } from './types/InterfaceType';
import { ComponentType } from './types/ComponentType';
import { WalkMode, createVisitor } from './astUtils/visitors';
import type { FunctionExpression } from './parser/Expression';
import { ObjectType } from './types';

describe('Scope', () => {
    let sinon = sinonImport.createSandbox();
    let rootDir = process.cwd();
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        program.createSourceScope();
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('getEnumMemberFileLink does not crash on undefined name', () => {
        program.setFile('source/main.bs', ``);
        const scope = program.getScopesForFile('source/main.bs')[0];
        scope.getEnumMemberFileLink(null as any);
        //test passes if this doesn't explode
    });

    it('does not mark namespace functions as collisions with stdlib', () => {
        program.setFile(`source/main.bs`, `
            namespace a
                function constructor()
                end function
            end namespace
        `);

        program.validate();
        expectZeroDiagnostics(program);
    });

    it('builds symbol table with namespace-relative entries', () => {
        const file = program.setFile<BrsFile>('source/alpha.bs', `
            namespace alpha
                class Beta
                end class
            end namespace
            namespace alpha
                class Charlie extends Beta
                end class
                function createBeta()
                    return new Beta()
                end function
            end namespace
        `);
        program.setFile('source/main.bs', `
            function main()
                alpha.createBeta()
                thing = new alpha.Beta()
            end function
        `);
        program.validate();
        const scope = program.getScopesForFile('source/alpha.bs')[0];
        scope.linkSymbolTable();
        const symbolTable = file.ast.findChildren<NamespaceStatement>(isNamespaceStatement)[1].body.getSymbolTable();
        //the symbol table should contain the relative names for all items in this namespace across the entire scope
        expect(
            // eslint-disable-next-line no-bitwise
            symbolTable.hasSymbol('Beta', SymbolTypeFlag.runtime | SymbolTypeFlag.typetime)
        ).to.be.true;
        expect(
            // eslint-disable-next-line no-bitwise
            symbolTable.hasSymbol('Charlie', SymbolTypeFlag.runtime | SymbolTypeFlag.typetime)
        ).to.be.true;
        expect(
            // eslint-disable-next-line no-bitwise
            symbolTable.hasSymbol('createBeta', SymbolTypeFlag.runtime)
        ).to.be.true;

        expectZeroDiagnostics(program);
    });

    it('handles variables with javascript prototype names', () => {
        program.setFile('source/main.brs', `
            sub main()
                constructor = true
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('does not flag unrelated namespace const and function collision', () => {
        program.setFile('source/main.bs', `
            namespace alpha
                const options = {}
            end namespace
            namespace beta
                sub options()
                end sub
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('does flag related namespace const and function collision', () => {
        program.setFile('source/main.bs', `
            namespace alpha
                const options = {}
            end namespace
            namespace alpha
                sub options()
                end sub
            end namespace
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.nameCollision('Const', 'Function', 'options').message
        ]);
    });

    it('does not flag namespaced const and un-namespaced function collision', () => {
        program.setFile('source/main.bs', `
            namespace alpha
                const options = {}
            end namespace

            sub options()
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags parameter with same name as namespace', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main(nameA)
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace('nameA')
        ]);
    });

    it('flags parameter with same name as a sub namespace part', () => {
        program.setFile('source/main.bs', `
            namespace alpha
                sub test(lineHeight as integer)
                end sub
            end namespace

            namespace alpha.lineHeight
            end namespace
        `);
        program.validate();
        expectDiagnostics(program, [{
            //sub test(|lineHeight| as integer)
            message: DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace('lineHeight').message,
            range: util.createRange(2, 25, 2, 35)
        }]);
    });

    it('flags assignments with same name as namespace', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main()
                namea = 2
                NAMEA += 1
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            {
                ...DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('namea'),
                range: util.createRange(4, 16, 4, 21)
            },
            {
                ...DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('NAMEA'),
                range: util.createRange(5, 16, 5, 21)
            }
        ]);
    });

    it('allows getting all scopes', () => {
        const scopes = program.getScopes();
        expect(scopes.length).to.equal(2);
    });

    describe('addFile', () => {
        it('detects callables from all loaded files', () => {
            const sourceScope = program.getScopeByName('source');

            program.setFile(`source/main.brs`, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            program.setFile(`source/lib.brs`, `
                sub ActionB()
                end sub
            `);

            program.validate();

            expect(sourceScope.getOwnFiles().map(x => x.srcPath).sort()).eql([
                s`${rootDir}/source/lib.brs`,
                s`${rootDir}/source/main.brs`
            ]);
            expectZeroDiagnostics(program);
            expect(sourceScope.getOwnCallables()).is.lengthOf(3);
            expect(sourceScope.getAllCallables()).is.length.greaterThan(3);
        });

        it('picks up new callables', () => {
            program.setFile('source/file.brs', '');
            //we have global callables, so get that initial number
            let originalLength = program.getScopeByName('source').getAllCallables().length;

            program.setFile('source/file.brs', `
                function DoA()
                    print "A"
                end function

                function DoA()
                    print "A"
                end function
            `);
            expect(program.getScopeByName('source').getAllCallables().length).to.equal(originalLength + 2);
        });
    });

    describe('removeFile', () => {
        it('removes callables from list', () => {
            //add the file
            let file = program.setFile(`source/file.brs`, `
                function DoA()
                    print "A"
                end function
            `);
            let initCallableCount = program.getScopeByName('source').getAllCallables().length;

            //remove the file
            program.removeFile(file.srcPath);
            expect(program.getScopeByName('source').getAllCallables().length).to.equal(initCallableCount - 1);
        });
    });

    describe('validate', () => {
        it('Validates not too many callfunc argument count', () => {
            program.options.autoImportComponentScript = true;
            program.setFile(`components/myComponent.bs`, `
                function myFunc(a, b, c, d, e)
                    return true
                end function
            `);
            program.setFile(`components/myComponent.xml`, `
                <component name="MyComponent" extends="Group">
                    <interface>
                        <function name="myFunc" />
                    </interface>
                </component>
            `);
            program.setFile(`components/main.bs`, `
                sub init()
                    m.mc@.callFunc(1,2,3,4,5)
                end sub
            `);
            program.setFile(`components/main.xml`, `
                <component name="MainScene" extends="Scene">
                    <children>
                        <MyComponent id="mc" />
                    </children>
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Validates too many callfunc argument count', () => {
            program.options.autoImportComponentScript = true;
            program.setFile(`components/myComponent.bs`, `
                function myFunc(a, b, c, d, e, f)
                    return true
                end function
            `);
            program.setFile(`components/myComponent.xml`, `
                <component name="MyComponent" extends="Group">
                    <interface>
                        <function name="myFunc" />
                    </interface>
                </component>
            `);
            program.setFile(`components/main.bs`, `
                sub init()
                    m.mc@.callFunc(1,2,3,4,5,6)
                end sub
            `);
            program.setFile(`components/main.xml`, `
                <component name="MainScene" extends="Scene">
                    <children>
                        <MyComponent id="mc" />
                    </children>
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.callfuncHasToManyArgs(6)
            ]);
        });

        it('diagnostics are assigned to correct child scope', () => {
            program.options.autoImportComponentScript = true;
            program.setFile('components/constants.bs', `
                namespace constants.alpha.beta
                    const charlie = "charlie"
                end namespace
            `);

            program.setFile('components/ButtonBase.xml', `<component name="ButtonBase" extends="Scene" />`);

            const buttonPrimary = program.setFile('components/ButtonPrimary.bs', `
                import "constants.bs"
                sub init()
                    print constants.alpha.delta.charlie
                end sub
            `);
            program.setFile('components/ButtonPrimary.xml', `<component name="ButtonPrimary" extends="ButtonBase" />`);

            const buttonSecondary = program.setFile('components/ButtonSecondary.bs', `
                import "constants.bs"
                sub init()
                    print constants.alpha.delta.charlie
                end sub
            `);
            program.setFile('components/ButtonSecondary.xml', `<component name="ButtonSecondary" extends="ButtonBase" />`);

            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.cannotFindName('delta', 'constants.alpha.delta'),
                    file: {
                        srcPath: buttonPrimary.srcPath
                    },
                    relatedInformation: [{
                        message: `In component scope 'ButtonPrimary'`
                    }]
                }, {
                    ...DiagnosticMessages.cannotFindName('delta', 'constants.alpha.delta'),
                    file: {
                        srcPath: buttonSecondary.srcPath
                    },
                    relatedInformation: [{
                        message: `In component scope 'ButtonSecondary'`
                    }]
                }
            ]);
        });

        it('recognizes dimmed vars', () => {
            program.setFile(`source/file.brs`, `
                function buildArray(numItems)
                    dim result[3]
                    for i = 0 to numItems
                        result.push(i)
                    end for
                    return result
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('detects unknown namespace names', () => {
            program.setFile('source/main.bs', `
                sub main()
                    Name1.thing()
                    Name2.thing()
                end sub
                namespace Name1
                    sub thing()
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Name2')
            ]);
        });

        it('detects namespace-relative namespace name used like a variable', () => {
            program.setFile('source/main.bs', `
                namespace Alpha.Beta
                    namespace Charlie
                    end namespace

                    sub test()
                        thing = Charlie
                        thing = Alpha.Beta.Charlie
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.cannotFindName('Charlie'),
                range: util.createRange(6, 32, 6, 39)
            }, {
                ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
                range: util.createRange(7, 32, 7, 50)
            }]);
        });

        it('flags assignment with same name as a sub namespace part', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub test()
                        lineHeight = 1
                    end sub
                end namespace

                namespace alpha.lineHeight
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [{
                //|lineHeight| = 1
                message: DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('lineHeight').message,
                range: util.createRange(3, 24, 3, 34)
            }]);
        });

        it('flags local vars with same name as a sub namespace part', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub test()
                        print lineHeight
                    end sub
                end namespace

                namespace alpha.lineHeight
                    const lg = 1.75
                    const md = 1.5
                    const sm = 1.25
                    const xs = 1.0
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [{
                //print |lineHeight|
                message: DiagnosticMessages.cannotFindName('lineHeight').message,
                range: util.createRange(3, 30, 3, 40)
            }]);
        });

        it('accepts namespace names in their transpiled form in .brs files', () => {
            program.setFile('source/ns.bs', `
                namespace MyNamespace
                    sub foo()
                    end sub
                end namespace

                namespace A.B.C
                    sub ga()
                    end sub
                end namespace
            `);
            program.setFile('source/main.brs', `
                sub main()
                    MyNamespace_foo()
                    A_B_C_ga()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Validates NOT too deep nested files', () => {
            program.setFile('source/folder2/folder3/folder4/folder5/folder6/folder7/main.brs', ``);
            program.setFile('source/folder2/folder3/folder4/folder5/folder6/folder7/main2.bs', ``);
            program.setFile('components/folder2/folder3/folder4/folder5/folder6/folder7/ButtonSecondary.xml', `<component name="ButtonSecondary" extends="ButtonBase" />`);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Validates too deep nested files', () => {
            program.setFile('source/folder2/folder3/folder4/folder5/folder6/folder7/folder8/main.brs', ``);
            program.setFile('source/folder2/folder3/folder4/folder5/folder6/folder7/folder8/main2.bs', ``);
            program.setFile('components/folder2/folder3/folder4/folder5/folder6/folder7/folder8/ButtonSecondary.xml', `<component name="ButtonSecondary" extends="ButtonBase" />`);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.detectedTooDeepFileSource(8),
                DiagnosticMessages.detectedTooDeepFileSource(8),
                DiagnosticMessages.detectedTooDeepFileSource(8)
            ]);
        });

        it('detects unknown namespace sub-names', () => {
            program.setFile('source/main.bs', `
                sub main()
                    Name1.subname.thing()
                end sub
                namespace Name1
                    sub thing()
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.cannotFindName('subname', 'Name1.subname')
            }]);
        });

        it('detects unknown enum names', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print Direction.up
                    print up.Direction
                end sub
                enum Direction
                    up
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('up')
            ]);
        });

        it('detects unknown function names', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print go.toStr()
                    print go2.toStr()
                end sub

                function go()
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('go2')
            ]);
        });

        it('detects unknown const in assignment operator', () => {
            program.setFile('source/main.bs', `
                sub main()
                    value = ""
                    value += constants.API_KEY
                    value += API_URL
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('constants'),
                DiagnosticMessages.cannotFindName('API_URL')
            ]);
        });

        it('detects unknown local var names', () => {
            program.setFile('source/lib.bs', `
                sub libFunc(param1)
                    print param1
                    print param2
                    name1 = "bob"
                    print name1
                    print name2
                    for each item1 in param1
                        print item1
                        print item2
                    end for
                    for idx1 = 0 to 10
                        print idx1
                        print idx2
                    end for
                    try
                        print 1
                    catch ex1
                        print ex1
                        print ex2
                    end try
                end sub

                function go()
                end function
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.cannotFindName('param2'),
                DiagnosticMessages.cannotFindName('name2'),
                DiagnosticMessages.cannotFindName('item2'),
                DiagnosticMessages.cannotFindName('idx2'),
                DiagnosticMessages.cannotFindName('ex2')
            ]);
        });

        describe('createObject', () => {
            it('recognizes various scenegraph nodes', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        scene = CreateObject("roSGScreen")
                        button = CreateObject("roSGNode", "Button")
                        list = CreateObject("roSGNode", "MarkupList")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('recognizes valid custom components', () => {
                program.setFile('components/comp1.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp1" extends="Scene">
                    </component>
                `);
                program.setFile('components/comp2.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp2" extends="Scene">
                    </component>
                `);
                program.setFile(`source/file.brs`, `
                    sub main()
                        comp1 = CreateObject("roSGNode", "Comp1")
                        comp2 = CreateObject("roSGNode", "Comp2")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('catches unknown roSGNodes', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        scene = CreateObject("roSGNode", "notReal")
                        button = CreateObject("roSGNode", "alsoNotReal")
                        list = CreateObject("roSGNode", "definitelyNotReal")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.unknownRoSGNode('notReal'),
                    DiagnosticMessages.unknownRoSGNode('alsoNotReal'),
                    DiagnosticMessages.unknownRoSGNode('definitelyNotReal')
                ]);
            });

            it('only adds a single diagnostic when the file is used in multiple scopes', () => {
                program.setFile('components/Comp1.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp1" extends="Scene">
                        <script type="text/brightscript" uri="lib.brs" />
                    </component>
                `);
                program.setFile('components/Comp2.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp2" extends="Scene">
                        <script type="text/brightscript" uri="lib.brs" />
                    </component>
                `);
                program.setFile('components/lib.brs', `
                    sub init()

                        'unknown BrightScript component
                        createObject("roDateTime_FAKE")

                        'Wrong number of params
                        createObject("roDateTime", "this param should not be here")

                        'unknown roSGNode
                        createObject("roSGNode", "Rectangle_FAKE")

                        'deprecated
                        fontMetrics = CreateObject("roFontMetrics", "someFontName")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.unknownBrightScriptComponent('roDateTime_FAKE'),
                    DiagnosticMessages.mismatchCreateObjectArgumentCount('roDateTime', [1, 1], 2),
                    DiagnosticMessages.unknownRoSGNode('Rectangle_FAKE'),
                    DiagnosticMessages.unknownBrightScriptComponent('roFontMetrics')
                ]);
            });

            it('disregards component library components', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        scene = CreateObject("roSGNode", "Complib1:MainScene")
                        button = CreateObject("roSGNode", "buttonlib:Button")
                        list = CreateObject("roSGNode", "listlib:List")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('disregards non-literal args', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        sgNodeName =  "roSGNode"
                        compNameAsVar =  "Button"
                        button = CreateObject(sgNodeName, compNameAsVar)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('recognizes valid BrightScript components', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        timeSpan = CreateObject("roTimespan")
                        bitmap = CreateObject("roBitmap", {width:10, height:10, AlphaEnable:false, name:"MyBitmapName"})
                        path = CreateObject("roPath", "ext1:/vid")
                        region = CreateObject("roRegion", bitmap, 20, 30, 100, 200)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('catches invalid BrightScript components', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        timeSpan = CreateObject("Thing")
                        bitmap = CreateObject("OtherThing", {width:10, height:10, AlphaEnable:false, name:"MyBitmapName"})
                        path = CreateObject("SomethingElse", "ext1:/vid")
                        region = CreateObject("Button", bitmap, 20, 30, 100, 200)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.unknownBrightScriptComponent('Thing'),
                    DiagnosticMessages.unknownBrightScriptComponent('OtherThing'),
                    DiagnosticMessages.unknownBrightScriptComponent('SomethingElse'),
                    DiagnosticMessages.unknownBrightScriptComponent('Button')
                ]);
            });

            it('catches wrong number of arguments', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        button = CreateObject("roSGNode", "Button", "extraArg")
                        bitmap = CreateObject("roBitmap") ' no 2nd arg
                        timeSpan = CreateObject("roTimespan", 1, 2, 3)
                        region = CreateObject("roRegion", bitmap, 20, 30, 100) ' missing last arg
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.mismatchCreateObjectArgumentCount('roSGNode', [2], 3),
                    DiagnosticMessages.mismatchCreateObjectArgumentCount('roBitmap', [2], 1),
                    DiagnosticMessages.mismatchCreateObjectArgumentCount('roTimespan', [1], 4),
                    DiagnosticMessages.mismatchCreateObjectArgumentCount('roRegion', [6], 5)
                ]);
            });

            it('catches deprecated components', () => {
                program.setFile(`source/file.brs`, `
                    sub main()
                        fontMetrics = CreateObject("roFontMetrics", "someFontName")
                    end sub
                `);
                program.validate();
                // only care about code and `roFontMetrics` match
                expectDiagnostics(program, [
                    DiagnosticMessages.unknownBrightScriptComponent('roFontMetrics')
                ]);
            });

            it('infers the correct type', () => {
                const file = program.setFile<BrsFile>(`source/file.brs`, `
                    sub main()
                        scene = CreateObject("roSGScreen")
                        button = CreateObject("roSGNode", "Button")
                        list = CreateObject("roSGNode", "MarkupList")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const mainSymbolTable = file.ast.findChild(isBlock).getSymbolTable();
                const sceneType = mainSymbolTable.getSymbolType('scene', { flags: SymbolTypeFlag.runtime }) as InterfaceType;
                expectTypeToBe(sceneType, InterfaceType);
                expect(sceneType.name).to.eq('roSGScreen');
                const buttonType = mainSymbolTable.getSymbolType('button', { flags: SymbolTypeFlag.runtime }) as InterfaceType;
                expectTypeToBe(buttonType, ComponentType);
                expect(buttonType.name).to.eq('Button');
                const listType = mainSymbolTable.getSymbolType('list', { flags: SymbolTypeFlag.runtime }) as InterfaceType;
                expectTypeToBe(listType, ComponentType);
                expect(listType.name).to.eq('MarkupList');
            });

            it('infers custom component types', () => {
                program.setFile('components/Comp1.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp1" extends="Group">
                    </component>
                `);
                program.setFile('components/Comp2.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp2" extends="Poster">
                    </component>
                `);
                const file = program.setFile<BrsFile>(`source/file.brs`, `
                    sub main()
                        comp1 = CreateObject("roSGNode", "Comp1")
                        comp2 = CreateObject("roSGNode", "Comp2")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                program.getScopeByName('source').linkSymbolTable();
                const mainSymbolTable = file.ast.findChild(isBlock).getSymbolTable();
                const comp1Type = mainSymbolTable.getSymbolType('comp1', { flags: SymbolTypeFlag.runtime }) as InterfaceType;
                expectTypeToBe(comp1Type, ComponentType);
                expect(comp1Type.name).to.eq('Comp1');
                const comp2Type = mainSymbolTable.getSymbolType('comp2', { flags: SymbolTypeFlag.runtime }) as InterfaceType;
                expectTypeToBe(comp2Type, ComponentType);
                expect(comp2Type.name).to.eq('Comp2');
            });

            it('implies objectType by default', () => {
                const file = program.setFile<BrsFile>(`source/file.brs`, `
                    function getObj(myObjName)
                        result = CreateObject(myObjName)
                        return result
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const mainSymbolTable = file.ast.findChild(isBlock).getSymbolTable();
                const resultType = mainSymbolTable.getSymbolType('result', { flags: SymbolTypeFlag.runtime });
                expectTypeToBe(resultType, ObjectType);
            });
        });

        it('marks the scope as validated after validation has occurred', () => {
            program.setFile(`source/main.bs`, `
               sub main()
               end sub
            `);
            let lib = program.setFile(`source/lib.bs`, `
               sub libFunc()
               end sub
            `);
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;
            program.validate();
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.true;
            lib = program.setFile(`source/lib.bs`, `
                sub libFunc()
                end sub
            `);

            //scope gets marked as invalidated
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;

        });

        it('does not mark same-named-functions in different namespaces as an error', () => {
            program.setFile(`source/main.bs`, `
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameB
                    sub alert()
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('resolves local-variable function calls', () => {
            program.setFile(`source/main.brs`, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName("John Doe")
                end sub`
            );
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('function shadowing', () => {
            it('warns when local var function has same name as stdlib function', () => {
                program.setFile(`source/main.brs`, `
                    sub main()
                        str = function(p)
                            return "override"
                        end function
                        print str(12345) 'prints "12345" (i.e. our local function is never used)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                    range: Range.create(2, 24, 2, 27)
                }]);
            });

            it('warns when local var has same name as built-in function', () => {
                program.setFile(`source/main.brs`, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('warns when local var has same name as built-in function', () => {
                program.setFile(`source/main.brs`, `
                    sub main()
                        str = 6789
                        print str(12345) ' prints "12345" (i.e. our local variable did not override the callable global function)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('detects local function with same name as scope function', () => {
                program.setFile(`source/main.brs`, `
                    sub main()
                        getHello = function()
                            return "override"
                        end function
                        print getHello() 'prints "hello" (i.e. our local variable is never called)
                    end sub

                    function getHello()
                        return "hello"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('scope').message,
                    range: Range.create(2, 24, 2, 32)
                }]);
            });

            it('detects local variable with same name as scope function', () => {
                program.setFile(`source/main.brs`, `
                    sub main()
                        getHello = "override"
                        print getHello ' prints <Function: gethello> (i.e. local variable override does NOT work for same-scope-defined methods)
                    end sub
                    function getHello()
                        return "hello"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.localVarShadowedByScopedFunction().message,
                    range: Range.create(2, 24, 2, 32)
                }]);
            });

            it('detects function param with same name as scope function', () => {
                program.setFile(`source/main.brs`, `
                    sub main(getHello = "hello")
                        print getHello ' prints <Function: gethello> (i.e. local variable override does NOT work for same-scope-defined methods)
                    end sub
                    function getHello()
                        return "hello"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.localVarShadowedByScopedFunction().message,
                    range: Range.create(1, 29, 1, 37)
                }]);
            });

            it('flags scope function with same name (but different case) as built-in function', () => {
                program.setFile('source/main.brs', `
                    sub main()
                        print str(12345) ' prints 12345 (i.e. our str() function below is ignored)
                    end sub
                    function STR(num)
                        return "override"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction().message,
                    range: Range.create(4, 29, 4, 32)
                }]);
            });
        });

        it('detects duplicate callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            expectZeroDiagnostics(program);
            //validate the scope
            program.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expectDiagnostics(program, [
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source'),
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source')
            ]);
        });

        it('detects calls to unknown callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
            `);
            expectZeroDiagnostics(program);
            //validate the scope
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('DoB')
            ]);
        });

        it('recognizes known callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
                function DoB()
                    DoC()
                end function
            `);
            //validate the scope
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('DoC')
            ]);
        });

        it('does not error with calls to callables in same namespace', () => {
            program.setFile('source/file.bs', `
                namespace Name.Space
                    sub a(param as string)
                        print param
                    end sub

                    sub b()
                        a("hello")
                    end sub
                end namespace
            `);
            //validate the scope
            program.validate();
            expectZeroDiagnostics(program);
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', () => {
            expectZeroDiagnostics(program);
            program.setFile('source/file.brs', `
               function DoB()
                    m.doSomething()
                end function
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expectZeroDiagnostics(program);
        });

        it('detects calling functions with too many parameters', () => {
            program.setFile('source/file.brs', `
                sub a()
                end sub
                sub b()
                    a(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(0, 1).message
            ]);
        });

        it('detects calling interface function with too few args', () => {
            program.setFile('source/file.bs', `
                sub init(arg as Tester)
                    arg.test()
                end sub
                interface Tester
                    sub test(param1)
                end interface
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 0).message
            ]);
        });

        it('detects calling interface function with too many args', () => {
            program.setFile('source/file.bs', `
                sub init(arg as Tester)
                    arg.test(1, 2)
                end sub
                interface Tester
                    sub test(param1)
                end interface
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 2).message
            ]);
        });

        it('detects calling interface function with mismatch argument type', () => {
            program.setFile('source/file.bs', `
                sub init(arg as Tester)
                    arg.test(1)
                end sub
                interface Tester
                    sub test(param1 as string)
                end interface
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });

        it('detects calling class constructors with too many parameters', () => {
            program.setFile('source/main.bs', `
                function noop0()
                end function

                function noop1(p1)
                end function

                sub main()
                   noop0(1)
                   noop1(1,2)
                   noop1()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(0, 1),
                DiagnosticMessages.mismatchArgumentCount(1, 2),
                DiagnosticMessages.mismatchArgumentCount(1, 0)
            ]);
        });

        it('detects calling functions with too many parameters', () => {
            program.setFile('source/file.brs', `
                sub a(name)
                end sub
                sub b()
                    a()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 0)
            ]);
        });

        it('allows skipping optional parameter', () => {
            program.setFile('source/file.brs', `
                sub a(name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            program.validate();
            //should have an error
            expectZeroDiagnostics(program);
        });

        it('shows expected parameter range in error message', () => {
            program.setFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            program.validate();
            //should have an error
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount('1-2', 0)
            ]);
        });

        it('handles expressions as arguments to a function', () => {
            program.setFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a("cat" + "dog" + "mouse")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Catches extra arguments for expressions as arguments to a function', () => {
            program.setFile('source/file.brs', `
                sub a(age)
                end sub
                sub b()
                    a(m.lib.movies[0], 1)
                end sub
            `);
            program.validate();
            //should have an error
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 2)
            ]);
        });

        it('handles JavaScript reserved names', () => {
            program.setFile('source/file.brs', `
                sub constructor()
                end sub
                sub toString()
                end sub
                sub valueOf()
                end sub
                sub getPrototypeOf()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Emits validation events', () => {
            program.setFile('source/file.brs', ``);
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                </component>
            `);
            program.setFile(s`components/comp.brs`, ``);
            const sourceScope = program.getScopeByName('source');
            const compScope = program.getScopeByName('components/comp.xml');
            program.plugins = new PluginInterface([], { logger: new Logger() });
            const plugin = program.plugins.add({
                name: 'Emits validation events',
                beforeScopeValidate: sinon.spy(),
                onScopeValidate: sinon.spy(),
                afterScopeValidate: sinon.spy()
            });
            program.validate();
            let scopeNames = program.getScopes().map(x => x.name).filter(x => x !== 'global').sort();

            const scopes = plugin.beforeScopeValidate.getCalls().map(x => x.args[0].scope);
            expect(plugin.beforeScopeValidate.callCount).to.equal(2);
            expect(scopes).to.include(sourceScope);
            expect(scopes).to.include(compScope);

            expect(plugin.onScopeValidate.callCount).to.equal(2);
            expect(plugin.onScopeValidate.getCalls().map(
                x => (x.args[0] as OnScopeValidateEvent).scope.name
            ).sort()).to.eql(scopeNames);

            scopeNames = program.getScopes().map(x => x.name).filter(x => x !== 'global').sort();
            expect(plugin.afterScopeValidate.callCount).to.equal(2);
            expect(scopes).to.include(sourceScope);
            expect(scopes).to.include(compScope);
        });

        it('supports parameter types in functions in AA literals defined in other scope', () => {
            program.setFile('source/util.brs', `
                function getObj() as object
                    aa = {
                        name: "test"
                        addInts: function(a = 1 as integer, b =-1 as integer) as integer
                            return a + b
                        end function
                    }
                end function
            `);
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                    <script uri="pkg:/source/util.brs"/>
                </component>
            `);
            program.setFile(s`components/comp.brs`, ``);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('name collisions', () => {
            it('should validate when class have name collisions with global function', () => {
                program.setFile('source/main.bs', `
                    class Log
                    end class

                    interface Lcase
                        name as string
                    end interface

                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.nameCollision('Class', 'Global Function', 'Log').message
                ]);
            });

            it('should not validate when interfaces have name collisions with global function', () => {
                program.setFile('source/main.bs', `
                    interface Lcase
                        name as string
                    end interface

                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('should validate when a namespace has a name collision with a class', () => {
                program.setFile('source/main.bs', `
                    namespace SomeKlass
                        function anything()
                        end function
                    end namespace

                    class SomeKlass
                    end class
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expectDiagnosticsIncludes(diagnostics, [
                    DiagnosticMessages.nameCollision('Namespace', 'Class', 'SomeKlass').message,
                    DiagnosticMessages.nameCollision('Class', 'Namespace', 'SomeKlass').message
                ]);
            });

            it('should not give diagnostics for a class that partially matches a namespace', () => {
                program.setFile('source/main.bs', `
                    namespace some.nameSpace
                        function anything()
                        end function
                    end namespace

                    namespace some
                            class name
                            end class
                    end namespace

                    namespace some
                        class name2
                        end class
                    end namespace
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics).to.be.empty;
            });

            it('should validate when an enum has a name collision with a namespace', () => {
                program.setFile('source/main.bs', `
                    namespace SomeEnum
                        function anything()
                        end function
                    end namespace

                    enum SomeEnum
                        a = "A"
                        b = "B"
                    end enum
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expectDiagnosticsIncludes(diagnostics, [
                    DiagnosticMessages.nameCollision('Enum', 'Namespace', 'SomeEnum').message,
                    DiagnosticMessages.nameCollision('Namespace', 'Enum', 'SomeEnum').message
                ]);
            });

            it('should not validate when a const has a name collision with something else in different namespace', () => {
                program.setFile('source/main.bs', `
                    namespace SomeEnum
                        const MY_CONST = "hello"
                    end namespace

                    function MY_CONST()
                    end function
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expectZeroDiagnostics(diagnostics);
            });

            it('should validate when a const has a name collision with something else in same namespace', () => {
                program.setFile('source/main.bs', `
                    namespace SomeEnum
                        const MY_CONST = "hello"

                        function MY_CONST()
                        end function
                    end namespace
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expectDiagnosticsIncludes(diagnostics, [
                    DiagnosticMessages.nameCollision('Const', 'Function', 'MY_CONST').message
                ]);
            });
        });

        describe('custom types', () => {
            it('detects an unknown function return type', () => {
                program.setFile(`source/main.bs`, `
                    function a()
                        return invalid
                    end function

                    function b() as integer
                        return 1
                    end function

                    function c() as unknownType 'error
                        return 2
                    end function

                    class myClass
                        function myClassMethod() as unknownType 'error
                            return 2
                        end function
                    end class

                    function d() as myClass
                        return new myClass()
                    end function
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.cannotFindName('unknownType').message,
                    DiagnosticMessages.cannotFindName('unknownType').message
                ]);
            });

            it('detects an unknown function parameter type', () => {
                program.setFile(`source/main.bs`, `
                    sub a(num as integer)
                    end sub

                    sub b(unknownParam as unknownType) 'error
                    end sub

                    class myClass
                        sub myClassMethod(unknownParam as unknownType) 'error
                        end sub
                    end class

                    sub d(obj as myClass)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('unknownType').message,
                    DiagnosticMessages.cannotFindName('unknownType').message
                ]);
            });

            it('detects an unknown field parameter type', () => {
                program.setFile(`source/main.bs`, `
                    class myClass
                        foo as unknownType 'error
                    end class

                    class myOtherClass
                        foo as unknownType 'error
                        bar as myClass
                        buz as myOtherClass
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('unknownType').message,
                    DiagnosticMessages.cannotFindName('unknownType').message
                ]);
            });

            it('supports enums and interfaces as types', () => {
                program.setFile(`source/main.bs`, `

                    interface MyInterface
                        title as string
                    end interface
                    enum myEnum
                        title = "t"
                    end enum

                    class myClass
                        foo as myInterface
                        foo2 as myEnum
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('finds interface types', () => {
                program.setFile(`source/main.bs`, `
                    namespace MyNamespace
                        interface MyInterface
                          title as string
                        end interface

                        function bar(param as MyNamespace.MyInterface) as MyNamespace.MyInterface
                        end function

                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds non-namespaced interface types', () => {
                program.setFile(`source/main.bs`, `
                    interface MyInterface
                        title as string
                    end interface

                    namespace MyNamespace
                        function bar(param as MyInterface) as MyInterface
                        end function

                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds enum types', () => {
                program.setFile(`source/main.bs`, `
                    namespace MyNamespace
                        enum MyEnum
                          title = "t"
                        end enum

                        function bar(param as MyNamespace.MyEnum) as MyNamespace.MyEnum
                        end function

                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds non-namespaced enum types', () => {
                program.setFile(`source/main.bs`, `
                    enum MyEnum
                        title = "t"
                    end enum

                    namespace MyNamespace
                        function bar(param as MyEnum) as MyEnum
                        end function

                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types inside namespaces', () => {
                program.setFile(`source/main.bs`, `
                    namespace MyNamespace
                        class MyClass
                        end class

                        function foo(param as MyClass) as MyClass
                        end function

                        function bar(param as MyNamespace.MyClass) as MyNamespace.MyClass
                        end function

                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types from other namespaces', () => {
                program.setFile(`source/main.bs`, `
                    namespace MyNamespace
                        class MyClass
                        end class
                    end namespace

                    function foo(param as MyNamespace.MyClass) as MyNamespace.MyClass
                    end function
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types from same namespace defined in different file', () => {
                program.setFile(`source/klass.bs`, `
                    namespace MyNamespace
                        class Klass
                        end class
                    end namespace
                `);

                program.setFile(`source/otherklass.bs`, `
                    namespace MyNamespace
                        class OtherKlass
                            function beClassy() as Klass
                              return new Klass()
                            end function
                        end class
                    end namespace
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types from same namespace defined in different file when using full Namespace', () => {
                program.setFile(`source/klass.bs`, `
                    namespace MyNamespace
                        class Klass
                        end class
                    end namespace
                `);

                program.setFile(`source/otherklass.bs`, `
                    namespace MyNamespace
                        class OtherKlass
                            function beClassy() as MyNamespace.Klass
                            end function
                        end class
                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('detects missing custom types from current namespaces', () => {
                program.setFile(`source/main.bs`, `
                    namespace MyNamespace
                        class MyClass
                        end class

                        function foo() as UnknownType
                        end function
                    end namespace
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('UnknownType').message
                ]);
            });

            it('finds custom types from other other files', () => {
                program.setFile(`source/main.bs`, `
                    function foo(param as MyClass) as MyClass
                    end function
                `);
                program.setFile(`source/MyClass.bs`, `
                    class MyClass
                    end class
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types from other other files', () => {
                program.setFile(`source/main.bs`, `
                    function foo(param as MyNameSpace.MyClass) as MyNameSpace.MyClass
                    end function
                `);
                program.setFile(`source/MyNameSpace.bs`, `
                    namespace MyNameSpace
                      class MyClass
                      end class
                    end namespace
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('detects missing custom types from another namespaces', () => {
                program.setFile(`source/main.bs`, `
                    namespace MyNamespace
                        class MyClass
                        end class
                    end namespace

                    function foo() as MyNamespace.UnknownType
                    end function
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('UnknownType').message
                ]);
                expect(program.getDiagnostics()[0]?.data?.fullName).to.eq('MyNamespace.UnknownType');
            });

            it('scopes types to correct scope', () => {
                program = new Program({ rootDir: rootDir });

                program.setFile('components/foo.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="foo" extends="Scene">
                        <script uri="foo.bs"/>
                    </component>
                `);
                program.setFile(s`components/foo.bs`, `
                    class MyClass
                    end class
                `);
                program.validate();

                expectZeroDiagnostics(program);

                program.setFile('components/bar.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="bar" extends="Scene">
                        <script uri="bar.bs"/>
                    </component>
                `);
                program.setFile(s`components/bar.bs`, `
                    function getFoo() as MyClass
                    end function
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('MyClass').message
                ]);
            });

            it('can reference types from parent component', () => {
                program = new Program({ rootDir: rootDir });

                program.setFile('components/parent.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="parent" extends="Scene">
                        <script uri="parent.bs"/>
                    </component>
                `);
                program.setFile(s`components/parent.bs`, `
                    class MyClass
                    end class
                `);
                program.setFile('components/child.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="child" extends="parent">
                        <script uri="child.bs"/>
                    </component>
                `);
                program.setFile(s`components/child.bs`, `
                    function getFoo() as MyClass
                    end function
                `);

                program.validate();

                expectZeroDiagnostics(program);

            });

            it('finds correctly types a variable with type from different file', () => {
                program.setFile(`source/main.bs`, `
                    sub main()
                        thing = new MyKlass()
                        useKlass(thing)
                    end sub

                    sub useKlass(thing as MyKlass)
                        print thing
                    end sub
                `);
                program.setFile(`source/MyKlass.bs`, `
                    class MyKlass
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        describe('runtime vs typetime', () => {
            it('detects invalidly using a class member as a parameter type', () => {
                program.setFile(`source/main.bs`, `
                    sub a(num as myClass.member)
                    end sub

                    class MyClass
                        member as integer
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.itemCannotBeUsedAsType('myClass.member').message
                ]);
            });

            it('detects invalidly using an EnumMember as a parameter type', () => {
                program.setFile(`source/main.bs`, `
                    sub a(num as MyNameSpace.SomeEnum.memberA)
                    end sub

                    namespace MyNameSpace
                        enum SomeEnum
                            memberA
                            memberB
                        end enum
                    end namespace
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.itemCannotBeUsedAsType('MyNameSpace.SomeEnum.memberA').message
                ]);
            });

            it('detects a member of a nested namespace', () => {
                program.setFile(`source/main.bs`, `
                    sub a(num as NSExistsA.NSExistsB.Klass)
                    end sub

                    namespace NSExistsA.NSExistsB
                        class Klass
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('detects an unknown member of a nested namespace', () => {
                program.setFile(`source/main.bs`, `
                    sub a(num as NSExistsA.NSExistsB.NSDoesNotExistC.Klass)
                    end sub

                    namespace NSExistsA.NSExistsB
                        class Klass
                        end class
                    end namespace
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('NSDoesNotExistC', 'NSExistsA.NSExistsB.NSDoesNotExistC').message
                ]);
            });

            it('allows a class to extend from a class in another namespace and file', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(myFace as Villain)
                        print myFace.coin
                    end sub

                    class Villain extends MyKlasses.twoFace
                        name as string
                    end class
                `);
                program.setFile(`source/extra.bs`, `
                    namespace MyKlasses
                        class twoFace
                            coin as string
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });


            it('resolves a const in a namespace', () => {
                program.setFile(`source/main.bs`, `
                    sub a()
                        print NSExistsA.SOME_CONST
                    end sub

                    namespace NSExistsA
                        const SOME_CONST = 3.14
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('resolves namespaces with relative references', () => {
                program.setFile(`source/main.bs`, `
                    namespace NameA
                        sub fn1()
                            'fully qualified-relative references are allowed
                            print NameA.API_URL
                            'namespace-relative references are allowed as well
                            print API_URL
                        end sub

                        const API_URL = "http://some.url.com"
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('resolves nested namespaces with relative references', () => {
                program.setFile(`source/main.bs`, `
                    sub main()
                        print NameA.A_VAL
                        print NameA.NameB.B_VAL
                        print NameA.NameB.NameC.C_VAL
                        print SOME_CONST
                    end sub
                    namespace NameA
                        sub fnA()
                            print NameA.A_VAL
                            print A_VAL
                        end sub
                        namespace NameB
                            sub fnB()
                                print NameA.NameB.B_VAL
                                print B_VAL
                            end sub
                            namespace NameC
                                sub fnC()
                                   print NameA.NameB.NameC.C_VAL
                                   print C_VAL
                                end sub
                                const C_VAL = "C"
                            end namespace
                            const B_VAL = "B"
                        end namespace
                        const A_VAL="A"
                    end namespace
                    const SOME_CONST = "hello"
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('resolves namespaces defined in different locations', () => {
                program.setFile(`source/main.bs`, `
                    sub main()
                        print NameA.A_VAL
                        print NameA.funcA()
                        print NameA.makeClass().value
                    end sub
                    namespace NameA
                        const A_VAL="A"
                    end namespace
                    namespace NameA
                        function funcA() as integer
                            return 17
                        end function
                    end namespace
                    namespace NameA
                        function makeClass() as SomeKlass
                            return new SomeKlass()
                        end function
                    end namespace
                    namespace NameA
                        class SomeKlass
                            value = 3.14
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('resolves deep namespaces defined in different locations', () => {
                program.setFile(`source/main.bs`, `
                    sub main()
                        print NameA.NameB.B_VAL
                        print NameA.NameB.funcB()
                        print NameA.makeClassA().value
                        print NameA.NameB.makeClassB().value
                    end sub
                    namespace NameA
                        namespace NameB
                            const B_VAL="B"
                        end namespace
                    end namespace
                    namespace NameA.NameB
                        function funcB() as integer
                            return 17
                        end function
                    end namespace
                    namespace NameA
                        function makeClassA() as NameA.NameB.SomeKlass
                            return new NameA.NameB.SomeKlass()
                        end function
                    end namespace
                    namespace NameA
                        namespace NameB
                            function makeClassB() as SomeKlass
                                return new SomeKlass()
                            end function
                        end namespace
                    end namespace
                    namespace NameA.NameB
                        class SomeKlass
                            value = 3.14
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows dot-references to properties on results of global callables', () => {
                program.setFile(`source/main.bs`, `
                    sub fn()
                        print CreateObject("roSgNode", "Node").id
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows dot-references to functions on results of global callables', () => {
                program.setFile(`source/main.bs`, `
                    sub fn()
                        print CreateObject("roDateTime").asSeconds()
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('finds unknown members of primitive types', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(input as SomeKlass)
                        piValue = input.getPi().someProp
                    end sub

                    class SomeKlass
                        function getPi() as float
                            return 3.14
                        end function
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('someProp').message
                ]);
            });

            it('finds unknown methods of primitive types', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(input as SomeKlass)
                        piValue = input.getPi().noMethod()
                    end sub

                    class SomeKlass
                        function getPi() as float
                            return 3.14
                        end function
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('noMethod').message
                ]);
            });

            it('finds members of arrays', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(input as SomeKlass)
                        numValue = input.getOtherKlasses()[2].num
                        print numValue
                    end sub

                    class OtherKlass
                      num = 1
                    end class

                    class SomeKlass
                        function getPi() as float
                            return 3.14
                        end function

                        function getOtherKlasses()
                            return [new OtherKlass(), new OtherKlass(), new OtherKlass()]
                        end function
                    end class
                `);
                program.validate();
                //TODO: When array types are available, check that `numValue` is an integer
                expectZeroDiagnostics(program);
            });

        });

        describe('interfaces', () => {
            it('allows using interfaces as types', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(myFace as iFace)
                    end sub

                    interface iFace
                        name as string
                    end interface
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('disallows using interface members as types', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(myFaceName as iFace.name)
                    end sub

                    interface iFace
                        name as string
                    end interface
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('name').message
                ]);
            });

            it('allows accessing interface members in code', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(myFace as iFace)
                        print myFace.name
                    end sub

                    interface iFace
                        name as string
                    end interface
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows accessing an interface member from a super interface', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(myFace as iFace)
                        print myFace.coin
                    end sub

                    interface iFace extends twoFace
                        name as string
                    end interface

                    interface twoFace
                        coin as string
                    end interface
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows an interface to extend from an interface in another namespace and file', () => {
                program.setFile(`source/main.bs`, `
                    sub fn(myFace as iFace)
                        print myFace.coin
                    end sub

                    interface iFace extends MyInterfaces.twoFace
                        name as string
                    end interface
                `);
                program.setFile(`source/interfaces.bs`, `
                    namespace MyInterfaces
                        interface twoFace
                            coin as string
                        end interface
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

        });


        it('should accept global callables returning objects', () => {
            program.setFile(`source/main.brs`, `
                sub main()
                    screen = CreateObject("roSGScreen")
                    port = CreateObject("roMessagePort")
                    scene = screen.CreateScene("MyMainScene")
                    screen.setMessagePort(port)
                    screen.show()
                    while(true)
                        msg     = wait(0, port)
                        msgType = type(msg)

                        if type(msg) = "roInputEvent"
                            if msg.IsInput()
                                info = msg.GetInfo()
                                if info.DoesExist("mediaType")
                                    mediaType = info.mediaType
                                    print mediaType
                                end if
                            end if
                        end if
                    end while
                end sub
            `);
            program.setFile('components/MyMainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyMainScene" extends="Scene">
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should correctly validate formatJson', () => {
            program.setFile(`source/main.brs`, `
                sub main()
                    obj = {hello: "world"}
                    print formatJson(obj) ' 2nd param not included
                    print formatJson(obj, 0) ' 2nd param as integer
                    print formatJson(obj, "0") ' 2nd param as string
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('inheritance', () => {
            it('inherits callables from parent', () => {
                program = new Program({ rootDir: rootDir });

                program.setFile('components/child.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="child" extends="parent">
                        <script uri="child.brs"/>
                    </component>
                `);
                program.setFile(s`components/child.brs`, ``);
                program.validate();
                let childScope = program.getComponentScope('child');
                expect(childScope.getAllCallables().map(x => x.callable.name)).not.to.include('parentSub');

                program.setFile('components/parent.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="parent" extends="Scene">
                        <script uri="parent.brs"/>
                    </component>
                `);
                program.setFile(s`components/parent.brs`, `
                    sub parentSub()
                    end sub
                `);
                program.validate();

                expect(childScope.getAllCallables().map(x => x.callable.name)).to.include('parentSub');
            });
        });

        describe('.d.bs files', () => {
            it('should be able to include .d.bs files', () => {
                program.setFile('source/roku_modules/anything.d.bs', `
                    function anything()
                    end function
                `);
                program.setFile('source/main.bs', `
                    namespace alpha
                         sub someFunc()
                            anything()
                         end sub
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });


            it('should be able to include .d.bs files that have namespaces', () => {
                program.setFile('source/roku_modules/anything.d.bs', `
                    namespace SomeNamespace
                        function anything()
                        end function
                    end namespace
                `);
                program.setFile('source/main.bs', `
                    namespace alpha
                         sub someFunc()
                              SomeNamespace.anything()
                         end sub
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });
    });

    describe('detachParent', () => {
        it('does not attach global to itself', () => {
            expect(program.globalScope.getParentScope()).not.to.exist;
        });
    });

    describe('getDefinition', () => {
        it('returns empty list when there are no files', () => {
            let file = program.setFile('source/main.brs', '');
            expect(program.getDefinition(file.srcPath, Position.create(0, 0))).to.be.lengthOf(0);
        });
    });

    describe('buildNamespaceLookup', () => {
        it('does not crash when class statement is missing `name` prop', () => {
            program.setFile<BrsFile>('source/main.bs', `
                namespace NameA
                    class
                    end class
                end namespace
            `);
            program['scopes']['source'].buildNamespaceLookup();
        });

        it('does not crash when function statement is missing `name` prop', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                namespace NameA
                    function doSomething()
                    end function
                end namespace
            `);
            delete ((file.ast.statements[0] as NamespaceStatement).body.statements[0] as any).name;
            program.validate();
            program['scopes']['source'].buildNamespaceLookup();
        });
    });

    describe('buildEnumLookup', () => {
        it('builds enum lookup', () => {
            const sourceScope = program.getScopeByName('source');
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile('source/main.bs', `
                enum foo
                    bar1
                    bar2
                end enum

                namespace test
                    function fooFace2()
                    end function

                    class fooClass2
                    end class

                    enum foo2
                        bar2_1
                        bar2_2
                    end enum
                end namespace

                enum foo3
                    bar3_1
                    bar3_2
                end enum
            `);
            program.validate();

            expect(
                [...sourceScope.getEnumMap().keys()]
            ).to.eql([
                'foo',
                'test.foo2',
                'foo3'
            ]);
        });
    });

    describe('symbolTable lookups with enhanced typing', () => {

        const mainFileContents = `
            sub main()
                population = Animals.getPopulation()
                print population
                flyBoy = new Animals.Bird()
                flyBoysWings = flyBoy.hasWings
                flyBoysSkin = flyBoy.skin
                fido = new Animals.Dog()
                fidoBark = fido.bark()
                chimp = new Animals.Ape()
                chimpHasLegs = chimp.hasLegs
                chimpSpeed = chimp.getRunSpeed()
                fidoSpeed = fido.getRunSpeed()
                skin = Animals.SkinType.fur
            end sub
         `;

        const animalFileContents = `
            namespace Animals
                function getPopulation() as integer
                    return 10
                end function

                class Creature
                    skin as Animals.SkinType
                end class

                class Bird extends Creature
                    hasWings = true
                    skin = Animals.SkinType.feathers
                end class

                class Mammal extends Creature
                    hasLegs = true
                    legCount as integer
                    skin = Animals.SkinType.fur

                    function getRunSpeed() as integer
                        speed = m.legCount * 10
                        return speed
                    end function
                end class

                class Dog extends Mammal
                    legCount = 4
                    function bark() as string
                        return "woof"
                    end function
                end class

                class Ape extends Mammal
                    legCount = 2
                end class

                enum SkinType
                    feathers
                    fur
                end enum
            end namespace
        `;

        it('finds correct return type for class methods', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    fooInstance = new Foo()
                    myNum = fooInstance.getNum()
                end sub

                class Foo
                    function getNum() as integer
                        return 1
                    end function
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 10));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            expect(mainFnScope).to.exist;
            sourceScope.linkSymbolTable();
            const mainSymbolTable = mainFnScope.symbolTable;
            expectTypeToBe(mainSymbolTable.getSymbol('fooInstance', SymbolTypeFlag.runtime)[0].type, ClassType);
            expect(mainSymbolTable.getSymbol('fooInstance', SymbolTypeFlag.runtime)[0].type.toString()).to.eq('Foo');
            let myNumType = mainSymbolTable.getSymbolType('myNum', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(myNumType, IntegerType);
        });

        it('finds correct parameter type with default value enums are used', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                sub paint(colorChoice = Color.red)
                    paintColor = colorChoice
                    print paintColor
                end sub

                enum Color
                    red
                    blue
                end enum
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 25));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            expect(mainFnScope).to.exist;
            sourceScope.linkSymbolTable();
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('paintColor', SymbolTypeFlag.runtime)[0].type, EnumMemberType);
        });

        it('finds correct class field type with default value enums are used', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    foo = new Paint()
                    paintColor = foo.colorType
                    print paintColor
                end sub

                class Paint
                    colorType = Color.red
                end class

                enum Color
                    red
                    blue
                end enum
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 25));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            expect(mainFnScope).to.exist;
            //sourceScope.linkSymbolTable();
            let mainScopeSymbolTable = mainFnScope.symbolTable;
            let paintType = mainScopeSymbolTable.getSymbolType('paintColor', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(paintType, EnumMemberType);
        });


        it('finds correct type for namespaced lookups', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', mainFileContents);
            program.setFile('source/animals.bs', animalFileContents);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(7, 23));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            sourceScope.linkSymbolTable();
            expect(mainFnScope).to.exist;
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('skin', SymbolTypeFlag.runtime)[0].type, EnumMemberType);

            expectTypeToBe(mainFnScope.symbolTable.getSymbol('flyBoy', SymbolTypeFlag.runtime)[0].type, ClassType);
            expect(mainFnScope.symbolTable.getSymbol('flyBoy', SymbolTypeFlag.runtime)[0].type.toString()).to.eq('Animals.Bird');
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('flyBoysWings', SymbolTypeFlag.runtime)[0].type, BooleanType);
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('flyBoysSkin', SymbolTypeFlag.runtime)[0].type, EnumMemberType);
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('fido', SymbolTypeFlag.runtime)[0].type, ClassType);
            expect(mainFnScope.symbolTable.getSymbol('fido', SymbolTypeFlag.runtime)[0].type.toString()).to.eq('Animals.Dog');
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('fidoBark', SymbolTypeFlag.runtime)[0].type, StringType);
        });

        it('finds correct type for members of classes with super classes', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', mainFileContents);
            program.setFile('source/animals.bs', animalFileContents);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(7, 23));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            sourceScope.linkSymbolTable();
            expect(mainFnScope).to.exist;
            const chimpType = mainFnScope.symbolTable.getSymbol('chimp', SymbolTypeFlag.runtime)[0].type;
            expectTypeToBe(chimpType, ClassType);
            expectTypeToBe((chimpType as ClassType).superClass, ClassType);
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('chimpHasLegs', SymbolTypeFlag.runtime)[0].type, BooleanType);
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('chimpSpeed', SymbolTypeFlag.runtime)[0].type, IntegerType);
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('fidoSpeed', SymbolTypeFlag.runtime)[0].type, IntegerType);
        });

        it('finds correct types for method calls', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    myVal = (new NameA.Klass()).getNumObj().num
                end sub

                namespace NameA
                    class Klass
                        function getNumObj() as NumObj
                            return new NumObj()
                        end function
                    end class

                    class NumObj
                        num = 2
                    end class
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            sourceScope.linkSymbolTable();
            expect(mainFnScope).to.exist;
            expectTypeToBe(mainFnScope.symbolTable.getSymbol('myVal', SymbolTypeFlag.runtime)[0].type, IntegerType);
        });

        it('finds correct types for self-referencing variables', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    dt = CreateObject("roDateTime")
                    hours = dt.GetHours()
                    hours = hours
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
            const sourceScope = program.getScopeByName('source');
            expect(sourceScope).to.exist;
            sourceScope.linkSymbolTable();
            expect(mainFnScope).to.exist;
            const getTypeOptions = { flags: SymbolTypeFlag.runtime };
            let dtType = mainFnScope.symbolTable.getSymbolType('dt', getTypeOptions);
            expectTypeToBe(dtType, InterfaceType);
            let hoursType = mainFnScope.symbolTable.getSymbolType('hours', getTypeOptions);
            expectTypeToBe(hoursType, IntegerType);
        });

        describe('union types', () => {

            it('should find actual members correctly', () => {
                const mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub printName(thing as Person or Pet)
                        name = thing.name
                        print name
                    end sub

                    class Person
                        name as string
                        age as integer
                    end class

                    class Pet
                        name as string
                        legs as integer
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const sourceScope = program.getScopeByName('source');
                expect(sourceScope).to.exist;
                sourceScope.linkSymbolTable();
                expect(mainFnScope).to.exist;
                const mainSymbolTable = mainFnScope.symbolTable;
                expectTypeToBe(mainSymbolTable.getSymbolType('name', { flags: SymbolTypeFlag.runtime }), StringType);
            });

            it('should have an error when a non union member is accessed', () => {
                const mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub printLegs(thing as Person or Pet)
                        print thing.legs
                    end sub

                    class Person
                        name as string
                        age as integer
                    end class

                    class Pet
                        name as string
                        legs as integer
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('legs').message
                ]);
                const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const sourceScope = program.getScopeByName('source');
                expect(sourceScope).to.exist;
                sourceScope.linkSymbolTable();
                expect(mainFnScope).to.exist;
            });

        });

        describe('type casts', () => {
            it('should use type casts to determine the types of symbols', () => {
                const mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub main(thing)
                        value = thing as float
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const sourceScope = program.getScopeByName('source');
                sourceScope.linkSymbolTable();
                let mainSymbolTable = mainFnScope.symbolTable;
                expectTypeToBe(mainSymbolTable.getSymbol('value', SymbolTypeFlag.runtime)[0].type, FloatType);
            });


            it('should allow type casts in dotted get statements', () => {
                const mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub main(thing)
                        value = (thing as MyThing).name
                    end sub

                    interface MyThing
                        name as string
                    end interface
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const mainFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const sourceScope = program.getScopeByName('source');
                sourceScope.linkSymbolTable();
                let mainSymbolTable = mainFnScope.symbolTable;
                expectTypeToBe(mainSymbolTable.getSymbol('value', SymbolTypeFlag.runtime)[0].type, StringType);
            });
        });


        describe('multiple nested namespaces', () => {

            it('should be able to define deep namespaces in any order', () => {
                let utilFile = program.setFile<BrsFile>('source/util.bs', `
                    function getData()
                        return alpha.beta.gamma.value1 + alpha.beta.gamma.delta.deltaValue +  alpha.beta.gamma.value2
                    end function

                    namespace alpha.beta.gamma.delta
                        const deltaValue = 50
                    end namespace

                    namespace alpha.beta.gamma
                        const value1 = 300
                        const value2 = 400
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const getDataFnScope = utilFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = getDataFnScope.symbolTable;
                const getTypeOptions = { flags: SymbolTypeFlag.runtime };
                let alphaType = symbolTable.getSymbolType('alpha', getTypeOptions);
                let betaType = alphaType?.getMemberType('beta', getTypeOptions);
                let gammaType = betaType?.getMemberType('gamma', getTypeOptions);
                let value1Type = gammaType?.getMemberType('value1', getTypeOptions);
                let deltaType = gammaType?.getMemberType('delta', getTypeOptions);
                let deltaValueType = deltaType?.getMemberType('deltaValue', getTypeOptions);
                expectTypeToBe(alphaType, NamespaceType);
                expectTypeToBe(betaType, NamespaceType);
                expectTypeToBe(gammaType, NamespaceType);
                expectTypeToBe(value1Type, IntegerType);
                expectTypeToBe(deltaType, NamespaceType);
                expectTypeToBe(deltaValueType, IntegerType);
            });

            it('should be able to define deep namespaces in multiple files', () => {
                program.setFile('source/util.bs', `
                    function getData()
                        return alpha.beta.gamma.sayHello(alpha.values.value1)
                    end function

                    namespace alpha.beta.gamma
                        function sayHello(num as integer)
                            return "hello " + num.toStr()
                        end function
                    end namespace
                `);
                program.setFile('source/values.bs', `
                    namespace alpha.values
                        const value1 = 300
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('should allow access to underscored version of namespace members in different file', () => {
                program.setFile('source/main.bs', `
                    sub printPi()
                        print alpha_util_getPi().toStr()
                    end sub
                `);
                program.setFile('source/util.bs', `
                    namespace alpha.util
                        function getPi() as float
                            return 3.14
                        end function
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('resolves deep namespaces defined in different locations', () => {
                program.setFile(`source/main.bs`, `
                sub main()
                    print NameA.NameB.makeClassB().value
                end sub

                namespace NameA
                    namespace NameB
                        function makeClassB() as SomeKlass
                            return new SomeKlass()
                        end function
                    end namespace
                end namespace
                namespace NameA.NameB
                    class SomeKlass
                        value = 3.14
                    end class
                end namespace
            `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('should find things in current namespace', () => {
                program.setFile('source/utils.bs', `
                    namespace sgnode
                        sub speak(message)
                            print message
                        end sub

                        sub sayHello()
                            sgnode.speak("Hello")
                        end sub
                    end namespace`
                );
                program.validate();
                expectZeroDiagnostics(program);
            });

        });

        describe('const values', () => {
            it('should allow const values to be composed of other const values from namespaces', () => {
                program.setFile('source/constants.bs', `
                    const top_pi = alpha.beta.pi
                    const top_two = alpha.gamma.two
                    const top_twoPi = top_two * top_pi
                `);
                program.setFile('source/ns.bs', `
                    namespace alpha.beta
                        const pi = 3.14
                    end namespace

                    namespace alpha.gamma
                        const two = 2
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('should show an error when an invalid value is references', () => {
                program.setFile('source/constants.bs', `
                    const pi = alpha.beta.pi
                    const two = alpha.gamma.two
                    const twoPi = two * pi
                `);
                program.setFile('source/ns.bs', `
                    namespace alpha.beta
                        const pi = 3.14
                    end namespace

                    namespace alpha.gamma
                        const three = 3
                    end namespace
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.cannotFindName('two', 'alpha.gamma.two').message
                ]);
            });
        });

        it('should be able to reference multiple properties of a class that is itself a property', () => {
            program.setFile('source/main.bs', `
                sub process(dataObj as alpha.media.MediaObject)
                    stream = dataObj.stream
                    url = stream.url
                    isLive = stream.live
                end sub
            `);
            program.setFile('source/media.bs', `
                namespace alpha.media
                    class MediaObject
                        stream as MediaStream
                    end class
                end namespace

                namespace alpha.media
                    class MediaStream
                        url as string
                        live as boolean
                    end class
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('knows about items defined in different files in same namespace', () => {
            program.options.autoImportComponentScript = true;
            const constFileContents = `
                import "pkg:/source/consts2.bs"

                namespace a
                    const PI = 3.14
                    const PIX2 = PI * TWO
                end namespace
            `;
            const const2FileContents = `
                namespace a
                    const TWO = 2
                end namespace
            `;
            program.setFile('source/consts.bs', constFileContents);
            program.setFile('source/consts2.bs', const2FileContents);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('knows about items defined in different files in same deeply nested namespace', () => {
            program.options.autoImportComponentScript = true;
            const constFileContents = `
                import "pkg:/source/consts2.bs"

                namespace a.b.c
                    const PI = 3.14
                    const PIX2 = PI * TWO
                end namespace
            `;
            const const2FileContents = `
                namespace a.b.c
                    const TWO = 2
                end namespace
            `;
            program.setFile('source/consts.bs', constFileContents);
            program.setFile('source/consts2.bs', const2FileContents);

            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('binary and unary expressions', () => {
            it('should set symbols with correct types from binary expressions', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process()
                        s = "hello" + "world"
                        exp = 2^3
                        num = 3.14 + 3.14
                        bool = true or false
                        notEq = {} <> invalid
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('s', opts), StringType);
                expectTypeToBe(symbolTable.getSymbolType('exp', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('num', opts), FloatType);
                expectTypeToBe(symbolTable.getSymbolType('bool', opts), BooleanType);
                expectTypeToBe(symbolTable.getSymbolType('notEq', opts), BooleanType);
            });

            it('should set symbols with correct types from unary expressions', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process(boolVal as boolean, intVal as integer)
                        a = not boolVal
                        b = not true
                        c = not intVal
                        d = not 3.14

                        e = -34
                        f = -3.14
                        g = -intVal
                        h = - (-f)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('a', opts), BooleanType);
                expectTypeToBe(symbolTable.getSymbolType('b', opts), BooleanType);
                expectTypeToBe(symbolTable.getSymbolType('c', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('d', opts), IntegerType);

                expectTypeToBe(symbolTable.getSymbolType('e', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('f', opts), FloatType);
                expectTypeToBe(symbolTable.getSymbolType('g', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('h', opts), FloatType);
            });

            it('should set correct types on bitwise operators on numbers', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process()
                        three = &h01 or &h02
                        print three ' prints 3

                        one = &h01 and &h01
                        print one ' prints 1
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const func = mainFile.ast.findChild<FunctionExpression>(isFunctionExpression);
                const symbolTable = func.body.getSymbolTable();
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('one', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('three', opts), IntegerType);
            });
        });

        describe('assignment expressions', () => {
            it('should set correct type on simple equals', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process(intVal as integer, dblVal as double, strVal as string)
                        a = intVal
                        b = dblVal
                        c = strVal
                        d = {}
                        f = m.foo
                        e = true
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('a', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('b', opts), DoubleType);
                expectTypeToBe(symbolTable.getSymbolType('c', opts), StringType);
                expectTypeToBe(symbolTable.getSymbolType('d', opts), AssociativeArrayType);
                expectTypeToBe(symbolTable.getSymbolType('f', opts), DynamicType);
                expectTypeToBe(symbolTable.getSymbolType('e', opts), BooleanType);
            });

            it('should set correct type for aa literals', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process(intVal as integer, dblVal as double, strVal as string)
                        myAA = {
                            a: intVal
                            b: dblVal
                            c: strVal
                            d: {}
                            f :m.foo
                            e: true
                        }
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                const myAA = symbolTable.getSymbolType('myAA', opts);
                expectTypeToBe(myAA, AssociativeArrayType);
                expectTypeToBe(myAA.getMemberType('a', opts), IntegerType);
                expectTypeToBe(myAA.getMemberType('b', opts), DoubleType);
                expectTypeToBe(myAA.getMemberType('c', opts), StringType);
                expectTypeToBe(myAA.getMemberType('d', opts), AssociativeArrayType);
                expectTypeToBe(myAA.getMemberType('f', opts), DynamicType);
                expectTypeToBe(myAA.getMemberType('e', opts), BooleanType);
                expectTypeToBe(myAA.getMemberType('someUnsetThing', opts), DynamicType);
            });

            it('should set correct type on compound equals', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process(intVal as integer, dblVal as double, strVal as string)
                        a = intVal
                        a += 4
                        b = dblVal
                        b *= 23
                        c = strVal
                        c += "hello world"
                        d = 3.14
                        d \= 3 ' integer division -> d could be either a float or int
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('a', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('b', opts), DoubleType);
                expectTypeToBe(symbolTable.getSymbolType('c', opts), StringType);
                const dType = symbolTable.getSymbolType('d', opts);
                expectTypeToBe(dType, UnionType);
                expect((dType as UnionType).types).to.include(FloatType.instance);
                expect((dType as UnionType).types).to.include(IntegerType.instance);
            });

            it('should set correct type on compound equals with function call', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    function check() as string
                        test = "hello"
                        test += lcase("WORLD")
                        return test
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('test', opts), StringType);
            });

            it('should work for a multiple binary expressions', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    function process(intVal as integer)
                        x = (intVal * 2) + 1 + 3^8 + intVal + (3 - 9)  ' should be int
                        result = 3.5 ' float
                        result *= (x + 1.123 * 3) ' -> float
                        return result
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('x', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('result', opts), FloatType);
            });

            it('should recognize consistent type after function call in binary op', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    function process(items) as string
                        myString = ""
                        for each item in items
                            myString += utils.toString(item) + " "
                        end for
                        return myString
                    end function
                `);
                program.setFile('source/utils.bs', `
                    namespace utils
                        function toString(thing) as string
                            return type(thing)
                        end function
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('myString', opts), StringType);
            });
        });

        describe('typed array expressions', () => {
            it('should set correct type on indexedGet', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub first(nums as integer[]) as integer
                        num = nums[0]
                        return num
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('num', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('nums', opts), ArrayType);
            });

            it('should set correct type on indexedGet of multi-dimensional arrays', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub first(numsArray as integer[][]) as integer
                        nums = numsArray[0]
                        num = nums[0]
                        return num
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('num', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('nums', opts), ArrayType);

                expectTypeToBe((symbolTable.getSymbolType('numsArray', opts) as any).defaultType, ArrayType);
                expectTypeToBe((symbolTable.getSymbolType('nums', opts) as any).defaultType, IntegerType);
            });


            it('should set correct type on for each loop items', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub sum(nums as integer[]) as integer
                        total = 0
                        for each num in nums
                            total += num
                        end for
                        return total
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const forEachStmt = mainFile.ast.findChild<ForEachStatement>(isForEachStatement);
                const symbolTable = forEachStmt.getSymbolTable();
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('total', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('num', opts), IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('nums', opts), ArrayType);
            });

            it('should set correct type on for each loop items when looping a const array in a namespace', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    namespace Alpha
                        const data = [1,2,3]

                        function printData()
                            for each item in Alpha.data
                                print item
                            end for
                        end function
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const forEachStmt = mainFile.ast.findChild<ForEachStatement>(isForEachStatement);
                const symbolTable = forEachStmt.getSymbolTable();
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('data', opts), ArrayType);
                expectTypeToBe((symbolTable.getSymbolType('data', opts) as ArrayType).defaultType, IntegerType);

                expectTypeToBe(symbolTable.getSymbolType('Alpha', opts).getMemberType('data', opts), ArrayType);
                expectTypeToBe(((symbolTable.getSymbolType('Alpha', opts).getMemberType('data', opts)) as ArrayType).defaultType, IntegerType);

                expectTypeToBe(symbolTable.getSymbolType('item', opts), IntegerType);

            });

            it('should set correct type on array literals', () => {
                let mainFile = program.setFile<BrsFile>('source/main.bs', `
                    sub process()
                        intArr = [1, 2, 3]
                        strArr = ["hello", "bronley"]
                        floatArr = [3.14, 282.23]
                        unionArr = ["string", 2]
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = mainFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('intArr', opts), ArrayType);
                expectTypeToBe((symbolTable.getSymbolType('intArr', opts) as ArrayType).defaultType, IntegerType);
                expectTypeToBe(symbolTable.getSymbolType('strArr', opts), ArrayType);
                expectTypeToBe((symbolTable.getSymbolType('strArr', opts) as ArrayType).defaultType, StringType);
                expectTypeToBe(symbolTable.getSymbolType('floatArr', opts), ArrayType);
                expectTypeToBe((symbolTable.getSymbolType('floatArr', opts) as ArrayType).defaultType, FloatType);
                expectTypeToBe(symbolTable.getSymbolType('unionArr', opts), ArrayType);
                const unionDefaultType = (symbolTable.getSymbolType('unionArr', opts) as ArrayType).defaultType;
                expectTypeToBe(unionDefaultType, UnionType);
                expect((unionDefaultType as UnionType).types).to.include(StringType.instance);
                expect((unionDefaultType as UnionType).types).to.include(IntegerType.instance);
            });

            it('should allow built in component types', () => {
                let utilFile = program.setFile<BrsFile>('source/util.bs', `
                    sub process(data as roAssociativeArray[])
                        for each datum in data
                            print datum
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = utilFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                expectTypeToBe(symbolTable.getSymbolType('data', opts), ArrayType);
                expectTypeToBe(symbolTable.getSymbolType('datum', opts), InterfaceType);
            });

            it('should allow class types', () => {
                let utilFile = program.setFile<BrsFile>('source/util.bs', `
                    sub process(data as Klass[])
                        for each datum in data
                            print datum.name
                        end for
                    end sub


                    class Klass
                        name as string
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = utilFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                const dataType = symbolTable.getSymbolType('data', opts);
                expectTypeToBe(dataType, ArrayType);
                expectTypeToBe((dataType as ArrayType).defaultType, ClassType);
                expect((dataType as ArrayType).defaultType.toString()).to.equal('Klass');
            });

            it('should allow component types', () => {
                let utilFile = program.setFile<BrsFile>('source/util.bs', `
                    sub process(labels as roSgNodeLabel[])
                        for each label in labels
                            print label.text
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = utilFile.getFunctionScopeAtPosition(util.createPosition(2, 24));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                const dataType = symbolTable.getSymbolType('labels', opts);
                expectTypeToBe(dataType, ArrayType);
                expectTypeToBe((dataType as ArrayType).defaultType, ComponentType);
                expect((dataType as ArrayType).defaultType.toString()).to.equal('roSGNodeLabel');
            });
        });

        describe('callFunc invocations', () => {
            it('TODO: should set correct return type', () => {

                program.setFile('components/Widget.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget" extends="Group">
                        <script uri="Widget.brs"/>
                        <interface>
                            <function name="getFloatFromString" />
                        </interface>
                    </component>
                `);

                program.setFile('components/Widget.brs', `
                    function getFloatFromString(input as string) as float
                        return input.toFloat()
                    end function
                `);

                let utilFile = program.setFile<BrsFile>('source/util.bs', `
                    sub someFunc(widget as roSGNodeWidget)
                        pi = widget@.getFloatFromString("3.14")
                        print pi
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const processFnScope = utilFile.getFunctionScopeAtPosition(util.createPosition(3, 31));
                const symbolTable = processFnScope.symbolTable;
                const opts = { flags: SymbolTypeFlag.runtime };
                const sourceScope = program.getScopeByName('source');
                sourceScope.linkSymbolTable();
                //TODO: This *SHOULD* be float, but callfunc returns aren't inferred yet
                expectTypeToBe(symbolTable.getSymbolType('pi', opts), DynamicType);
                sourceScope.unlinkSymbolTable();
            });
        });


        describe('roAssociativeArray type', () => {

            it('allows accessing built-in member of AA', () => {
                program.setFile<BrsFile>('source/aa.bs', `
                    function getSize(aa as roAssociativeArray) as integer
                        return aa.count()
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows assigning to prop of AA', () => {
                program.setFile<BrsFile>('source/aa.bs', `
                    sub addName(aa as roAssociativeArray)
                        aa.name = "foo"
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows accessing random prop of typecasted AA', () => {
                program.setFile<BrsFile>('source/aa.bs', `
                    sub foo()
                        print (m as roAssociativeArray).whatever.whatever
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows asscessing prop of AA through square brackets', () => {
                program.setFile<BrsFile>('source/aa.bs', `
                    sub addName(aa as roAssociativeArray)
                        aa["whatEver"] = "hello"
                        print aa["whatEver"]
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

        });

        describe('roArray type', () => {

            it('allows accessing built-in member of array', () => {
                program.setFile<BrsFile>('source/array.bs', `
                    function getSize(aa as roArray) as integer
                        return aa.count()
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows assigning to prop of item in array', () => {
                program.setFile<BrsFile>('source/array.bs', `
                    sub addName(aa as roArray)
                        aa[0].name = "foo"
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows accessing random prop item in array of typecasted array', () => {
                program.setFile<BrsFile>('source/array.bs', `
                    sub foo()
                        print (m as roArray)[0].whatever
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows asscessing prop of AA through square brackets', () => {
                program.setFile<BrsFile>('source/array.bs', `
                    sub addName(myArray as roArray)
                        myArray[0] = "hello"
                        print myArray[0]
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

        });

        it('classes in namespaces that reference themselves without namespace work', () => {
            program.setFile<BrsFile>('source/class.bs', `
                namespace Alpha
                    class TestClass
                        function getCopy() as TestClass
                            return new TestClass()
                        end function
                    end class
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('namespaces can shadow global functions', () => {
            program.setFile<BrsFile>('source/main.bs', `
                namespace log ' shadows built-in function "log"
                    sub doPrint(x)
                        print x
                    end sub
                end namespace

                sub main()
                    log.doPrint("hello")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('namespaces shadowing global functions do not break other stuff', () => {
            program.setFile('source/roku_modules/anything.d.bs', `
                namespace log ' shadows built-in function "log"
                    sub doPrint(x)
                        print x
                    end sub
                end namespace
            `);
            program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    log.doPrint("hello")
                    anotherNs.foo()
                end sub
            `);
            program.setFile<BrsFile>('source/zzzz.bs', `
                namespace anotherNs
                   sub foo()
                        print 1234
                    end sub
               end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('resets m in a function in an AA literal to be an AssociativeArray type', () => {
            const file = program.setFile<BrsFile>('source/class.bs', `
                class TestKlass
                    function getData() as object
                        data = {
                            data: [] as float[],
                            sum: function() as float
                                value = 0
                                for each item in m.data
                                    value += item
                                end for
                                return value
                            end function
                        }
                        return data
                    end function
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const forEachStmt = file.parser.ast.findChildren(isForEachStatement, { walkMode: WalkMode.visitAllRecursive })[0] as ForEachStatement;
            const mType = forEachStmt.getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(mType, AssociativeArrayType);
        });

        it('does not propagate a typecast m across namespace statements', () => {
            const file1 = program.setFile<BrsFile>('source/one.bs', `
                interface Thing1
                    value as integer
                end interface

                namespace Alpha.Beta
                    typecast m as Thing1

                    sub method1()
                        x = m.value
                        print x
                    end sub
                end namespace
            `);
            const file2 = program.setFile<BrsFile>('source/two.bs', `
                namespace Alpha.Beta
                    sub method2()
                        x = m.value
                        print x
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            // find places in AST where "x" is assigned
            const assigns = [] as Array<AssignmentStatement>;
            const assignmentVisitor = createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            });
            file1.ast.walk(assignmentVisitor, { walkMode: WalkMode.visitAllRecursive });
            file2.ast.walk(assignmentVisitor, { walkMode: WalkMode.visitAllRecursive });

            // method1 - uses Thing1 'm'
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);

            // method1 - uses untypecast 'm'
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), AssociativeArrayType);
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), DynamicType);
        });
    });

    describe('unlinkSymbolTable', () => {
        it('properly removes sibling symbol tables', () => {
            const file = program.setFile<BrsFile>('source/lib.bs', `
                namespace alpha.beta.charlie
                    function delta()
                    end function
                end namespace

                namespace alpha.beta.charlie
                    function echo()
                    end function
                end namespace
            `);

            program.setFile<BrsFile>('source/lib2.bs', `
                namespace alpha.beta.charlie
                    function foxtrot()
                    end function
                end namespace

                namespace alpha.beta.charlie
                    function hotel()
                    end function
                end namespace
            `);
            const scope = program.getScopeByName('source');

            scope.linkSymbolTable();

            const opts = { flags: 3 as SymbolTypeFlag };

            function getSymbolTableList() {
                const namespaceContainingDelta = file.ast.findChild(x => isFunctionStatement(x) && x.tokens.name.text === 'delta').findAncestor(x => isNamespaceStatement(x));
                return {
                    statements: [
                        (namespaceContainingDelta as NamespaceStatement).getSymbolTable()
                    ],
                    types: [
                        scope.symbolTable.getSymbolType('alpha', opts).memberTable,
                        scope.symbolTable.getSymbolType('alpha', opts).getMemberType('beta', opts).memberTable,
                        scope.symbolTable.getSymbolType('alpha', opts).getMemberType('beta', opts).getMemberType('charlie', opts).memberTable
                    ]
                };
            }
            // Statements get linked/unlinked at scope linking time.
            // Namespace types exist at file level, and will not change
            let symbolTables = getSymbolTableList();

            symbolTables.statements.forEach(x => expect(x['siblings'].size).to.eql(1, `${x.name} has wrong number of siblings`));
            symbolTables.types.forEach(x => expect(x['siblings'].size).to.eql(1, `${x.name} has wrong number of siblings`));

            scope.unlinkSymbolTable();
            symbolTables.statements.forEach(x => expect(x['siblings'].size).to.eql(0, `${x.name} has wrong number of siblings`));
            symbolTables.types.forEach(x => expect(x['siblings'].size).to.eql(1, `${x.name} has wrong number of siblings`));

            //do it again, make sure we don't end up with additional siblings
            scope.linkSymbolTable();

            // get the member tables again, as the types were re-created
            symbolTables = getSymbolTableList();
            symbolTables.statements.forEach(x => expect(x['siblings'].size).to.eql(1, `${x.name} has wrong number of siblings`));
            symbolTables.types.forEach(x => expect(x['siblings'].size).to.eql(1, `${x.name} has wrong number of siblings`));

            scope.unlinkSymbolTable();
            symbolTables.statements.forEach(x => expect(x['siblings'].size).to.eql(0, `${x.name} has wrong number of siblings`));
            symbolTables.types.forEach(x => expect(x['siblings'].size).to.eql(1, `${x.name} has wrong number of siblings`));
        });
    });

    describe('provides & requires', () => {

        it('a class can reference itself', () => {
            program.setFile<BrsFile>('source/klass.bs', `
                class Klass
                    function copy(otherKlass as Klass) as Klass
                        return otherKlass
                    end function
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('classes can reference each other across files', () => {
            program.setFile<BrsFile>('source/klass.bs', `
                class Klass
                    function copy(otherKlass as Klass2) as Klass
                        return otherKlass.getKlass()
                    end function
                end class
            `);

            program.setFile<BrsFile>('source/klass2.bs', `
                class Klass2
                    function getKlass() as Klass
                        return new Klass()
                    end function
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('requires a enum defined in a different namespace', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                namespace Alpha
                    function printEnum(enumVal as Alpha.Beta.Charlie.SomeEnum) as string
                        return enumVal.toStr()
                    end function
                end namespace
            `);

            let file2 = program.setFile<BrsFile>('source/file2.bs', `
                namespace Alpha.Beta.Charlie
                    enum SomeEnum
                        val1 = 1
                        val2 = 2
                    end enum
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file1.requiredSymbols[0].containingNamespaces).to.have.members(['Alpha']);
            expect(file1.requiredSymbols[0].endChainFlags).to.eq(SymbolTypeFlag.typetime);
            expect(file1.requiredSymbols[0].typeChain.length).to.eq(4);
            expect(file1.requiredSymbols[0].typeChain.map(x => x.name)).to.have.members(['Alpha', 'Beta', 'Charlie', 'SomeEnum']);
            expect(file2.requiredSymbols.length).to.eq(0);
            expect(file2.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime).size).to.eq(1);
            const file2TypeProvides = file2.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime);
            expectTypeToBe(file2TypeProvides.get('alpha.beta.charlie.someenum').type, EnumType);
        });

        it('classes that extend classes in other files show change properly', () => {
            program.setFile<BrsFile>('source/class.bs', `
                class TestClass
                    name as string
                end class
            `);

            program.setFile<BrsFile>('source/subclass.bs', `
                class SubTestClass extends TestClass
                    length as float
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);

            program.setFile<BrsFile>('source/subclass.bs', `
                class SubTestClass extends TestClass
                    ' added a comment
                    length as float
                end class
            `);

            let changedSymbolsSize = -1;
            class TestScopeValidator implements CompilerPlugin {
                name = 'TestScopeValidator';
                public onScopeValidate(event: OnScopeValidateEvent) {
                    changedSymbolsSize = event.changedSymbols.get(SymbolTypeFlag.runtime).size;
                }
            }

            program.plugins.add(new TestScopeValidator());
            program.validate();
            expectZeroDiagnostics(program);
            expect(changedSymbolsSize).to.equal(0);
        });

        it('does not throw exception when updating a file with roSGNodeNode interface extension', () => {
            program.setFile<BrsFile>('source/class.bs', `

                namespace mc.internal.commands
                    interface ICommandTask extends roSGNodeNode
                        __commandName as string
                    end interface

                    function doesItWork(thing as mc.internal.commands.ICommandTask)
                        ? thing.__commandName
                    end function
                end namespace
            `);

            program.validate();
            let symbolChanges: Map<SymbolTypeFlag, Set<string>>;
            class TestScopeValidator implements CompilerPlugin {
                name = 'TestScopeValidator';
                public onScopeValidate(event: OnScopeValidateEvent) {
                    symbolChanges = event.changedSymbols;
                }
            }
            program.plugins.add(new TestScopeValidator());
            program.setFile<BrsFile>('source/class.bs', `

                namespace mc.internal.commands
                    interface ICommandTask extends roSGNodeNode
                        __commandName as string
                        __otherProp as integer
                    end interface

                    function doesItWork(thing as mc.internal.commands.ICommandTask)
                        ? thing.__commandName
                    end function
                end namespace
            `);

            program.validate();
            expectZeroDiagnostics(program);
            let runTimeChanges = symbolChanges.get(SymbolTypeFlag.runtime);
            let typeTimeChanges = symbolChanges.get(SymbolTypeFlag.typetime);

            expect(runTimeChanges.size).to.equal(0); // mc.internal.commands.doesItWork did not change
            expect(typeTimeChanges.size).to.equal(1); // mc.internal.commands.ICommandTask

            program.validate();
            expectZeroDiagnostics(program);
        });


        it('does not throw exception when updating a file with roSGNode interface extension', () => {
            program.setFile<BrsFile>('source/class.bs', `

                namespace mc.internal.commands
                    interface ICommandTask extends roSGNode
                        __commandName as string
                    end interface

                    function doesItWork(thing as mc.internal.commands.ICommandTask)
                        ? thing.__commandName
                    end function
                end namespace
            `);

            program.validate();
            let symbolChanges: Map<SymbolTypeFlag, Set<string>>;
            class TestScopeValidator implements CompilerPlugin {
                name = 'TestScopeValidator';
                public onScopeValidate(event: OnScopeValidateEvent) {
                    symbolChanges = event.changedSymbols;
                }
            }
            program.plugins.add(new TestScopeValidator());
            program.setFile<BrsFile>('source/class.bs', `

                namespace mc.internal.commands
                    interface ICommandTask extends roSGNodeNode
                        __commandName as string
                        __otherProp as integer
                    end interface

                    function doesItWork(thing as mc.internal.commands.ICommandTask)
                        ? thing.__commandName
                    end function
                end namespace
            `);

            program.validate();
            expectZeroDiagnostics(program);
            let runTimeChanges = symbolChanges.get(SymbolTypeFlag.runtime);
            let typeTimeChanges = symbolChanges.get(SymbolTypeFlag.typetime);

            expect(runTimeChanges.size).to.equal(0); // mc.internal.commands.doesItWork did not change
            expect(typeTimeChanges.size).to.equal(1); // mc.internal.commands.ICommandTask

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('revalidates if import file changes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                import "pkg:/source/file2.bs"

                    function test()
                        print test2()
                    end function
            `);
            program.setFile<BrsFile>('source/file2.bs', ``);
            //let widgetXml =
            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/Widget.bs', trim`
                sub init()
                    test()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('test2').message
            ]);

            program.setFile<BrsFile>('source/file2.bs', `
                function test2()
                    return 2
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('namespaces', () => {

            it('does not require symbols found in same namespace', () => {
                let file1 = program.setFile<BrsFile>('source/file1.bs', `
                    namespace alpha
                        const PI = 3.14

                        const ABC = "abc"

                        function test()
                            print ABC
                            return 2*alpha.PI
                        end function

                    end namespace
                `);
                program.setFile<BrsFile>('components/Widget.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget" extends="Group">
                        <script uri="Widget.bs"/>
                        <script uri="pkg:/source/file1.bs"/>
                    </component>
                `);
                program.setFile<BrsFile>('components/Widget.bs', trim`
                    sub init()
                        print alpha.test()
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                expect(file1.requiredSymbols.length).to.eq(0);
                const validationSegments = file1.getValidationSegments(file1.providedSymbols.changes);
                expect(validationSegments).to.not.undefined;
            });

            it('does require symbols found in namespace of import', () => {
                let file1 = program.setFile<BrsFile>('source/file1.bs', `
                    import "pkg:/source/file2.bs"

                    namespace alpha
                        const PI = 3.14

                        const ABC = "abc"

                        function test()
                            print ABC + beta.XYZ + alpha.alpha2.DEF
                            return 2*alpha.PI
                        end function

                    end namespace
                `);
                program.setFile<BrsFile>('source/file2.bs', `
                    namespace beta
                        const XYZ = "XYZ"
                    end namespace

                    namespace alpha.alpha2
                        const DEF = "def"
                    end namespace
                `);
                //let widgetXml =
                program.setFile<BrsFile>('components/Widget.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget" extends="Group">
                        <script uri="Widget.bs"/>
                        <script uri="pkg:/source/file1.bs"/>
                    </component>
                `);
                program.setFile<BrsFile>('components/Widget.bs', trim`
                    sub init()
                        print alpha.test()
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                expect(file1.requiredSymbols.length).to.eq(2);
                const validationSegments = file1.getValidationSegments(file1.providedSymbols.changes);
                expect(validationSegments).to.not.undefined;
            });
        });

    });

    describe('shadowing', () => {
        it('allows namespaces shadowing global function names', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace log
                    sub doLog(x)
                        ? x
                    end sub
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                sub foo()
                    log.doLog("hello")
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows enums shadowing global function names', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                enum log
                    debug = "DEBUG"
                    error = "ERROR"
                end enum
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                sub foo(message)
                    print log.debug;" ";message
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows interfaces shadowing global function names', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                interface log
                    abs
                    function formatJson(input)
                end interface
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                sub foo(logger as log)
                    print logger.abs;" ";logger.formatJson("message")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows consts shadowing global function names', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                const log = "hello"   ' const shadows global function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('disallows enum/const shadowing', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                enum SomeName
                    opt1
                    opt2
                end enum

                const SomeName = "hello"    ' const and enum have same name
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Enum', 'Const', 'SomeName').message,
                DiagnosticMessages.nameCollision('Const', 'Enum', 'SomeName').message
            ]);
        });

        it('disallows enum/namespace shadowing', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                enum SomeName
                    opt1
                    opt2
                end enum

                namespace SomeName
                    sub foo()
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Enum', 'Namespace', 'SomeName').message,
                DiagnosticMessages.nameCollision('Namespace', 'Enum', 'SomeName').message
            ]);
        });

        it('disallows interface/namespace shadowing', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                interface SomeName  ' interface has same name as namespace
                    opt1
                    opt2
                end interface

                namespace SomeName
                    sub foo()
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Interface', 'Namespace', 'SomeName').message,
                DiagnosticMessages.nameCollision('Namespace', 'Interface', 'SomeName').message
            ]);
        });

        it('disallows class/namespace shadowing', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                class SomeName  ' class has same name as namespace
                    opt1
                    opt2
                end class

                namespace SomeName
                    sub foo()
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Class', 'Namespace', 'SomeName').message,
                DiagnosticMessages.nameCollision('Namespace', 'Class', 'SomeName').message
            ]);
        });

        it('allows namespaced functions shadowing upper scope function names', () => {
            program.setFile<BrsFile>('source/file.bs', `
                namespace alpha
                    sub log(input)
                      print "in namespace"
                    end sub

                    sub test()
                        log(44) ' prints "in namespace"
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows namespaced functions shadowing upper scope function names', () => {
            program.setFile<BrsFile>('source/file.bs', `
                sub someFunc()
                    print "outside"
                end sub

                namespace alpha
                    sub someFunc()
                      print "inside"
                    end sub

                    sub test()
                        someFunc() ' prints "inside"
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('disallows class/global function shadowing', () => {
            program.setFile<BrsFile>('source/file.bs', `
                class log  ' class shadows global function
                    sub foo()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Class', 'Global Function', 'log')
            ]);
        });

        it('disallows class/local function shadowing', () => {
            program.setFile<BrsFile>('source/file.bs', `
                function someName()
                end function

                class SomeName  ' class shadows local function
                    sub foo()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.functionCannotHaveSameNameAsClass('someName'),
                DiagnosticMessages.nameCollision('Class', 'Function', 'SomeName')
            ]);
        });


        it('allows function having same name as class in namespace', () => {
            program.setFile<BrsFile>('source/file.bs', `
                function someName()
                end function

                namespace alpha
                    class SomeName  ' class in namespace shadows function in upper scope
                        sub foo()
                        end sub
                    end class
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows class in namespace having same name as global function', () => {
            program.setFile<BrsFile>('source/file.bs', `
                namespace alpha
                    class log ' class in namespace shadows global function
                        text = "hello"
                    end class

                    sub foo()
                       myLog = new Log()
                       print myLog.text ' prints "hello"
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('disallows reusing a class name as "for each" variable in a function', () => {
            program.setFile<BrsFile>('source/file.bs', `
                class Person
                    name as string
                end class

                sub foo(people as Person[])
                    for each person in people
                        print person.name
                    end for
                end sub
            `);
            program.validate();
            expectDiagnosticsIncludes(program, DiagnosticMessages.localVarSameNameAsClass('Person').message);
        });

        it('disallows reusing a class name as "for each" variable in a method', () => {
            program.setFile<BrsFile>('source/file.bs', `
                class Person
                    name as string
                    children as Person[]

                    sub test()
                        for each person in m.children
                            print person.name
                        end for
                    end sub
                end class
            `);
            program.validate();
            expectDiagnosticsIncludes(program, DiagnosticMessages.localVarSameNameAsClass('Person').message);
        });
    });


    describe('performance', () => {

        // eslint-disable-next-line func-names, prefer-arrow-callback
        it.skip('namespace linking performance', function () {
            this.timeout(5000);
            // this test takes a few seconds (~4) it is skipped just to make regular test running faster
            program.options.autoImportComponentScript = true;
            const constFileContents = `
                import "pkg:/source/consts2.bs"

                namespace a.b.c
                    const PI = 3.14
                end namespace

                namespace d.e.f
                    const EULER = 2.78
                    const GOLDEN_EULER = EULER + GOLDEN
                end namespace

                namespace g.h.i
                    const A = "A"
                end namespace

                namespace j.k.l
                    const B = "B"
                end namespace

                namespace n.o.p
                    const C = "C"
                end namespace
            `;

            const const2FileContents = `
               import "pkg:/source/consts3.bs"

                namespace a.b.c
                    const ROOT2 = 1.41
                end namespace

                namespace d.e.f
                    const GOLDEN = 1.62
                end namespace

                namespace a.b.c.d
                    const D = "D"
                end namespace

                namespace d.e.f.g
                    const D = "D"
                end namespace
            `;

            let const3FileContents = '';
            const exponentBase = 7; // 7^4 = 2401 total namespaces
            for (let i = 0; i < exponentBase; i++) {
                for (let j = 0; j < exponentBase; j++) {
                    for (let k = 0; k < exponentBase; k++) {
                        for (let l = 0; l < exponentBase; l++) {
                            const3FileContents += `
                            namespace alpha_${i}.beta_${j}.charlie_${k}.delta_${l}
                                const test = "TEST"
                                function getNum() as integer
                                    return 100
                                end function
                            end namespace
                        `;
                        }
                    }
                }
            }

            program.setFile('source/consts.bs', constFileContents);
            program.setFile('source/consts2.bs', const2FileContents);
            program.setFile('source/consts3.bs', const3FileContents);

            const widgetBsFileContents = `
                    import "pkg:/source/consts.bs"

                    sub init()
                        print a.b.c.PI + d.e.f.EULER
                        print a.b.c.d.D + n.o.p.C
                        print d.e.f.GOLDEN_EULER
                        print alpha_0.beta_0.charlie_0.delta_0.getNum().toStr() +  alpha_0.beta_0.charlie_0.delta_0.TEST
                    end sub
                `;
            for (let i = 0; i < 100; i++) {
                const widgetXmlFileContents = trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget${i}" extends="Group">
                    </component>
                `;
                program.setFile(`components/Widget${i}.bs`, widgetBsFileContents);
                program.setFile(`components/Widget${i}.xml`, widgetXmlFileContents);
            }
            program.validate();
            expectZeroDiagnostics(program);
            program.setFile('source/consts.bs', constFileContents);
            program.validate();
            program.setFile('source/consts2.bs', const2FileContents);
            program.validate();
            program.setFile('source/consts3.bs', const3FileContents);
            program.validate();
        });
    });

});
