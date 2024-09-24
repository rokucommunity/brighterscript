import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { DottedGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { isAssignmentStatement, isBlock, isCatchStatement, isClassStatement, isCommentStatement, isConstStatement, isDimStatement, isDottedGetExpression, isDottedSetStatement, isEnumMemberStatement, isEnumStatement, isExpressionStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isIfStatement, isIncrementStatement, isIndexedSetStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInterfaceStatement, isLibraryStatement, isMethodStatement, isNamespaceStatement, isPrintStatement, isReturnStatement, isThrowStatement, isTryCatchStatement, isWhileStatement } from '../astUtils/reflection';
import type { ClassStatement, FunctionStatement, InterfaceFieldStatement, InterfaceMethodStatement, MethodStatement, InterfaceStatement, CatchStatement, ThrowStatement, EnumStatement, EnumMemberStatement, ConstStatement, Block, CommentStatement, PrintStatement, DimStatement, ForStatement, WhileStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, TryCatchStatement, DottedSetStatement } from './Statement';
import { AssignmentStatement, EmptyStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import type { AstNode } from './AstNode';

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
            let original: AstNode;
            if (typeof code === 'string') {
                const parser = Parser.parse(code, { mode: ParseMode.BrighterScript });
                original = parser.ast;
                expectZeroDiagnostics(parser);
            } else {
                original = code;
            }

            const clone = original.clone();
            //ensure the clone is identical to the original

            //compare them both ways to ensure no extra properties exist
            ensureIdentical(original, clone);
            ensureIdentical(clone, original);

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
                        (isFunctionExpression(original) && (key === 'functionStatement' || key === 'returnType'))
                    ) {
                        continue;
                    }

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
                    } else if ([''].includes(typeOfValue)) {
                        //primitive values should be identical
                        expect(cloneValue).to.equal(originalValue, `${fullKey} should be equal`);
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
    });
});
