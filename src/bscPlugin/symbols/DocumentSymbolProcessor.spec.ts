import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { createSandbox } from 'sinon';
import { rootDir } from '../../testHelpers.spec';
import type { DocumentSymbol } from 'vscode-languageserver-types';
import { SymbolKind } from 'vscode-languageserver-types';
import type { BrsFile } from '../../files/BrsFile';
import { util } from '../../util';
let sinon = createSandbox();

describe('DocumentSymbolProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    function doTest(source: string, expected: SymbolTree) {
        program.setFile('source/main.brs', source);
        expectSymbols(
            program.getDocumentSymbols('source/main.brs'),
            expected
        );
    }

    it('skips other file types for now', () => {
        program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
            </component>
        `);
        expectSymbols(
            program.getDocumentSymbols('components/MainScene.xml'),
            {}
        );
    });

    it('does not crash when name is missing', () => {
        program.plugins['suppressErrors'] = false;
        function testMissingToken(source: string, nameTokenPath: string[], expected: SymbolTree = {}) {
            const file = program.setFile<BrsFile>('source/main.brs', source);
            let node = file.ast.statements[0];
            //delete the token at the given path
            for (let i = 0; i < nameTokenPath.length - 1; i++) {
                node = node[nameTokenPath[i]];
            }

            const lastTokenPath = nameTokenPath[nameTokenPath.length - 1];
            delete node[lastTokenPath];
            expectSymbols(
                program.getDocumentSymbols('source/main.brs'),
                expected
            );
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
        `, ['body', '0', 'tokens', 'name'], {
            alpha: SymbolKind.Class
        });

        //class method name is missing
        testMissingToken(`
            class alpha
                sub test()
                end sub
            end class
        `, ['body', '0', 'tokens', 'name'], {
            alpha: SymbolKind.Class
        });

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
        `, ['body', '0', 'tokens', 'name'], {
            alpha: SymbolKind.Interface
        });

        //interface field name is missing
        testMissingToken(`
            interface alpha
                name as string
            end interface
        `, ['body', '0', 'tokens', 'name'], {
            alpha: SymbolKind.Interface
        });

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
        `, ['body', '0', 'tokens', 'name'], {
            alpha: SymbolKind.Enum
        });
    });

    it('finds functions', () => {
        doTest(`
            function alpha()
            end function
            function beta()
            end function
        `, {
            'alpha': SymbolKind.Function,
            'beta': SymbolKind.Function
        });
    });

    it('finds namespaces', () => {
        doTest(`
            namespace alpha
            end namespace
            namespace beta
            end namespace
            namespace charlie
                namespace delta
                end namespace
            end namespace
        `, {
            alpha: SymbolKind.Namespace,
            beta: SymbolKind.Namespace,
            charlie: {
                kind: SymbolKind.Namespace,
                children: {
                    delta: SymbolKind.Namespace
                }
            }
        });
    });

    it('finds classes', () => {
        doTest(`
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
        `, {
            alpha: SymbolKind.Class,
            beta: {
                kind: SymbolKind.Namespace,
                children: {
                    charlie: {
                        kind: SymbolKind.Class,
                        children: {
                            name: SymbolKind.Field,
                            speak: SymbolKind.Method
                        }
                    }
                }
            }
        });
    });

    it('finds interfaces', () => {
        doTest(`
            interface alpha
                name as string
            end interface

            namespace beta
                interface charlie
                    age as string
                    sub speak() as void
                end interface
            end namespace
        `, {
            alpha: {
                kind: SymbolKind.Interface,
                children: {
                    name: SymbolKind.Field
                }
            },
            beta: {
                kind: SymbolKind.Namespace,
                children: {
                    charlie: {
                        kind: SymbolKind.Interface,
                        children: {
                            age: SymbolKind.Field,
                            speak: SymbolKind.Method
                        }
                    }
                }
            }
        });
    });

    it('finds consts', () => {
        doTest(`
            const alpha = 1
            namespace beta
                const charlie = 2
            end namespace
            const delta = 3
        `, {
            alpha: SymbolKind.Constant,
            beta: {
                kind: SymbolKind.Namespace,
                children: {
                    charlie: SymbolKind.Constant
                }
            },
            delta: SymbolKind.Constant
        });
    });

    it('finds enums', () => {
        doTest(`
            enum alpha
                a = 1
                b = 2
            end enum
            namespace beta
                enum charlie
                    c = 3
                    d = 4
                end enum
            end namespace
        `, {
            alpha: {
                kind: SymbolKind.Enum,
                children: {
                    a: SymbolKind.EnumMember,
                    b: SymbolKind.EnumMember
                }
            },
            beta: {
                kind: SymbolKind.Namespace,
                children: {
                    charlie: {
                        kind: SymbolKind.Enum,
                        children: {
                            c: SymbolKind.EnumMember,
                            d: SymbolKind.EnumMember
                        }
                    }
                }
            }
        });
    });

    describe('location boundaries', () => {
        /**
         * Flatten the document symbols into `name|kind|range|selectionRange` strings, indenting children by 2 spaces per level
         */
        function getSymbolStrings(srcPath: string) {
            const result: string[] = [];
            function walk(symbols: DocumentSymbol[], indent: string) {
                for (const symbol of symbols ?? []) {
                    result.push(`${indent}${symbol.name}|${SymbolKindMap.get(symbol.kind)}|${util.rangeToString(symbol.range)}|${util.rangeToString(symbol.selectionRange)}`);
                    walk(symbol.children, indent + '  ');
                }
            }
            walk(program.getDocumentSymbols(srcPath), '');
            return result;
        }

        it('computes exact ranges for nested multi-line constructs in a .bs file with no trailing newline', () => {
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
            expect(getSymbolStrings('source/main.bs')).to.eql([
                'alpha|Namespace|0:0-17:13|0:10-0:15',
                '  charlie|Namespace|1:4-7:17|1:14-1:26',
                '    Person|Class|2:8-6:17|2:14-2:20',
                '      name|Field|3:12-3:26|3:12-3:16',
                '      speak|Method|4:12-5:19|4:16-4:21',
                '  Direction|Enum|8:4-11:12|8:9-8:18',
                '    up|EnumMember|9:8-9:17|9:8-9:10',
                '    down|EnumMember|10:8-10:21|10:8-10:12',
                '  Shape|Interface|12:4-15:17|12:14-12:19',
                '    width|Field|13:8-13:24|13:8-13:13',
                '    area|Method|14:8-14:32|14:17-14:21',
                '  PI|Constant|16:4-16:19|16:10-16:12',
                'empty|Function|18:0-19:12|18:9-18:14',
                'LAST_ONE|Constant|20:0-20:21|20:6-20:14'
            ]);
        });

        it('computes exact ranges for empty-bodied constructs', () => {
            program.setFile('source/main.bs', [
                'namespace alpha',
                'end namespace',
                'class Beta',
                'end class',
                'interface Charlie',
                'end interface',
                'enum Delta',
                'end enum',
                'sub main()',
                '    if true then',
                '    else if false then',
                '    else',
                '    end if',
                '    while true',
                '    end while',
                '    for i = 0 to 1',
                '    end for',
                'end sub'
            ].join('\n'));
            expect(getSymbolStrings('source/main.bs')).to.eql([
                'alpha|Namespace|0:0-1:13|0:10-0:15',
                'Beta|Class|2:0-3:9|2:6-2:10',
                'Charlie|Interface|4:0-5:13|4:10-4:17',
                'Delta|Enum|6:0-7:8|6:5-6:10',
                'main|Function|8:0-17:7|8:4-8:8'
            ]);
        });

        it('computes exact ranges in a .brs file with CRLF line endings, emoji, and elseif', () => {
            program.setFile('source/main.brs', [
                '\' 😀 header comment',
                'function alpha(a, b)',
                '    if a then',
                '        print "😀"',
                '    elseif b then',
                '        print 2',
                '    else',
                '        print 3',
                '    end if',
                'end function',
                'sub beta() : print "😀😀" : end sub : sub charlie() : end sub',
                'sub empty()',
                'end sub',
                ''
            ].join('\r\n'));
            expect(getSymbolStrings('source/main.brs')).to.eql([
                'alpha|Function|1:0-9:12|1:9-1:14',
                'beta|Function|10:0-10:35|10:4-10:8',
                'charlie|Function|10:38-10:61|10:42-10:49',
                'empty|Function|11:0-12:7|11:4-11:9'
            ]);
        });

        it('uses utf-16 code units for symbols that follow an emoji on the same line', () => {
            program.setFile('source/main.bs', [
                'const A = "😀" : const B = 2',
                'enum E',
                '    x = "😀😀" : y = "b"',
                'end enum'
            ].join('\n'));
            expect(getSymbolStrings('source/main.bs')).to.eql([
                'A|Constant|0:0-0:14|0:6-0:7',
                'B|Constant|0:17-0:28|0:23-0:24',
                'E|Enum|1:0-3:8|1:5-1:6',
                '  x|EnumMember|2:4-2:14|2:4-2:5',
                '  y|EnumMember|2:17-2:24|2:17-2:18'
            ]);
        });

        it('computes exact ranges for symbols after a multi-line template string', () => {
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
            expect(getSymbolStrings('source/main.bs')).to.eql([
                'main|Function|0:0-6:7|0:4-0:8',
                'after|Function|7:0-8:12|7:9-7:14'
            ]);
        });
    });

    function expectSymbols(documentSymbols: DocumentSymbol[], expected: SymbolTree) {
        expect(
            symbolKindToString(createSymbolTree(documentSymbols))
        ).to.eql(
            symbolKindToString(expected)
        );
    }

    const SymbolKindMap = new Map(Object.entries(SymbolKind).map(x => [x[1], x[0]]));

    function symbolKindToString(tree: SymbolTree) {
        //recursively walk the tree and convert every .kind property to a string
        for (let key in tree) {
            let value = tree[key];
            if (typeof value === 'object') {
                tree[key] = symbolKindToString(value as any) as any;
            } else {
                tree[key] = SymbolKindMap.get(value as any);
            }
        }
        return tree;
    }

    function createSymbolTree(documentSymbols: DocumentSymbol[]) {
        let tree = {} as SymbolTree;
        for (let symbol of documentSymbols) {
            tree[symbol.name] = symbol.kind;
            if (symbol.children?.length > 0) {
                tree[symbol.name] = {
                    kind: symbol.kind,
                    children: createSymbolTree(symbol.children)
                };
            }
        }
        return tree;
    }
});

interface SymbolTree {
    [key: string]: SymbolKind | string | { kind: SymbolKind | string; children: SymbolTree };
}
