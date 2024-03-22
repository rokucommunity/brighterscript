import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { createSandbox } from 'sinon';
import { rootDir } from '../../testHelpers.spec';
import { WorkspaceSymbol } from 'vscode-languageserver-types';
import { SymbolKind } from 'vscode-languageserver-types';
import type { BrsFile } from '../../files/BrsFile';
import util, { standardizePath as s } from '../../util';
let sinon = createSandbox();

describe('WorkspaceSymbolProcessor', () => {
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    type ExpectedArray = [string, SymbolKind, string?, number?, number?, number?, number?];

    function doTest(sources: string[], expected: Array<ExpectedArray>) {
        for (let i = 0; i < sources.length; i++) {
            program.setFile(`source/lib${i}.brs`, sources[i]);
        }

        const actual = program.getWorkspaceSymbols().sort((a, b) => symbolToString(a).localeCompare(symbolToString(b)));
        for (let i = 0; i < actual.length; i++) {
            let a = actual[i] as any;
            let b = expected?.[i];
            //if the expected doesn't have a range, delete the range from the actual
            if (b?.[3] === undefined) {
                delete a.location.range;
            }
        }

        expect(
            actual.map(x => symbolToString(x))
        ).to.eql(
            expected?.map(x => symbolToString(
                WorkspaceSymbol.create(
                    x[0],
                    x[1],
                    util.pathToUri(s`${rootDir}/${x[2] ?? 'source/lib0.brs'}`),
                    typeof x[3] === 'number' ? util.createRange(x[3], x[4], x[5], x[6]) : null
                )
            )) ?? undefined
        );
    }

    const SymbolKindMap = new Map(Object.entries(SymbolKind).map(x => [x[1], x[0]]));

    function symbolToString(symbol: WorkspaceSymbol) {
        let result = `${symbol.name}|${SymbolKindMap.get(symbol.kind)}|${symbol.location.uri}`;
        const range = (symbol as any).location.range;
        if (range) {
            result += '|' + util.rangeToString(range);
        }
        return result;
    }

    it('skips other file types for now', () => {
        program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
            </component>
        `);
        expect(
            program.getWorkspaceSymbols()
        ).to.eql([]);
    });

    it('does not crash when name is missing', () => {
        program.plugins['suppressErrors'] = false;
        function testMissingToken(source: string, nameTokenPath: string[], expected?: ExpectedArray[]) {
            const file = program.setFile<BrsFile>('source/lib0.brs', source);
            let node = file.ast.statements[0];
            //delete the token at the given path
            for (let i = 0; i < nameTokenPath.length - 1; i++) {
                node = node[nameTokenPath[i]];
            }
            delete node[nameTokenPath[nameTokenPath.length - 1]];

            doTest([], expected ?? []);
        }

        //function name is missing
        testMissingToken(`
            sub alpha()
            end sub
        `, ['name']);

        //class name is missing
        testMissingToken(`
            class alpha
            end class
        `, ['name']);

        //class field name is missing
        testMissingToken(`
            class alpha
                name as string
            end class
        `, ['body', '0', 'name'], [
            ['alpha', SymbolKind.Class]
        ]);

        //class method name is missing
        testMissingToken(`
            class alpha
                sub test()
                end sub
            end class
        `, ['body', '0', 'name'], [
            ['alpha', SymbolKind.Class]
        ]);

        //interface name is missing
        testMissingToken(`
            interface alpha
            end interface
        `, ['tokens', 'name']);

        //interface method name is missing
        testMissingToken(`
            interface alpha
                sub test() as void
            end interface
        `, ['body', '0', 'tokens', 'name'], [
            ['alpha', SymbolKind.Interface]
        ]);

        //interface field name is missing
        testMissingToken(`
            interface alpha
                name as string
            end interface
        `, ['body', '0', 'tokens', 'name'], [
            ['alpha', SymbolKind.Interface]
        ]);

        //const name is missing
        testMissingToken(`
            const alpha = 1
        `, ['tokens', 'name']);

        //namespace name is missing
        testMissingToken(`
            namespace alpha
            end namespace
        `, ['nameExpression']);

        //enum name is missing
        testMissingToken(`
            enum alpha
            end enum
        `, ['tokens', 'name']);

        //enum member name is missing
        testMissingToken(`
            enum alpha
                name = 1
            end enum
        `, ['body', '0', 'tokens', 'name'], [
            ['alpha', SymbolKind.Enum]
        ]);
    });

    it('finds functions', () => {
        doTest([`
            function alpha()
            end function
            function beta()
            end function
        `], [
            ['alpha', SymbolKind.Function, 'source/lib0.brs', 1, 21, 1, 26],
            ['beta', SymbolKind.Function, 'source/lib0.brs', 3, 21, 3, 25]
        ]);
    });

    it('finds namespaces', () => {
        doTest([`
            namespace alpha
            end namespace
            namespace beta
            end namespace
            namespace charlie
                namespace delta
                end namespace
            end namespace
        `], [
            ['alpha', SymbolKind.Namespace],
            ['beta', SymbolKind.Namespace],
            ['charlie', SymbolKind.Namespace],
            ['delta', SymbolKind.Namespace]
        ]);
    });

    it('finds classes', () => {
        doTest([`
            class alpha
            end class

            namespace beta
                class charlie
                    name as string
                    sub speak()
                        print "I am " + m.name
                    end sub
                end class
            end namespace
        `], [
            ['alpha', SymbolKind.Class],
            ['beta', SymbolKind.Namespace],
            ['charlie', SymbolKind.Class],
            ['name', SymbolKind.Field],
            ['speak', SymbolKind.Method]
        ]);
    });

    it('finds interfaces', () => {
        doTest([`
            interface alpha
                beta as string
            end interface

            namespace charlie
                interface delta
                    echo as string
                    sub foxtrot() as void
                end interface
            end namespace
        `], [
            ['alpha', SymbolKind.Interface],
            ['beta', SymbolKind.Field],
            ['charlie', SymbolKind.Namespace],
            ['delta', SymbolKind.Interface],
            ['echo', SymbolKind.Field],
            ['foxtrot', SymbolKind.Method]
        ]);
    });

    it('finds consts', () => {
        doTest([`
            const alpha = 1
            namespace beta
                const charlie = 2
            end namespace
            const delta = 3
        `], [
            ['alpha', SymbolKind.Constant],
            ['beta', SymbolKind.Namespace],
            ['charlie', SymbolKind.Constant],
            ['delta', SymbolKind.Constant]
        ]);
    });

    it('finds enums', () => {
        doTest([`
            enum alpha
                b = 1
                c = 2
            end enum
            namespace delta
                enum echo
                    f = 3
                    g = 4
                end enum
            end namespace
        `], [
            ['alpha', SymbolKind.Enum],
            ['b', SymbolKind.EnumMember],
            ['c', SymbolKind.EnumMember],
            ['delta', SymbolKind.Namespace],
            ['echo', SymbolKind.Enum],
            ['f', SymbolKind.EnumMember],
            ['g', SymbolKind.EnumMember]
        ]);
    });
});
