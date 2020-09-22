/* eslint-disable no-multi-spaces */
import { Position } from 'vscode-languageserver';
import { expect } from 'chai';
import { PrintStatement, Block, Body, AssignmentStatement, CommentStatement, ExitForStatement, ExitWhileStatement, ExpressionStatement, FunctionStatement, IfStatement, IncrementStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement } from '../parser/Statement';
import { FunctionExpression, NamespacedVariableNameExpression, BinaryExpression, CallExpression, DottedGetExpression, IndexedGetExpression, GroupingExpression, LiteralExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, XmlAttributeGetExpression, TemplateStringExpression, TaggedTemplateStringExpression } from '../parser/Expression';
import { TokenKind, Token } from '../lexer';
import { BrsString } from '../brsTypes';
import { isPrintStatement, isIfStatement, isBody, isAssignmentStatement, isBlock, isExpressionStatement, isCommentStatement, isExitForStatement, isExitWhileStatement, isFunctionStatement, isIncrementStatement, isGotoStatement, isLabelStatement, isReturnStatement, isEndStatement, isStopStatement, isForStatement, isForEachStatement, isWhileStatement, isDottedSetStatement, isIndexedSetStatement, isLibraryStatement, isNamespaceStatement, isImportStatement, isExpression, isBinaryExpression, isCallExpression, isFunctionExpression, isNamespacedVariableNameExpression, isDottedGetExpression, isXmlAttributeGetExpression, isIndexedGetExpression, isGroupingExpression, isLiteralExpression, isEscapedCharCodeLiteral, isArrayLiteralExpression, isAALiteralExpression, isUnaryExpression, isVariableExpression, isSourceLiteralExpression, isNewExpression, isCallfuncExpression, isTemplateStringQuasiExpression, isTemplateStringExpression, isTaggedTemplateStringExpression, isBrsFile, isXmlFile, isClassStatement } from './reflection';
import { createRange, createToken, createStringLiteral, createIdentifier } from './creators';
import { Program } from '../Program';
import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';
import { ClassStatement } from '../parser/ClassStatement';

