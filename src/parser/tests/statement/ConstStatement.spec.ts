import { expectCompletionsIncludes, expectDiagnostics, expectZeroDiagnostics, getTestGetTypedef, getTestTranspile } from '../../../testHelpers.spec';
import { util, standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { createSandbox } from 'sinon';
import { ParseMode, Parser } from '../../Parser';
import { expect } from '../../../chai-config.spec';
import type { ConstStatement } from '../../Statement';
import { TokenKind } from '../../../lexer/TokenKind';
import { LiteralExpression } from '../../Expression';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { rootDir } from '../../../testHelpers.spec';
import { CompletionItemKind } from 'vscode-languageserver';

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
                print const.name = "John"
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('supports basic structure', () => {
        parser.parse('const API_KEY = "abc"', { mode: ParseMode.BrighterScript, srcPath: s`${rootDir}/source/main.bs` });
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ConstStatement;
        expect(statement.tokens.const?.kind).to.eql(TokenKind.Const);
        expect(statement.tokens.name).to.include({
            kind: TokenKind.Identifier,
            text: 'API_KEY'
        });
        const value = statement.value as LiteralExpression;
        expect(value).to.be.instanceof(LiteralExpression);
        expect(value.tokens.value?.text).to.eql('"abc"');
        //ensure range is correct
        expect(statement.location?.range).to.eql(util.createRange(0, 0, 0, 21));
    });

    it('produces typedef', async () => {
        await testGetTypedef(`
            const API_KEY = "abc"
            const SOME_OBJ = {}
            const SOME_ARR = []
        `);
    });

    it('allows const with the name `optional`', () => {
        program.setFile('source/main.bs', `
            const optional = true
            sub main()
                print optional
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('allows const with the name `optional` in a namespace', () => {
        program.setFile('source/main.bs', `
            namespace alpha
                const optional = true
            end namespace
            sub main()
                print alpha.optional
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    describe('transpile', () => {

        it('transpiles simple consts', async () => {
            await testTranspile(`
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

        it('transpiles arrays', async () => {
            await testTranspile(`
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

        it('transpiles objects', async () => {
            await testTranspile(`
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

        it('supports consts inside namespaces', async () => {
            await testTranspile(`
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

        it('supports property access on complex objects', async () => {
            await testTranspile(`
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

        it('supports calling methods on consts', async () => {
            await testTranspile(`
                const API_KEY ="ABC"
                sub main()
                    print API_KEY.toStr()
                end sub
            `, `
                sub main()
                    print "ABC".toStr()
                end sub
            `);
        });

        it('transpiles within += operator', async () => {
            await testTranspile(`
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

        it('transpiles nested consts that reference other consts within same namespace', async () => {
            await testTranspile(`
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

        it('transpiles nested consts that reference other consts in different namespaces', async () => {
            await testTranspile(`
                namespace alpha.beta
                    const FLAG_A = "A"
                end namespace
                namespace charlie
                    const FLAG_B = "B"
                    const AD_BREAK_START = { a: alpha.beta.FLAG_A, b: FLAG_B }
                end namespace
                sub main()
                    print charlie.AD_BREAK_START
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

        it('transpiles nested consts that reference other consts across files', async () => {
            program.setFile('source/constants.bs', `
                namespace theming
                    const PRIMARY_COLOR = "blue"
                end namespace
                const FLAG_B = "B"
            `);
            await testTranspile(`
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

        it('recursively resolves nested consts that reference other consts', async () => {
            await testTranspile(`
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

        it('handles the exact example from the issue - nested consts with namespace references', async () => {
            await testTranspile(`
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

        it('handles cyclical const references without infinite loop', async () => {
            //the cycle is also reported via a diagnostic; this test only verifies
            //the transpile output doesn't recurse forever.
            await testTranspile(`
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

        it('resolves consts inside array literals', async () => {
            await testTranspile(`
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

        it('resolves enum used in const - same file', async () => {
            await testTranspile(`
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

        it('resolves enum used in const - cross file', async () => {
            program.setFile('source/theming.bs', `
                namespace Theming
                    enum Color
                        BLACK = "#000000"
                        BLUE = "#0000FF"
                    end enum
                end namespace
            `);
            await testTranspile(`
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

        it('resolves const -> enum -> const -> enum chain across files', async () => {
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
            await testTranspile(`
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

        it('resolves enum refs inside an aa-literal const used cross-file (issue #1618)', async () => {
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
            await testTranspile(`
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

        it('resolves enum refs in computed keys of an aa-literal const used cross-file', async () => {
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
            await testTranspile(`
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

        it('inlines a const aa-literal at multiple consumer call sites in the same file', async () => {
            program.setFile('source/consts.bs', `
                namespace ns
                    enum E
                        X = "X"
                    end enum
                    const M = { "x": ns.E.X }
                end namespace
            `);
            await testTranspile(`
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

        it('handles diamond const reference graph (one base const reached via two paths)', async () => {
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
            await testTranspile(`
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

        it('does not infinite-loop on circular const-of-aa references', async function () {
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
            await testTranspile(`
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

        it('flags scalar circular const reference', () => {
            program.setFile('source/main.bs', `
                const A = B
                const B = A
            `);
            program.validate();
            //matches the class-hierarchy convention: one diagnostic per const in the cycle,
            //each rotated so the diagnostic's const is at the head of the chain
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['A', 'B', 'A']).message,
                DiagnosticMessages.circularReferenceDetected(['B', 'A', 'B']).message
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
                DiagnosticMessages.circularReferenceDetected(['ns.A', 'ns.B', 'ns.A']).message,
                DiagnosticMessages.circularReferenceDetected(['ns.B', 'ns.A', 'ns.B']).message
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
                DiagnosticMessages.circularReferenceDetected(['ns.A', 'ns.B', 'ns.C', 'ns.A']).message,
                DiagnosticMessages.circularReferenceDetected(['ns.B', 'ns.C', 'ns.A', 'ns.B']).message,
                DiagnosticMessages.circularReferenceDetected(['ns.C', 'ns.A', 'ns.B', 'ns.C']).message
            ]);
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

        it('resolves complex multi-file const-enum chain', async () => {
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
            await testTranspile(`
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
            program.validate();
            // log(|)
            expectCompletionsIncludes(
                program.getCompletions('source/main.bs', util.createPosition(3, 34)),
                [{
                    label: 'API_KEY',
                    kind: CompletionItemKind.Constant
                }]
            );
        });

        it('transpiles simple const in a unary expression', async () => {
            await testTranspile(`
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

        it('transpiles complex const in a unary expression', async () => {
            await testTranspile(`
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
            program.validate();
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
