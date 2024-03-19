import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { createSandbox } from 'sinon';
import { rootDir } from '../../testHelpers.spec';
import type { DocumentSymbol } from 'vscode-languageserver-types';
import { SymbolKind } from 'vscode-languageserver-types';
import { BrsFile } from '../../files/BrsFile';
let sinon = createSandbox();

describe.only('DocumentSymbolProcessor', () => {
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
            delete node[nameTokenPath[nameTokenPath.length - 1]];

            expectSymbols(
                program.getDocumentSymbols('source/main.brs'),
                expected
            );
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
        `, ['body', '0', 'name'], {
            alpha: SymbolKind.Class
        });

        //class method name is missing
        testMissingToken(`
            class alpha
                sub test()
                end sub
            end class
        `, ['body', '0', 'name'], {
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
        `, ['tokens', 'name']);
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
