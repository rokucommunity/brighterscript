/* eslint-disable no-multi-spaces */
import { expect } from '../chai-config.spec';
import { PrintStatement, Block, Body, AssignmentStatement, ExpressionStatement, FunctionStatement, IfStatement, IncrementStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassStatement, EmptyStatement, TryCatchStatement, CatchStatement, ThrowStatement, ExitStatement } from '../parser/Statement';
import { FunctionExpression, BinaryExpression, CallExpression, DottedGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, XmlAttributeGetExpression, TemplateStringExpression, TaggedTemplateStringExpression, AnnotationExpression } from '../parser/Expression';
import type { Token } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import { isPrintStatement, isIfStatement, isBody, isAssignmentStatement, isBlock, isExpressionStatement, isFunctionStatement, isIncrementStatement, isGotoStatement, isLabelStatement, isReturnStatement, isEndStatement, isStopStatement, isForStatement, isForEachStatement, isWhileStatement, isDottedSetStatement, isIndexedSetStatement, isLibraryStatement, isNamespaceStatement, isImportStatement, isExpression, isBinaryExpression, isCallExpression, isFunctionExpression, isDottedGetExpression, isXmlAttributeGetExpression, isIndexedGetExpression, isGroupingExpression, isLiteralExpression, isEscapedCharCodeLiteralExpression, isArrayLiteralExpression, isAALiteralExpression, isUnaryExpression, isVariableExpression, isSourceLiteralExpression, isNewExpression, isCallfuncExpression, isTemplateStringQuasiExpression, isTemplateStringExpression, isTaggedTemplateStringExpression, isBrsFile, isXmlFile, isClassStatement, isStatement, isAnnotationExpression, isTryCatchStatement, isCatchStatement, isThrowStatement, isLiteralInvalid, isLiteralBoolean, isLiteralNumber, isLiteralInteger, isLiteralLongInteger, isLiteralFloat, isLiteralDouble, isExitStatement } from './reflection';
import { createToken, createStringLiteral, createInvalidLiteral, createBooleanLiteral, createIntegerLiteral, createVariableExpression, createFloatLiteral, createDoubleLiteral, createLongIntegerLiteral } from './creators';
import { Program } from '../Program';
import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';

