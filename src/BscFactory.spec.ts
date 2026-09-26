import { expect } from './chai-config.spec';
import * as ExpressionModule from './parser/Expression';
import * as StatementModule from './parser/Statement';
import * as SGTypesModule from './parser/SGTypes';
import { BscFactory, bscFactory } from './BscFactory';
import { TokenKind } from './lexer/TokenKind';
import { Program } from './Program';
import { rootDir } from './testHelpers.spec';
import { CallExpression, DottedGetExpression, LiteralExpression, VariableExpression } from './parser/Expression';
import { Block, EmptyStatement, IfStatement, PrintStatement } from './parser/Statement';
import { SGAst, SGComponent, SGInterfaceField, SGProlog, SGScript } from './parser/SGTypes';
import { BrsTranspileState } from './parser/BrsTranspileState';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { AssetFile } from './files/AssetFile';
import type { AstNode } from './parser/AstNode';
import util from './util';

describe('BscFactory', () => {
    let factory: BscFactory;
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        factory = program.factory;
    });

    afterEach(() => {
        program.dispose();
    });

    function getClassNames(module: Record<string, any>) {
        return Object.entries(module)
            .filter(([name, value]) => typeof value === 'function' && /^class\s/.test(Function.prototype.toString.call(value)))
            .map(([name]) => name);
    }

    function transpile(node: AstNode) {
        const file = factory.createBrsFile({ srcPath: 'source/main.brs', destPath: 'source/main.brs' });
        const state = new BrsTranspileState(file);
        return state.sourceNode(node, node.transpile(state)).toString().replace(/\s+/g, ' ').trim();
    }

    it('has a create method for every AST node class', () => {
        const classNames = [
            ...getClassNames(ExpressionModule),
            ...getClassNames(StatementModule),
            ...getClassNames(SGTypesModule)
        ];
        //sanity check to make sure we actually found the classes
        expect(classNames).to.include.members(['CallExpression', 'IfStatement', 'SGComponent']);

        const missing = classNames.filter(name => typeof factory[`create${name}`] !== 'function');
        expect(missing).to.eql([]);
    });

    it('is available on the program, bound to that program', () => {
        expect(program.factory).to.be.instanceOf(BscFactory);
        expect(program.factory.program).to.equal(program);
    });

    it('exports a shared instance with no program', () => {
        expect(bscFactory).to.be.instanceOf(BscFactory);
        expect(bscFactory.program).to.be.undefined;
    });

    describe('tokens', () => {
        it('creates tokens with default text', () => {
            expect(factory.createToken(TokenKind.LeftParen)).to.include({
                kind: TokenKind.LeftParen,
                text: '('
            });
            expect(factory.createToken(TokenKind.EndSub)).to.include({
                kind: TokenKind.EndSub,
                text: 'end sub'
            });
        });

        it('creates tokens with custom text', () => {
            expect(factory.createToken(TokenKind.StringLiteral, '"hello"')).to.include({
                kind: TokenKind.StringLiteral,
                text: '"hello"'
            });
        });

        it('creates identifiers', () => {
            expect(factory.createIdentifier('alpha')).to.include({
                kind: TokenKind.Identifier,
                text: 'alpha'
            });
        });

        it('creates SG tokens', () => {
            const location = util.createLocation(1, 2, 3, 4);
            expect(factory.createSGToken('component', location)).to.eql({
                text: 'component',
                location: location
            });
        });
    });

    describe('files', () => {
        it('creates a BrsFile for the program', () => {
            const file = factory.createBrsFile({ srcPath: `${rootDir}/source/main.bs`, destPath: 'source/main.bs' });
            expect(file).to.be.instanceOf(BrsFile);
            expect(file.program).to.equal(program);
            expect(file.pkgPath).to.eql(util.standardizePath('source/main.brs'));
        });

        it('creates an XmlFile for the program', () => {
            const file = factory.createXmlFile({ srcPath: `${rootDir}/components/Comp.xml`, destPath: 'components/Comp.xml' });
            expect(file).to.be.instanceOf(XmlFile);
            expect(file.program).to.equal(program);
        });

        it('creates files for an explicit program', () => {
            const file = bscFactory.createBrsFile({ srcPath: `${rootDir}/source/main.brs`, destPath: 'source/main.brs', program: program });
            expect(file.program).to.equal(program);
        });

        it('creates an AssetFile', () => {
            const file = factory.createAssetFile({ srcPath: `${rootDir}/images/logo.png`, destPath: 'images/logo.png' });
            expect(file).to.be.instanceOf(AssetFile);
        });
    });

    describe('literals', () => {
        it('creates literals of each type', () => {
            expect(factory.createIntegerLiteral('1').tokens.value.kind).to.eql(TokenKind.IntegerLiteral);
            expect(factory.createFloatLiteral('1.5').tokens.value.kind).to.eql(TokenKind.FloatLiteral);
            expect(factory.createDoubleLiteral('1.5#').tokens.value.kind).to.eql(TokenKind.DoubleLiteral);
            expect(factory.createLongIntegerLiteral('1&').tokens.value.kind).to.eql(TokenKind.LongIntegerLiteral);
            expect(factory.createInvalidLiteral().tokens.value.kind).to.eql(TokenKind.Invalid);
            expect(factory.createBooleanLiteral('true').tokens.value.kind).to.eql(TokenKind.True);
            expect(factory.createBooleanLiteral('false').tokens.value.kind).to.eql(TokenKind.False);
        });

        describe('createStringLiteral', () => {
            it('wraps the value in quotes', () => {
                expect(factory.createStringLiteral('hello world').tokens.value.text).to.equal('"hello world"');
            });

            it('does not wrap already-quoted value in extra quotes', () => {
                expect(factory.createStringLiteral('"hello world"').tokens.value.text).to.equal('"hello world"');
            });

            it('does not wrap badly quoted value in additional quotes', () => {
                //leading
                expect(factory.createStringLiteral('"hello world').tokens.value.text).to.equal('"hello world');
                //trailing
                expect(factory.createStringLiteral('hello world"').tokens.value.text).to.equal('hello world"');
            });
        });

        it('creates dotted identifiers', () => {
            const path = ['alpha', 'beta', 'charlie'];
            const expression = factory.createDottedIdentifier(path);
            expect(expression).to.be.instanceOf(DottedGetExpression);
            expect(util.getAllDottedGetPartsAsString(expression)).to.eql('alpha.beta.charlie');
            //does not mutate the input array
            expect(path).to.eql(['alpha', 'beta', 'charlie']);

            expect(factory.createDottedIdentifier(['alpha'])).to.be.instanceOf(VariableExpression);
        });
    });

    describe('AST nodes', () => {
        it('creates a CallExpression with default parens', () => {
            const callee = factory.createVariableExpression({ name: 'doSomething' });
            const arg = factory.createIntegerLiteral('1');
            const call = factory.createCallExpression({
                callee: callee,
                args: [arg]
            });
            expect(call).to.be.instanceOf(CallExpression);
            expect(call.callee).to.equal(callee);
            expect(call.args).to.eql([arg]);
            expect(call.args[0]).to.be.instanceOf(LiteralExpression);
            expect(transpile(call)).to.eql('doSomething(1)');
        });

        it('creates statements with optional options', () => {
            expect(factory.createEmptyStatement()).to.be.instanceOf(EmptyStatement);
            expect(factory.createReturnStatement().value).to.be.undefined;
            expect(factory.createBody().statements).to.eql([]);
            expect(factory.createBlock().statements).to.eql([]);
        });

        it('creates an empty function by default', () => {
            expect(transpile(factory.createFunctionExpression())).to.eql('function() end function');
        });

        it('uses `end sub` for sub functions', () => {
            const func = factory.createFunctionExpression({ functionType: factory.createToken(TokenKind.Sub) });
            expect(transpile(func)).to.eql('sub() end sub');
        });

        it('creates a MethodStatement with a string name', () => {
            const method = factory.createMethodStatement({ name: 'new' });
            expect(method.tokens.name.text).to.eql('new');
            expect(method.func.tokens.functionType.kind).to.eql(TokenKind.Function);
        });

        it('creates an IfStatement with default tokens', () => {
            const ifStatement = factory.createIfStatement({
                condition: factory.createBooleanLiteral('true'),
                thenBranch: factory.createBlock({
                    statements: [
                        factory.createPrintStatement({
                            print: factory.createToken(TokenKind.Print),
                            expressions: [
                                factory.createStringLiteral('hello')
                            ]
                        })
                    ]
                })
            });
            expect(ifStatement).to.be.instanceOf(IfStatement);
            expect(ifStatement.thenBranch).to.be.instanceOf(Block);
            expect(ifStatement.thenBranch.statements[0]).to.be.instanceOf(PrintStatement);
            expect(ifStatement.tokens.else).to.be.undefined;
            expect(transpile(ifStatement)).to.eql('if true then print "hello" end if');
        });

        it('creates an IfStatement with an else branch', () => {
            const ifStatement = factory.createIfStatement({
                condition: factory.createBooleanLiteral('true'),
                thenBranch: factory.createBlock(),
                elseBranch: factory.createBlock()
            });
            expect(ifStatement.tokens.else.kind).to.eql(TokenKind.Else);
        });

        it('creates assignments with default tokens', () => {
            expect(
                transpile(factory.createAssignmentStatement({ name: 'a', value: factory.createIntegerLiteral('1') }))
            ).to.eql('a = 1');
            expect(
                transpile(factory.createDottedSetStatement({ obj: factory.createVariableExpression({ name: 'a' }), name: 'b', value: factory.createIntegerLiteral('1') }))
            ).to.eql('a.b = 1');
            expect(
                transpile(factory.createIndexedSetStatement({ obj: factory.createVariableExpression({ name: 'a' }), indexes: [factory.createIntegerLiteral('0')], value: factory.createIntegerLiteral('1') }))
            ).to.eql('a[0] = 1');
        });
    });

    describe('SceneGraph', () => {
        it('creates attributes with default tokens', () => {
            const attr = factory.createSGAttribute({ key: 'name', value: 'MyComponent' });
            expect(attr.tokens.key.text).to.eql('name');
            expect(attr.tokens.equals.text).to.eql('=');
            expect(attr.tokens.openingQuote.text).to.eql('"');
            expect(attr.tokens.value.text).to.eql('MyComponent');
            expect(attr.tokens.closingQuote.text).to.eql('"');
        });

        it('creates a component with default tokens and object attributes', () => {
            const component = factory.createSGComponent({
                attributes: {
                    name: 'MyComponent',
                    extends: 'Group'
                }
            });
            expect(component).to.be.instanceOf(SGComponent);
            expect(component.name).to.eql('MyComponent');
            expect(component.extends).to.eql('Group');
            expect(component.tokens.startTagOpen.text).to.eql('<');
            expect(component.tokens.startTagName.text).to.eql('component');
            expect(component.tokens.startTagClose.text).to.eql('>');
            expect(component.tokens.endTagName.text).to.eql('component');
        });

        it('accepts full tokens', () => {
            const component = factory.createSGComponent({
                startTagOpen: { text: '<' },
                startTagName: { text: 'component' },
                attributes: [
                    factory.createSGAttribute({ key: { text: 'name' }, value: { text: 'MyComponent' } })
                ],
                startTagClose: { text: '>' },
                elements: [],
                endTagOpen: { text: '</' },
                endTagName: { text: 'component' },
                endTagClose: { text: '>' }
            });
            expect(component.name).to.eql('MyComponent');
        });

        it('creates self-closing elements', () => {
            const field = factory.createSGInterfaceField({ attributes: { id: 'title', type: 'string' } });
            expect(field).to.be.instanceOf(SGInterfaceField);
            expect(field.id).to.eql('title');
            expect(field.type).to.eql('string');
            expect(field.tokens.startTagClose.text).to.eql('/>');
            expect(field.tokens.endTagName).to.be.undefined;

            const script = factory.createSGScript({ attributes: { uri: 'pkg:/source/main.brs' } });
            expect(script).to.be.instanceOf(SGScript);
            expect(script.uri).to.eql('pkg:/source/main.brs');
        });

        it('creates a prolog', () => {
            const prolog = factory.createSGProlog({ attributes: { version: '1.0' } });
            expect(prolog).to.be.instanceOf(SGProlog);
            expect(prolog.tokens.startTagOpen.text).to.eql('<?');
            expect(prolog.tokens.startTagName.text).to.eql('xml');
            expect(prolog.tokens.startTagClose.text).to.eql('?>');
        });

        it('creates an SGAst', () => {
            const component = factory.createSGComponent({ attributes: { name: 'MyComponent' } });
            const ast = factory.createSGAst({ rootElement: component, componentElement: component });
            expect(ast).to.be.instanceOf(SGAst);
            expect(ast.componentElement).to.equal(component);
            expect(factory.createSGAst()).to.be.instanceOf(SGAst);
        });
    });
});
