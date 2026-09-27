import { expect } from '../chai-config.spec';
import * as ExpressionModule from '../parser/Expression';
import * as StatementModule from '../parser/Statement';
import * as SGTypesModule from '../parser/SGTypes';
import { BscFactory, bscFactory } from './BscFactory';
import { AstFactory } from './AstFactory';
import { BrsFactory } from './BrsFactory';
import { SGXmlFactory } from './SGXmlFactory';
import { TokenKind } from '../lexer/TokenKind';
import { Program } from '../Program';
import { rootDir } from '../testHelpers.spec';
import { CallExpression, DottedGetExpression, LiteralExpression, VariableExpression } from '../parser/Expression';
import { Block, EmptyStatement, IfStatement, PrintStatement } from '../parser/Statement';
import { SGAst, SGComponent, SGInterfaceField, SGProlog, SGScript } from '../parser/SGTypes';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';
import { AssetFile } from '../files/AssetFile';
import type { AstNode } from '../parser/AstNode';
import util from '../util';

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
        const file = factory.files.createBrsFile({ srcPath: 'source/main.brs', destPath: 'source/main.brs' });
        const state = new BrsTranspileState(file);
        return state.sourceNode(node, node.transpile(state)).toString().replace(/\s+/g, ' ').trim();
    }

    it('has a brs create method for every BrightScript AST node class', () => {
        const classNames = [
            ...getClassNames(ExpressionModule),
            ...getClassNames(StatementModule)
        ];
        //sanity check to make sure we actually found the classes
        expect(classNames).to.include.members(['CallExpression', 'IfStatement']);

        const missing = classNames.filter(name => typeof factory.ast.brs[`create${name}`] !== 'function');
        expect(missing).to.eql([]);
    });

    it('has an sgXml create method for every SceneGraph node class', () => {
        const classNames = getClassNames(SGTypesModule);
        //sanity check to make sure we actually found the classes
        expect(classNames).to.include.members(['SGComponent', 'SGAst']);

        const missing = classNames.filter(name => typeof factory.ast.sgXml[`create${name}`] !== 'function');
        expect(missing).to.eql([]);
    });

    it('is available on the program, bound to that program', () => {
        expect(program.factory).to.be.instanceOf(BscFactory);
        expect(program.factory.program).to.equal(program);
    });

    it('groups syntax factories under ast', () => {
        expect(factory.ast).to.be.instanceOf(AstFactory);
        expect(factory.ast.brs).to.be.instanceOf(BrsFactory);
        expect(factory.ast.sgXml).to.be.instanceOf(SGXmlFactory);
    });

    it('exports a shared instance with no program', () => {
        expect(bscFactory).to.be.instanceOf(BscFactory);
        expect(bscFactory.program).to.be.undefined;
        expect(bscFactory.files.program).to.be.undefined;
    });

    it('passes its program to the file factory', () => {
        expect(factory.files.program).to.equal(program);
    });

    describe('plugins', () => {
        class ExampleFactory {
            public createThing() {
                return { kind: 'thing' };
            }
        }

        it('registers and gets a plugin factory', () => {
            const example = new ExampleFactory();
            factory.plugins.register('bsc-plugin-example', example);
            expect(factory.plugins.has('bsc-plugin-example')).to.be.true;
            expect(factory.plugins.get<ExampleFactory>('bsc-plugin-example')).to.equal(example);
            expect(factory.plugins.get<ExampleFactory>('bsc-plugin-example').createThing()).to.eql({ kind: 'thing' });
        });

        it('looks up names case-insensitively', () => {
            const example = new ExampleFactory();
            factory.plugins.register('BSC-Plugin-Example', example);
            expect(factory.plugins.get('bsc-plugin-example')).to.equal(example);
        });

        it('returns undefined for unregistered plugins', () => {
            expect(factory.plugins.has('not-there')).to.be.false;
            expect(factory.plugins.get('not-there')).to.be.undefined;
        });

        it('throws when registering a duplicate name', () => {
            factory.plugins.register('bsc-plugin-example', new ExampleFactory());
            expect(() => {
                factory.plugins.register('bsc-plugin-example', new ExampleFactory());
            }).to.throw(`A plugin factory named 'bsc-plugin-example' has already been registered`);
        });

        it('unregisters a plugin factory', () => {
            factory.plugins.register('bsc-plugin-example', new ExampleFactory());
            factory.plugins.unregister('bsc-plugin-example');
            expect(factory.plugins.has('bsc-plugin-example')).to.be.false;
            //can register again after unregistering
            factory.plugins.register('bsc-plugin-example', new ExampleFactory());
        });

        it('keeps registries separate per program', () => {
            const otherProgram = new Program({ rootDir: rootDir });
            factory.plugins.register('bsc-plugin-example', new ExampleFactory());
            expect(otherProgram.factory.plugins.has('bsc-plugin-example')).to.be.false;
            otherProgram.dispose();
        });
    });

    describe('tokens', () => {
        it('creates tokens with default text', () => {
            expect(factory.ast.brs.createToken(TokenKind.LeftParen)).to.include({
                kind: TokenKind.LeftParen,
                text: '('
            });
            expect(factory.ast.brs.createToken(TokenKind.EndSub)).to.include({
                kind: TokenKind.EndSub,
                text: 'end sub'
            });
        });

        it('creates tokens with custom text', () => {
            expect(factory.ast.brs.createToken(TokenKind.StringLiteral, '"hello"')).to.include({
                kind: TokenKind.StringLiteral,
                text: '"hello"'
            });
        });

        it('creates identifiers', () => {
            expect(factory.ast.brs.createIdentifier('alpha')).to.include({
                kind: TokenKind.Identifier,
                text: 'alpha'
            });
        });

        it('creates SG tokens', () => {
            const location = util.createLocation(1, 2, 3, 4);
            expect(factory.ast.sgXml.createToken('component', location)).to.eql({
                text: 'component',
                location: location
            });
        });
    });

    describe('files', () => {
        it('creates a BrsFile for the program', () => {
            const file = factory.files.createBrsFile({ srcPath: `${rootDir}/source/main.bs`, destPath: 'source/main.bs' });
            expect(file).to.be.instanceOf(BrsFile);
            expect(file.program).to.equal(program);
            expect(file.pkgPath).to.eql(util.standardizePath('source/main.brs'));
        });

        it('creates an XmlFile for the program', () => {
            const file = factory.files.createXmlFile({ srcPath: `${rootDir}/components/Comp.xml`, destPath: 'components/Comp.xml' });
            expect(file).to.be.instanceOf(XmlFile);
            expect(file.program).to.equal(program);
        });

        it('creates files for an explicit program', () => {
            const file = bscFactory.files.createBrsFile({ srcPath: `${rootDir}/source/main.brs`, destPath: 'source/main.brs', program: program });
            expect(file.program).to.equal(program);
        });

        it('creates an AssetFile', () => {
            const file = factory.files.createAssetFile({ srcPath: `${rootDir}/images/logo.png`, destPath: 'images/logo.png' });
            expect(file).to.be.instanceOf(AssetFile);
        });
    });

    describe('literals', () => {
        it('creates literals of each type', () => {
            expect(factory.ast.brs.createIntegerLiteral('1').tokens.value.kind).to.eql(TokenKind.IntegerLiteral);
            expect(factory.ast.brs.createFloatLiteral('1.5').tokens.value.kind).to.eql(TokenKind.FloatLiteral);
            expect(factory.ast.brs.createDoubleLiteral('1.5#').tokens.value.kind).to.eql(TokenKind.DoubleLiteral);
            expect(factory.ast.brs.createLongIntegerLiteral('1&').tokens.value.kind).to.eql(TokenKind.LongIntegerLiteral);
            expect(factory.ast.brs.createInvalidLiteral().tokens.value.kind).to.eql(TokenKind.Invalid);
            expect(factory.ast.brs.createBooleanLiteral('true').tokens.value.kind).to.eql(TokenKind.True);
            expect(factory.ast.brs.createBooleanLiteral('false').tokens.value.kind).to.eql(TokenKind.False);
        });

        describe('createStringLiteral', () => {
            it('wraps the value in quotes', () => {
                expect(factory.ast.brs.createStringLiteral('hello world').tokens.value.text).to.equal('"hello world"');
            });

            it('does not wrap already-quoted value in extra quotes', () => {
                expect(factory.ast.brs.createStringLiteral('"hello world"').tokens.value.text).to.equal('"hello world"');
            });

            it('does not wrap badly quoted value in additional quotes', () => {
                //leading
                expect(factory.ast.brs.createStringLiteral('"hello world').tokens.value.text).to.equal('"hello world');
                //trailing
                expect(factory.ast.brs.createStringLiteral('hello world"').tokens.value.text).to.equal('hello world"');
            });
        });

        it('creates dotted identifiers', () => {
            const path = ['alpha', 'beta', 'charlie'];
            const expression = factory.ast.brs.createDottedIdentifier(path);
            expect(expression).to.be.instanceOf(DottedGetExpression);
            expect(util.getAllDottedGetPartsAsString(expression)).to.eql('alpha.beta.charlie');
            //does not mutate the input array
            expect(path).to.eql(['alpha', 'beta', 'charlie']);

            expect(factory.ast.brs.createDottedIdentifier(['alpha'])).to.be.instanceOf(VariableExpression);
        });
    });

    describe('AST nodes', () => {
        it('creates a CallExpression with default parens', () => {
            const callee = factory.ast.brs.createVariableExpression({ name: 'doSomething' });
            const arg = factory.ast.brs.createIntegerLiteral('1');
            const call = factory.ast.brs.createCallExpression({
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
            expect(factory.ast.brs.createEmptyStatement()).to.be.instanceOf(EmptyStatement);
            expect(factory.ast.brs.createReturnStatement().value).to.be.undefined;
            expect(factory.ast.brs.createBody().statements).to.eql([]);
            expect(factory.ast.brs.createBlock().statements).to.eql([]);
        });

        it('creates an empty function by default', () => {
            expect(transpile(factory.ast.brs.createFunctionExpression())).to.eql('function() end function');
        });

        it('uses `end sub` for sub functions', () => {
            const func = factory.ast.brs.createFunctionExpression({ functionType: factory.ast.brs.createToken(TokenKind.Sub) });
            expect(transpile(func)).to.eql('sub() end sub');
        });

        it('creates a MethodStatement with a string name', () => {
            const method = factory.ast.brs.createMethodStatement({ name: 'new' });
            expect(method.tokens.name.text).to.eql('new');
            expect(method.func.tokens.functionType.kind).to.eql(TokenKind.Function);
        });

        it('creates an IfStatement with default tokens', () => {
            const ifStatement = factory.ast.brs.createIfStatement({
                condition: factory.ast.brs.createBooleanLiteral('true'),
                thenBranch: factory.ast.brs.createBlock({
                    statements: [
                        factory.ast.brs.createPrintStatement({
                            print: factory.ast.brs.createToken(TokenKind.Print),
                            expressions: [
                                factory.ast.brs.createStringLiteral('hello')
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
            const ifStatement = factory.ast.brs.createIfStatement({
                condition: factory.ast.brs.createBooleanLiteral('true'),
                thenBranch: factory.ast.brs.createBlock(),
                elseBranch: factory.ast.brs.createBlock()
            });
            expect(ifStatement.tokens.else.kind).to.eql(TokenKind.Else);
        });

        it('creates assignments with default tokens', () => {
            expect(
                transpile(factory.ast.brs.createAssignmentStatement({ name: 'a', value: factory.ast.brs.createIntegerLiteral('1') }))
            ).to.eql('a = 1');
            expect(
                transpile(factory.ast.brs.createDottedSetStatement({ obj: factory.ast.brs.createVariableExpression({ name: 'a' }), name: 'b', value: factory.ast.brs.createIntegerLiteral('1') }))
            ).to.eql('a.b = 1');
            expect(
                transpile(factory.ast.brs.createIndexedSetStatement({ obj: factory.ast.brs.createVariableExpression({ name: 'a' }), indexes: [factory.ast.brs.createIntegerLiteral('0')], value: factory.ast.brs.createIntegerLiteral('1') }))
            ).to.eql('a[0] = 1');
        });
    });

    describe('SceneGraph', () => {
        it('creates attributes with default tokens', () => {
            const attr = factory.ast.sgXml.createSGAttribute({ key: 'name', value: 'MyComponent' });
            expect(attr.tokens.key.text).to.eql('name');
            expect(attr.tokens.equals.text).to.eql('=');
            expect(attr.tokens.openingQuote.text).to.eql('"');
            expect(attr.tokens.value.text).to.eql('MyComponent');
            expect(attr.tokens.closingQuote.text).to.eql('"');
        });

        it('creates a component with default tokens and object attributes', () => {
            const component = factory.ast.sgXml.createSGComponent({
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
            const component = factory.ast.sgXml.createSGComponent({
                startTagOpen: { text: '<' },
                startTagName: { text: 'component' },
                attributes: [
                    factory.ast.sgXml.createSGAttribute({ key: { text: 'name' }, value: { text: 'MyComponent' } })
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
            const field = factory.ast.sgXml.createSGInterfaceField({ attributes: { id: 'title', type: 'string' } });
            expect(field).to.be.instanceOf(SGInterfaceField);
            expect(field.id).to.eql('title');
            expect(field.type).to.eql('string');
            expect(field.tokens.startTagClose.text).to.eql('/>');
            expect(field.tokens.endTagName).to.be.undefined;

            const script = factory.ast.sgXml.createSGScript({ attributes: { uri: 'pkg:/source/main.brs' } });
            expect(script).to.be.instanceOf(SGScript);
            expect(script.uri).to.eql('pkg:/source/main.brs');
        });

        it('creates a prolog', () => {
            const prolog = factory.ast.sgXml.createSGProlog({ attributes: { version: '1.0' } });
            expect(prolog).to.be.instanceOf(SGProlog);
            expect(prolog.tokens.startTagOpen.text).to.eql('<?');
            expect(prolog.tokens.startTagName.text).to.eql('xml');
            expect(prolog.tokens.startTagClose.text).to.eql('?>');
        });

        it('creates an SGAst', () => {
            const component = factory.ast.sgXml.createSGComponent({ attributes: { name: 'MyComponent' } });
            const ast = factory.ast.sgXml.createSGAst({ rootElement: component, componentElement: component });
            expect(ast).to.be.instanceOf(SGAst);
            expect(ast.componentElement).to.equal(component);
            expect(factory.ast.sgXml.createSGAst()).to.be.instanceOf(SGAst);
        });
    });
});
