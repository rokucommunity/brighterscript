import { expect } from '../../../chai-config.spec';
import { ParseMode } from '../../Parser';
import { parse } from '../../Parser.spec';
import { expectDiagnostics, expectDiagnosticsIncludes, expectTypeToBe, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { isGenericTypeExpression, isTypedArrayExpression, isTypeParameterType } from '../../../astUtils/reflection';
import type { AssignmentStatement, ClassStatement, FunctionStatement, InterfaceStatement } from '../../Statement';
import type { GenericTypeExpression, NewExpression, TypedArrayExpression } from '../../Expression';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { TypeParameterType } from '../../../types/TypeParameterType';
import { ArrayType } from '../../../types/ArrayType';
import { TokenKind } from '../../../lexer/TokenKind';

describe('generics', () => {
    describe('type parameters', () => {
        it('parses a type parameter on a function', () => {
            const { ast, diagnostics } = parse(`
                function first<T>(items as T[]) as T
                    return items[0]
                end function
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const func = (ast.statements[0] as FunctionStatement).func;
            expect(func.typeParameters.map(x => x.name)).to.eql(['T']);
            expect(func.tokens.leftAngleBracket?.text).to.eq('<');
            expect(func.tokens.rightAngleBracket?.text).to.eq('>');

            const paramType = func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(paramType, ArrayType);
            expect(paramType.toString()).to.eq('Array<T>');

            const returnType = func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(returnType, TypeParameterType);
            expect(returnType.toString()).to.eq('T');
            //both `T`s refer to the same type parameter
            expect((paramType as ArrayType).defaultType.isEqual(returnType)).to.be.true;

            const funcType = func.getType({ flags: SymbolTypeFlag.typetime });
            expect(funcType.typeParameters.map(x => x.name)).to.eql(['T']);
            expect(funcType.toString()).to.include('<T>(items as Array<T>) as T');
        });

        it('parses multiple type parameters with constraints', () => {
            const { ast, diagnostics } = parse(`
                function pick<T, U extends Node>(a as T, b as U) as U
                    return b
                end function
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const func = (ast.statements[0] as FunctionStatement).func;
            expect(func.typeParameters.map(x => x.name)).to.eql(['T', 'U']);
            expect(func.typeParameters[0].constraint).to.be.undefined;
            expect(func.typeParameters[1].tokens.extends?.text).to.eq('extends');
            expect(func.typeParameters[1].constraint.getName()).to.eq('Node');

            const uType = func.typeParameters[1].getType({ flags: SymbolTypeFlag.typetime });
            expect(isTypeParameterType(uType)).to.be.true;
            expect(uType.constraint?.toString()).to.eq('Node');
        });

        it('parses type parameters on classes and methods', () => {
            const { ast, diagnostics } = parse(`
                class Queue<T>
                    private data as T[] = []

                    sub push(item as T)
                        m.data.push(item)
                    end sub

                    function map<U>(mapper as function(item as T) as U) as U[]
                        return []
                    end function
                end class
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const cls = ast.statements[0] as ClassStatement;
            expect(cls.typeParameters.map(x => x.name)).to.eql(['T']);
            expect(cls.tokens.leftAngleBracket?.text).to.eq('<');

            const classType = cls.getType({ flags: SymbolTypeFlag.typetime });
            expect(classType.typeParameters.map(x => x.name)).to.eql(['T']);
            expect(classType.toString()).to.eq('Queue<T>');
            expect(classType.isGenericDeclaration).to.be.true;

            const mapMethod = cls.methods.find(x => x.tokens.name.text === 'map');
            expect(mapMethod.func.typeParameters.map(x => x.name)).to.eql(['U']);

            //the field type refers to the class's type parameter
            const fieldType = cls.fields[0].getType({ flags: SymbolTypeFlag.typetime });
            expect(fieldType.toString()).to.eq('Array<T>');
        });

        it('parses type parameters on interfaces and interface methods', () => {
            const { ast, diagnostics } = parse(`
                interface Container<T>
                    items as T[]
                    function get(index as integer) as T
                    function convert<U>(converter as function(item as T) as U) as U[]
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const iface = ast.statements[0] as InterfaceStatement;
            expect(iface.typeParameters.map(x => x.name)).to.eql(['T']);

            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            expect(ifaceType.toString()).to.eq('Container<T>');
            expect(ifaceType.typeParameters.map(x => x.name)).to.eql(['T']);

            const convert = iface.methods.find(x => x.tokens.name.text === 'convert');
            expect(convert.typeParameters.map(x => x.name)).to.eql(['U']);
            expect(convert.getType({ flags: SymbolTypeFlag.typetime }).typeParameters.map(x => x.name)).to.eql(['U']);
        });

        it('flags duplicate type parameter names', () => {
            const { diagnostics } = parse(`
                function foo<T, T>(a as T) as T
                    return a
                end function
            `, ParseMode.BrighterScript);
            expectDiagnostics(diagnostics, [
                DiagnosticMessages.duplicateTypeParameterName('T').message
            ]);
        });

        it('flags an unclosed type parameter list and keeps parsing', () => {
            const { ast, diagnostics } = parse(`
                function foo<T(a as T) as T
                    return a
                end function
            `, ParseMode.BrighterScript);
            expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.unmatchedLeftToken('<', 'type parameter list').message);
            expect(ast.statements.length).to.eq(1);
            expect((ast.statements[0] as FunctionStatement).func.parameters.length).to.eq(1);
        });

        it('flags type parameters in brightscript mode', () => {
            const { diagnostics } = parse(`
                function foo<T>(a as T) as T
                    return a
                end function
            `, ParseMode.BrightScript);
            expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('generic type parameters').message);
        });
    });

    describe('type arguments', () => {
        it('parses type arguments in type expressions', () => {
            const { ast, diagnostics } = parse(`
                sub foo(a as Queue<integer>, b as Alpha.Beta.Map<string, Node[]>, c as Queue<Queue<integer>>, d as Queue<string>[])
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const params = (ast.statements[0] as FunctionStatement).func.parameters;

            const a = params[0].typeExpression.expression as GenericTypeExpression;
            expect(isGenericTypeExpression(a)).to.be.true;
            expect(a.getName()).to.eq('Queue');
            expect(a.typeArguments.map(x => x.getName())).to.eql(['integer']);
            expect(params[0].typeExpression.getName()).to.eq('Queue<integer>');

            const b = params[1].typeExpression.expression as GenericTypeExpression;
            expect(b.getName()).to.eq('Alpha.Beta.Map');
            expect(b.typeArguments.map(x => x.getName())).to.eql(['string', 'Node[]']);

            //nested `>>` is split into two closing brackets
            const c = params[2].typeExpression.expression as GenericTypeExpression;
            expect(c.getName()).to.eq('Queue');
            expect(isGenericTypeExpression(c.typeArguments[0].expression)).to.be.true;
            expect(c.tokens.rightAngleBracket.kind).to.eq(TokenKind.Greater);
            expect(c.tokens.rightAngleBracket.text).to.eq('>');
            expect(params[2].typeExpression.getName()).to.eq('Queue<Queue<integer>>');

            //array of a generic type
            const d = params[3].typeExpression.expression as TypedArrayExpression;
            expect(isTypedArrayExpression(d)).to.be.true;
            expect(isGenericTypeExpression(d.innerType)).to.be.true;
            expect(params[3].typeExpression.getName()).to.eq('Queue<string>[]');
        });

        it('parses type arguments on new expressions', () => {
            const { ast, diagnostics } = parse(`
                sub foo()
                    a = new Queue<integer>()
                    b = new Alpha.Pair<string, integer>(1)
                    c = new Queue()
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const statements = (ast.statements[0] as FunctionStatement).func.body.statements as AssignmentStatement[];

            const a = statements[0].value as NewExpression;
            expect(a.typeArguments.map(x => x.getName())).to.eql(['integer']);
            expect(a.className.getName(ParseMode.BrighterScript)).to.eq('Queue');
            expect(a.call.args.length).to.eq(0);

            const b = statements[1].value as NewExpression;
            expect(b.typeArguments.map(x => x.getName())).to.eql(['string', 'integer']);
            expect(b.className.getName(ParseMode.BrighterScript)).to.eq('Alpha.Pair');
            expect(b.call.args.length).to.eq(1);

            const c = statements[2].value as NewExpression;
            expect(c.typeArguments).to.be.undefined;
        });

        it('flags an unclosed type argument list without crashing', () => {
            const { diagnostics } = parse(`
                sub foo(a as Queue<integer)
                end sub
                sub bar()
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics.length).to.be.greaterThan(0);
        });

        it('flags type arguments in brightscript mode', () => {
            const { diagnostics } = parse(`
                sub foo()
                    a = new Queue<integer>()
                end sub
            `, ParseMode.BrightScript);
            expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('generic type arguments').message);
        });
    });
});
