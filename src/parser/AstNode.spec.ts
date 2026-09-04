import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { DottedGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { Parser } from './Parser';
import type { AstNode } from './AstNode';
import { WalkMode } from '../astUtils/visitors';
import { isStatement } from '../astUtils/reflection';

describe('Program', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            stagingDir: stagingDir
        });
        program.createSourceScope(); //ensure source scope is created
    });
    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program.dispose();
    });

    describe('AstNode', () => {
        describe('findNodeAtPosition', () => {
            it('finds deepest AstNode that matches the position', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    sub main()
                        alpha = invalid
                        print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const delta = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 52));
                expect(delta.name.text).to.eql('delta');

                const foxtrot = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 71));
                expect(foxtrot.name.text).to.eql('foxtrot');
            });
        });

        describe('chains', () => {
            /**
             * Parse `code` and return every node in the AST, in walk order, already linked to its parent
             */
            function parseNodes(code: string) {
                const { ast } = Parser.parse(code);
                const nodes: AstNode[] = [];
                ast.walk((node) => {
                    nodes.push(node);
                }, { walkMode: WalkMode.visitAllRecursive });
                return nodes;
            }

            /**
             * Render a node as the exact source text it spans. This gives the tests a readable,
             * unambiguous label for each node without depending on transpile behavior.
             */
            function getText(code: string, node: AstNode) {
                const lines = code.split(/\r?\n/);
                const { start, end } = node.range;
                if (start.line === end.line) {
                    return lines[start.line].slice(start.character, end.character);
                }
                return [
                    lines[start.line].slice(start.character),
                    ...lines.slice(start.line + 1, end.line),
                    lines[end.line].slice(0, end.character)
                ].join('\n').replace(/\s+/g, ' ');
            }

            /**
             * Find the single node whose source text is `text`
             */
            function findNode(code: string, text: string) {
                const node = parseNodes(code).find(x => getText(code, x) === text);
                if (!node) {
                    throw new Error(`Could not find node with text '${text}'`);
                }
                return node;
            }

            /**
             * Assert the full set of expression chains in `code`.
             *
             * Each expected entry is the source text of one terminal expression, followed by the
             * source text of every node in its chain ordered from chain start to chain end.
             * Statements are excluded so these tests stay focused on expression boundaries.
             */
            function expectChains(code: string, expected: Array<[string, string[]]>) {
                const actual = parseNodes(code)
                    //only expressions (skip the root Body) that are the outermost node of their chain
                    .filter(node => node.parent && node.isTerminal() && !isStatement(node))
                    .map(node => [
                        getText(code, node),
                        node.getChain().map(link => getText(code, link))
                    ]);
                expect(actual).to.eql(expected);
            }

            /**
             * Assert `[text, isChainStart, isTerminal]` for every node in `code`
             */
            function expectChainInfo(code: string, expected: Array<[string, boolean, boolean]>) {
                const actual = parseNodes(code)
                    .filter(node => node.parent)
                    .map(node => [getText(code, node), node.isChainStart(), node.isTerminal()]);
                expect(actual).to.eql(expected);
            }

            it('treats a lone variable as a complete chain', () => {
                expectChains('print alpha', [
                    ['alpha', ['alpha']]
                ]);
            });

            it('walks a simple dotted get chain', () => {
                expectChains('print alpha.beta.charlie', [
                    ['alpha.beta.charlie', ['alpha', 'alpha.beta', 'alpha.beta.charlie']]
                ]);
            });

            it('stops at the boundary when a chain is used as a call argument', () => {
                expectChains('print doSomething(alpha.beta.charlie)', [
                    ['doSomething(alpha.beta.charlie)', ['doSomething', 'doSomething(alpha.beta.charlie)']],
                    ['alpha.beta.charlie', ['alpha', 'alpha.beta', 'alpha.beta.charlie']]
                ]);
            });

            it('finds chains in nested function calls', () => {
                expectChains('print alpha(beta.charlie(1 + 2))', [
                    ['alpha(beta.charlie(1 + 2))', ['alpha', 'alpha(beta.charlie(1 + 2))']],
                    ['beta.charlie(1 + 2)', ['beta', 'beta.charlie', 'beta.charlie(1 + 2)']],
                    ['1 + 2', ['1 + 2']],
                    ['1', ['1']],
                    ['2', ['2']]
                ]);
            });

            it('treats a call of a call as one chain', () => {
                expectChains('print alpha()()', [
                    ['alpha()()', ['alpha', 'alpha()', 'alpha()()']]
                ]);
            });

            it('includes indexed gets in the chain but not their index', () => {
                expectChains('print alpha.beta[charlie.delta]', [
                    ['alpha.beta[charlie.delta]', ['alpha', 'alpha.beta', 'alpha.beta[charlie.delta]']],
                    ['charlie.delta', ['charlie', 'charlie.delta']]
                ]);
            });

            it('includes xml attribute gets in the chain', () => {
                expectChains('print alpha.beta@charlie', [
                    ['alpha.beta@charlie', ['alpha', 'alpha.beta', 'alpha.beta@charlie']]
                ]);
            });

            it('includes callfunc in the chain but not its args', () => {
                expectChains('print alpha.beta@.charlie(delta.echo)', [
                    ['alpha.beta@.charlie(delta.echo)', ['alpha', 'alpha.beta', 'alpha.beta@.charlie(delta.echo)']],
                    ['delta.echo', ['delta', 'delta.echo']]
                ]);
            });

            it('handles a long mixed chain', () => {
                expectChains('print alpha.beta[1].charlie(2).delta@echo', [
                    [
                        'alpha.beta[1].charlie(2).delta@echo',
                        [
                            'alpha',
                            'alpha.beta',
                            'alpha.beta[1]',
                            'alpha.beta[1].charlie',
                            'alpha.beta[1].charlie(2)',
                            'alpha.beta[1].charlie(2).delta',
                            'alpha.beta[1].charlie(2).delta@echo'
                        ]
                    ],
                    ['1', ['1']],
                    ['2', ['2']]
                ]);
            });

            it('treats a grouping as a boundary in both directions', () => {
                expectChains('print (alpha.beta).charlie', [
                    ['(alpha.beta).charlie', ['(alpha.beta)', '(alpha.beta).charlie']],
                    ['alpha.beta', ['alpha', 'alpha.beta']]
                ]);
            });

            it('treats each operand of a binary expression as its own chain', () => {
                expectChains('print alpha.beta > charlie.delta', [
                    ['alpha.beta > charlie.delta', ['alpha.beta > charlie.delta']],
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['charlie.delta', ['charlie', 'charlie.delta']]
                ]);
            });

            it('treats the operand of a unary expression as its own chain', () => {
                expectChains('print not alpha.beta', [
                    ['not alpha.beta', ['not alpha.beta']],
                    ['alpha.beta', ['alpha', 'alpha.beta']]
                ]);
            });

            it('treats array literal elements as their own chains', () => {
                expectChains('print [alpha.beta, charlie.delta]', [
                    ['[alpha.beta, charlie.delta]', ['[alpha.beta, charlie.delta]']],
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['charlie.delta', ['charlie', 'charlie.delta']]
                ]);
            });

            it('treats aa literal member values as their own chains', () => {
                expectChains('print {alpha: beta.charlie}', [
                    ['{alpha: beta.charlie}', ['{alpha: beta.charlie}']],
                    ['alpha: beta.charlie', ['alpha: beta.charlie']],
                    ['beta.charlie', ['beta', 'beta.charlie']]
                ]);
            });

            it('treats each part of a ternary as its own chain', () => {
                expectChains('print alpha.beta ? charlie.delta : echo.foxtrot', [
                    [
                        'alpha.beta ? charlie.delta : echo.foxtrot',
                        ['alpha.beta ? charlie.delta : echo.foxtrot']
                    ],
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['charlie.delta', ['charlie', 'charlie.delta']],
                    ['echo.foxtrot', ['echo', 'echo.foxtrot']]
                ]);
            });

            it('treats each part of a null coalescing expression as its own chain', () => {
                expectChains('print alpha.beta ?? charlie.delta', [
                    ['alpha.beta ?? charlie.delta', ['alpha.beta ?? charlie.delta']],
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['charlie.delta', ['charlie', 'charlie.delta']]
                ]);
            });

            it('treats template string interpolations as their own chains', () => {
                //the odd-looking quasi text below is due to pre-existing quirks in template
                //string node ranges; what matters here is that `alpha.beta` is its own chain
                /* eslint-disable no-template-curly-in-string */
                expectChains('print `hello ${alpha.beta} world`', [
                    ['`hello ${alpha.beta} world', ['`hello ${alpha.beta} world']],
                    ['hello ', ['hello ']],
                    ['hello ', ['hello ']],
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['} worl', ['} worl']],
                    ['} worl', ['} worl']]
                ]);
                /* eslint-enable no-template-curly-in-string */
            });

            it('includes the wrapped call in a new expression chain', () => {
                expectChains('print new Alpha.Beta(charlie.delta)', [
                    [
                        'new Alpha.Beta(charlie.delta)',
                        [
                            'Alpha',
                            'Alpha.Beta',
                            'Alpha.Beta',
                            'Alpha.Beta(charlie.delta)',
                            'new Alpha.Beta(charlie.delta)'
                        ]
                    ],
                    ['charlie.delta', ['charlie', 'charlie.delta']]
                ]);
            });

            it('treats the parts of a dotted set statement as separate chains', () => {
                expectChains('alpha.beta.charlie = delta.echo', [
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['delta.echo', ['delta', 'delta.echo']]
                ]);
            });

            it('treats the parts of an indexed set statement as separate chains', () => {
                expectChains('alpha.beta[charlie.delta] = echo.foxtrot', [
                    ['alpha.beta', ['alpha', 'alpha.beta']],
                    ['charlie.delta', ['charlie', 'charlie.delta']],
                    ['echo.foxtrot', ['echo', 'echo.foxtrot']]
                ]);
            });

            it('finds chains in statement expressions', () => {
                expectChains([
                    'for each item in alpha.beta.charlie',
                    'end for'
                ].join('\n'), [
                    ['alpha.beta.charlie', ['alpha', 'alpha.beta', 'alpha.beta.charlie']]
                ]);
            });

            it('reports chain start and terminal flags for every node', () => {
                expectChainInfo('print alpha.beta(charlie)', [
                    //a statement is always terminal, and starts no chain
                    ['print alpha.beta(charlie)', true, true],
                    //the whole call is the end of the chain
                    ['alpha.beta(charlie)', false, true],
                    //the callee is a link in the middle
                    ['alpha.beta', false, false],
                    //the base value is the start of the chain
                    ['alpha', true, false],
                    //an argument is its own single-node chain
                    ['charlie', true, true]
                ]);
            });

            describe('getChainEnd', () => {
                it('returns the outermost node of the chain', () => {
                    const code = 'print alpha.beta.charlie(1)';
                    expect(
                        getText(code, findNode(code, 'alpha').getChainEnd())
                    ).to.eql('alpha.beta.charlie(1)');
                });

                it('returns itself when already terminal', () => {
                    const code = 'print alpha.beta';
                    const node = findNode(code, 'alpha.beta');
                    expect(node.getChainEnd()).to.equal(node);
                });

                it('does not escape into the enclosing expression', () => {
                    const code = 'print doSomething(alpha.beta)';
                    //must stop at `alpha.beta` rather than continuing up to the CallExpression
                    expect(
                        getText(code, findNode(code, 'alpha').getChainEnd())
                    ).to.eql('alpha.beta');
                });
            });

            describe('getChainStart', () => {
                it('returns the base value of the chain', () => {
                    const code = 'print alpha.beta.charlie(1)';
                    expect(
                        getText(code, findNode(code, 'alpha.beta.charlie(1)').getChainStart())
                    ).to.eql('alpha');
                });

                it('returns itself when already the chain start', () => {
                    const code = 'print alpha';
                    const node = findNode(code, 'alpha');
                    expect(node.getChainStart()).to.equal(node);
                });

                it('does not descend into a call argument', () => {
                    const code = 'print doSomething(alpha.beta)';
                    expect(
                        getText(code, findNode(code, 'doSomething(alpha.beta)').getChainStart())
                    ).to.eql('doSomething');
                });
            });

            describe('chainParent', () => {
                it('is undefined for the terminal node of a chain', () => {
                    const code = 'print alpha.beta';
                    expect(findNode(code, 'alpha.beta').chainParent).to.be.undefined;
                });

                it('is undefined when the parent does not continue the chain', () => {
                    const code = 'print doSomething(alpha)';
                    //`alpha` is an argument, so it has a parent but no chain parent
                    const alpha = parseNodes(code).filter(x => getText(code, x) === 'alpha')[0];
                    expect(alpha.parent).to.exist;
                    expect(alpha.chainParent).to.be.undefined;
                });

                it('is the parent when the parent continues the chain', () => {
                    const code = 'print alpha.beta';
                    const nodes = parseNodes(code);
                    const alpha = nodes.find(x => getText(code, x) === 'alpha');
                    const beta = nodes.find(x => getText(code, x) === 'alpha.beta');
                    expect(alpha.chainParent).to.equal(beta);
                });
            });

            it('gives every node in a chain the same chain', () => {
                const code = 'print alpha.beta[1].charlie(2)';
                const chainTexts = [
                    'alpha',
                    'alpha.beta',
                    'alpha.beta[1]',
                    'alpha.beta[1].charlie',
                    'alpha.beta[1].charlie(2)'
                ];
                for (const text of chainTexts) {
                    expect(
                        findNode(code, text).getChain().map(link => getText(code, link)),
                        `chain from '${text}'`
                    ).to.eql(chainTexts);
                }
            });
        });
    });
});
