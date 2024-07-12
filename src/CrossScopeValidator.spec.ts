import * as sinonImport from 'sinon';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import * as path from 'path';
import type { BrsFile } from './files/BrsFile';
import { trim, expectZeroDiagnostics, expectDiagnostics, expectDiagnosticsIncludes } from './testHelpers.spec';
import { expect } from 'chai';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import util from './util';

describe('CrossScopeValidator', () => {
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

    describe('providedNodes', () => {
        it('builds a tree', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                sub callOutsideFunc()
                    outsideFunc()
                end sub
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                sub outsideFunc()
                    print "hello"
                end sub

                class Klass
                    x as integer
                end class

                interface IFace
                    x as float
                    y as float
                end interface
            `);
            program.validate();
            const sourceScope = program.getScopeByName('source');
            const results = program.crossScopeValidation.getProvidedTree(sourceScope);
            const tree = results.providedTree;
            expect(tree.getSymbol('callOutsideFunc')).to.exist;
            expect(tree.getSymbol('outsideFunc')).to.exist;
            expect(tree.getSymbol('Klass')).to.exist;
            expect(tree.getSymbol('IFace')).to.exist;
        });

        it('finds duplicates', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha.beta
                    sub thing()
                       alpha.outsideFunc()
                    end sub
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                namespace alpha
                    sub outsideFunc()
                        print "hello"
                    end sub

                    namespace beta
                        class Thing
                            x as integer
                        end class
                end namespace
            `);
            program.validate();
            const sourceScope = program.getScopeByName('source');
            const results = program.crossScopeValidation.getProvidedTree(sourceScope);
            const tree = results.providedTree;
            expect(tree.getSymbol('alpha.beta.Thing')).to.exist;
            expect(results.duplicatesMap.has('alpha.beta.thing')).to.true;
        });

        it('builds a tree from namespaces', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha.beta
                    sub callOutsideFunc()
                       alpha.outsideFunc()
                    end sub
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                sub outsideFunc()
                end sub

                namespace alpha
                    sub outsideFunc()
                        print "hello"
                    end sub

                    namespace beta
                        class Klass
                            x as integer
                        end class

                        interface IFace
                            x as float
                            y as float
                        end interface
                    end namespace
                end namespace
            `);
            program.validate();
            const sourceScope = program.getScopeByName('source');
            const results = program.crossScopeValidation.getProvidedTree(sourceScope);
            const tree = results.providedTree;
            expect(tree.getSymbol('alpha.beta.callOutsideFunc')).to.exist;
            expect(tree.getSymbol('outsideFunc')).to.exist;
            expect(tree.getSymbol('alpha.outsideFunc')).to.exist;
            expect(tree.getSymbol('alpha.beta.Klass')).to.exist;
            expect(tree.getSymbol('alpha.beta.IFace')).to.exist;
        });
    });

    describe('provides & requires', () => {
        it('finds a required symbol in another file', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                sub callOutsideFunc()
                    outsideFunc()
                end sub
            `);
            let file2 = program.setFile<BrsFile>('source/file2.bs', `
                sub outsideFunc()
                    print "hello"
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file2.requiredSymbols.length).to.eq(0);
            const sourceScopeIssues = program.crossScopeValidation.getIssuesForScope(program.getScopeByName('source'));
            expect(sourceScopeIssues.missingSymbols.size).to.eq(0);
        });

        it('finds a required symbol in another file for each scope', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                sub callOutsideFunc()
                    outsideFunc()
                end sub
            `);
            let file2 = program.setFile<BrsFile>('source/file2.bs', `
                sub outsideFunc()
                    print "hello from source"
                end sub
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            let widgetBs = program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callOutsideFunc()
                end sub

                sub outsideFunc()
                    print "hello from widget"
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file2.requiredSymbols.length).to.eq(0);
            expect(widgetBs.requiredSymbols.length).to.eq(1);
            const sourceScopeIssues = program.crossScopeValidation.getIssuesForScope(program.getScopeByName('source'));
            expect(sourceScopeIssues.missingSymbols.size).to.eq(0);
            const widgetScopeIssues = program.crossScopeValidation.getIssuesForScope(program.getScopeByName(`components${path.sep}Widget.xml`));
            expect(widgetScopeIssues.missingSymbols.size).to.eq(0);
        });

        it('finds a required symbol in a namespace in another file', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha
                    sub callOutsideFunc()
                        outsideFunc()
                    end sub
                end namespace
            `);
            let file2 = program.setFile<BrsFile>('source/file2.bs', `
                namespace alpha
                    sub outsideFunc()
                        print "hello from source"
                    end sub
                end namespace
            `);

            program.validate();
            expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file2.requiredSymbols.length).to.eq(0);
            const sourceScopeIssues = program.crossScopeValidation.getIssuesForScope(program.getScopeByName('source'));
            expect(sourceScopeIssues.missingSymbols.size).to.eq(0);
        });


        it('finds if a required symbol is defined different in different scopes', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                sub callOutsideFunc()
                    print outsideFunc()
                end sub
            `);
            let file2 = program.setFile<BrsFile>('source/file2.bs', `
                function outsideFunc() as string
                    return "hello from source"
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            let widgetBs = program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    print callOutsideFunc()
                end sub

                function outsideFunc() as integer
                    return 123
                end function
            `);
            program.validate();
            //expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file2.requiredSymbols.length).to.eq(0);
            expect(widgetBs.requiredSymbols.length).to.eq(1);
            const incompatibleResolutions = program.crossScopeValidation.getIncompatibleSymbolResolutions();
            expect(incompatibleResolutions.length).to.eq(1);
            expect(incompatibleResolutions[0].incompatibleScopes.size).to.eq(2);
        });

        it('finds types defined in different file', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                function takesIface(z as MyInterface) as string
                    return z.name
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                interface MyInterface
                    name as string
                end interface
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file1.requiredSymbols[0].flags).to.eq(SymbolTypeFlag.typetime);
            expect(file1.requiredSymbols[0].typeChain[0].name).to.eq('MyInterface');
            const sourceScopeIssues = program.crossScopeValidation.getIssuesForScope(program.getScopeByName('source'));
            expect(sourceScopeIssues.missingSymbols.size).to.eq(0);
        });

        it('finds members of typecasts of types defined in different file', () => {
            let file1 = program.setFile<BrsFile>('source/file1.bs', `
                function takesIface(z) as string
                    return (z as MyInterface).name
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                interface MyInterface
                    name as string
                end interface
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(file1.requiredSymbols.length).to.eq(1);
            expect(file1.requiredSymbols[0].flags).to.eq(SymbolTypeFlag.typetime);
            expect(file1.requiredSymbols[0].typeChain[0].name).to.eq('MyInterface');
            const sourceScopeIssues = program.crossScopeValidation.getIssuesForScope(program.getScopeByName('source'));
            expect(sourceScopeIssues.missingSymbols.size).to.eq(0);
        });
    });

    describe('incompatibleSymbolDefinition', () => {
        it('allows different symbols that are compatible across scopes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                function callsOther() as string
                    return otherFunc()
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                function otherFunc() as string
                    return "hello"
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callsOther()
                end sub

                function otherFunc() as string ' same function signature as in file2.bs
                    return "goodbye"
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('finds symbols inconsistent across scopes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                function callsOther() as string
                     otherFunc()
                     return "test"
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                function otherFunc() as string
                    return "hello"
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callsOther()
                end sub

                function otherFunc() as integer
                    return 42
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.incompatibleSymbolDefinition('otherFunc', `source, components${path.sep}Widget.xml`).message
            ]);
        });

        it('finds namespaced symbols inconsistent across scopes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                function callsAlphaBetaOther() as string
                     alpha.beta.otherFunc()
                     return "test"
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                namespace alpha.beta
                    function otherFunc() as string
                        return "hello"
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
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callsAlphaBetaOther()
                end sub

                namespace alpha.beta
                    function otherFunc() as integer
                        return 42
                    end function
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.incompatibleSymbolDefinition('alpha.beta.otherFunc', `source, components${path.sep}Widget.xml`).message
            ]);
        });

        it('finds relative namespaced symbols inconsistent across scopes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha.beta
                    function callsOther() as string
                        otherFunc()
                        return "test"
                    end function
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                namespace alpha.beta
                    function otherFunc() as string
                        return "hello"
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
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    alpha.beta.callsOther()
                end sub

                namespace alpha.beta
                    function otherFunc() as integer
                        return 42
                    end function
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.incompatibleSymbolDefinition('otherFunc', `source, components${path.sep}Widget.xml`).message
            ]);
        });

        it('adds a diagnostic when a file import changes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                interface iface1
                    name as string
                    otherIface as iface2
                end interface

                function useIface1(x as iface1) as integer
                    out = x.otherIface.data + 2
                    return out
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                interface iface2
                    data as integer
                end interface
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/widget.bs', `
                import "pkg:/source/file2.bs"
            `);

            program.validate();
            expectZeroDiagnostics(program);

            program.setFile<BrsFile>('components/file3.bs', `
                interface iface2
                    data as string
                end interface
            `);
            program.setFile<BrsFile>('components/widget.bs', `
                import "file3.bs"
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.incompatibleSymbolDefinition('iface2', `source, components${path.sep}Widget.xml`).message
            ]);
        });
    });

    describe('cannotFindName', () => {
        it('should not complain when all non-namespaced symbols are found', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                function callsOther() as string
                    return otherFunc()
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                function otherFunc() as string
                    return "hello"
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callsOther()
                end sub

                function otherFunc() as string
                    return "goodbye"
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should not have scope specific error if symbol not found in any scope', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                function callsOther() as string
                    return otherFunc()
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callsOther()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindFunction('otherFunc').message
            ]);
        });

        it('should allow namespaced symbols to match a require in a namespace', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha.beta
                    function callsOther() as string
                        return otherFunc()
                    end function
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                function otherFunc() as string ' non-namespaced - matches for scope source
                    return "hello"
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    alpha.beta.callsOther()
                end sub

                namespace alpha.beta
                    function otherFunc() as string ' namespaced - matches for scope Widget
                        return "goodbye"
                    end function
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should find when a non-namespaced symbols are not in a second scope', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                function callsOther() as string
                    otherFunc()
                    return "test"
                end function
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                function otherFunc() as string
                    return "hello"
                end function
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            // "otherFunc" is in Widget
            program.setFile<BrsFile>('components/Widget.bs', `
                sub init()
                    callsOther()
                end sub

                function otherFunc() as string
                    return "goodbye"
                end function
            `);

            program.setFile<BrsFile>('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <script uri="pkg:/source/file1.bs"/>
                </component>
            `);
            // "otherFunc" is NOT in Widget2
            program.setFile<BrsFile>('components/Widget2.bs', `
                sub init()
                    callsOther()
                end sub
            `);
            program.validate();

            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindFunction('otherFunc', `components${path.sep}Widget2.xml`).message
            ]);
        });

        it('should validate when type is not available in a second scope', () => {
            program.setFile<BrsFile>('components/file1.bs', `
                interface iface1 ' this file is in components - it is not in source scope
                    data as iface2
                end interface
            `);
            program.setFile<BrsFile>('components/file2.bs', `
                interface iface2
                    name as string
                end interface
            `);

            program.setFile<BrsFile>('components/common.bs', `
                sub printData(x as iface1)
                    print x.data.name
                end sub
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                </component>
            `);
            // "iface2" is in Widget
            program.setFile<BrsFile>('components/Widget.bs', `
                import "pkg:/components/file1.bs"
                import "pkg:/components/file2.bs"
                import "pkg:/components/common.bs"
            `);

            program.setFile<BrsFile>('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                </component>
            `);
            // "iface2" is NOT in Widget2
            program.setFile<BrsFile>('components/Widget2.bs', `
                import "pkg:/components/file1.bs"
                import "pkg:/components/common.bs"
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.cannotFindName('iface2', `components${path.sep}Widget2.xml`).message
            ]);
        });

        it('should validate when type is not available in an new scope', () => {
            program.setFile<BrsFile>('components/file1.bs', `
                interface iface1 ' this file is in components - it is not in source scope
                    data as iface2
                end interface
            `);
            program.setFile<BrsFile>('components/file2.bs', `
                interface iface2
                    name as string
                end interface
            `);

            program.setFile<BrsFile>('components/common.bs', `
                sub printData(x as iface1)
                    print x.data.name
                end sub
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                </component>
            `);
            // "iface2" is in Widget
            program.setFile<BrsFile>('components/Widget.bs', `
                import "pkg:/components/file1.bs"
                import "pkg:/components/file2.bs"
                import "pkg:/components/common.bs"
            `);


            program.validate();
            expectZeroDiagnostics(program);

            program.setFile<BrsFile>('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                </component>
            `);
            // "iface2" is NOT in Widget2
            program.setFile<BrsFile>('components/Widget2.bs', `
                import "pkg:/components/file1.bs"
                import "pkg:/components/common.bs"
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.cannotFindName('iface2', `components${path.sep}Widget2.xml`).message
            ]);
        });

        it('should validate when namespaced symbol in second scope is missing because of file change', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha
                    namespace beta
                        function someFunc() as string
                            return "hello"
                        end function
                    end namespace
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                sub otherFunc()
                    print alpha.beta.someFunc() + " world"
                end sub
            `);

            program.setFile<BrsFile>('source/file3.bs', `
                import "file1.bs"
                import "file2.bs"
            `);

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                </component>
            `);

            program.setFile<BrsFile>('components/Widget.bs', `
                import "pkg:/source/file3.bs"

                sub init()
                    alpha.beta.someFunc()
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);

            // change file3 so  alpha.beta.someFunc is not available
            program.setFile<BrsFile>('pkg:/source/file3.bs', `
                namespace alpha.beta ' need to define the namespace, but not someFunc()
                    const pi = 3.14
                end namespace
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindFunction('someFunc', 'alpha.beta.someFunc', 'alpha.beta', 'namespace').message
            ]);
        });

        it('should find relative namespace items defined in another file', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha.beta
                    enum Direction
                        up
                        down
                    end enum

                    class Foo
                        x as integer
                        dir as Direction
                    end class
                end namespace
            `);
            program.setFile<BrsFile>('source/file2.bs', `
                namespace alpha.beta
                    interface Data
                        name as string
                        id as integer
                    end interface
                end namespace
            `);

            program.setFile<BrsFile>('source/file3.bs', `
                namespace Alpha.Beta
                    class Bar extends Foo
                        function getData() as Data
                            return {name: m.dir.toStr(), id: m.x}
                        end function
                    end class
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('should find member symbols in other file when editing', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace alpha.beta
                    enum Direction
                        up
                        down
                    end enum

                    class Foo
                         dir as Direction
                    end class
                end namespace
            `);

            program.setFile<BrsFile>('source/file2.bs', `
                namespace Alpha.Beta
                    class Bar extends Foo
                        sub goDown()
                            m.dir = Direction.down
                        end sub
                    end class
                end namespace
            `);

            const file3Text = `
                namespace Alpha.Beta
                    class Other
                        function getPi() as float
                            return 3.14
                        end function
                    end class
                end namespace
            `;

            program.setFile<BrsFile>('source/file3.bs', file3Text);
            program.validate();
            expectZeroDiagnostics(program);

            program.setFile<BrsFile>('source/file3.bs', file3Text); // NO CHANGE!!
            program.validate();
            expectZeroDiagnostics(program);
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

                program.setFile('components/widget.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget" extends="Group">
                        <script uri="pkg:/components/widget.bs"/>
                    </component>
                `);

                program.setFile('components/widget.bs', `
                    import "pkg:/source/constants.bs"
                    import "pkg:/source/ns.bs"

                    sub init()
                        print top_twoPi
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        it('allows union types from imports', () => {
            program.setFile('components/namespaces.bs', `
                namespace alpha
                    namespace beta
                        interface BaseCase
                            name as string
                        end interface
                    end namespace
                end namespace

            `);
            program.setFile('components/utils.bs', `
                namespace alpha
                    namespace beta
                        interface OtherCase
                            name as string
                        end interface
                    end namespace
                end namespace

            `);
            program.setFile('components/widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="pkg:/components/widget.bs"/>
                </component>
            `);

            program.setFile('components/widget.bs', `
                import "pkg:/components/utils.bs"
                import "pkg:/components/namespaces.bs"

                sub foo(input as alpha.beta.BaseCase or alpha.beta.OtherCase)
                    print input.name
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('finds custom components', () => {
            program.setFile('components/utils.bs', `
                function printWidgetName(widg as roSGNodeWidget)
                    print widg.name
                end function

                function getWidget(name as string) as roSGNodeWidget
                    widge = createObject("roSgNode", "Widget")
                    widge.name = name
                    return widge
                end function
            `);
            program.setFile('components/widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="pkg:/components/widget.bs"/>
                    <interface>
                        <field id="name" type="string" />
                    </interface>
                </component>
            `);

            program.setFile('components/widget.bs', `
                import "pkg:/components/utils.bs"

                sub init()
                    stuff(m.top as roSGNodeWidget)
                end sub

                sub stuff(w as roSgNodeWidget)
                    printWidgetName(w)
                end sub
            `);

            program.setFile('components/other.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Other" extends="Group">
                    <script uri="pkg:/components/other.bs"/>
                    <interface>
                        <field id="name" type="string" />
                    </interface>
                </component>
            `);

            program.setFile('components/other.bs', `
                import "pkg:/components/utils.bs"
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

    });

    describe('alias statements', () => {
        it('allows alias namespace and referencing it', () => {
            program.setFile('components/utils.bs', `
                namespace get
                    function hello() as string
                        return "hello"
                    end function
                end namespace
            `);

            program.setFile('components/widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="pkg:/components/widget.bs"/>
                    <script uri="pkg:/components/utils.bs"/>
                </component>
            `);

            program.setFile('components/widget.bs', `
                alias get2 = get

                sub foo()
                    print get2.hello()
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('gracefully handles circular reference', () => {
            program.setFile('components/utils.bs', `
                namespace get
                    function aa()
                        return {}
                    end function
                end namespace

            `);

            program.setFile('components/widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="pkg:/components/widget.bs"/>
                    <script uri="pkg:/components/utils.bs"/>
                </component>
            `);

            program.setFile('components/widget.bs', `
                alias get2 = get2

                sub foo()
                    print "hello"
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('get2')
            ]);
            program.setFile('components/widget.bs', `
                alias get2 = get 'no more circular reference

                sub foo()
                    print "hello"
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('revalidates when source namespace changes', () => {
            program.setFile('components/utils.bs', `
                namespace alpha
                    function passThru(val as integer) as string
                        return val.toStr()
                    end function
                end namespace

            `);

            program.setFile('components/widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="pkg:/components/widget.bs"/>
                    <script uri="pkg:/components/utils.bs"/>
                </component>
            `);

            program.setFile('components/widget.bs', `
                alias beta = alpha

                sub foo()
                    print beta.passThru(1)
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);

            // now alpha.passthru takes a string
            program.setFile('components/utils.bs', `
                namespace alpha
                    function passThru(val as string) as string
                        return val.toStr()
                    end function
                end namespace

            `);
            program.validate();

            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });
    });

    describe('revalidation', () => {
        it('works for multi-scope usage, when variable is passed as function param', () => {
            program.options.autoImportComponentScript = true;
            //set a baseline where everyone is happy
            program.setFile('components/TextOptions.bs', `
                interface TextOptions
                    fontName as string
                end interface
            `);

            const button1 = program.setFile('components/Button1.bs', `
                import "pkg:/components/TextOptions.bs"
                function configure(options as TextOptions)
                    m.fontName = options.fontName
                end function
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            const button2 = program.setFile('components/Button2.bs', `
                import "pkg:/components/TextOptions.bs"
                function configure(options as TextOptions)
                    m.fontName = options.fontName
                end function
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);

            //now rename the interface property and verify both files have an error
            program.setFile('components/TextOptions.bs', `
                interface TextOptions
                    fontFileName as string 'renamed from "fontName" to "fontFileName"
                end interface
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    message: DiagnosticMessages.cannotFindName('fontName', 'TextOptions.fontName', 'TextOptions').message,
                    location: { uri: util.pathToUri(button1.srcPath) }
                },
                {
                    message: DiagnosticMessages.cannotFindName('fontName', 'TextOptions.fontName', 'TextOptions').message,
                    location: { uri: util.pathToUri(button2.srcPath) }
                }
            ]);
        });

        it('works for multi-scope usage, with namespaced functions', () => {
            program.options.autoImportComponentScript = true;
            //set a baseline where everyone is happy
            program.setFile('components/namespace.bs', `
                namespace alpha
                    namespace beta
                        function getValue() as string
                            return "value"
                        end function
                    end namespace
                end namespace
            `);

            const button1 = program.setFile('components/Button1.bs', `
                import "pkg:/components/namespace.bs"
                function configure()
                    m.label.text = alpha.beta.getValue()
                end function
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            const button2 = program.setFile('components/Button2.bs', `
                import "pkg:/components/namespace.bs"
                namespace alpha.beta
                    function configure()
                        m.label.text = getValue()
                    end function
                end namespace
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);

            //now rename the interface property and verify both files have an error
            program.setFile('components/namespace.bs', `
                namespace alpha
                    namespace beta
                        function getValue(text as string) as string
                            return text
                        end function
                    end namespace
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    message: DiagnosticMessages.mismatchArgumentCount(1, 0).message,
                    location: { uri: util.pathToUri(button1.srcPath) }
                },
                {
                    message: DiagnosticMessages.mismatchArgumentCount(1, 0).message,
                    location: { uri: util.pathToUri(button2.srcPath) }
                }
            ]);
        });

        it('works for multi-scope usage, with namespaced consts', () => {
            program.options.autoImportComponentScript = true;
            //set a baseline where everyone is happy
            program.setFile('source/test.bs', `
                namespace alpha.beta
                   const PI = 3.14
                end namespace
            `);

            program.setFile('components/Button1.bs', `
                import "pkg:/source/test.bs"
                function configure()
                    m.label.text = alpha.beta.PI.toStr()
                end function
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            program.setFile('components/Button2.bs', `
                import "pkg:/source/test.bs"
                namespace alpha.beta
                    sub configure()
                        m.label.text = alpha.beta.PI.toStr()
                    end sub

                    sub noop()
                        print "hello"
                    end sub
                end namespace
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);

            //now rename the interface property and verify both files have an error
            program.setFile('source/test.bs', `
                namespace alpha.beta
                    const PI = 3.14159
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('works for multi-scope usage, with namespaced consts name changes', () => {
            program.options.autoImportComponentScript = true;
            program.logger.logLevel = 'info';
            //set a baseline where everyone is happy
            program.setFile('source/test.bs', `
                namespace alpha.beta
                   const PI = 3.14
                end namespace
            `);

            for (let i = 0; i < 100; i++) {

                program.setFile(`components/Button${i}.bs`, `
                    import "pkg:/source/test.bs"
                    namespace alpha.beta
                        sub configure(x = alpha.beta.PI)
                            print x
                        end sub
                    end namespace
                `);

                program.setFile(`components/Button${i}.xml`, `
                    <component name="Button${i}" extends="Group">
                    </component>
                `);
            }
            program.validate();
            expectZeroDiagnostics(program);

            //now rename the interface property and verify both files have an error
            program.setFile('source/test.bs', `
                namespace alpha.beta
                    const PIE = 3.14159
                end namespace
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.cannotFindName('PI', 'alpha.beta.PI', 'alpha.beta', 'namespace').message
            ]);
        });

        it('works for multi-scope usage, when changing imported namespace members', () => {
            program.options.autoImportComponentScript = true;
            //set a baseline where everyone is happy
            program.setFile('source/test.bs', `
                namespace alpha.beta
                   function getValue()
                        return 1
                    end function

                    namespace charlie
                        const hello = "hello"
                    end namespace
                end namespace
            `);

            const button1 = program.setFile('components/Button1.bs', `
                import "pkg:/source/test.bs"
                function configure()
                    m.label.text = alpha.beta.getValue.toStr()
                end function

                sub noop()
                    print alpha.beta.charlie.hello
                end sub
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            const button2 = program.setFile('components/Button2.bs', `
                import "pkg:/source/test.bs"
                namespace alpha.beta
                    sub configure()
                        m.label.text = getValue.toStr()
                    end sub

                    sub noop()
                        print "hello"
                    end sub

                    sub noop2()
                        print alpha.beta.charlie.hello
                    end sub
                end namespace
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);

            //now rename the interface property and verify both files have an error
            program.setFile('source/test.bs', `
                namespace alpha.beta
                    function getOtherValue()
                        return 1
                    end function

                    namespace charlie
                        const hello = "hello"
                    end namespace
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    message: DiagnosticMessages.cannotFindName('getValue', 'alpha.beta.getValue', 'alpha.beta', 'namespace').message,
                    location: { uri: util.pathToUri(button1.srcPath) }
                },
                {
                    message: DiagnosticMessages.cannotFindName('getValue').message,
                    location: { uri: util.pathToUri(button2.srcPath) }
                }
            ]);
        });

        it('works when changing file multiple times', () => {
            program.options.autoImportComponentScript = true;
            //set a baseline where everyone is happy
            program.setFile('source/test.bs', `
                namespace alpha.beta
                    function someFunc()
                        return "test"
                    end function
                end namespace
            `);

            const widgetFile = program.setFile('components/Widget.bs', `
                import "pkg:/source/test.bs"
                sub init()
                    alpha.beta.someFunc()
                end sub
            `);
            program.setFile('components/Widget.xml', `
                <component name="Widget" extends="Group">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);

            let testCount = 4;
            while (testCount > 0) {
                testCount--;

                //now rename the interface property and verify both files have an error
                program.setFile('source/test.bs', `
                    namespace alpha.beta
                        function notSomeFunc()
                            return "test"
                        end function
                    end namespace
                `);
                program.validate();
                expectDiagnostics(program, [
                    {
                        message: DiagnosticMessages.cannotFindFunction('someFunc', 'alpha.beta.someFunc', 'alpha.beta', 'namespace').message,
                        location: { uri: util.pathToUri(widgetFile.srcPath) }
                    }
                ]);

                //reset file:
                program.setFile('source/test.bs', `
                    namespace alpha.beta
                        function someFunc()
                            return "test"
                        end function
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            }
        });
    });

    describe('duplicate symbols / name collisions', () => {
        it('finds duplicates', () => {
            program.options.autoImportComponentScript = true;

            program.setFile('source/utils.bs', `
                interface Test
                    name as string
                end interface
            `);

            program.setFile('components/Button1.bs', `
                import "pkg:/source/utils.bs"
                const Test = "test"
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            program.setFile('components/Button2.bs', `
                import "pkg:/source/utils.bs"
                function test()
                end function
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Const', 'Interface', 'Test'),
                DiagnosticMessages.nameCollision('Interface', 'Const', 'Test'),
                DiagnosticMessages.nameCollision('Function', 'Interface', 'Test'),
                DiagnosticMessages.nameCollision('Interface', 'Function', 'test')
            ]);
        });

        it('finds duplicates inside a namespace', () => {
            program.options.autoImportComponentScript = true;

            program.setFile('source/utils.bs', `
                namespace alpha.beta
                    interface Test
                        name as string
                    end interface
                end namespace
            `);

            program.setFile('components/Button1.bs', `
                import "pkg:/source/utils.bs"
                namespace alpha.beta
                    const Test = "test"
                end namespace
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            program.setFile('components/Button2.bs', `
                import "pkg:/source/utils.bs"
                namespace alpha.beta
                    function test()
                    end function
                end namespace
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Const', 'Interface', 'alpha.beta.Test'),
                DiagnosticMessages.nameCollision('Interface', 'Const', 'alpha.beta.Test'),
                DiagnosticMessages.nameCollision('Function', 'Interface', 'alpha.beta.Test'),
                DiagnosticMessages.nameCollision('Interface', 'Function', 'alpha.beta.test')
            ]);
        });

        it('does not have diagnostic if items are namespaced', () => {
            program.options.autoImportComponentScript = true;

            program.setFile('source/utils.bs', `
                interface Test
                    name as string
                end interface
            `);

            program.setFile('components/Button1.bs', `
                import "pkg:/source/utils.bs"
                namespace alpha.beta
                    const Test = "test"
                end namespace
            `);
            program.setFile('components/Button1.xml', `
                <component name="Button1" extends="Group">
                </component>
            `);

            program.setFile('components/Button2.bs', `
                import "pkg:/source/utils.bs"
                namespace alpha.beta
                    function test()
                    end function
                end namespace
            `);

            program.setFile('components/Button2.xml', `
                <component name="Button2" extends="Group">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('finds duplicates in same file', () => {
            program.options.autoImportComponentScript = true;

            program.setFile('source/utils.bs', `
                interface Test
                    name as string
                end interface

                const Test = 89
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Const', 'Interface', 'Test'),
                DiagnosticMessages.nameCollision('Interface', 'Const', 'Test')
            ]);
        });

        it('finds namespaced duplicates in same file', () => {
            program.options.autoImportComponentScript = true;

            program.setFile('source/utils.bs', `
                namespace alpha
                    namespace beta
                        interface Test
                            name as string
                        end interface

                        const Test = 89
                    end namespace
                end namespace
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nameCollision('Const', 'Interface', 'alpha.beta.Test'),
                DiagnosticMessages.nameCollision('Interface', 'Const', 'alpha.beta.Test')
            ]);
        });
    });
});
