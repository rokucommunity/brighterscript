import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { AAMemberExpression } from './Expression';
import { type AALiteralExpression, type ArrayLiteralExpression, type BinaryExpression, type CallExpression, type CallfuncExpression, type DottedGetExpression, type FunctionExpression, type GroupingExpression, type IndexedGetExpression, type NewExpression, type NullCoalescingExpression, type TaggedTemplateStringExpression, type TemplateStringExpression, type TemplateStringQuasiExpression, type TernaryExpression, type TypeCastExpression, type UnaryExpression, type XmlAttributeGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { isAALiteralExpression, isAAMemberExpression, isAnnotationExpression, isArrayLiteralExpression, isAssignmentStatement, isBinaryExpression, isBlock, isCallExpression, isCallfuncExpression, isCatchStatement, isClassStatement, isCommentStatement, isConstStatement, isDimStatement, isDottedGetExpression, isDottedSetStatement, isEnumMemberStatement, isEnumStatement, isExpressionStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isGroupingExpression, isIfStatement, isIncrementStatement, isIndexedGetExpression, isIndexedSetStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInterfaceStatement, isLibraryStatement, isLiteralNumber, isMethodStatement, isNamespacedVariableNameExpression, isNamespaceStatement, isNewExpression, isNullCoalescingExpression, isPrintStatement, isRegexLiteralExpression, isReturnStatement, isSourceLiteralExpression, isTaggedTemplateStringExpression, isTemplateStringExpression, isTemplateStringQuasiExpression, isTernaryExpression, isThrowStatement, isTryCatchStatement, isTypeCastExpression, isUnaryExpression, isVariableExpression, isWhileStatement, isXmlAttributeGetExpression } from '../astUtils/reflection';
import type { Body, ClassStatement, FunctionStatement, InterfaceFieldStatement, InterfaceMethodStatement, MethodStatement, InterfaceStatement, CatchStatement, ThrowStatement, EnumStatement, EnumMemberStatement, ConstStatement, Block, CommentStatement, PrintStatement, DimStatement, ForStatement, WhileStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, TryCatchStatement, DottedSetStatement } from './Statement';
import { AssignmentStatement, EmptyStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import type { AstNode } from './AstNode';
import { BrsTranspileState } from './BrsTranspileState';
import { standardizePath as s } from '../util';

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

    describe('Expression chains', () => {
        function findNodeByName(ast: Body, name: string) {
            return ast.findChild(node => {
                if (isVariableExpression(node) && node.name.text === name) {
                    return true;
                } else if (isDottedGetExpression(node) && node.name.text === name) {
                    return true;
                } else if (isSourceLiteralExpression(node) && node.token.text === name) {
                    return true;
                } else if (isXmlAttributeGetExpression(node) && node.name.text === name) {
                    return true;
                }
            });
        }

        type FindMatcher = (ast: Body) => AstNode;
        function doTest(code: string, startSelector: string | FindMatcher, expectedRootSelector: string | FindMatcher, insertFunctionBody = true) {
            const file = new BrsFile(s`${rootDir}/source/main.bs`, 'pkg:/source/main.bs', program);

            file.parse(
                !insertFunctionBody ? code : `function test()\n    ${code}\nend function`
            );

            expectZeroDiagnostics(file);

            const ast = file.ast;

            const start = typeof startSelector === 'function' ? startSelector(ast) : findNodeByName(ast, startSelector as string);
            const expectedRoot = typeof expectedRootSelector === 'function' ? expectedRootSelector(ast) : findNodeByName(ast, expectedRootSelector as string);

            expect(start).not.to.be.undefined;
            expect(expectedRoot).not.to.be.undefined;

            const root = start.getExpressionChainRoot();

            //transpile both items so we can compare the things they actually represent. (helps sanity check)
            expect(
                root.transpile(new BrsTranspileState(file)).toString()
            ).to.eql(
                expectedRoot.transpile(new BrsTranspileState(file)).toString()
            );

            //the real test. did we get the exact same instance of the root that we were expecting?
            expect(root).to.equal(expectedRoot);
        }

        it('finds root of dotted gets', () => {
            doTest(`func = alpha.beta.charlie.delta`, 'alpha', 'delta');
            doTest(`func = alpha.beta.charlie.delta`, 'beta', 'delta');
            doTest(`func = alpha.beta.charlie.delta`, 'charlie', 'delta');
            doTest(`func = alpha.beta.charlie.delta`, 'delta', 'delta');
        });

        it('finds root of dotted get inside indexed get', () => {
            doTest(`func = alpha.beta[charlie.delta]`, 'alpha', ast => ast.findChild(isIndexedGetExpression));
            doTest(`func = alpha.beta[charlie.delta]`, 'beta', ast => ast.findChild(isIndexedGetExpression));
            doTest(`func = alpha.beta[charlie.delta]`, 'charlie', 'delta');
            doTest(`func = alpha.beta[charlie.delta]`, 'delta', 'delta');
        });

        it('finds root of variable expression', () => {
            doTest(`func = alpha`, 'alpha', 'alpha');
        });

        it('finds root of function call', () => {
            doTest(`func = alpha()`, 'alpha', ast => ast.findChild(isCallExpression));
            doTest(`func = alpha.beta()`, 'alpha', ast => ast.findChild(isCallExpression));
        });

        it('finds root of call inside call', () => {
            doTest(`func = alpha()`, 'alpha', ast => ast.findChild(isCallExpression));
            doTest(`func = alpha(beta())`, 'beta', ast => {
                return ast.findChild(x => isVariableExpression(x) && x.name.text === 'beta').parent;
            });
            doTest(`func = alpha(beta())`, 'alpha', ast => {
                return ast.findChild(x => isVariableExpression(x) && x.name.text === 'alpha').parent;
            });
        });

        it('finds root of literal number inside call', () => {
            doTest(`func = alpha(1)`, ast => ast.findChild(isLiteralNumber), ast => ast.findChild(isLiteralNumber));
        });

        it('finds wrapped of literal number inside call', () => {
            doTest(`func = alpha(1)`, ast => ast.findChild(isLiteralNumber), ast => ast.findChild(isLiteralNumber));
        });

        it('GroupExpressions cause new expression chains', () => {
            doTest(`func = (((one).two).three)`, 'one', 'one');
            doTest(`func = (((one).two).three)`, ast => {
                //the grouping expression around `one`
                return ast.findChild(x => isVariableExpression(x) && x.name.text === 'one').parent;
            }, 'two');
            doTest(`func = (((one).two).three)`, ast => {
                //the grouping expression around `(one).two`
                return ast.findChild(x => isDottedGetExpression(x) && x.name.text === 'two').parent;
            }, 'three');
            doTest(`func = (((one).two).three)`, ast => {
                //the grouping expression around `((one).two).three`
                return ast.findChild(x => isDottedGetExpression(x) && x.name.text === 'three').parent;
            }, ast => {
                //the grouping expression around `((one).two).three`
                return ast.findChild(x => isDottedGetExpression(x) && x.name.text === 'three').parent;
            });
        });

        it('UnaryExpression are not included in expressionChainRoot', () => {
            doTest(`isAlive = [not isDead]`, 'isDead', 'isDead');
        });

        it('SourceLiteralExpression do not cause issues', () => {
            doTest(`isAlive = [LINE_NUM.ToStr()]`, 'LINE_NUM', ast => ast.findChild(isCallExpression));
        });

        it('SourceLiteralExpression do not cause issues', () => {
            doTest(`func = [function(p1 = alpha.beta)\nend function]`, 'alpha', 'beta');
        });

        it('BinaryExpression knows its a root', () => {
            doTest(`func = [1 + "two"]`, ast => ast.findChild(isBinaryExpression), ast => ast.findChild(isBinaryExpression));
        });

        it('FunctionExpression knows its a root', () => {
            doTest(`func = [sub() : end sub]`, ast => ast.findChild(isFunctionExpression), ast => ast.findChild(isFunctionExpression));
        });

        it('NamespacedVariableExpression knows its a root', () => {
            doTest(`
                namespace alpha.beta
                    class charlie extends delta.echo
                    end class
                end namespace
            `, ast => ast.findChild(isNamespacedVariableNameExpression), ast => ast.findChild(isNamespacedVariableNameExpression), false);
        });

        it('XmlAttributeGetExpression works', () => {
            doTest(`result = [thing@name]`, 'thing', 'name');
        });

        it('LiteralExpression knows its a root when standalone', () => {
            doTest(`result = [1]`, ast => ast.findChild(isLiteralNumber), ast => ast.findChild(isLiteralNumber));
        });

        //skipped because this is a bug in the parser (it's valid syntax on device)
        it.skip('LiteralExpression is not a root when used on LHS of dotted get', () => {
            doTest(`result = 1.ToStr()`, ast => ast.findChild(isLiteralNumber), ast => ast.findChild(isCallExpression));
        });

        it('ArrayLiteralExpression knows its a root', () => {
            doTest(`result = [1,2,3]`, ast => ast.findChild(isArrayLiteralExpression), ast => ast.findChild(isArrayLiteralExpression));
        });

        it('AALiteralExpression knows its a root', () => {
            doTest(`result = [{}]`, ast => ast.findChild(isAALiteralExpression), ast => ast.findChild(isAALiteralExpression));
        });

        it('AAMemberExpression knows its a root', () => {
            doTest(`result = [{ one: 1}]`, ast => ast.findChild(isAAMemberExpression), ast => ast.findChild(isAAMemberExpression));
        });

        it('VariableExpression knows its a root', () => {
            doTest(`result = [one]`, 'one', 'one');
        });

        it('NewExpression knows its a root', () => {
            doTest(`result = [new Movie()]`, ast => ast.findChild(isNewExpression), ast => ast.findChild(isNewExpression));
        });

        it('CallfuncExpression properly passes along', () => {
            doTest(`result = [ node@.someCallfunc() ]`, 'node', ast => ast.findChild(isCallfuncExpression));
        });

        it('TemplateStringExpression knows its a root', () => {
            doTest('result = [ `some text` ]', ast => ast.findChild(isTemplateStringExpression), ast => ast.findChild(isTemplateStringExpression));
        });

        it('TaggedStringExpression knows its a root', () => {
            doTest('result = [ someTag`some text` ]', ast => ast.findChild(isTaggedTemplateStringExpression), ast => ast.findChild(isTaggedTemplateStringExpression));
        });

        it('AnnotationExpression knows its a root', () => {
            doTest(`
                @SomeAnnotation()
                sub SomeFunc()
                end sub
            `, ast => ast.findChild<FunctionStatement>(x => {
                return isFunctionStatement(x);
            }).annotations[0], ast => ast.findChild<FunctionStatement>(x => {
                return isFunctionStatement(x);
            }).annotations[0], false);
        });

        it('TernaryExpression knows its a root', () => {
            doTest('result = [ true ? 1 : 2 ]', ast => ast.findChild(isTernaryExpression), ast => ast.findChild(isTernaryExpression));
        });

        it('NullCoalescingExpression knows its a root', () => {
            doTest('result = [ 1 ?? 2 ]', ast => ast.findChild(isNullCoalescingExpression), ast => ast.findChild(isNullCoalescingExpression));
        });

        it('regex works correctly', () => {
            doTest('result = [ /one/ ]', ast => ast.findChild(isRegexLiteralExpression), ast => ast.findChild(isRegexLiteralExpression));
            doTest('result = [ /one/.exec() ]', ast => ast.findChild(isRegexLiteralExpression), ast => ast.findChild(isCallExpression));
        });

        it('NullCoalescingExpression knows its a root', () => {
            doTest('result = [1 as string]', ast => ast.findChild(isTypeCastExpression), ast => ast.findChild(isTypeCastExpression));
        });
    });
});
