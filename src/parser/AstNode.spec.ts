import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { AAIndexedMemberExpression, AALiteralExpression, AAMemberExpression, ArrayLiteralExpression, BinaryExpression, CallExpression, CallfuncExpression, DottedGetExpression, FunctionExpression, GroupingExpression, IndexedGetExpression, NewExpression, NullCoalescingExpression, TaggedTemplateStringExpression, TemplateStringExpression, TemplateStringQuasiExpression, TernaryExpression, TypeCastExpression, UnaryExpression, XmlAttributeGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { isAAIndexedMemberExpression, isAALiteralExpression, isAAMemberExpression, isAnnotationExpression, isArrayLiteralExpression, isAssignmentStatement, isBinaryExpression, isBlock, isCallExpression, isCallfuncExpression, isCatchStatement, isClassStatement, isCommentStatement, isConstStatement, isDimStatement, isDottedGetExpression, isDottedSetStatement, isEnumMemberStatement, isEnumStatement, isExpressionStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isGroupingExpression, isIfStatement, isIncrementStatement, isIndexedGetExpression, isIndexedSetStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInterfaceStatement, isLibraryStatement, isMethodStatement, isNamespaceStatement, isNewExpression, isNullCoalescingExpression, isPrintStatement, isReturnStatement, isStatement, isTaggedTemplateStringExpression, isTemplateStringExpression, isTemplateStringQuasiExpression, isTernaryExpression, isThrowStatement, isTryCatchStatement, isTypeCastExpression, isUnaryExpression, isWhileStatement, isXmlAttributeGetExpression } from '../astUtils/reflection';
import type { ClassStatement, FunctionStatement, InterfaceFieldStatement, InterfaceMethodStatement, MethodStatement, InterfaceStatement, CatchStatement, ThrowStatement, EnumStatement, EnumMemberStatement, ConstStatement, Block, CommentStatement, PrintStatement, DimStatement, ForStatement, WhileStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, TryCatchStatement, DottedSetStatement } from './Statement';
import { AssignmentStatement, EmptyStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import type { AstNode } from './AstNode';
import { WalkMode } from '../astUtils/visitors';

type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> };

describe('AstNode', () => {
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

    describe('findChildAtPosition', () => {
        it('finds deepest AstNode that matches the position', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                    sub main()
                        alpha = invalid
                        print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                    end sub
                `);
            program.validate();
            expectZeroDiagnostics(program);
            const delta = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 52))!;
            expect(delta.name.text).to.eql('delta');

            const foxtrot = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 71))!;
            expect(foxtrot.name.text).to.eql('foxtrot');
        });
    });

    describe('findChild', () => {
        it('finds a child that matches the matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            expect(
                file.ast.findChild((node) => {
                    return isAssignmentStatement(node) && node.name.text === 'alpha';
                })
            ).instanceof(AssignmentStatement);
        });

        it('returns the exact node that matches', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha1 = invalid
                    alpha2 = invalid
                end sub
            `);
            let count = 0;
            const instance = file.ast.findChild((node) => {
                if (isAssignmentStatement(node)) {
                    count++;
                    if (count === 2) {
                        return true;
                    }
                }
            });
            const expected = (file.ast.statements[0] as FunctionStatement).func.body.statements[1];
            expect(instance).to.equal(expected);
        });

        it('returns undefined when matcher never returned true', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            expect(
                file.ast.findChild((node) => false)
            ).not.to.exist;
        });

        it('returns the value returned from the matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const secondStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[1];
            expect(
                file.ast.findChild((node) => secondStatement)
            ).to.equal(secondStatement);
        });

        it('cancels properly', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            let count = 0;
            file.ast.findChild((node, cancelToken) => {
                count++;
                cancelToken.cancel();
            });
            expect(count).to.eql(1);
        });
    });

    describe('findAncestor', () => {
        it('returns node when matcher returns true', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const secondStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[1];
            const foxtrot = file.ast.findChild((node) => {
                return isDottedGetExpression(node) && node.name?.text === 'foxtrot';
            })!;
            expect(
                foxtrot.findAncestor(isPrintStatement)
            ).to.equal(secondStatement);
        });

        it('returns undefined when no match found', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const foxtrot = file.ast.findChild((node) => {
                return isDottedGetExpression(node) && node.name?.text === 'foxtrot';
            })!;
            expect(
                foxtrot.findAncestor(isClassStatement)
            ).to.be.undefined;
        });

        it('returns overridden node when returned in matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const firstStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[0];
            const foxtrot = file.ast.findChild((node) => {
                return isDottedGetExpression(node) && node.name?.text === 'foxtrot';
            })!;
            expect(
                foxtrot.findAncestor(node => firstStatement)
            ).to.equal(firstStatement);
        });

        it('returns overridden node when returned in matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            let count = 0;
            const firstStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[0];
            firstStatement.findAncestor((node, cancel) => {
                count++;
                cancel.cancel();
            });
            expect(count).to.eql(1);
        });
    });

    describe('clone', () => {
        function testClone(code: string | AstNode) {
            let originalOuter: AstNode;
            if (typeof code === 'string') {
                const parser = Parser.parse(code, { mode: ParseMode.BrighterScript });
                originalOuter = parser.ast;
                expectZeroDiagnostics(parser);
            } else {
                originalOuter = code;
            }

            const cloneOuter = originalOuter.clone();
            //ensure the clone is identical to the original

            //compare them both ways to ensure no extra properties exist
            ensureIdentical(originalOuter, cloneOuter);
            ensureIdentical(cloneOuter, originalOuter);

            function ensureIdentical(original: AstNode, clone: AstNode, ancestors = [], seenNodes = new Map<AstNode, number>()) {
                for (let key in original) {
                    let fullKey = [...ancestors, key].join('.');
                    const originalValue = original?.[key];
                    const cloneValue = clone?.[key];
                    let typeOfValue = typeof originalValue;

                    //skip these properties
                    if (
                        ['parent', 'symbolTable', 'range'].includes(key) ||
                        //this is a circular reference property or the `returnType` prop, skip it
                        (isFunctionExpression(original) && (key === 'functionStatement' || key === 'returnType')) ||
                        //circular reference property for annotations
                        (isAnnotationExpression(original) && key === 'call')
                    ) {
                        continue;
                    }

                    //if this is an object, recurse
                    if (typeOfValue === 'object' && originalValue !== null) {
                        //skip circular references (but give some tollerance)
                        if (seenNodes.get(originalValue) > 2) {
                            throw new Error(`${fullKey} is a circular reference`);
                        }
                        seenNodes.set(originalValue, (seenNodes.get(originalValue) ?? 0) + 1);

                        //object references should not be the same
                        if (originalValue === cloneValue) {
                            throw new Error(`${fullKey} is the same object reference`);
                        }
                        //compare child object values
                        ensureIdentical(originalValue, cloneValue, [...ancestors, key], seenNodes);

                        //for these tests, empty arrays can be the same as undefined so skip
                    } else if (
                        (Array.isArray(originalValue) && originalValue.length === 0 && cloneValue === undefined) ||
                        (Array.isArray(cloneValue) && cloneValue.length === 0 && originalValue === undefined)) {
                        continue;

                        //these values must be identical
                    } else {
                        // eslint-disable-next-line no-useless-catch
                        try {
                            expect(cloneValue).to.equal(originalValue, `'${fullKey}' should be identical`);
                        } catch (e) {
                            //build a full list of ancestors for orig and clone
                            let originalChain = [originalOuter];
                            let cloneChain = [cloneOuter];
                            for (let key of fullKey.split('.')) {
                                originalChain.push(originalChain[originalChain.length - 1]?.[key]);
                                cloneChain.push(cloneChain[cloneChain.length - 1]?.[key]);
                            }
                            console.error((e as Error)?.message, fullKey, originalChain, cloneChain);
                            throw e;
                        }
                    }
                }
            }
        }

        it('clones EmptyStatement', () => {
            testClone(new EmptyStatement(
                util.createRange(1, 2, 3, 4)
            ));
        });

        it('clones body with undefined statements array', () => {
            const original = Parser.parse(`
                sub main()
                end sub
            `).ast;
            original.statements = undefined;
            testClone(original);
        });

        it('clones body with undefined in the statements array', () => {
            const original = Parser.parse(`
                sub main()
                end sub
            `).ast;
            original.statements.push(undefined);
            testClone(original);
        });

        it('clones interfaces', () => {
            testClone(`
                interface Empty
                end interface
                interface Movie
                    name as string
                    previous as Movie
                    sub play()
                    function play2(a, b as string) as dynamic
                end interface
                interface Short extends Movie
                    length as integer
                end interface
            `);
        });

        it('handles when interfaces are missing their body', () => {
            const original = Parser.parse(`
                interface Empty
                end interface
            `).ast;
            original.findChild<InterfaceStatement>(isInterfaceStatement).body = undefined;
            testClone(original);
        });

        it('handles when interfaces have undefined statements in the body', () => {
            const original = Parser.parse(`
                interface Empty
                end interface
            `).ast;
            original.findChild<InterfaceStatement>(isInterfaceStatement).body.push(undefined);
            testClone(original);
        });

        it('handles when interfaces have undefined field type', () => {
            const original = Parser.parse(`
                interface Empty
                    name as string
                end interface
            `).ast;
            original.findChild<InterfaceFieldStatement>(isInterfaceFieldStatement).type = undefined;
            testClone(original);
        });

        it('handles when interface function has undefined param and return type', () => {
            const original = Parser.parse(`
                interface Empty
                    function test() as dynamic
                end interface
            `).ast;
            original.findChild<InterfaceMethodStatement>(isInterfaceMethodStatement).params.push(undefined);
            original.findChild<InterfaceMethodStatement>(isInterfaceMethodStatement).returnType = undefined;
            testClone(original);
        });

        it('handles when interface function has undefined params array', () => {
            const original = Parser.parse(`
                interface Empty
                    function test(a) as dynamic
                end interface
            `).ast;
            original.findChild<InterfaceMethodStatement>(isInterfaceMethodStatement).params = undefined;
            testClone(original);
        });

        it('clones empty class', () => {
            testClone(`
                class Movie
                end class
            `);
        });

        it('clones class with undefined body', () => {
            const original = Parser.parse(`
                class Movie
                end class
            `).ast;
            original.findChild<ClassStatement>(isClassStatement).body = undefined;
            testClone(original);
        });

        it('clones class with undefined body statement', () => {
            const original = Parser.parse(`
                class Movie
                end class
            `).ast;
            original.findChild<ClassStatement>(isClassStatement).body.push(undefined);
            testClone(original);
        });

        it('clones class having parent class', () => {
            testClone(`
                class Video
                end class
                class Movie extends Video
                end class
            `);
        });

        it('clones class', () => {
            testClone(`
                class Movie
                    name as string
                    previous as Movie
                    sub play()
                    end sub
                    function play2(a, b as string) as dynamic
                    end function
                end class
            `);
        });

        it('clones access modifiers', () => {
            testClone(`
                class Movie
                    public sub test()
                    end sub
                    protected name = "bob"
                    private child = {}
                end class
            `);
        });

        it('clones AssignmentStatement', () => {
            testClone(`
                sub main()
                    thing = true
                end sub
            `);
        });

        it('clones AssignmentStatement with missing value', () => {
            const original = Parser.parse(`
                sub main()
                    thing = true
                end sub
            `).ast;
            original.findChild<any>(isAssignmentStatement).value = undefined;
            testClone(original);
        });

        it('clones Block with undefined statements array', () => {
            const original = Parser.parse(`
                sub main()
                    thing = true
                end sub
            `).ast;
            original.findChild<any>(isBlock).statements = undefined;
            testClone(original);
        });

        it('clones Block with undefined statement in statements array', () => {
            const original = Parser.parse(`
                sub main()
                    thing = true
                end sub
            `).ast;
            original.findChild<Block>(isBlock).statements.push(undefined);
            testClone(original);
        });

        it('clones comment statement with undefined comments array', () => {
            const original = Parser.parse(`
                'hello world
            `).ast;
            original.findChild<CommentStatement>(isCommentStatement).comments = undefined;
            testClone(original);
        });

        it('clones class with undefined method modifiers array', () => {
            const original = Parser.parse(`
                class Movie
                    sub test()
                    end sub
                end class
            `).ast;
            original.findChild<MethodStatement>(isMethodStatement).modifiers = undefined;
            testClone(original);
        });

        it('clones class with undefined func', () => {
            const original = Parser.parse(`
                class Movie
                    sub test()
                    end sub
                end class
            `).ast;
            original.findChild<MethodStatement>(isMethodStatement).func = undefined;
            testClone(original);
        });

        it('clones ExpressionStatement', () => {
            testClone(`
                sub main()
                    test()
                end sub
            `);
        });

        it('clones ExpressionStatement without an expression', () => {
            const original = Parser.parse(`
                sub main()
                    test()
                end sub
            `).ast;
            original.findChild<any>(isExpressionStatement).expression = undefined;
            original.findChild<FunctionExpression>(isFunctionExpression).callExpressions = [];
            testClone(original);
        });

        it('clones IfStatement', () => {
            testClone(`
                sub main()
                    if true
                    end if
                    if true then
                    end if
                    if true
                        print 1
                    else if true
                        print 1
                    else
                        print 1
                    end if
                end sub
            `);
        });

        it('clones IfStatement without condition or branches', () => {
            const original = Parser.parse(`
                sub main()
                    if true
                    end if
                end sub
            `).ast;
            original.findChild<any>(isIfStatement).condition = undefined;
            original.findChild<any>(isIfStatement).thenBranch = undefined;
            original.findChild<any>(isIfStatement).elseBranch = undefined;
            testClone(original);
        });

        it('clones IncrementStatement', () => {
            testClone(`
                sub main()
                    i = 0
                    i++
                end sub
            `);
        });

        it('clones IncrementStatement with missing `value`', () => {
            const original = Parser.parse(`
                sub main()
                    i = 0
                    i++
                end sub
            `).ast;
            original.findChild<any>(isIncrementStatement).value = undefined;
            testClone(original);
        });

        it('clones PrintStatement with undefined expressions array', () => {
            const original = Parser.parse(`
                sub main()
                    print 1
                end sub
            `).ast;
            original.findChild<any>(isPrintStatement).expressions = undefined;
            testClone(original);
        });

        it('clones PrintStatement with undefined expression in the expressions array', () => {
            const original = Parser.parse(`
                sub main()
                    print 1
                end sub
            `).ast;
            original.findChild<PrintStatement>(isPrintStatement).expressions.push(undefined);
            testClone(original);
        });

        it('clones DimStatement', () => {
            testClone(`
                sub main()
                    dim alpha[1,2]
                end sub
            `);
        });

        it('clones DimStatement with undefined dimensions', () => {
            const original = Parser.parse(`
                sub main()
                    dim alpha[1,2]
                end sub
            `).ast;
            original.findChild<DimStatement>(isDimStatement).dimensions = undefined;
            testClone(original);
        });

        it('clones DimStatement with undefined as item in dimensions', () => {
            const original = Parser.parse(`
                sub main()
                    dim alpha[1,2]
                end sub
            `).ast;
            original.findChild<DimStatement>(isDimStatement).dimensions.push(undefined);
            testClone(original);
        });

        it('clones Goto statement', () => {
            testClone(`
                sub main()
                    label1:
                    for i = 0 to 10
                        goto label1
                    end for
                end sub
            `);
        });

        it('clones return statement', () => {
            testClone(`
                sub main()
                    return
                end sub
            `);
        });

        it('clones return statement with value', () => {
            testClone(`
                function test()
                    return true
                end function
            `);
        });

        it('clones return statement with undefined value expression', () => {
            const original = Parser.parse(`
                function test()
                    return true
                end function
            `).ast;
            original.findChild<any>(isReturnStatement).value = undefined;
            testClone(original);
        });

        it('clones stop statement', () => {
            testClone(`
                sub main()
                    stop
                end sub
            `);
        });

        it('clones ForStatement', () => {
            testClone(`
                function test()
                    for i = 0 to 10 step 2
                    end for
                end function
            `);
        });

        it('clones ForStatement with undefined items', () => {
            const original = Parser.parse(`
                function test()
                    for i = 0 to 10 step 2
                    end for
                end function
            `).ast;
            original.findChild<ForStatement>(isForStatement).counterDeclaration = undefined;
            original.findChild<ForStatement>(isForStatement).finalValue = undefined;
            original.findChild<ForStatement>(isForStatement).body = undefined;
            original.findChild<ForStatement>(isForStatement).increment = undefined;
            testClone(original);
        });

        it('clones ForEachStatement', () => {
            testClone(`
                function test()
                    for each item in [1, 2, 3]
                    end for
                end function
            `);
        });

        it('clones ForEachStatement with undefined props', () => {
            const original = Parser.parse(`
                function test()
                    for each item in [1, 2, 3]
                    end for
                end function
            `).ast;
            original.findChild<any>(isForEachStatement).target = undefined;
            original.findChild<any>(isForEachStatement).body = undefined;
            testClone(original);
        });

        it('clones EndStatement', () => {
            testClone(`
                function test()
                    end
                end function
            `);
        });

        it('clones ExitFor statement', () => {
            testClone(`
                sub main()
                    for i = 0 to 10
                        exit for
                    end for
                end sub
            `);
        });

        it('clones While statement', () => {
            testClone(`
                sub main()
                    while true
                    end while
                end sub
            `);
        });

        it('clones While statement', () => {
            testClone(`
                sub main()
                    while true
                    end while
                end sub
            `);
        });

        it('clones ExitWhile statement', () => {
            testClone(`
                sub main()
                    while true
                        exit while
                    end while
                end sub
            `);
        });

        it('clones tryCatch statement', () => {
            testClone(`
                sub main()
                    try
                    catch e
                    end try
                end sub
            `);
        });

        it('clones tryCatch statement when missing branches', () => {
            const original = Parser.parse(`
               sub main()
                    try
                        print 1
                    catch e
                        print 2
                    end try
                end sub
            `).ast;
            original.findChild<TryCatchStatement>(isTryCatchStatement).tryBranch = undefined;
            original.findChild<TryCatchStatement>(isTryCatchStatement).catchStatement = undefined;
            testClone(original);
        });

        it('clones tryCatch statement when missing catch branch', () => {
            const original = Parser.parse(`
               sub main()
                    try
                        print 1
                    catch e
                        print 2
                    end try
                end sub
            `).ast;
            original.findChild<CatchStatement>(isCatchStatement).catchBranch = undefined;
            testClone(original);
        });

        it('clones throw statement', () => {
            testClone(`
                sub main()
                    throw "Crash"
                end sub
            `);
        });

        it('clones throw statement with missing expression', () => {
            const original = Parser.parse(`
                sub main()
                    throw "Crash"
                end sub
            `).ast;
            original.findChild<ThrowStatement>(isThrowStatement).expression = undefined;
            testClone(original);
        });

        it('clones FunctionStatement when missing .func', () => {
            const original = Parser.parse(`
               sub main()
                end sub
            `).ast;
            original.findChild<FunctionStatement>(isFunctionStatement).func = undefined;
            testClone(original);
        });

        it('clones empty enum statement', () => {
            testClone(`
               enum Direction
               end enum
            `);
        });

        it('clones enum statement with comments', () => {
            testClone(`
                enum Direction
                    'the up direction
                    up = "up"
                end enum
            `);
        });

        it('clones enum statement with missing body', () => {
            const original = Parser.parse(`
                enum Direction
                    'the up direction
                    up = "up"
                end enum
            `).ast;
            original.findChild<EnumStatement>(isEnumStatement).body = undefined;
            testClone(original);
        });

        it('clones enum statement with undefined in body', () => {
            const original = Parser.parse(`
                enum Direction
                    'the up direction
                    up = "up"
                end enum
            `).ast;
            original.findChild<EnumStatement>(isEnumStatement).body.push(undefined);
            testClone(original);
        });

        it('clones enum member with missing value', () => {
            const original = Parser.parse(`
                enum Direction
                    up = "up"
                end enum
            `).ast;
            original.findChild<EnumMemberStatement>(isEnumMemberStatement).value = undefined;
            testClone(original);
        });

        it('clones const', () => {
            const original = Parser.parse(`
                const key = "KEY"
            `).ast;
            testClone(original);
        });


        it('clones const with missing value', () => {
            const original = Parser.parse(`
                const key = "KEY"
            `).ast;
            original.findChild<ConstStatement>(isConstStatement).value = undefined;

            testClone(original);
        });

        it('clones continue statement', () => {
            testClone(`
                sub main()
                    for i = 0 to 10
                        continue for
                    end for
                end sub
            `);
        });

        it('clones WhileStatement', () => {
            const original = Parser.parse(`
                sub main()
                    while true
                        print hello
                    end while
                end sub
            `).ast;
            original.findChild<DeepWriteable<WhileStatement>>(isWhileStatement).condition = undefined;
            original.findChild<DeepWriteable<WhileStatement>>(isWhileStatement).body = undefined;

            testClone(original);
        });

        it('clones DottedSetStatement', () => {
            const original = Parser.parse(`
                sub main()
                    m.value = true
                end sub
            `).ast;

            testClone(original);
        });

        it('clones DottedSetStatement with missing properties', () => {
            const original = Parser.parse(`
                sub main()
                    m.value = true
                end sub
            `).ast;
            original.findChild<DeepWriteable<DottedSetStatement>>(isDottedSetStatement).obj = undefined;
            original.findChild<DeepWriteable<DottedSetStatement>>(isDottedSetStatement).value = undefined;

            testClone(original);
        });

        it('clones IndexedSetStatement with missing props', () => {
            const original = Parser.parse(`
                sub main()
                    m["value"] = true
                end sub
            `).ast;
            original.findChild<DeepWriteable<IndexedSetStatement>>(isIndexedSetStatement).obj = undefined;
            original.findChild<DeepWriteable<IndexedSetStatement>>(isIndexedSetStatement).value = undefined;

            testClone(original);
        });

        it('clones IndexedSetStatement', () => {
            const original = Parser.parse(`
                sub main()
                    m["value"] = true
                end sub
            `).ast;

            testClone(original);
        });

        it('clones IndexedSetStatement', () => {
            const original = Parser.parse(`
                sub main()
                    m["value"][2] = true
                    m["value", 2] = true
                end sub
            `).ast;

            testClone(original);
        });

        it('clones IndexedSetStatement with undefined additional index', () => {
            const original = Parser.parse(`
                sub main()
                    m["value", 2] = true
                end sub
            `).ast;
            original.findChild<DeepWriteable<IndexedSetStatement>>(isIndexedSetStatement).additionalIndexes[0] = undefined;

            testClone(original);
        });

        it('clones IndexedSetStatement with missing props', () => {
            const original = Parser.parse(`
                sub main()
                    m["value"] = true
                end sub
            `).ast;
            original.findChild<DeepWriteable<IndexedSetStatement>>(isIndexedSetStatement).index = undefined;
            original.findChild<DeepWriteable<IndexedSetStatement>>(isIndexedSetStatement).additionalIndexes = undefined;

            testClone(original);
        });

        it('clones LibraryStatement', () => {
            const original = Parser.parse(`
                Library "v30/bslCore.brs"
            `).ast;

            testClone(original);
        });

        it('clones LibraryStatement with missing tokens', () => {
            const original = Parser.parse(`
                Library "v30/bslCore.brs"
            `).ast;
            original.findChild<DeepWriteable<LibraryStatement>>(isLibraryStatement).tokens = undefined;

            testClone(original);
        });

        it('clones NamespaceStatement', () => {
            const original = Parser.parse(`
                namespace Alpha
                end namespace
            `).ast;

            testClone(original);
        });

        it('clones NamespaceStatement with missing items', () => {
            const original = Parser.parse(`
                namespace Alpha
                end namespace
            `).ast;
            original.findChild<DeepWriteable<NamespaceStatement>>(isNamespaceStatement).nameExpression = undefined;
            original.findChild<DeepWriteable<NamespaceStatement>>(isNamespaceStatement).body = undefined;

            testClone(original);
        });

        it('clones ImportStatement', () => {
            const original = Parser.parse(`
                import "Something.brs"
            `).ast;

            testClone(original);
        });

        it('clones BinaryExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print 1 + 2
                end sub
            `).ast;

            testClone(original);
        });

        it('clones BinaryExpression with missing props', () => {
            const original = Parser.parse(`
                sub test()
                    print 1 + 2
                end sub
            `).ast;
            original.findChild<DeepWriteable<BinaryExpression>>(isBinaryExpression).left = undefined;
            original.findChild<DeepWriteable<BinaryExpression>>(isBinaryExpression).right = undefined;

            testClone(original);
        });

        it('clones CallExpression', () => {
            const original = Parser.parse(`
                sub test()
                    test()
                end sub
            `).ast;

            testClone(original);
        });

        it('clones CallExpression with args', () => {
            const original = Parser.parse(`
                sub test()
                    test(1,2,3)
                end sub
            `).ast;

            testClone(original);
        });

        it('clones CallExpression with missing props', () => {
            const original = Parser.parse(`
                sub test()
                    test(1,2,3)
                end sub
            `).ast;
            original.findChild<DeepWriteable<CallExpression>>(isCallExpression).callee = undefined;
            original.findChild<DeepWriteable<CallExpression>>(isCallExpression).args = undefined;

            testClone(original);
        });

        it('clones CallExpression with args containing undefined', () => {
            const original = Parser.parse(`
                sub test()
                    test(1,2,3)
                end sub
            `).ast;
            original.findChild<DeepWriteable<CallExpression>>(isCallExpression).args[0] = undefined;

            testClone(original);
        });

        it('clones FunctionExpression', () => {
            const original = Parser.parse(`
                sub test()
                end sub
            `).ast;

            testClone(original);
        });

        it('clones FunctionExpression with undefined props', () => {
            const original = Parser.parse(`
                sub test()
                end sub
            `).ast;
            original.findChild<DeepWriteable<FunctionExpression>>(isFunctionExpression).parameters = undefined;
            original.findChild<DeepWriteable<FunctionExpression>>(isFunctionExpression).body = undefined;

            testClone(original);
        });

        it('clones FunctionExpression with a parameter that is undefined', () => {
            const original = Parser.parse(`
                sub test(p1)
                end sub
            `).ast;
            original.findChild<DeepWriteable<FunctionExpression>>(isFunctionExpression).parameters[0] = undefined;

            testClone(original);
        });

        it('clones FunctionParameterExpression', () => {
            const original = Parser.parse(`
                sub test(p1)
                end sub
            `).ast;

            testClone(original);
        });

        it('clones FunctionParameterExpression with default value', () => {
            const original = Parser.parse(`
                sub test(p1 = true)
                end sub
            `).ast;

            testClone(original);
        });


        it('clones FunctionParameterExpression with undefined default value', () => {
            const original = Parser.parse(`
                sub test(p1 = true)
                end sub
            `).ast;
            original.findChild<DeepWriteable<FunctionExpression>>(isFunctionExpression).parameters[0].defaultValue = undefined;

            testClone(original);
        });

        it('clones NamespacedVariableNameExpression', () => {
            const original = Parser.parse(`
                sub test(p1 as Alpha.Beta)
                end sub
            `).ast;

            testClone(original);
        });

        it('clones NamespacedVariableNameExpression with undefined expression', () => {
            const original = Parser.parse(`
                class Person extends Alpha.Humanoid
                end class
            `).ast;
            original.findChild<DeepWriteable<ClassStatement>>(isClassStatement).parentClassName.expression = undefined;

            testClone(original);
        });

        it('clones DottedGetExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print alpha.beta.charlie
                end sub
            `).ast;

            testClone(original);
        });

        it('clones DottedGetExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print alpha.beta.charlie
                end sub
            `).ast;
            original.findChild<DeepWriteable<DottedGetExpression>>(isDottedGetExpression).obj = undefined;

            testClone(original);
        });

        it('clones XmlAttributeGetExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print xml@name
                end sub
            `).ast;

            testClone(original);
        });

        it('clones XmlAttributeGetExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print xml@name
                end sub
            `).ast;
            original.findChild<DeepWriteable<XmlAttributeGetExpression>>(isXmlAttributeGetExpression).obj = undefined;

            testClone(original);
        });

        it('clones IndexedGetExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print m.stuff[0]
                end sub
            `).ast;

            testClone(original);
        });

        it('clones IndexedGetExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print m.stuff[0]
                end sub
            `).ast;
            original.findChild<DeepWriteable<IndexedGetExpression>>(isIndexedGetExpression).obj = undefined;
            original.findChild<DeepWriteable<IndexedGetExpression>>(isIndexedGetExpression).index = undefined;
            original.findChild<DeepWriteable<IndexedGetExpression>>(isIndexedGetExpression).additionalIndexes = undefined;

            testClone(original);
        });

        it('clones IndexedGetExpression with additionalIndexes', () => {
            const original = Parser.parse(`
                sub test()
                    print m.stuff[0, 1]
                end sub
            `).ast;

            testClone(original);
        });

        it('clones IndexedGetExpression with additionalIndexes having undefined', () => {
            const original = Parser.parse(`
                sub test()
                    print m.stuff[0, 1]
                end sub
            `).ast;
            original.findChild<DeepWriteable<IndexedGetExpression>>(isIndexedGetExpression).additionalIndexes[0] = undefined;

            testClone(original);
        });

        it('clones GroupingExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print (1 + 2)
                end sub
            `).ast;

            testClone(original);
        });

        it('clones GroupingExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print (1 + 2)
                end sub
            `).ast;
            original.findChild<DeepWriteable<GroupingExpression>>(isGroupingExpression).expression = undefined;

            testClone(original);
        });

        it('clones LiteralExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print true
                end sub
            `).ast;

            testClone(original);
        });

        it('clones ExcapedCharCodeLiteralExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print \`\n\`
                end sub
            `).ast;

            testClone(original);
        });

        it('clones ArrayLiteralExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print []
                end sub
            `).ast;

            testClone(original);
        });

        it('clones ArrayLiteralExpression with undefined items', () => {
            const original = Parser.parse(`
                sub test()
                    print []
                end sub
            `).ast;
            original.findChild<DeepWriteable<ArrayLiteralExpression>>(isArrayLiteralExpression).elements = undefined;

            testClone(original);
        });

        it('clones ArrayLiteralExpression with with elements having an undefined', () => {
            const original = Parser.parse(`
                sub test()
                    print [1,2,3]
                end sub
            `).ast;
            original.findChild<DeepWriteable<ArrayLiteralExpression>>(isArrayLiteralExpression).elements[0] = undefined;

            testClone(original);
        });

        it('clones AAMemberExpression', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        duration: 20
                    }
                end sub
            `).ast;

            testClone(original);
        });

        it('clones AAMemberExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        duration: 20
                    }
                end sub
            `).ast;
            original.findChild<DeepWriteable<AAMemberExpression>>(isAAMemberExpression).value = undefined;

            testClone(original);
        });

        it('clones AAIndexedMemberExpression', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        [someEnum.key]: 20
                    }
                end sub
            `).ast;

            testClone(original);
        });

        it('clones AAIndexedMemberExpression with undefined value', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        [someEnum.key]: 20
                    }
                end sub
            `).ast;
            original.findChild<DeepWriteable<AAIndexedMemberExpression>>(isAAIndexedMemberExpression).value = undefined;

            testClone(original);
        });

        it('clones AALiteralExpression', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        duration: 20
                    }
                end sub
            `).ast;

            testClone(original);
        });

        it('clones AALiteralExpression with undefined items', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        duration: 20
                    }
                end sub
            `).ast;
            original.findChild<DeepWriteable<AALiteralExpression>>(isAALiteralExpression).elements = undefined;

            testClone(original);
        });

        it('clones AALiteralExpression with undefined items', () => {
            const original = Parser.parse(`
                sub test()
                    movie = {
                        duration: 20
                    }
                end sub
            `).ast;
            original.findChild<AALiteralExpression>(isAALiteralExpression).elements.push(undefined);

            testClone(original);
        });

        it('clones UnaryExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print not true
                end sub
            `).ast;

            testClone(original);
        });

        it('clones UnaryExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print not true
                end sub
            `).ast;
            original.findChild<DeepWriteable<UnaryExpression>>(isUnaryExpression).right = undefined;

            testClone(original);
        });

        it('clones SourceLiteralExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print LINE_NUM
                end sub
            `).ast;

            testClone(original);
        });

        it('clones NewExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print new Person()
                end sub
            `).ast;

            testClone(original);
        });

        it('clones NewExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print new Person()
                end sub
            `).ast;
            original.findChild<DeepWriteable<NewExpression>>(isNewExpression).call = undefined;

            testClone(original);
        });

        it('clones CallfuncExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print node@.run(1)
                end sub
            `).ast;

            testClone(original);
        });

        it('clones CallfuncExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print node@.run()
                end sub
            `).ast;
            original.findChild<DeepWriteable<CallfuncExpression>>(isCallfuncExpression).callee = undefined;
            original.findChild<DeepWriteable<CallfuncExpression>>(isCallfuncExpression).args = undefined;

            testClone(original);
        });

        it('clones CallfuncExpression with undefined args', () => {
            const original = Parser.parse(`
                sub test()
                    print node@.run()
                end sub
            `).ast;
            original.findChild<DeepWriteable<CallfuncExpression>>(isCallfuncExpression).args[0] = undefined;

            testClone(original);
        });

        it('clones TemplateStringQuasiExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print \`hello \${name}\`
                end sub
            `).ast;

            testClone(original);
        });

        it('clones TemplateStringQuasiExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print \`hello \${name}\`
                end sub
            `).ast;
            original.findChild<DeepWriteable<TemplateStringQuasiExpression>>(isTemplateStringQuasiExpression).expressions = undefined;

            testClone(original);
        });

        it('clones TemplateStringQuasiExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print \`hello \${name}\`
                end sub
            `).ast;
            original.findChild<DeepWriteable<TemplateStringQuasiExpression>>(isTemplateStringQuasiExpression).expressions[0] = undefined;

            testClone(original);
        });

        it('clones TemplateStringExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print \`hello \${name} \\n\`
                end sub
            `).ast;

            testClone(original);
        });

        it('clones TemplateStringExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print \`hello \${name}\`
                end sub
            `).ast;
            original.findChild<DeepWriteable<TemplateStringExpression>>(isTemplateStringExpression).quasis = undefined;
            original.findChild<DeepWriteable<TemplateStringExpression>>(isTemplateStringExpression).expressions = undefined;

            testClone(original);
        });

        it('clones TemplateStringExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print \`hello \${name}\`
                end sub
            `).ast;
            original.findChild<DeepWriteable<TemplateStringExpression>>(isTemplateStringExpression).quasis.push(undefined);
            original.findChild<DeepWriteable<TemplateStringExpression>>(isTemplateStringExpression).expressions.push(undefined);

            testClone(original);
        });

        it('clones TemplateStringExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print tag\`hello \${name} \\n\`
                end sub
            `).ast;

            testClone(original);
        });

        it('clones TemplateStringExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print tag\`hello \${name}\`
                end sub
            `).ast;
            original.findChild<DeepWriteable<TaggedTemplateStringExpression>>(isTaggedTemplateStringExpression).quasis = undefined;
            original.findChild<DeepWriteable<TaggedTemplateStringExpression>>(isTaggedTemplateStringExpression).expressions = undefined;

            testClone(original);
        });

        it('clones TemplateStringExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print tag\`hello \${name}\`
                end sub
            `).ast;
            original.findChild<DeepWriteable<TaggedTemplateStringExpression>>(isTaggedTemplateStringExpression).quasis.push(undefined);
            original.findChild<DeepWriteable<TaggedTemplateStringExpression>>(isTaggedTemplateStringExpression).expressions.push(undefined);

            testClone(original);
        });

        it('clones TernaryExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print true ? 1 : 2
                end sub
            `).ast;

            testClone(original);
        });

        it('clones TernaryExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print true ? 1 : 2
                end sub
            `).ast;
            original.findChild<DeepWriteable<TernaryExpression>>(isTernaryExpression).test = undefined;
            original.findChild<DeepWriteable<TernaryExpression>>(isTernaryExpression).consequent = undefined;
            original.findChild<DeepWriteable<TernaryExpression>>(isTernaryExpression).alternate = undefined;

            testClone(original);
        });

        it('clones NullCoalescingExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print a ?? b
                end sub
            `).ast;

            testClone(original);
        });

        it('clones NullCoalescingExpression with undefined expressions', () => {
            const original = Parser.parse(`
                sub test()
                    print a ?? b
                end sub
            `).ast;
            original.findChild<DeepWriteable<NullCoalescingExpression>>(isNullCoalescingExpression).consequent = undefined;
            original.findChild<DeepWriteable<NullCoalescingExpression>>(isNullCoalescingExpression).alternate = undefined;

            testClone(original);
        });

        it('clones RegexLiteralExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print /test/gi
                end sub
            `).ast;

            testClone(original);
        });

        it('clones TypeCastExpression', () => {
            const original = Parser.parse(`
                sub test()
                    print name as string
                end sub
            `).ast;

            testClone(original);
        });

        it('clones TypeCastExpression with undefined expression', () => {
            const original = Parser.parse(`
                sub test()
                    print name as string
                end sub
            `).ast;
            original.findChild<DeepWriteable<TypeCastExpression>>(isTypeCastExpression).obj = undefined;

            testClone(original);
        });

        it('clones AnnotationExpressions above every statement type', () => {
            const original = Parser.parse(`
                @annotation()
                sub test()
                    @annotation()
                    statement = true
                    @annotation()
                    call()
                    @annotation()
                    'comment
                end sub

                @annotation()
                class Person
                end class

                @annotation()
                enum Direction
                end enum

                @annotation()
                namespace alpha
                end namespace

                @annotation()
                const thing = 1
            `).ast;

            testClone(original);
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
            /* eslint-disable no-template-curly-in-string */
            expectChains('print `hello ${alpha.beta} world`', [
                ['`hello ${alpha.beta} world`', ['`hello ${alpha.beta} world`']],
                ['hello ', ['hello ']],
                ['hello ', ['hello ']],
                ['alpha.beta', ['alpha', 'alpha.beta']],
                [' world', [' world']],
                [' world', [' world']]
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
