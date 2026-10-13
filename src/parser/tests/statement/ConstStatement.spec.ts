import { expectCompletionsIncludes, expectDiagnostics, expectZeroDiagnostics, getTestGetTypedef, getTestTranspile } from '../../../testHelpers.spec';
import { util } from '../../../util';
import { Program } from '../../../Program';
import { createSandbox } from 'sinon';
import { ParseMode, Parser } from '../../Parser';
import { expect } from '../../../chai-config.spec';
import type { ConstStatement } from '../../Statement';
import { TokenKind } from '../../../lexer/TokenKind';
import { LiteralExpression } from '../../Expression';
import { CompletionItemKind } from 'vscode-languageserver-protocol';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { rootDir } from '../../../testHelpers.spec';

const sinon = createSandbox();

describe('ConstStatement', () => {
    let program: Program;
    let parser: Parser;
    let testTranspile = getTestTranspile(() => [program, rootDir]);
    let testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
        parser = new Parser();
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('does not prevent using `const` as a variable name in .brs files', () => {
        program.setFile('source/main.brs', `
            sub main()
                const = {
                    name: "Bob"
                }
                print const.name = {}
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('supports basic structure', () => {
        parser.parse('const API_KEY = "abc"', { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ConstStatement;
        expect(statement.tokens.const?.kind).to.eql(TokenKind.Const);
        expect(statement.tokens.name).to.include({
            kind: TokenKind.Identifier,
            text: 'API_KEY'
        });
        const value = statement.value as LiteralExpression;
        expect(value).to.be.instanceof(LiteralExpression);
        expect(value.token?.text).to.eql('"abc"');
        //ensure range is correct
        expect(statement.range).to.eql(util.createRange(0, 0, 0, 21));
    });

    it('produces typedef', () => {
        testGetTypedef(`
            const API_KEY = "abc"
            const SOME_OBJ = {}
            const SOME_ARR = []
        `);
    });

    it('allows const with the name `optional`', () => {
        program.setFile('source/main.bs', `
            const optional = true
            namespace alpha
                const optional = true
            end namespace
            sub main()
                print optional
                print alpha.optional
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    describe('transpile', () => {

        it('transpiles simple consts', () => {
            testTranspile(`
                const API_KEY = "abc"
                sub main()
                    print API_KEY
                end sub
            `, `
                sub main()
                    print "abc"
                end sub
            `);
        });

        it('transpiles arrays', () => {
            testTranspile(`
                const WORDS = [
                    "alpha"
                    "beta"
                ]
                sub main()
                    print WORDS
                end sub
            `, `
                sub main()
                    print ([
                        "alpha"
                        "beta"
                    ])
                end sub
            `);
        });

        it('transpiles objects', () => {
            testTranspile(`
                const DEFAULTS = {
                    alpha: true
                    beta: true
                }
                sub main()
                    print DEFAULTS
                end sub
            `, `
                sub main()
                    print ({
                        alpha: true
                        beta: true
                    })
                end sub
            `);
        });

        it('supports consts inside namespaces', () => {
            testTranspile(`
                namespace network
                    const API_KEY = "abc"
                    sub get()
                        print API_KEY
                    end sub
                end namespace
                sub main()
                    print network.API_KEY
                end sub
            `, `
                sub network_get()
                    print "abc"
                end sub

                sub main()
                    print "abc"
                end sub
            `);
        });

        it('supports property access on complex objects', () => {
            testTranspile(`
                const DEFAULTS = {
                    enabled: true
                }
                sub main()
                    print DEFAULTS.enabled
                end sub
            `, `
                sub main()
                    print ({
                        enabled: true
                    }).enabled
                end sub
            `);
        });

        it('supports calling methods on consts', () => {
            testTranspile(`
                const API_KEY ="ABC"
                sub main()
                    print API_KEY.toString()
                end sub
            `, `
                sub main()
                    print "ABC".toString()
                end sub
            `);
        });

        it('transpiles within += operator', () => {
            testTranspile(`
                namespace constants
                    const API_KEY = "test"
                end namespace
                const API_URL = "url"
                sub main()
                    value = ""
                    value += constants.API_KEY
                    value += API_URL
                end sub
            `, `
                sub main()
                    value = ""
                    value += "test"
                    value += "url"
                end sub
            `);
        });

        it('transpiles nested consts that reference other consts within same namespace', () => {
            testTranspile(`
                namespace theming
                    const FLAG_A = "A"
                    const FLAG_B = "B"
                    const AD_BREAK_START = { a: FLAG_A, b: FLAG_B }
                end namespace
                sub main()
                    print theming.AD_BREAK_START
                end sub
            `, `
                sub main()
                    print ({
                        a: "A"
                        b: "B"
                    })
                end sub
            `);
        });

        it('transpiles nested consts that reference other consts in different namespaces', () => {
            testTranspile(`
                namespace aa.bb
                    const FLAG_A = "A"
                end namespace
                namespace main
                    const FLAG_B = "B"
                    const AD_BREAK_START = { a: aa.bb.FLAG_A, b: FLAG_B }
                end namespace
                sub main()
                    print main.AD_BREAK_START
                end sub
            `, `
                sub main()
                    print ({
                        a: "A"
                        b: "B"
                    })
                end sub
            `);
        });

        it('transpiles nested consts that reference other consts across files', () => {
            program.setFile('source/constants.bs', `
                namespace theming
                    const PRIMARY_COLOR = "blue"
                end namespace
                const FLAG_B = "B"
            `);
            testTranspile(`
                const SECONDARY_COLOR = theming.PRIMARY_COLOR
                const AD_BREAK_START = { a: SECONDARY_COLOR, b: FLAG_B }
                sub main()
                    print AD_BREAK_START
                end sub
            `, `
                sub main()
                    print ({
                        a: "blue"
                        b: "B"
                    })
                end sub
            `);
        });

        it('recursively resolves nested consts that reference other consts', () => {
            testTranspile(`
                const FLAG_A = "A"
                const FLAG_B = FLAG_A
                const AD_BREAK_START = { a: FLAG_A, b: FLAG_B }
                sub main()
                    print AD_BREAK_START
                end sub
            `, `
                sub main()
                    print ({
                        a: "A"
                        b: "A"
                    })
                end sub
            `);
        });

        it('handles the exact example from the issue - nested consts with namespace references', () => {
            testTranspile(`
                namespace aa.bb
                    const FLAG_A = "test"
                end namespace
                const FLAG_B = "another"
                const AD_BREAK_START = { a: aa.bb.FLAG_A, b: FLAG_B }
                sub main()
                    print AD_BREAK_START
                end sub
            `, `
                sub main()
                    print ({
                        a: "test"
                        b: "another"
                    })
                end sub
            `);
        });

        it('handles cyclical const references without infinite loop', () => {
            //the cycle is also reported via a diagnostic; this test only verifies
            //the transpile output doesn't recurse forever.
            testTranspile(`
                const A = B
                const B = C
                const C = A
                sub main()
                    print A
                end sub
            `, `
                sub main()
                    print A
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('resolves consts inside array literals', () => {
            testTranspile(`
                const FLAG_A = "A"
                const FLAG_B = "B"
                const MY_ARRAY = [FLAG_A, FLAG_B, "C"]
                sub main()
                    print MY_ARRAY
                end sub
            `, `
                sub main()
                    print ([
                        "A"
                        "B"
                        "C"
                    ])
                end sub
            `);
        });

        it('resolves enum used in const - same file', () => {
            testTranspile(`
                namespace Theming
                    enum Color
                        RED = "#FF0000"
                        BLUE = "#0000FF"
                    end enum
                    const PRIMARY_COLOR = Theming.Color.BLUE
                end namespace
                sub main()
                    a = Theming.PRIMARY_COLOR
                end sub
            `, `
                sub main()
                    a = "#0000FF"
                end sub
            `);
        });

        it('resolves enum used in const - cross file', () => {
            program.setFile('source/theming.bs', `
                namespace Theming
                    enum Color
                        BLACK = "#000000"
                        BLUE = "#0000FF"
                    end enum
                end namespace
            `);
            testTranspile(`
                namespace Theming
                    const PRIMARY_COLOR = Theming.Color.BLUE
                end namespace
                sub main()
                    a = Theming.PRIMARY_COLOR
                end sub
            `, `
                sub main()
                    a = "#0000FF"
                end sub
            `);
        });

        it('resolves const -> enum -> const -> enum chain across files', () => {
            program.setFile('source/theming1.bs', `
                namespace Theming
                    const BACKGROUND_COLOR = Theming.Color.BLACK
                end namespace
            `);
            program.setFile('source/theming2.bs', `
                namespace Theming
                    enum Color
                        BLACK = "#000000"
                        WHITE = "#FFFFFF"
                    end enum
                end namespace
            `);
            program.setFile('source/theming3.bs', `
                namespace Theming
                    const OVERLAY_COLOR = Theming.BACKGROUND_COLOR
                end namespace
            `);
            testTranspile(`
                sub test()
                    aa = {
                        backgroundOverlay: {
                            color: Theming.OVERLAY_COLOR
                        }
                    }
                end sub
            `, `
                sub test()
                    aa = {
                        backgroundOverlay: {
                            color: "#000000"
                        }
                    }
                end sub
            `);
        });

        it('resolves enum refs inside an aa-literal const used cross-file (issue #1618)', () => {
            program.setFile('source/map.bs', `
                namespace name.space
                    enum someEnum
                        one = "val1"
                        two = "val2"
                        three = "val3"
                    end enum

                    const myMap = {
                        "key1": someEnum.one
                        "key2": someEnum.two
                        "key3": someEnum.three
                    }
                end namespace
            `);
            testTranspile(`
                namespace name.space
                    class someClass
                        public function someFunc(key as dynamic) as object
                            return name.space.myMap[key]
                        end function
                    end class
                end namespace
            `, `
                sub __name_space_someClass_method_new()
                end sub
                function __name_space_someClass_method_someFunc(key as dynamic) as object
                    return ({
                        "key1": "val1"
                        "key2": "val2"
                        "key3": "val3"
                    })[key]
                end function
                function __name_space_someClass_builder()
                    instance = {}
                    instance.new = __name_space_someClass_method_new
                    instance.someFunc = __name_space_someClass_method_someFunc
                    return instance
                end function
                function name_space_someClass()
                    instance = __name_space_someClass_builder()
                    instance.new()
                    return instance
                end function
            `);
        });

        it('resolves enum refs in computed keys of an aa-literal const used cross-file', () => {
            program.setFile('source/map.bs', `
                namespace name.space
                    enum someEnum
                        one = "key1"
                        two = "key2"
                    end enum

                    const myMap = {
                        [someEnum.one]: "val1"
                        [someEnum.two]: "val2"
                    }
                end namespace
            `);
            testTranspile(`
                namespace name.space
                    sub useMap(key as dynamic) as object
                        return name.space.myMap[key]
                    end sub
                end namespace
            `, `
                sub name_space_useMap(key as dynamic) as object
                    return ({
                        "key1": "val1"
                        "key2": "val2"
                    })[key]
                end sub
            `);
        });

        it('inlines a const aa-literal at multiple consumer call sites in the same file', () => {
            program.setFile('source/consts.bs', `
                namespace ns
                    enum E
                        X = "X"
                    end enum
                    const M = { "x": ns.E.X }
                end namespace
            `);
            testTranspile(`
                sub main()
                    a = ns.M
                    b = ns.M
                end sub
            `, `
                sub main()
                    a = ({
                        "x": "X"
                    })
                    b = ({
                        "x": "X"
                    })
                end sub
            `);
        });

        it('handles diamond const reference graph (one base const reached via two paths)', () => {
            program.setFile('source/consts.bs', `
                namespace ns
                    enum E
                        X = "X"
                    end enum
                    const C = { "c": ns.E.X }
                    const A = { "a": ns.C }
                    const B = { "b": ns.C }
                end namespace
            `);
            testTranspile(`
                sub main()
                    print ns.A
                    print ns.B
                end sub
            `, `
                sub main()
                    print ({
                        "a": ({
                            "c": "X"
                        })
                    })
                    print ({
                        "b": ({
                            "c": "X"
                        })
                    })
                end sub
            `);
        });

        it('does not infinite-loop on circular const-of-aa references', function() {
            this.timeout(2000);
            program.setFile('source/consts.bs', `
                namespace ns
                    const A = { "x": ns.B }
                    const B = { "y": ns.A }
                end namespace
            `);
            //the inner-most cyclic ref is left as the original namespace path so
            //transpile completes without recursing forever. The runtime semantics
            //of the cyclic ref are inherently broken, but the compile must not hang.
            //(A diagnostic is also emitted; see the dedicated cycle-diagnostic tests.)
            testTranspile(`
                sub main()
                    print ns.A
                end sub
            `, `
                sub main()
                    print ({
                        "x": ({
                            "y": ns_A
                        })
                    })
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('does not infinite-loop on scalar three-cycle const references', function() {
            this.timeout(2000);
            program.setFile('source/consts.bs', `
                const a = b
                const b = c
                const c = a
            `);
            testTranspile(`
                sub main()
                    print a
                end sub
            `, `
                sub main()
                    print a
                end sub
            `, 'trim', 'source/main.bs', false);
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['a', 'b', 'c', 'a'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['b', 'c', 'a', 'b'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['c', 'a', 'b', 'c'], 'source').message
            ]);
        });

        it('does not infinite-loop on namespaced three-cycle using relative names', function() {
            this.timeout(2000);
            program.setFile('source/consts.bs', `
                namespace ns
                    const a = b
                    const b = c
                    const c = a
                end namespace
            `);
            testTranspile(`
                namespace ns
                    sub doWork()
                        print a
                    end sub
                end namespace
            `, `
                sub ns_doWork()
                    print a
                end sub
            `, 'trim', 'source/main.bs', false);
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['ns.a', 'ns.b', 'ns.c', 'ns.a'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['ns.b', 'ns.c', 'ns.a', 'ns.b'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['ns.c', 'ns.a', 'ns.b', 'ns.c'], 'source').message
            ]);
        });

        it('does not infinite-loop on a relative-name cycle back to a const (self-exclusion only skips the referencing const)', function() {
            this.timeout(2000);
            program.setFile('source/consts.bs', `
                function chain()
                end function
                namespace ns
                    const chain = other
                    const other = chain
                end namespace
            `);
            testTranspile(`
                sub main()
                    print ns.chain
                end sub
            `, `
                sub main()
                    print ns_chain
                end sub
            `, 'trim', 'source/main.bs', false);
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['ns.chain', 'ns.other', 'ns.chain'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['ns.other', 'ns.chain', 'ns.other'], 'source').message
            ]);
        });

        it('flags scalar circular const reference', () => {
            program.setFile('source/main.bs', `
                const A = B
                const B = A
            `);
            program.validate();
            //matches the class-hierarchy convention: one diagnostic per const in the cycle,
            //each rotated so the diagnostic's const is at the head of the chain
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['A', 'B', 'A'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['B', 'A', 'B'], 'source').message
            ]);
        });

        it('flags aggregate circular const reference', () => {
            program.setFile('source/main.bs', `
                namespace ns
                    const A = { "x": ns.B }
                    const B = { "y": ns.A }
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['ns.A', 'ns.B', 'ns.A'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['ns.B', 'ns.A', 'ns.B'], 'source').message
            ]);
        });

        it('flags three-cycle const reference once per node', () => {
            program.setFile('source/main.bs', `
                namespace ns
                    const A = { "x": ns.B }
                    const B = { "y": ns.C }
                    const C = { "z": ns.A }
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['ns.A', 'ns.B', 'ns.C', 'ns.A'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['ns.B', 'ns.C', 'ns.A', 'ns.B'], 'source').message,
                DiagnosticMessages.circularReferenceDetected(['ns.C', 'ns.A', 'ns.B', 'ns.C'], 'source').message
            ]);
        });

        describe('const values resolve relative to the const namespace', () => {
            it('ignores a same-named const in the usage namespace', () => {
                program.setFile('source/consts.bs', `
                    namespace alpha
                        const BASE = "alpha"
                        const KEY = BASE
                    end namespace
                    namespace beta
                        const BASE = "beta"
                    end namespace
                `);
                testTranspile(`
                    namespace beta
                        sub doWork()
                            print alpha.KEY
                        end sub
                    end namespace
                `, `
                    sub beta_doWork()
                        print "alpha"
                    end sub
                `);
            });

            it('resolves a relative enum reference when used outside the namespace', () => {
                program.setFile('source/consts.bs', `
                    namespace alpha
                        enum Direction
                            up = "up"
                        end enum
                        const DEFAULT = Direction.up
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print alpha.DEFAULT
                    end sub
                `, `
                    sub main()
                        print "up"
                    end sub
                `);
            });

            it('resolves a multi-hop relative chain when used from another namespace', () => {
                program.setFile('source/consts.bs', `
                    namespace alpha
                        const A = B
                        const B = C
                        const C = "c"
                    end namespace
                `);
                testTranspile(`
                    namespace beta
                        sub doWork()
                            print alpha.A
                        end sub
                    end namespace
                `, `
                    sub beta_doWork()
                        print "c"
                    end sub
                `);
            });
        });

        describe('const that shares its name with what it references', () => {
            it('does not flag a namespaced const referencing a global function with the same name', () => {
                program.setFile('source/main.bs', `
                    function chain()
                    end function

                    namespace promises
                        const chain = chain
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('inlines the global function when used outside the namespace', () => {
                program.setFile('source/promises.bs', `
                    function chain()
                    end function

                    namespace promises
                        const chain = chain
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.chain
                    end sub
                `, `
                    sub main()
                        print (chain)
                    end sub
                `);
            });

            it('inlines the global function when used inside the namespace', () => {
                program.setFile('source/promises.bs', `
                    function chain()
                    end function

                    namespace promises
                        const chain = chain
                    end namespace
                `);
                testTranspile(`
                    namespace promises
                        sub doWork()
                            print chain
                            print promises.chain
                        end sub
                    end namespace
                `, `
                    sub promises_doWork()
                        print (chain)
                        print (chain)
                    end sub
                `);
            });

            it('inlines the global function from a nested namespace', () => {
                program.setFile('source/promises.bs', `
                    function chain()
                    end function

                    namespace alpha.beta
                        const chain = chain
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print alpha.beta.chain
                    end sub
                    namespace alpha.beta
                        sub doWork()
                            print chain
                        end sub
                    end namespace
                `, `
                    sub main()
                        print (chain)
                    end sub
                    sub alpha_beta_doWork()
                        print (chain)
                    end sub
                `);
            });

            it('inlines the global function when referenced from inside an aa', () => {
                program.setFile('source/promises.bs', `
                    function chain()
                    end function

                    namespace promises
                        const chain = { "fn": chain }
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.chain
                    end sub
                `, `
                    sub main()
                        print ({
                            "fn": chain
                        })
                    end sub
                `);
            });

            it('resolves to a global const with the same name', () => {
                program.setFile('source/consts.bs', `
                    const chain = "global"
                    namespace promises
                        const chain = chain
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.chain
                    end sub
                    namespace promises
                        sub doWork()
                            print chain
                        end sub
                    end namespace
                `, `
                    sub main()
                        print "global"
                    end sub
                    sub promises_doWork()
                        print "global"
                    end sub
                `);
            });

            it('resolves to a function in another namespace with the same name', () => {
                program.setFile('source/promises.bs', `
                    namespace utils
                        function chain()
                        end function
                    end namespace

                    namespace promises
                        const chain = utils.chain
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.chain
                    end sub
                `, `
                    sub main()
                        print (utils_chain)
                    end sub
                `);
            });

            it('only skips the referencing const, so sibling consts still resolve', () => {
                program.setFile('source/consts.bs', `
                    namespace promises
                        const chain = other
                        const other = "other"
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.chain
                    end sub
                `, `
                    sub main()
                        print "other"
                    end sub
                `);
            });

            it('still prefers a namespaced const over a global const of the same name when it is not the referencing const', () => {
                program.setFile('source/consts.bs', `
                    const value = "global"
                    namespace promises
                        const value = "namespaced"
                        const alias = value
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.alias
                    end sub
                `, `
                    sub main()
                        print "namespaced"
                    end sub
                `);
            });

            it('follows a chain through a self-named const in another namespace', () => {
                program.setFile('source/consts.bs', `
                    function chain()
                    end function
                    namespace promises
                        const chain = chain
                    end namespace
                    namespace other
                        const chain = promises.chain
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print other.chain
                    end sub
                `, `
                    sub main()
                        print (chain)
                    end sub
                `);
            });

            it('resolves sibling refs inside an aa alongside the self-named ref', () => {
                program.setFile('source/consts.bs', `
                    function chain()
                    end function
                    namespace promises
                        const chain = { "fn": chain, "other": other }
                        const other = "other"
                    end namespace
                `);
                testTranspile(`
                    sub main()
                        print promises.chain
                    end sub
                `, `
                    sub main()
                        print ({
                            "fn": chain
                            "other": "other"
                        })
                    end sub
                `);
            });

            it('still flags a namespaced const that references itself by its full name', () => {
                program.setFile('source/main.bs', `
                    namespace promises
                        const chain = promises.chain
                    end namespace
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.circularReferenceDetected(['promises.chain', 'promises.chain'], 'source').message
                ]);
            });

            it('still flags a global const that references itself', () => {
                program.setFile('source/main.bs', `
                    const chain = chain
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.circularReferenceDetected(['chain', 'chain'], 'source').message
                ]);
            });

            it('still flags a cycle that passes back through the namespaced const', () => {
                program.setFile('source/main.bs', `
                    namespace promises
                        const chain = { "next": promises.other }
                        const other = { "prev": chain }
                    end namespace
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.circularReferenceDetected(['promises.chain', 'promises.other', 'promises.chain'], 'source').message,
                    DiagnosticMessages.circularReferenceDetected(['promises.other', 'promises.chain', 'promises.other'], 'source').message
                ]);
            });
        });

        it('does not flag diamond const reference graph', () => {
            program.setFile('source/main.bs', `
                namespace ns
                    enum E
                        X = "X"
                    end enum
                    const Base = { "c": ns.E.X }
                    const A = { "a": ns.Base }
                    const B = { "b": ns.Base }
                    const Root = { "left": ns.A, "right": ns.B }
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('resolves complex multi-file const-enum chain', () => {
            program.setFile('source/colors.bs', `
                namespace Theme
                    enum Color
                        PRIMARY = "#0000FF"
                        SECONDARY = "#00FF00"
                    end enum
                end namespace
            `);
            program.setFile('source/constants.bs', `
                namespace Theme
                    const MAIN_COLOR = Theme.Color.PRIMARY
                    const ALT_COLOR = Theme.MAIN_COLOR
                end namespace
            `);
            testTranspile(`
                sub main()
                    colors = {
                        main: Theme.ALT_COLOR
                        secondary: Theme.Color.SECONDARY
                    }
                end sub
            `, `
                sub main()
                    colors = {
                        main: "#0000FF"
                        secondary: "#00FF00"
                    }
                end sub
            `);
        });
    });

    describe('completions', () => {
        it('shows up in standard completions', () => {
            program.setFile('source/main.bs', `
                const API_KEY = "123"
                sub log(message)
                    log()
                end sub
            `);

            expectCompletionsIncludes(
                // log(|)
                program.getCompletions('source/main.bs', util.createPosition(3, 24)),
                [{
                    label: 'API_KEY',
                    kind: CompletionItemKind.Constant
                }]
            );
        });

        it('transpiles simple const in a unary expression', () => {
            testTranspile(`
                const foo = 1
                sub main()
                    bar = -foo
                end sub
            `, `
                sub main()
                    bar = -1
                end sub
            `, undefined, 'source/main.bs');
        });

        it('transpiles complex const in a unary expression', () => {
            testTranspile(`
                namespace some.consts
                    const foo = 1
                end namespace
                sub main()
                    bar = -some.consts.foo
                end sub
            `, `
                sub main()
                    bar = - 1
                end sub
            `, undefined, 'source/main.bs');
        });

        it('shows up in namespace completions', () => {
            program.setFile('source/main.bs', `
                namespace constants
                    const API_KEY = "123"
                end namespace
                sub log(message)
                    log(constants.)
                end sub
            `);

            expectCompletionsIncludes(
                // log(|)
                program.getCompletions('source/main.bs', util.createPosition(5, 34)),
                [{
                    label: 'API_KEY',
                    kind: CompletionItemKind.Constant
                }]
            );
        });
    });
});
