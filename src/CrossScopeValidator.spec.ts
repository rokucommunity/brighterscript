import * as sinonImport from 'sinon';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import * as path from 'path';
import type { BrsFile } from './files/BrsFile';
import { trim, expectZeroDiagnostics, expectDiagnostics, expectDiagnosticsIncludes } from './testHelpers.spec';

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
                    return alpha.beta.otherFunc()
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
                        return otherFunc()
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

    describe('symbolNotDefinedInScope', () => {
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
                DiagnosticMessages.cannotFindName('otherFunc').message
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
                DiagnosticMessages.symbolNotDefinedInScope('otherFunc', 'components/Widget2.xml').message
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
                DiagnosticMessages.symbolNotDefinedInScope('iface2', 'components/Widget2.xml').message
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
                DiagnosticMessages.symbolNotDefinedInScope('iface2', 'components/Widget2.xml').message
            ]);
        });

        it.only('should validate when namespaced symbol in second scope is missing because of file change', () => {
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

            program.setFile<BrsFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                </component>
            `);

            program.setFile<BrsFile>('components/Widget.bs', `
                import "pkg:/source/file1.bs"

                sub init()
                    alpha.beta.someFunc()
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);

            // change file1 so  alpha.beta.someFunc is not available
            program.setFile<BrsFile>('pkg:/source/file1.bs', `
                namespace alpha
                    namespace beta
                        function notSomeFunc() as string
                            return "hello"
                        end function
                  end namespace
                end namespace
            `);

            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.cannotFindName('someFunc').message, // not found in source scope from source/file2.bs
                DiagnosticMessages.symbolNotDefinedInScope('alpha.beta.someFunc', 'components/Widget2.xml').message
            ]);
        });
    });


});
