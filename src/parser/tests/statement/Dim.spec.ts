import { expect } from 'chai';
import type { DimStatement } from '../..';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { LiteralExpression } from '../../Expression';
import { Parser } from '../../Parser';
import { identifier } from '../Parser.spec';

describe.only('parser DimStatement', () => {
    it('parses properly', () => {
        validatePass(`Dim c[5]`, 0, 'c',  1)
        validatePass(`Dim c[5, 4]`, 0, 'c',  2)
        validatePass(`Dim c[5, 4, 6]`, 0, 'c',  3)
        validatePass(`Dim requestData[requestList.count()]`, 0, 'requestData',  1)
        validatePass(`Dim requestData[1, requestList.count()]`, 0, 'requestData',  2)
        validatePass(`Dim requestData[1, requestList.count(), 2]`, 0, 'requestData',  3)
        validatePass(`Dim requestData[requestList[2]]`, 0, 'requestData',  1)
        validatePass(`Dim requestData[1, requestList[2]]`, 0, 'requestData',  2)
        validatePass(`Dim requestData[1, requestList[2], 2]`, 0, 'requestData',  3)
        validatePass(`Dim requestData[requestList["2"]]`, 0, 'requestData',  1)
        validatePass(`Dim requestData[1, requestList["2"]]`, 0, 'requestData',  2)
        validatePass(`Dim requestData[1, requestList["2"], 2]`, 0, 'requestData',  3)
        validatePass(`Dim requestData[1, getValue({
            key: "value"
        }), 2]`, 0, 'requestData',  3)
    });

    it('flags missing expression after dim', () => {
        const parser = Parser.parse(`Dim `);
        const dimStatement = (parser.ast.statements[0] as DimStatement);
        //the statement should still exist and have null identifier
        expect(dimStatement).to.exist;
        expect(dimStatement.dimensions).to.not.exist;
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.missingExpressionAfterDimKeyword().message);
    });

    it('flags missing identifier after dim', () => {
        const parser = Parser.parse(`Dim [5]`);
        const dimStatement = (parser.ast.statements[0] as DimStatement);
        //the statement should still exist and have null identifier
        expect(dimStatement).to.exist;
        expect(dimStatement.identifier).to.not.exist;
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.expectedIdentifierAfterKeyword('dim').message);
    });

    it('flags missing left bracket', () => {
        const parser = Parser.parse(`Dim c]`);
        const dimStatement = (parser.ast.statements[0] as DimStatement);
        //the statement should still exist and have null dimensions
        expect(dimStatement).to.exist;
        expect(dimStatement.openingSquare).to.not.exist;
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.missingLeftBracketAfterDimIdentifier().message);
    });

    it('flags missing right bracket', () => {
        const parser = Parser.parse(`Dim c[5, 5`);
        const dimStatement = (parser.ast.statements[0] as DimStatement);
        //the statement should still exist and have null dimensions
        expect(dimStatement).to.exist;
        expect(dimStatement.closingSquare).to.not.exist;
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.missingRightBracketAfterDimIdentifier().message);
    });

    it('flags missing expressions', () => {
        const parser = Parser.parse(`Dim c[]`);
        const dimStatement = (parser.ast.statements[0] as DimStatement);
        //the statement should still exist and have null dimensions
        expect(dimStatement).to.exist;
        expect(dimStatement.dimensions).to.not.exist;
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.missingExpressionsInDimStatement().message);
    });

    it('flags missing commas in expression', () => {
        const parser = Parser.parse(`Dim c[5 6 7]`);
        const dimStatement = (parser.ast.statements[0] as DimStatement);
        //the statement should still exist and have null dimensions
        expect(dimStatement).to.exist;
        expect(dimStatement.dimensions).to.not.exist;
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.missingExpressionsInDimStatement().message);
    });
});

function validatePass(text: string, dimStatementIndex: number, identifierText: string, dimensionsCount: number) {
    const parser = Parser.parse(text);
    const dimStatement = (parser.ast.statements[dimStatementIndex] as DimStatement);
    expect(dimStatement).to.exist;
    expect(dimStatement.dimToken).to.exist;
    expect(dimStatement.identifier).to.exist;
    expect(dimStatement.identifier.text).to.equal(identifierText);
    expect(dimStatement.openingSquare).to.exist;
    expect(dimStatement.dimensions).to.exist;
    expect(dimStatement.dimensions.length).to.equal(dimensionsCount);
    expect(dimStatement.closingSquare).to.exist;
    expect(dimStatement.range).to.exist;
}