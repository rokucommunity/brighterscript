import * as sinonImport from 'sinon';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import * as path from 'path';
import type { BrsFile } from './files/BrsFile';
import { trim, expectZeroDiagnostics, expectDiagnostics } from './testHelpers.spec';

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
            //    expectDiagnostics(program, [
            //  DiagnosticMessages.incompatibleSymbolDefinition('otherFunc', `source, components${path.sep}Widget.xml`).message
            // ]);

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

});