describe('reflection', () => {
    describe('Files', () => {
        const program = new Program({});
        const file = new BrsFile('path/to/source/file.brs', 'pkg:/source/file.brs', program);
        const comp = new XmlFile('path/to/components/file.xml', 'pkg:/components/file.brs', program);
        expect(isBrsFile(file)).to.be.true;
        expect(isXmlFile(file)).to.be.false;
        expect(isBrsFile(comp)).to.be.false;
        expect(isXmlFile(comp)).to.be.true;
    });

    describe('Statements', () => {
        let body: Body;
        let assignment: AssignmentStatement;
        let block: Block;
        let expression: ExpressionStatement;
        let comment: CommentStatement;
        let exitFor: ExitForStatement;
        let exitWhile: ExitWhileStatement;
        let funs: FunctionStatement;
        let ifs: IfStatement;
        let increment: IncrementStatement;
        let print: PrintStatement;
        let gotos: GotoStatement;
        let labels: LabelStatement;
        let returns: ReturnStatement;
        let ends: EndStatement;
        let stop: StopStatement;
        let fors: ForStatement;
        let foreach: ForEachStatement;
        let whiles: WhileStatement;
        let dottedSet: DottedSetStatement;
        let indexedSet: IndexedSetStatement;
        let library: LibraryStatement;
        let namespace: NamespaceStatement;
        let cls: ClassStatement;
        let imports: ImportStatement;

        before(() => {
            const pos = Position.create(0, 0);
            const range = createRange(pos);
            const ident = createToken(TokenKind.Identifier, pos, 'a');
            const expr = createStringLiteral('', pos);
            const token = createToken(TokenKind.StringLiteral, pos, '');
            body = new Body([]);
            assignment = new AssignmentStatement(undefined, ident, expr, undefined);
            block = new Block([], range);
            expression = new ExpressionStatement(expr);
            comment = new CommentStatement([token]);
            exitFor = new ExitForStatement({ exitFor: token });
            exitWhile = new ExitWhileStatement({ exitWhile: token });
            funs = new FunctionStatement(ident, new FunctionExpression([], undefined, block, token, token, token, token), undefined);
            ifs = new IfStatement({ if: token }, expr, block, []);
            increment = new IncrementStatement(expr, token);
            print = new PrintStatement({ print: token }, []);
            gotos = new GotoStatement({ goto: token, label: token });
            labels = new LabelStatement({ identifier: ident, colon: token });
            returns = new ReturnStatement({ return: token });
            ends = new EndStatement({ end: token });
            stop = new StopStatement({ stop: token });
            fors = new ForStatement({ for: token, to: token, endFor: token }, assignment, expr, expr, block);
            foreach = new ForEachStatement({ forEach: token, in: token, endFor: token }, token, expr, block);
            whiles = new WhileStatement({ while: token, endWhile: token }, expr, block);
            dottedSet = new DottedSetStatement(expr, ident, expr);
            indexedSet = new IndexedSetStatement(expr, expr, expr, token, token);
            library = new LibraryStatement({ library: token, filePath: token });
            namespace = new NamespaceStatement(token, new NamespacedVariableNameExpression(createIdentifier('a', pos)), body, token);
            cls = new ClassStatement(token, ident, [], token);
            imports = new ImportStatement(token, token);
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
        it('isCommentStatement', () => {
            expect(isCommentStatement(comment)).to.be.true;
            expect(isCommentStatement(body)).to.be.false;
        });
        it('isExitForStatement', () => {
            expect(isExitForStatement(exitFor)).to.be.true;
            expect(isExitForStatement(body)).to.be.false;
        });
        it('isExitWhileStatement', () => {
            expect(isExitWhileStatement(exitWhile)).to.be.true;
            expect(isExitWhileStatement(body)).to.be.false;
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
    });

    describe('Expressions', () => {
        let binary: BinaryExpression;
        let call: CallExpression;
        let fun: FunctionExpression;
        let nsVar: NamespacedVariableNameExpression;
        let dottedGet: DottedGetExpression;
        let xmlAttrGet: XmlAttributeGetExpression;
        let indexedGet: IndexedGetExpression;
        let grouping: GroupingExpression;
        let literal: LiteralExpression;
        let escapedCarCode: EscapedCharCodeLiteralExpression;
        let arrayLit: ArrayLiteralExpression;
        let aaLit: AALiteralExpression;
        let unary: UnaryExpression;
        let variable: VariableExpression;
        let sourceLit: SourceLiteralExpression;
        let newx: NewExpression;
        let callfunc: CallfuncExpression;
        let tplQuasi: TemplateStringQuasiExpression;
        let tplString: TemplateStringExpression;
        let taggedTpl: TaggedTemplateStringExpression;

        before(() => {
            const pos = Position.create(0, 0);
            const range = createRange(pos);
            const ident = createToken(TokenKind.Identifier, pos, 'a');
            const expr = createStringLiteral('', pos);
            const token = createToken(TokenKind.StringLiteral, pos, '');
            const value = new BrsString('');
            const block = new Block([], range);
            const charCode: Token & { charCode: number } = {
                kind: TokenKind.EscapedCharCodeLiteral,
                text: '0',
                range: range,
                isReserved: false,
                charCode: 0
            };
            nsVar = new NamespacedVariableNameExpression(createIdentifier('a', pos));
            binary = new BinaryExpression(expr, token, expr);
            call = new CallExpression(expr, token, token, [], undefined);
            fun = new FunctionExpression([], undefined, block, token, token, token, token);
            dottedGet = new DottedGetExpression(expr, ident, token);
            xmlAttrGet = new XmlAttributeGetExpression(expr, ident, token);
            indexedGet = new IndexedGetExpression(expr, expr, token, token);
            grouping = new GroupingExpression({ left: token, right: token }, expr);
            literal = new LiteralExpression(value, range);
            escapedCarCode = new EscapedCharCodeLiteralExpression(charCode);
            arrayLit = new ArrayLiteralExpression([], token, token);
            aaLit = new AALiteralExpression([], token, token);
            unary = new UnaryExpression(token, expr);
            variable = new VariableExpression(ident, undefined);
            sourceLit = new SourceLiteralExpression(token);
            newx = new NewExpression(token, call);
            callfunc = new CallfuncExpression(expr, token, ident, token, [], token);
            tplQuasi = new TemplateStringQuasiExpression([expr]);
            tplString = new TemplateStringExpression(token, [tplQuasi], [], token);
            taggedTpl = new TaggedTemplateStringExpression(ident, token, [tplQuasi], [], token);
        });

        it('isExpression', () => {
            expect(isExpression(binary)).to.be.true;
            expect(isExpression(binary.operator)).to.be.false;
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
        it('isNamespacedVariableNameExpression', () => {
            expect(isNamespacedVariableNameExpression(nsVar)).to.be.true;
            expect(isNamespacedVariableNameExpression(fun)).to.be.false;
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
            expect(isEscapedCharCodeLiteral(escapedCarCode)).to.be.true;
            expect(isEscapedCharCodeLiteral(fun)).to.be.false;
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
    });
});
