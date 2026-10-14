import { expect } from '../../../chai-config.spec';
import { Parser, ParseMode } from '../../Parser';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import { isFunctionStatement, isTupleTypeElementExpression, isTupleTypeExpression, isTypedArrayExpression, isTypeExpression, isTypeStatement } from '../../../astUtils/reflection';
import type { TupleTypeExpression, TypeExpression } from '../../Expression';
import type { FunctionStatement, TypeStatement } from '../../Statement';
import { Program } from '../../../Program';
import type { BrsFile } from '../../../files/BrsFile';
import { util } from '../../../util';
import { WalkMode } from '../../../astUtils/visitors';

describe('TupleTypeExpression', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    function parse(text: string, mode = ParseMode.BrighterScript) {
        return Parser.parse(text, { mode: mode });
    }

    /**
     * Parse a function with a single parameter typed as `typeText`, and return that parameter's type expression
     */
    function parseParamType(typeText: string) {
        const parser = parse(`
            sub main(value as ${typeText})
            end sub
        `);
        expectZeroDiagnostics(parser);
        const func = parser.ast.statements[0] as FunctionStatement;
        expect(isFunctionStatement(func)).to.be.true;
        return func.func.parameters[0].typeExpression;
    }

    function getTuple(typeExpression: TypeExpression) {
        expect(isTupleTypeExpression(typeExpression.expression)).to.be.true;
        return typeExpression.expression as TupleTypeExpression;
    }

    describe('parse', () => {
        it('parses a fixed tuple', () => {
            const typeExpression = parseParamType('[string, integer]');
            const tuple = getTuple(typeExpression);
            expect(tuple.elements).to.have.lengthOf(2);
            expect(tuple.elements.map(x => x.typeExpression.getName())).to.eql(['string', 'integer']);
            expect(tuple.elements.map(x => x.isOptional)).to.eql([false, false]);
            expect(tuple.elements.map(x => x.isRest)).to.eql([false, false]);
            expect(tuple.elements[0].tokens.comma?.text).to.eql(',');
            expect(tuple.elements[1].tokens.comma).to.be.undefined;
            expect(typeExpression.getName()).to.eql('[string, integer]');
        });

        it('parses optional elements', () => {
            const tuple = getTuple(parseParamType('[float, float, float?]'));
            expect(tuple.elements.map(x => x.isOptional)).to.eql([false, false, true]);
            expect(tuple.elements[2].tokens.question?.text).to.eql('?');
        });

        it('parses a rest element', () => {
            const typeExpression = parseParamType('[string, ...integer[]]');
            const tuple = getTuple(typeExpression);
            expect(tuple.elements.map(x => x.isRest)).to.eql([false, true]);
            expect(tuple.elements[1].tokens.dotDotDot?.text).to.eql('...');
            expect(isTypedArrayExpression(tuple.elements[1].typeExpression.expression)).to.be.true;
            expect(typeExpression.getName()).to.eql('[string, ...integer[]]');
        });

        it('parses optional and rest elements together', () => {
            expect(parseParamType('[string, integer?, ...float[]]').getName()).to.eql('[string, integer?, ...float[]]');
        });

        it('parses an empty tuple', () => {
            const tuple = getTuple(parseParamType('[]'));
            expect(tuple.elements).to.be.empty;
        });

        it('parses nested tuples, arrays of tuples, and custom types', () => {
            expect(parseParamType('[[string, integer], boolean]').getName()).to.eql('[[string, integer], boolean]');
            expect(parseParamType('[integer, integer][]').getName()).to.eql('[integer, integer][]');
            expect(parseParamType('[Alpha.Beta, roAssociativeArray]').getName()).to.eql('[Alpha.Beta, roAssociativeArray]');
        });

        it('parses unions inside and around a tuple', () => {
            expect(parseParamType('[string or integer, boolean]').getName()).to.eql('[string or integer, boolean]');
            expect(parseParamType('[string, integer] or boolean').getName()).to.eql('[string, integer] or boolean');
        });

        it('parses a tuple that spans multiple lines', () => {
            const typeExpression = parseParamType(`[
                string,
                integer
            ]`);
            expect(typeExpression.getName()).to.eql('[string, integer]');
        });

        it('parses tuples in return types, type statements, typed assignments, and typecasts', () => {
            const parser = parse(`
                type Pair = [string, integer]
                function split(data) as [string, string]
                    pair as [string, integer] = ["a", 1]
                    other = data as [string, integer]
                    return ["a", "b"]
                end function
            `);
            expectZeroDiagnostics(parser);
            const typeStatement = parser.ast.statements[0] as TypeStatement;
            expect(isTypeStatement(typeStatement)).to.be.true;
            expect(isTupleTypeExpression(typeStatement.value.expression)).to.be.true;

            const tupleTypes = parser.ast.findChildren(isTupleTypeExpression, { walkMode: WalkMode.visitAllRecursive });
            expect(tupleTypes.map(x => util.getTypeExpressionName(x))).to.eql([
                '[string, integer]',
                '[string, string]',
                '[string, integer]',
                '[string, integer]'
            ]);
        });

        it('wraps each element type in a type expression', () => {
            const tuple = getTuple(parseParamType('[string, integer]'));
            for (const element of tuple.elements) {
                expect(isTupleTypeElementExpression(element)).to.be.true;
                expect(isTypeExpression(element.typeExpression)).to.be.true;
                expect(util.isInTypeExpression(element.typeExpression.expression)).to.be.true;
            }
        });

        it('flags a required element after an optional element', () => {
            const parser = parse(`
                sub main(value as [string?, integer])
                end sub
            `);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.tupleRequiredElementAfterOptional(),
                location: { range: util.createRange(1, 44, 1, 51) }
            }]);
        });

        it('flags a rest element that is not last', () => {
            const parser = parse(`
                sub main(value as [...string[], integer])
                end sub
            `);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.tupleRestElementMustBeLast(),
                location: { range: util.createRange(1, 35, 1, 46) }
            }]);
        });

        it('flags an optional rest element', () => {
            const parser = parse(`
                sub main(value as [...string[]?])
                end sub
            `);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.tupleRestElementCannotBeOptional(),
                location: { range: util.createRange(1, 35, 1, 47) }
            }]);
        });

        it('allows a trailing comma and a comma at the start of a line', () => {
            expect(parseParamType('[string, integer,]').getName()).to.eql('[string, integer]');
            expect(parseParamType(`[string
                , integer]`).getName()).to.eql('[string, integer]');
        });

        it('flags an unclosed tuple', () => {
            const parser = parse(`
                sub main(value as [string, integer)
                end sub
            `);
            expectDiagnosticsIncludes(parser, [
                DiagnosticMessages.unmatchedLeftToken('[', 'tuple type').message
            ]);
        });

        it('does not swallow the following lines when a multi-line tuple is unclosed', () => {
            const parser = parse(`
                sub main(value as [string, integer
                end sub
                sub other()
                end sub
            `);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.unmatchedLeftToken('[', 'tuple type'),
                location: { range: util.createRange(2, 16, 2, 23) }
            }]);
            //`main` is abandoned at the error, but `other` must still be parsed
            expect(parser.ast.statements.map(x => (x as FunctionStatement).tokens.name.text)).to.eql(['other']);
        });

        it('reports each ordering problem only once', () => {
            const parser = parse(`
                sub main(value as [...string[], integer, boolean])
                end sub
            `);
            expectDiagnostics(parser, [
                DiagnosticMessages.tupleRestElementMustBeLast()
            ]);
        });

        it('does not duplicate diagnostics when probing for a typed assignment', () => {
            //a typed assignment is detected by speculatively parsing the type, so diagnostics from that attempt must be dropped
            const parser = parse(`
                sub main()
                    pair as [string?, integer] = ["a", 1]
                    print pair
                end sub
            `);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.tupleRequiredElementAfterOptional(),
                location: { range: util.createRange(2, 38, 2, 45) }
            }]);
        });

        it('flags tuple types in plain brightscript at the opening bracket', () => {
            const parser = parse(`
                sub main(value as [string, integer])
                end sub
            `, ParseMode.BrightScript);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('tuple types'),
                location: { range: util.createRange(1, 34, 1, 35) }
            }]);
        });

        it('gives ordering diagnostics a location in plain brightscript, where custom type names are skipped', () => {
            const parser = parse(`
                sub main(value as [Foo?, Bar])
                end sub
            `, ParseMode.BrightScript);
            const ordering = parser.diagnostics.find(x => x.code === DiagnosticMessages.tupleRequiredElementAfterOptional().code);
            expect(ordering).to.exist;
            expect(ordering.location?.range).to.exist;
        });

        it('does not affect array literals or indexing', () => {
            const parser = parse(`
                sub main(items)
                    first = items[0]
                    pair = [1, 2]
                    print first; pair
                end sub
            `);
            expectZeroDiagnostics(parser);
            expect(parser.ast.findChildren(isTupleTypeExpression, { walkMode: WalkMode.visitAllRecursive })).to.be.empty;
        });

        it('clones a tuple type', () => {
            const tuple = getTuple(parseParamType('[string, integer?, ...float[]]'));
            const clone = tuple.clone();
            expect(clone).to.not.equal(tuple);
            expect(util.getTypeExpressionName(clone)).to.eql('[string, integer?, ...float[]]');
            expect(clone.elements.map(x => x.isOptional)).to.eql([false, true, false]);
            expect(clone.elements.map(x => x.isRest)).to.eql([false, false, true]);
            expect(clone.elements[0].parent).to.equal(clone);
        });
    });

    describe('validation', () => {
        it('validates the type names inside a tuple', () => {
            program.setFile('source/main.bs', `
                interface Person
                    name as string
                end interface
                sub main(value as [Person, Missing])
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Missing').message
            ]);
        });
    });

    describe('transpile', () => {
        it('transpiles tuple types to dynamic', async () => {
            await testTranspile(`
                function split(pair as [string, integer], rest as [string, ...integer[]]) as [string, string]
                    other = pair as [string, integer]
                    return ["a", "b"]
                end function
            `, `
                function split(pair as dynamic, rest as dynamic) as dynamic
                    other = pair
                    return [
                        "a"
                        "b"
                    ]
                end function
            `);
        });

        it('emits tuple types as dynamic in typedefs, the same as typed arrays', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(pair as [string, integer], items as string[])
                end sub
            `);
            expect(file.getTypedef().trim()).to.eql('sub main(pair as dynamic, items as dynamic)\nend sub');
        });
    });
});