describe('reflection', () => {
    describe('Files', () => {
        it('recognizes files', () => {
            const program = new Program({});
            const file = new BrsFile({ srcPath: 'path/to/source/file.brs', destPath: 'source/file.brs', program: program });
            const comp = new XmlFile({ srcPath: 'path/to/components/file.xml', destPath: 'components/file.brs', program: program });
            expect(isBrsFile(file)).to.be.true;
            expect(isXmlFile(file)).to.be.false;
            expect(isBrsFile(comp)).to.be.false;
            expect(isXmlFile(comp)).to.be.true;
        });
    });

    describe('Statements', () => {
        const ident = createToken(TokenKind.Identifier, 'a');
        const expr = createStringLiteral('');
        const token = createToken(TokenKind.StringLiteral, '');
        const body = new Body({ statements: [] });
        const assignment = new AssignmentStatement({ equals: undefined, name: ident, value: expr });
        const block = new Block({ statements: [] });
        const expression = new ExpressionStatement({ expression: expr });
        const exit = new ExitStatement({ exit: token, loopType: token });
        const funs = new FunctionStatement({
            name: ident,
            func: new FunctionExpression({
                parameters: [],
                body: block,
                functionType: token,
                leftParen: token,
                rightParen: token,
                endFunctionType: token
            })
        });
        const ifs = new IfStatement({ if: token, condition: expr, thenBranch: block });
        const increment = new IncrementStatement({ value: expr, operator: token });
        const print = new PrintStatement({ print: token, expressions: [] });
        const gotos = new GotoStatement({ goto: token, label: token });
        const labels = new LabelStatement({ name: ident, colon: token });
        const returns = new ReturnStatement({ return: token });
        const ends = new EndStatement({ end: token });
        const stop = new StopStatement({ stop: token });
        const fors = new ForStatement({ for: token, counterDeclaration: assignment, to: token, finalValue: expr, body: block, endFor: token, step: token, increment: expr });
        const foreach = new ForEachStatement({ forEach: token, in: token, endFor: token, item: token, target: expr, body: block });
        const whiles = new WhileStatement({ while: token, endWhile: token, condition: expr, body: block });
        const dottedSet = new DottedSetStatement({ obj: expr, name: ident, value: expr });
        const indexedSet = new IndexedSetStatement({ obj: expr, indexes: [expr], value: expr, openingSquare: token, closingSquare: token });
        const library = new LibraryStatement({ library: token, filePath: token });
        const namespace = new NamespaceStatement({ namespace: token, nameExpression: createVariableExpression('a'), body: body, endNamespace: token });
        const cls = new ClassStatement({ class: token, name: ident, body: [], endClass: token });
        const imports = new ImportStatement({ import: token, path: token });
        const catchStmt = new CatchStatement({ catch: token, exceptionVariable: ident, catchBranch: block });
        const tryCatch = new TryCatchStatement({ try: token, tryBranch: block, catchStatement: catchStmt });
        const throwSt = new ThrowStatement({ throw: createToken(TokenKind.Throw) });

        it('isStatement', () => {
            expect(isStatement(library)).to.be.true;
            expect(
                isStatement(
                    createStringLiteral('test')
                )
            ).to.be.false;
            //doesn't fail for undefined
            expect(isStatement(undefined)).to.be.false;
        });

        it('isBody', () => {
            expect(isBody(body)).to.be.true;
            expect(isBody(assignment)).to.be.false;
        });
        it('isAssignmentStatement', () => {
            expect(isAssignmentStatement(assignment)).to.be.true;
            expect(isAssignmentStatement(body)).to.be.false;
        });
        it('isBlock', () => {
            expect(isBlock(block)).to.be.true;
            expect(isBlock(body)).to.be.false;
        });
        it('isExpressionStatement', () => {
            expect(isExpressionStatement(expression)).to.be.true;
            expect(isExpressionStatement(body)).to.be.false;
        });
        it('isExitStatement', () => {
            expect(isExitStatement(exit)).to.be.true;
            expect(isExitStatement(body)).to.be.false;
        });
        it('isFunctionStatement', () => {
            expect(isFunctionStatement(funs)).to.be.true;
            expect(isFunctionStatement(body)).to.be.false;
        });
        it('isIfStatement', () => {
            expect(isIfStatement(ifs)).to.be.true;
            expect(isIfStatement(body)).to.be.false;
        });
        it('isIncrementStatement', () => {
            expect(isIncrementStatement(increment)).to.be.true;
            expect(isIncrementStatement(body)).to.be.false;
        });
        it('isPrintStatement', () => {
            expect(isPrintStatement(print)).to.be.true;
            expect(isPrintStatement(body)).to.be.false;
        });
        it('isGotoStatement', () => {
            expect(isGotoStatement(gotos)).to.be.true;
            expect(isGotoStatement(body)).to.be.false;
        });
        it('isLabelStatement', () => {
            expect(isLabelStatement(labels)).to.be.true;
            expect(isLabelStatement(body)).to.be.false;
        });
        it('isReturnStatement', () => {
            expect(isReturnStatement(returns)).to.be.true;
            expect(isReturnStatement(body)).to.be.false;
        });
        it('isEndStatement', () => {
            expect(isEndStatement(ends)).to.be.true;
            expect(isEndStatement(body)).to.be.false;
        });
        it('isStopStatement', () => {
            expect(isStopStatement(stop)).to.be.true;
            expect(isStopStatement(body)).to.be.false;
        });
        it('isForStatement', () => {
            expect(isForStatement(fors)).to.be.true;
            expect(isForStatement(body)).to.be.false;
        });
        it('isForEachStatement', () => {
            expect(isForEachStatement(foreach)).to.be.true;
            expect(isForEachStatement(body)).to.be.false;
        });
        it('isWhileStatement', () => {
            expect(isWhileStatement(whiles)).to.be.true;
            expect(isWhileStatement(body)).to.be.false;
        });
        it('isDottedSetStatement', () => {
            expect(isDottedSetStatement(dottedSet)).to.be.true;
            expect(isDottedSetStatement(body)).to.be.false;
        });
        it('isIndexedSetStatement', () => {
            expect(isIndexedSetStatement(indexedSet)).to.be.true;
            expect(isIndexedSetStatement(body)).to.be.false;
        });
        it('isLibraryStatement', () => {
            expect(isLibraryStatement(library)).to.be.true;
            expect(isLibraryStatement(body)).to.be.false;
        });
        it('isNamespaceStatement', () => {
            expect(isNamespaceStatement(namespace)).to.be.true;
            expect(isNamespaceStatement(body)).to.be.false;
        });
        it('isClassStatement', () => {
            expect(isClassStatement(cls)).to.be.true;
            expect(isClassStatement(body)).to.be.false;
        });
        it('isImportStatement', () => {
            expect(isImportStatement(imports)).to.be.true;
            expect(isImportStatement(body)).to.be.false;
        });
        it('isTryCatchStatement', () => {
            expect(isTryCatchStatement(tryCatch)).to.be.true;
            expect(isTryCatchStatement(body)).to.be.false;
        });
        it('isCatchStatement', () => {
            expect(isCatchStatement(catchStmt)).to.be.true;
            expect(isCatchStatement(body)).to.be.false;
        });
        it('isThrowStatement', () => {
            expect(isThrowStatement(throwSt)).to.be.true;
            expect(isThrowStatement(body)).to.be.false;
        });
    });

    describe('Expressions', () => {
        const ident = createToken(TokenKind.Identifier, 'a');
        const expr = createStringLiteral('');
        const token = createToken(TokenKind.StringLiteral, '');
        const block = new Block({ statements: [] });
        const charCode: Token & { charCode: number } = {
            kind: TokenKind.EscapedCharCodeLiteral,
            text: '0',
            location: undefined,
            isReserved: false,
            charCode: 0,
            leadingWhitespace: '',
            leadingTrivia: []
        };

        const binary = new BinaryExpression({ left: expr, operator: token, right: expr });
        const call = new CallExpression({ callee: expr, openingParen: token, closingParen: token, args: [] });
        const fun = new FunctionExpression({
            parameters: [],
            body: block,
            functionType: token,
            leftParen: token,
            rightParen: token,
            endFunctionType: token
        });
        const dottedGet = new DottedGetExpression({ obj: expr, name: ident, dot: token });
        const xmlAttrGet = new XmlAttributeGetExpression({ obj: expr, name: ident, at: token });
        const indexedGet = new IndexedGetExpression({ obj: expr, indexes: [expr], openingSquare: token, closingSquare: token });
        const grouping = new GroupingExpression({ leftParen: token, rightParen: token, expression: expr });
        const literal = createStringLiteral('test');
        const escapedCarCode = new EscapedCharCodeLiteralExpression({ value: charCode });
        const arrayLit = new ArrayLiteralExpression({ elements: [], open: token, close: token });
        const aaLit = new AALiteralExpression({ elements: [], open: token, close: token });
        const unary = new UnaryExpression({ operator: token, right: expr });
        const variable = new VariableExpression({ name: ident });
        const sourceLit = new SourceLiteralExpression({ value: token });
        const newx = new NewExpression({ new: token, call: call });
        const callfunc = new CallfuncExpression({ callee: expr, operator: token, methodName: ident, openingParen: token, args: [], closingParen: token });
        const tplQuasi = new TemplateStringQuasiExpression({ expressions: [expr] });
        const tplString = new TemplateStringExpression({ openingBacktick: token, quasis: [tplQuasi], expressions: [], closingBacktick: token });
        const taggedTpl = new TaggedTemplateStringExpression({ tagName: ident, openingBacktick: token, quasis: [tplQuasi], expressions: [], closingBacktick: token });
        const annotation = new AnnotationExpression({ at: token, name: token });

        it('isExpression', () => {
            expect(isExpression(binary)).to.be.true;
            expect(isExpression(binary.tokens.operator as any)).to.be.false;
        });
        it('isBinaryExpression', () => {
            expect(isBinaryExpression(binary)).to.be.true;
            expect(isBinaryExpression(fun)).to.be.false;
        });
        it('isCallExpression', () => {
            expect(isCallExpression(call)).to.be.true;
            expect(isCallExpression(fun)).to.be.false;
        });
        it('isFunctionExpression', () => {
            expect(isFunctionExpression(fun)).to.be.true;
            expect(isFunctionExpression(call)).to.be.false;
        });

        it('isDottedGetExpression', () => {
            expect(isDottedGetExpression(dottedGet)).to.be.true;
            expect(isDottedGetExpression(fun)).to.be.false;
        });
        it('iisXmlAttributeGetExpressions', () => {
            expect(isXmlAttributeGetExpression(xmlAttrGet)).to.be.true;
            expect(isXmlAttributeGetExpression(fun)).to.be.false;
        });
        it('isIndexedGetExpression', () => {
            expect(isIndexedGetExpression(indexedGet)).to.be.true;
            expect(isIndexedGetExpression(fun)).to.be.false;
        });
        it('isGroupingExpression', () => {
            expect(isGroupingExpression(grouping)).to.be.true;
            expect(isGroupingExpression(fun)).to.be.false;
        });
        it('isLiteralExpression', () => {
            expect(isLiteralExpression(literal)).to.be.true;
            expect(isLiteralExpression(fun)).to.be.false;
        });
        it('isEscapedCharCodeLiteral', () => {
            expect(isEscapedCharCodeLiteralExpression(escapedCarCode)).to.be.true;
            expect(isEscapedCharCodeLiteralExpression(fun)).to.be.false;
        });
        it('isArrayLiteralExpression', () => {
            expect(isArrayLiteralExpression(arrayLit)).to.be.true;
            expect(isArrayLiteralExpression(fun)).to.be.false;
        });
        it('isAALiteralExpression', () => {
            expect(isAALiteralExpression(aaLit)).to.be.true;
            expect(isAALiteralExpression(fun)).to.be.false;
        });
        it('isUnaryExpression', () => {
            expect(isUnaryExpression(unary)).to.be.true;
            expect(isUnaryExpression(fun)).to.be.false;
        });
        it('isVariableExpression', () => {
            expect(isVariableExpression(variable)).to.be.true;
            expect(isVariableExpression(fun)).to.be.false;
        });
        it('isSourceLiteralExpression', () => {
            expect(isSourceLiteralExpression(sourceLit)).to.be.true;
            expect(isSourceLiteralExpression(fun)).to.be.false;
        });
        it('isNewExpression', () => {
            expect(isNewExpression(newx)).to.be.true;
            expect(isNewExpression(fun)).to.be.false;
        });
        it('isCallfuncExpression', () => {
            expect(isCallfuncExpression(callfunc)).to.be.true;
            expect(isCallfuncExpression(fun)).to.be.false;
        });
        it('isTemplateStringQuasiExpression', () => {
            expect(isTemplateStringQuasiExpression(tplQuasi)).to.be.true;
            expect(isTemplateStringQuasiExpression(fun)).to.be.false;
        });
        it('isTemplateStringExpression', () => {
            expect(isTemplateStringExpression(tplString)).to.be.true;
            expect(isTemplateStringExpression(fun)).to.be.false;
        });
        it('isTaggedTemplateStringExpression', () => {
            expect(isTaggedTemplateStringExpression(taggedTpl)).to.be.true;
            expect(isTaggedTemplateStringExpression(fun)).to.be.false;
        });
        it('isAnnotationExpression', () => {
            expect(isAnnotationExpression(annotation)).to.be.true;
            expect(isAnnotationExpression(fun)).to.be.false;
        });

        it('isExpression', () => {
            expect(isExpression(call)).to.be.true;
            expect(isExpression(new EmptyStatement())).to.be.false;
            //doesn't fail for invalid param types
            expect(isExpression(undefined)).to.be.false;
            expect(isExpression(1 as any)).to.be.false;
        });
    });

    describe('isLiteralInvalid', () => {
        it('handles true cases', () => {
            expect(isLiteralInvalid(createInvalidLiteral('invalid'))).to.be.true;
            expect(isLiteralInvalid(createInvalidLiteral('Invalid'))).to.be.true;
            expect(isLiteralInvalid(createInvalidLiteral('INVALID'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralInvalid(createBooleanLiteral('true'))).to.be.false;
            expect(isLiteralInvalid(createIntegerLiteral('1'))).to.be.false;
            expect(isLiteralInvalid(createVariableExpression('cat'))).to.be.false;
        });
    });

    describe('isLiteralBoolean', () => {
        it('handles true cases', () => {
            expect(isLiteralBoolean(createBooleanLiteral('true'))).to.be.true;
            expect(isLiteralBoolean(createBooleanLiteral('TRUE'))).to.be.true;
            expect(isLiteralBoolean(createBooleanLiteral('false'))).to.be.true;
            expect(isLiteralBoolean(createBooleanLiteral('FALSE'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralBoolean(createInvalidLiteral('invalid'))).to.be.false;
            expect(isLiteralBoolean(createIntegerLiteral('1'))).to.be.false;
            expect(isLiteralBoolean(createVariableExpression('cat'))).to.be.false;
        });
    });

    describe('isLiteralNumber', () => {
        it('handles true cases', () => {
            expect(isLiteralNumber(createIntegerLiteral('1'))).to.be.true;
            expect(isLiteralNumber(createLongIntegerLiteral('1'))).to.be.true;
            expect(isLiteralNumber(createFloatLiteral('1.2'))).to.be.true;
            expect(isLiteralNumber(createDoubleLiteral('2.3'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralNumber(createInvalidLiteral('invalid'))).to.be.false;
            expect(isLiteralNumber(createBooleanLiteral('true'))).to.be.false;
            expect(isLiteralNumber(createVariableExpression('cat'))).to.be.false;
        });
    });

    describe('isLiteralInteger', () => {
        it('handles true cases', () => {
            expect(isLiteralInteger(createIntegerLiteral('1'))).to.be.true;
            expect(isLiteralInteger(createIntegerLiteral('100'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralInteger(createInvalidLiteral('invalid'))).to.be.false;
            expect(isLiteralInteger(createBooleanLiteral('true'))).to.be.false;
            expect(isLiteralInteger(createVariableExpression('cat'))).to.be.false;
        });
    });

    describe('isLiteralLongInteger', () => {
        it('handles true cases', () => {
            expect(isLiteralLongInteger(createLongIntegerLiteral('1'))).to.be.true;
            expect(isLiteralLongInteger(createLongIntegerLiteral('100'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralLongInteger(createInvalidLiteral('invalid'))).to.be.false;
            expect(isLiteralLongInteger(createBooleanLiteral('true'))).to.be.false;
            expect(isLiteralLongInteger(createVariableExpression('cat'))).to.be.false;
        });
    });

    describe('isLiteralFloat', () => {
        it('handles true cases', () => {
            expect(isLiteralFloat(createFloatLiteral('1.2'))).to.be.true;
            expect(isLiteralFloat(createFloatLiteral('1.234'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralFloat(createInvalidLiteral('invalid'))).to.be.false;
            expect(isLiteralFloat(createBooleanLiteral('true'))).to.be.false;
            expect(isLiteralFloat(createVariableExpression('cat'))).to.be.false;
        });
    });

    describe('isLiteralDouble', () => {
        it('handles true cases', () => {
            expect(isLiteralDouble(createDoubleLiteral('1.2'))).to.be.true;
            expect(isLiteralDouble(createDoubleLiteral('1.234'))).to.be.true;
        });
        it('handles false cases', () => {
            expect(isLiteralDouble(createInvalidLiteral('invalid'))).to.be.false;
            expect(isLiteralDouble(createBooleanLiteral('true'))).to.be.false;
            expect(isLiteralDouble(createVariableExpression('cat'))).to.be.false;
        });
    });
});
