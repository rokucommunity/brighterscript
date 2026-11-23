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
        `, ['tokens', 'name']);

        //class name is missing
        testMissingToken(`
            class alpha
            end class
        `, ['tokens', 'name']);

        //class field name is missing
        testMissingToken(`
            class alpha
                name as string
            end class
        `, ['body', '0', 'tokens', 'name'], [
            ['alpha', SymbolKind.Class]
        ]);

        //class method name is missing
        testMissingToken(`
            class alpha
                sub test()
                end sub
            end class
        `, ['body', '0', 'tokens', 'name'], [
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

    describe('location boundaries', () => {
        /**
         * Get every workspace symbol as a `name|kind|containerName|uri|range` string, sorted for stable comparison
         */
        function getSymbolStrings() {
            return program.getWorkspaceSymbols().map((x: any) => {
                return `${x.name}|${SymbolKindMap.get(x.kind)}|${x.containerName}|${x.location.uri}|${util.rangeToString(x.location.range)}`;
            }).sort();
        }

        function uri(pkgPath: string) {
            return util.pathToUri(s`${rootDir}/${pkgPath}`);
        }

        it('computes exact locations across .bs and .brs files, including CRLF, emoji, and nested namespaces', () => {
            program.setFile('source/main.bs', [
                'namespace alpha',
                '    namespace beta.charlie',
                '        class Person',
                '            name as string',
                '            sub speak()',
                '            end sub',
                '        end class',
                '    end namespace',
                '    enum Direction',
                '        up = "up"',
                '        down = "down"',
                '    end enum',
                '    interface Shape',
                '        width as integer',
                '        function area() as float',
                '    end interface',
                '    const PI = 3.14',
                'end namespace',
                'function empty()',
                'end function',
                'const LAST_ONE = true'
            ].join('\n'));
            program.setFile('source/lib.brs', [
                '\' 😀 header comment',
                'function alpha(a, b)',
                '    if a then',
                '        print "😀"',
                '    elseif b then',
                '        print 2',
                '    end if',
                'end function',
                'sub beta() : print "😀😀" : end sub : sub charlie() : end sub',
                'sub emptyBrs()',
                'end sub',
                ''
            ].join('\r\n'));
            const main = uri('source/main.bs');
            const lib = uri('source/lib.brs');
            expect(getSymbolStrings()).to.eql([
                `alpha|Function|undefined|${lib}|1:9-1:14`,
                `alpha|Namespace|undefined|${main}|0:10-0:15`,
                `area|Method|Shape|${main}|14:17-14:21`,
                `beta|Function|undefined|${lib}|8:4-8:8`,
                `charlie|Function|undefined|${lib}|8:42-8:49`,
                `charlie|Namespace|alpha|${main}|1:14-1:26`,
                `Direction|Enum|alpha|${main}|8:9-8:18`,
                `down|EnumMember|Direction|${main}|10:8-10:12`,
                `empty|Function|undefined|${main}|18:9-18:14`,
                `emptyBrs|Function|undefined|${lib}|9:4-9:12`,
                `LAST_ONE|Constant|undefined|${main}|20:6-20:14`,
                `name|Field|Person|${main}|3:12-3:16`,
                `Person|Class|charlie|${main}|2:14-2:20`,
                `PI|Constant|alpha|${main}|16:10-16:12`,
                `Shape|Interface|alpha|${main}|12:14-12:19`,
                `speak|Method|Person|${main}|4:16-4:21`,
                `up|EnumMember|Direction|${main}|9:8-9:10`,
                `width|Field|Shape|${main}|13:8-13:13`
            ].sort());
        });

        it('uses utf-16 code units for symbols that follow an emoji on the same line', () => {
            program.setFile('source/main.bs', [
                'const A = "😀" : const B = 2',
                'enum E',
                '    x = "😀😀" : y = "b"',
                'end enum'
            ].join('\n'));
            const main = uri('source/main.bs');
            expect(getSymbolStrings()).to.eql([
                `A|Constant|undefined|${main}|0:6-0:7`,
                `B|Constant|undefined|${main}|0:23-0:24`,
                `E|Enum|undefined|${main}|1:5-1:6`,
                `x|EnumMember|E|${main}|2:4-2:5`,
                `y|EnumMember|E|${main}|2:17-2:18`
            ].sort());
        });

        it('computes exact locations for symbols after a multi-line template string', () => {
            program.setFile('source/main.bs', [
                'sub main(who as string)',
                '    count = 1',
                '    text = `line one 😀',
                // eslint-disable-next-line no-template-curly-in-string
                'two ${who} and ${count}',
                // eslint-disable-next-line no-template-curly-in-string
                'three ${ lcase(who) }`',
                '    print text',
                'end sub',
                'function after()',
                'end function',
                ''
            ].join('\n'));
            const main = uri('source/main.bs');
            expect(getSymbolStrings()).to.eql([
                `after|Function|undefined|${main}|7:9-7:14`,
                `main|Function|undefined|${main}|0:4-0:8`
            ].sort());
        });
    });
});
