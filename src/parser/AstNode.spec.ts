import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { DottedGetExpression, LiteralExpression, VariableExpression } from './Expression';
import type { AstNode } from './AstNode';
import { ParseMode } from './Parser';
import type { ClassStatement, MethodStatement, NamespaceStatement } from './Statement';
import { isClassStatement, isLiteralExpression, isMethodStatement, isNamespaceStatement, isVariableExpression } from '../astUtils/reflection';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';

/**
 * Compile-time assertion that `T` is exactly `TExpected` (not merely assignable to it).
 * These specs are typechecked by ts-node at runtime, so a broken inference fails the suite.
 */
function expectTypeToBe<TExpected>() {
    return <TActual>(_value: TActual & IfEquals<TActual, TExpected, unknown, never>) => { };
}
type IfEquals<X, Y, TIfEqual, TIfNot> =
    (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? TIfEqual : TIfNot;

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
        describe('findAncestor', () => {
            /**
             * Grab a deeply-nested node to walk upward from. `beta` is a variable
             * expression inside a method, inside a class, inside a namespace.
             */
            function getDeepNode() {
                const file = program.setFile<BrsFile>('source/main.bs', `
                    namespace Alpha
                        class Bravo
                            sub charlie()
                                delta = 1
                                print delta
                            end sub
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                //NOTE: must match by name; a bare isVariableExpression matches the
                //namespace's own name expression, which has no class in its chain
                const node = file.ast.findChild<VariableExpression>(
                    (x) => isVariableExpression(x) && x.name.text.toLowerCase() === 'delta'
                );
                expect(node).to.exist;
                return node;
            }

            it('infers the node type from a single type-guard matcher', () => {
                const node = getDeepNode();

                const namespaceStatement = node.findAncestor(isNamespaceStatement);

                //runtime
                expect(namespaceStatement.getName(ParseMode.BrighterScript)).to.eql('Alpha');
                //compile-time: no explicit type arg was supplied, yet this is a NamespaceStatement
                expectTypeToBe<NamespaceStatement>()(namespaceStatement);
            });

            it('returns a union for a custom matcher with an explicit type argument', () => {
                const node = getDeepNode();

                //the terse way to get a union out of custom logic: name the union once
                //as the type argument and write plain boolean logic
                const found = node.findAncestor<ClassStatement | NamespaceStatement>(
                    (x) => isClassStatement(x) || isNamespaceStatement(x)
                );

                //the class is nearer than the namespace, so it wins the upward walk
                expect(isClassStatement(found)).to.be.true;
                expect((found as ClassStatement).name.text).to.eql('Bravo');
                expectTypeToBe<ClassStatement | NamespaceStatement>()(found);
            });

            it('narrows a union result down to a single member when guarded', () => {
                const node = getDeepNode();

                const found = node.findAncestor<ClassStatement | NamespaceStatement>(
                    (x) => isClassStatement(x) || isNamespaceStatement(x)
                );

                //standard narrowing still applies to the union we got back
                if (isClassStatement(found)) {
                    expectTypeToBe<ClassStatement>()(found);
                    expect(found.name.text).to.eql('Bravo');
                } else {
                    throw new Error('should have found the class');
                }
            });

            it('also returns a union for a matcher annotated as a type predicate', () => {
                const node = getDeepNode();

                //more verbose than the explicit type argument above, but the compiler
                //actually *verifies* this predicate against the matcher body rather
                //than taking the caller's word for it
                const found = node.findAncestor(
                    (x): x is ClassStatement | NamespaceStatement => isClassStatement(x) || isNamespaceStatement(x)
                );

                expect(isClassStatement(found)).to.be.true;
                expectTypeToBe<ClassStatement | NamespaceStatement>()(found);
            });

            it('honors the order of the upward walk, returning the nearest match', () => {
                const node = getDeepNode();

                //the method is nearest, then the class, then the namespace
                const nearest = node.findAncestor<ClassStatement | MethodStatement | NamespaceStatement>(
                    (x) => isClassStatement(x) || isMethodStatement(x) || isNamespaceStatement(x)
                );
                expect(isMethodStatement(nearest)).to.be.true;
                expectTypeToBe<ClassStatement | MethodStatement | NamespaceStatement>()(nearest);
            });

            it('supports a multi-statement boolean matcher with an explicit type argument', () => {
                const node = getDeepNode();

                //matcher returns boolean|undefined (no explicit return on the fall-through path)
                const found = node.findAncestor<ClassStatement>((x) => {
                    if (isClassStatement(x)) {
                        return true;
                    }
                });

                expect(found.name.text).to.eql('Bravo');
                expectTypeToBe<ClassStatement>()(found);
            });

            it('does not verify an explicit type argument against the matcher logic', () => {
                const node = getDeepNode();

                //CAVEAT of the terse form: the type argument is asserted, not proven. The
                //logic below matches a class, but we claim MethodStatement and the compiler
                //accepts it. Annotate the matcher as a type predicate if you want this checked.
                const found = node.findAncestor<MethodStatement>((x) => isClassStatement(x));

                expectTypeToBe<MethodStatement>()(found);
                //the static type is a lie; at runtime it really is the ClassStatement
                expect(isClassStatement(found)).to.be.true;
            });

            it('falls back to AstNode when a boolean matcher gives no type information', () => {
                const node = getDeepNode();

                //an un-annotated `||` of guards is NOT a type predicate, so TypeScript
                //cannot infer the union here; the result widens to the AstNode default.
                const found = node.findAncestor((x) => isClassStatement(x) || isNamespaceStatement(x));

                expect(isClassStatement(found)).to.be.true;
                expectTypeToBe<AstNode>()(found);
                //...and the un-inferred result really is just an AstNode
                // @ts-expect-error `name` does not exist on AstNode
                found.name;
            });

            it('returns undefined when no ancestor matches', () => {
                const node = getDeepNode();

                //there is no literal expression anywhere up the parent chain
                const found = node.findAncestor(isLiteralExpression);

                expect(found).to.be.undefined;
                expectTypeToBe<LiteralExpression>()(found);
            });
        });

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
    });
});
