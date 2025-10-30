import { expect } from '../../../chai-config.spec';
import { Parser } from '../../Parser';
import type { AssignmentStatement } from '../../Statement';
import type { AALiteralExpression, AAIndexedMemberExpression } from '../../Expression';
import { isAAIndexedMemberExpression, isAALiteralExpression, isAssignmentStatement, isDottedGetExpression, isVariableExpression } from '../../../astUtils/reflection';

describe('parser AAIndexedMemberExpression', () => {
    describe('basic syntax', () => {
        it('parses single indexed member', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY]: "value1"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.lengthOf(1);
            expect(isAssignmentStatement(statements[0])).to.be.true;
            const assignStmt = statements[0] as AssignmentStatement;
            expect(isAALiteralExpression(assignStmt.value)).to.be.true;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(1);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.true;
            const indexedMember = aaLiteral.elements[0] as AAIndexedMemberExpression;
            expect(isDottedGetExpression(indexedMember.keyExpression)).to.be.true;
        });

        it('parses indexed member with variable', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [MY_CONST]: "value1"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.lengthOf(1);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(1);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.true;
            const indexedMember = aaLiteral.elements[0] as AAIndexedMemberExpression;
            expect(isVariableExpression(indexedMember.keyExpression)).to.be.true;
        });
    });

    describe('mixed members', () => {
        it('parses indexed member at the start', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY1]: "value1",
                    normalKey: "value2",
                    anotherKey: "value3"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(3);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.true;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[1])).to.be.false;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[2])).to.be.false;
        });

        it('parses indexed member in the middle', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    normalKey: "value1",
                    [myEnum.KEY2]: "value2",
                    anotherKey: "value3"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(3);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.false;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[1])).to.be.true;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[2])).to.be.false;
        });

        it('parses indexed member at the end', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    normalKey: "value1",
                    anotherKey: "value2",
                    [myEnum.KEY3]: "value3"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(3);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.false;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[1])).to.be.false;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[2])).to.be.true;
        });

        it('parses multiple indexed members', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY1]: "value1",
                    [myEnum.KEY2]: "value2",
                    [myEnum.KEY3]: "value3"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(3);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.true;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[1])).to.be.true;
            expect(isAAIndexedMemberExpression(aaLiteral.elements[2])).to.be.true;
        });
    });

    describe('nested AA literals', () => {
        it('parses indexed members in nested AAs', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY1]: {
                        [myEnum.KEY2]: {
                            [myEnum.KEY3]: "value"
                        }
                    }
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(1);
            expect(isAAIndexedMemberExpression(aaLiteral.elements[0])).to.be.true;
            
            const level1Member = aaLiteral.elements[0] as AAIndexedMemberExpression;
            expect(isAALiteralExpression(level1Member.value)).to.be.true;
            
            const level2AA = level1Member.value as AALiteralExpression;
            expect(isAAIndexedMemberExpression(level2AA.elements[0])).to.be.true;
            
            const level2Member = level2AA.elements[0] as AAIndexedMemberExpression;
            expect(isAALiteralExpression(level2Member.value)).to.be.true;
            
            const level3AA = level2Member.value as AALiteralExpression;
            expect(isAAIndexedMemberExpression(level3AA.elements[0])).to.be.true;
        });

        it('parses mixed indexed and normal members in nested AAs', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    normalKey1: {
                        [myEnum.KEY1]: "value1",
                        normalKey2: "value2"
                    },
                    [myEnum.KEY2]: {
                        normalKey3: "value3"
                    }
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            expect(aaLiteral.elements).to.be.lengthOf(2);
        });
    });

    describe('formatting variations', () => {
        it('parses indexed member on single line', () => {
            const { diagnostics } = Parser.parse(`
                myAA = { [myEnum.KEY]: "value" }
            `);
            expect(diagnostics).to.be.lengthOf(0);
        });

        it('parses indexed member without commas', () => {
            const { diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY1]: "value1"
                    [myEnum.KEY2]: "value2"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
        });

        it('captures commas for indexed members', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY1]: "value1",
                    [myEnum.KEY2]: "value2"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            const member1 = aaLiteral.elements[0] as AAIndexedMemberExpression;
            const member2 = aaLiteral.elements[1] as AAIndexedMemberExpression;
            expect(member1.commaToken).to.exist;
            expect(member2.commaToken).to.not.exist;
        });
    });

    describe('complex key expressions', () => {
        it('parses dotted get expression as key', () => {
            const { statements, diagnostics } = Parser.parse(`
                myAA = {
                    [myNamespace.myEnum.KEY]: "value"
                }
            `);
            expect(diagnostics).to.be.lengthOf(0);
            const assignStmt = statements[0] as AssignmentStatement;
            const aaLiteral = assignStmt.value as AALiteralExpression;
            const indexedMember = aaLiteral.elements[0] as AAIndexedMemberExpression;
            expect(isDottedGetExpression(indexedMember.keyExpression)).to.be.true;
        });
    });

    describe('parser error cases', () => {
        it('reports error for missing closing bracket', () => {
            const { diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY: "value"
                }
            `);
            expect(diagnostics.length).to.be.greaterThan(0);
            expect(diagnostics.some(d => d.message.includes(']'))).to.be.true;
        });

        it('reports error for missing colon after bracket', () => {
            const { diagnostics } = Parser.parse(`
                myAA = {
                    [myEnum.KEY] "value"
                }
            `);
            expect(diagnostics.length).to.be.greaterThan(0);
        });
    });
});
