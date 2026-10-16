import { expect } from '../../../chai-config.spec';
import { Parser, ParseMode } from '../../Parser';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import { isFunctionStatement, isTupleTypeElementExpression, isTupleTypeExpression, isTypedArrayExpression, isTypeExpression, isTypeStatement } from '../../../astUtils/reflection';
import type { TupleTypeElementExpression, TupleTypeExpression, TypeExpression } from '../../Expression';
import type { FunctionStatement, TypeStatement } from '../../Statement';
import { Program } from '../../../Program';
import type { BrsFile } from '../../../files/BrsFile';
import { util } from '../../../util';
import { WalkMode } from '../../../astUtils/visitors';
import type { Location } from 'vscode-languageserver';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';

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

        it('parses tuples in class fields, interface members, inline interfaces, and typed function types', () => {
            const parser = parse(`
                class Foo
                    pair as [string, integer]
                end class
                interface Bar
                    pair as [string, integer]
                end interface
                sub main(a as { pair as [string, integer] }, cb as function(p as [string, integer]) as [string, string])
                end sub
            `);
            expectZeroDiagnostics(parser);
            const tuples = parser.ast.findChildren(isTupleTypeExpression, { walkMode: WalkMode.visitAllRecursive });
            expect(tuples.map(x => util.getTypeExpressionName(x)).sort()).to.eql([
                '[string, integer]',
                '[string, integer]',
                '[string, integer]',
                '[string, integer]',
                '[string, string]'
            ]);
        });

        it('parses grouping, typed function, keyword, and multidimensional element types', () => {
            expect(parseParamType('[(string or integer), boolean]').getName()).to.eql('[(string or integer), boolean]');
            expect(parseParamType('[function(a as integer) as string, integer]').getName()).to.eql('[function(a as integer) as string, integer]');
            expect(parseParamType('[object, dynamic, boolean, float, double, longinteger, void?]').getName()).to.eql('[object, dynamic, boolean, float, double, longinteger, void?]');
            expect(parseParamType('[string, ...integer[][]]').getName()).to.eql('[string, ...integer[][]]');
        });

        it('allows comments inside a multi-line tuple', () => {
            const typeExpression = parseParamType(`[
                string, ' the name
                ' the count
                integer
            ]`);
            expect(typeExpression.getName()).to.eql('[string, integer]');
        });

        it('parses a parenthesized tuple typecast followed by an index, and a colon after a typed assignment', () => {
            const parser = parse(`
                sub main(data)
                    first = (data as [string, integer])[0]
                    pair as [string, integer] = ["a", 1] : print pair; first
                end sub
            `);
            expectZeroDiagnostics(parser);
        });

        it('reports malformed elements and still parses the following function', () => {
            for (const bad of ['[string, , integer]', '[, string]', '[string, ...]', '[?]']) {
                const parser = parse(`
                    sub main(value as ${bad})
                    end sub
                    sub other()
                    end sub
                `);
                expect(parser.diagnostics, bad).to.not.be.empty;
                expect(parser.ast.statements.map(x => (x as FunctionStatement).tokens.name.text), bad).to.eql(['other']);
            }
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

        it('clones an element whose type was skipped in plain brightscript', () => {
            const parser = parse(`
                sub main(value as [Foo, integer])
                end sub
            `, ParseMode.BrightScript);
            const elements = parser.ast.findChildren<TupleTypeElementExpression>(isTupleTypeElementExpression, { walkMode: WalkMode.visitAllRecursive });
            expect(elements[0].typeExpression).to.be.undefined;
            const clone = elements[0].clone();
            expect(clone.typeExpression).to.be.undefined;
            expect(elements[1].clone().typeExpression.getName()).to.eql('integer');
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
        it('types a tuple as an array of its element types, using the item type of a rest element', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                type Nums = integer[]
                sub main(fixed as [string, integer], rest as [string, ...integer[]], aliasRest as [string, ...Nums])
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[1] as FunctionStatement;
            const typeOf = (index: number) => func.func.parameters[index].getType({ flags: SymbolTypeFlag.typetime }).toString();
            expect(typeOf(0)).to.eql('Array<string or integer>');
            expect(typeOf(1)).to.eql('Array<string or integer>');
            expect(typeOf(2)).to.eql('Array<string or integer>');
        });

        it('supports hover, go-to-definition, and completions for a type name inside a tuple', () => {
            program.setFile('source/main.bs', [
                'interface Person',
                '    name as string',
                'end interface',
                'sub main(people as [Person, integer])',
                'end sub'
            ].join('\n'));
            program.validate();
            //`Person` occupies columns 20-25 on line 3
            const hover = program.getHover('source/main.bs', util.createPosition(3, 22));
            expect(hover?.[0]?.contents).to.eql(['```brightscript\ninterface Person\n```']);
            const definitions = program.getDefinition('source/main.bs', util.createPosition(3, 22));
            expect(definitions.map(x => (x as Location).range.start.line)).to.eql([0]);
            //completions in the middle of the name should offer type names, not runtime variables
            const completions = program.getCompletions('source/main.bs', util.createPosition(3, 23));
            expect(completions.map(x => x.label)).to.include('Person');
        });

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
                type Pair = [string, integer]
                function main(pair as [string, integer], items as string[]) as [string, string]
                    return ["a", "b"]
                end function
            `);
            expect(file.getTypedef().trim()).to.eql('type Pair = dynamic\nfunction main(pair as dynamic, items as dynamic) as dynamic\nend function');
        });
    });
});
