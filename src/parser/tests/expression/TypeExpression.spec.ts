import { assert, expect } from '../../../chai-config.spec';
import { ParseMode } from '../../Parser';
import { parse } from '../../Parser.spec';
import { expectTypeToBe, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { isFunctionStatement, isReferenceType, isTypeExpression } from '../../../astUtils/reflection';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import { IntegerType } from '../../../types/IntegerType';
import { StringType } from '../../../types/StringType';
import { UnionType } from '../../../types/UnionType';

describe('TypeExpressions', () => {

    it('parses a type expressions after "as"', () => {
        let { statements, diagnostics } = parse(`
            sub foo(p1 as integer, p2 as string, p3 as Namespaced.SomeType)
                print p1
                print p2
                print p3
            end sub

        `, ParseMode.BrighterScript);
        expectZeroDiagnostics(diagnostics);
        expect(statements.length).to.eq(1);
        const funcStmt = statements[0];
        if (isFunctionStatement(funcStmt)) {
            expect(funcStmt.func.parameters.length).to.eq(3);
            for (const param of funcStmt.func.parameters) {
                expect(isTypeExpression(param.typeExpression)).to.be.true;
            }
            expectTypeToBe(funcStmt.func.parameters[0].getType({ flags: SymbolTypeFlag.typetime }), IntegerType);
            expectTypeToBe(funcStmt.func.parameters[1].getType({ flags: SymbolTypeFlag.typetime }), StringType);
            expect(isReferenceType(funcStmt.func.parameters[2].getType({ flags: SymbolTypeFlag.typetime }))).to.be.true;

        } else {
            assert.fail(`expected ${funcStmt} to be FunctionStatement`);
        }
    });

    it('parses a union expression of multiple types', () => {
        let { statements, diagnostics } = parse(`
            sub foo(p1 as integer or Namespaced.SomeType or string)
                print p1
            end sub

        `, ParseMode.BrighterScript);
        expectZeroDiagnostics(diagnostics);
        expect(statements.length).to.eq(1);
        const funcStmt = statements[0];
        if (isFunctionStatement(funcStmt)) {
            expect(funcStmt.func.parameters.length).to.eq(1);
            expect(isTypeExpression(funcStmt.func.parameters[0].typeExpression)).to.be.true;
            const p1Type = funcStmt.func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(p1Type, UnionType);
            expect(p1Type.toString()).to.eq('integer or Namespaced.SomeType or string');
        } else {
            assert.fail(`expected ${funcStmt} to be FunctionStatement`);
        }
    });

    it('parses a union expression of multiple unknown types', () => {
        let { statements, diagnostics } = parse(`
            sub foo(p1 as Alpha or Beta or Charlie or Delta)
                print p1
            end sub

        `, ParseMode.BrighterScript);
        expectZeroDiagnostics(diagnostics);
        expect(statements.length).to.eq(1);
        const funcStmt = statements[0];
        if (isFunctionStatement(funcStmt)) {
            expect(funcStmt.func.parameters.length).to.eq(1);
            expect(isTypeExpression(funcStmt.func.parameters[0].typeExpression)).to.be.true;
            const p1Type = funcStmt.func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(p1Type, UnionType);
            expect(p1Type.toString()).to.eq('Alpha or Beta or Charlie or Delta');
        } else {
            assert.fail(`expected ${funcStmt} to be FunctionStatement`);
        }
    });

    it('parses a union expression of multiple unknown namespaced types', () => {
        let { statements, diagnostics } = parse(`
            sub foo(p1 as NS1.Alpha or NS1.NS2.Beta or NS1.NS2.NS3.Charlie or Delta)
                print p1
            end sub

        `, ParseMode.BrighterScript);
        expectZeroDiagnostics(diagnostics);
        expect(statements.length).to.eq(1);
        const funcStmt = statements[0];
        if (isFunctionStatement(funcStmt)) {
            expect(funcStmt.func.parameters.length).to.eq(1);
            expect(isTypeExpression(funcStmt.func.parameters[0].typeExpression)).to.be.true;
            const p1Type = funcStmt.func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(p1Type, UnionType);
            expect(p1Type.toString()).to.eq('NS1.Alpha or NS1.NS2.Beta or NS1.NS2.NS3.Charlie or Delta');
        } else {
            assert.fail(`expected ${funcStmt} to be FunctionStatement`);
        }
    });

    it('parses multiple union expressions on same line', () => {
        let { statements, diagnostics } = parse(`
            sub foo(p1 as Alpha or Beta or Charlie, p2 as Delta or Epsilon or Foxtrot or Gamma)
                print p1
            end sub

        `, ParseMode.BrighterScript);
        expectZeroDiagnostics(diagnostics);
        expect(statements.length).to.eq(1);
        const funcStmt = statements[0];
        if (isFunctionStatement(funcStmt)) {
            expect(funcStmt.func.parameters.length).to.eq(2);
            expect(isTypeExpression(funcStmt.func.parameters[0].typeExpression)).to.be.true;
            expect(isTypeExpression(funcStmt.func.parameters[1].typeExpression)).to.be.true;
            const p1Type = funcStmt.func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            const p2Type = funcStmt.func.parameters[1].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(p1Type, UnionType);
            expect(p1Type.toString()).to.eq('Alpha or Beta or Charlie');
            expectTypeToBe(p2Type, UnionType);
            expect(p2Type.toString()).to.eq('Delta or Epsilon or Foxtrot or Gamma');
        } else {
            assert.fail(`expected ${funcStmt} to be FunctionStatement`);
        }
    });

});
