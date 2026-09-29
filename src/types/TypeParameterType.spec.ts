import { expect } from '../chai-config.spec';
import { TypeParameterType } from './TypeParameterType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { FloatType } from './FloatType';
import { DynamicType } from './DynamicType';
import { InvalidType } from './InvalidType';
import { ObjectType } from './ObjectType';
import { VoidType } from './VoidType';
import { ArrayType } from './ArrayType';
import { ClassType } from './ClassType';
import { InterfaceType } from './InterfaceType';
import { TypedFunctionType } from './TypedFunctionType';
import { UnionType } from './UnionType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { applyTypeArguments, createTypeParameterBindings, findConstraintViolations, inferTypeArguments, instantiateFunctionForCall, substituteTypeParameters } from './TypeParameterHelpers';
import { expectTypeToBe } from '../testHelpers.spec';

describe('TypeParameterType', () => {
    const runtime = { flags: SymbolTypeFlag.runtime };

    /**
     * Build a `class Queue<T>` with `push(item as T)`, `pop() as T` and `items as T[]` members
     */
    function createQueueClass() {
        const t = new TypeParameterType('T');
        const queue = new ClassType('Queue');
        queue.typeParameters = [t];
        const push = new TypedFunctionType(VoidType.instance);
        push.addParameter('item', t, false);
        queue.addMember('push', {}, push, SymbolTypeFlag.runtime);
        queue.addMember('pop', {}, new TypedFunctionType(t), SymbolTypeFlag.runtime);
        queue.addMember('items', {}, new ArrayType(t), SymbolTypeFlag.runtime);
        return { t: t, queue: queue };
    }

    describe('isTypeCompatible', () => {
        it('accepts the same type parameter, dynamic, invalid and object', () => {
            const t = new TypeParameterType('T');
            expect(t.isTypeCompatible(t)).to.be.true;
            expect(t.isTypeCompatible(DynamicType.instance)).to.be.true;
            expect(t.isTypeCompatible(InvalidType.instance)).to.be.true;
            expect(t.isTypeCompatible(ObjectType.instance)).to.be.true;
        });

        it('rejects concrete types and other type parameters', () => {
            const t = new TypeParameterType('T');
            const u = new TypeParameterType('U');
            expect(t.isTypeCompatible(IntegerType.instance)).to.be.false;
            expect(t.isTypeCompatible(StringType.instance)).to.be.false;
            expect(t.isTypeCompatible(u)).to.be.false;
            expect(t.isTypeCompatible(new ArrayType(t))).to.be.false;
            expect(t.isTypeCompatible(new ClassType('Animal'))).to.be.false;
        });

        it('treats same-named type parameters as equal', () => {
            const t1 = new TypeParameterType('T');
            const t2 = new TypeParameterType('T');
            expect(t1.isEqual(t2)).to.be.true;
            expect(t1.isTypeCompatible(t2)).to.be.true;
            expect(t1.isEqual(new TypeParameterType('U'))).to.be.false;
        });

        it('uses the constraint when a type parameter is used where a concrete type is expected', () => {
            const unconstrained = new TypeParameterType('T');
            expect(IntegerType.instance.isTypeCompatible(unconstrained)).to.be.false;
            expect(StringType.instance.isTypeCompatible(unconstrained)).to.be.false;

            const numberish = new TypeParameterType('T', IntegerType.instance);
            expect(IntegerType.instance.isTypeCompatible(numberish)).to.be.true;
            expect(FloatType.instance.isTypeCompatible(numberish)).to.be.true;
            expect(StringType.instance.isTypeCompatible(numberish)).to.be.false;

            const animal = new ClassType('Animal');
            const animalish = new TypeParameterType('T', animal);
            expect(animal.isTypeCompatible(animalish)).to.be.true;
            expect(new ClassType('Vehicle').isTypeCompatible(animalish)).to.be.false;

            //arrays of type parameters
            expect(new ArrayType(IntegerType.instance).isTypeCompatible(new ArrayType(numberish))).to.be.true;
            expect(new ArrayType(IntegerType.instance).isTypeCompatible(new ArrayType(unconstrained))).to.be.false;
            expect(new ArrayType(unconstrained).isTypeCompatible(new ArrayType(unconstrained))).to.be.true;
        });
    });

    describe('toString and toTypeString', () => {
        it('shows the name and transpiles to the constraint or dynamic', () => {
            expect(new TypeParameterType('T').toString()).to.eq('T');
            expect(new TypeParameterType('T').toTypeString()).to.eq('dynamic');
            expect(new TypeParameterType('T', StringType.instance).toString()).to.eq('T');
            expect(new TypeParameterType('T', StringType.instance).toTypeString()).to.eq('string');
            expect(new TypeParameterType('T', new ClassType('Animal')).toTypeString()).to.eq('dynamic');
        });
    });

    describe('getMemberType', () => {
        it('returns dynamic for members of unconstrained type parameters', () => {
            const t = new TypeParameterType('T');
            expectTypeToBe(t.getMemberType('anything', runtime), DynamicType);
        });

        it('returns the members of the constraint', () => {
            const animal = new ClassType('Animal');
            animal.addMember('speak', {}, new TypedFunctionType(VoidType.instance), SymbolTypeFlag.runtime);
            const t = new TypeParameterType('T', animal);
            expectTypeToBe(t.getMemberType('speak', runtime), TypedFunctionType);
        });
    });

    describe('substituteTypeParameters', () => {
        it('replaces bound type parameters and leaves everything else untouched', () => {
            const t = new TypeParameterType('T');
            const u = new TypeParameterType('U');
            const bindings = createTypeParameterBindings([t], [IntegerType.instance]);

            expectTypeToBe(substituteTypeParameters(t, bindings), IntegerType);
            expect(substituteTypeParameters(u, bindings)).to.equal(u);
            expect(substituteTypeParameters(StringType.instance, bindings)).to.equal(StringType.instance);

            expect(substituteTypeParameters(new ArrayType(t), bindings).toString()).to.eq('Array<integer>');
            expect(substituteTypeParameters(new ArrayType(new ArrayType(t)), bindings).toString()).to.eq('Array<Array<integer>>');
            const stringArray = new ArrayType(StringType.instance);
            expect(substituteTypeParameters(stringArray, bindings)).to.equal(stringArray);

            expect(substituteTypeParameters(new UnionType([t, StringType.instance]), bindings).toString()).to.eq('integer or string');

            const func = new TypedFunctionType(t);
            func.addParameter('items', new ArrayType(t), false);
            func.addParameter('name', StringType.instance, false);
            const substituted = substituteTypeParameters(func, bindings) as TypedFunctionType;
            expectTypeToBe(substituted.returnType, IntegerType);
            expect(substituted.params[0].type.toString()).to.eq('Array<integer>');
            expect(substituted.params[1].type).to.equal(StringType.instance);
            //original is untouched
            expectTypeToBe(func.returnType, TypeParameterType);
        });

        it('does not substitute a generic function\'s own type parameters', () => {
            const t = new TypeParameterType('T');
            const func = new TypedFunctionType(t);
            func.typeParameters = [t];
            func.addParameter('x', t, false);
            const bindings = createTypeParameterBindings([t], [IntegerType.instance]);
            expect(substituteTypeParameters(func, bindings)).to.equal(func);
        });
    });

    describe('inferTypeArguments', () => {
        it('infers from direct, array, and function-typed parameters', () => {
            const t = new TypeParameterType('T');
            const u = new TypeParameterType('U');

            let bindings = inferTypeArguments([t], [t], [IntegerType.instance]);
            expectTypeToBe(bindings.get(t.id), IntegerType);

            bindings = inferTypeArguments([t], [new ArrayType(t)], [new ArrayType(StringType.instance)]);
            expectTypeToBe(bindings.get(t.id), StringType);

            const paramFunc = new TypedFunctionType(u);
            paramFunc.addParameter('item', t, false);
            const argFunc = new TypedFunctionType(StringType.instance);
            argFunc.addParameter('item', IntegerType.instance, false);
            bindings = inferTypeArguments([t, u], [paramFunc], [argFunc]);
            expectTypeToBe(bindings.get(t.id), IntegerType);
            expectTypeToBe(bindings.get(u.id), StringType);
        });

        it('keeps the first binding, and falls back to the constraint or dynamic', () => {
            const t = new TypeParameterType('T');
            let bindings = inferTypeArguments([t], [t, t], [IntegerType.instance, StringType.instance]);
            expectTypeToBe(bindings.get(t.id), IntegerType);

            //`invalid` gives way to a more specific binding
            bindings = inferTypeArguments([t], [t, t], [InvalidType.instance, StringType.instance]);
            expectTypeToBe(bindings.get(t.id), StringType);

            const u = new TypeParameterType('U', new ClassType('Animal'));
            bindings = inferTypeArguments([t, u], [], []);
            expectTypeToBe(bindings.get(t.id), DynamicType);
            expect(bindings.get(u.id).toString()).to.eq('Animal');
        });

        it('infers through instantiated generic classes and their subclasses', () => {
            const { t, queue } = createQueueClass();
            const paramType = queue.instantiate([t]);
            const intQueue = queue.instantiate([IntegerType.instance]);

            let bindings = inferTypeArguments([t], [paramType], [intQueue]);
            expectTypeToBe(bindings.get(t.id), IntegerType);

            const subclass = new ClassType('IntQueue', intQueue);
            bindings = inferTypeArguments([t], [paramType], [subclass]);
            expectTypeToBe(bindings.get(t.id), IntegerType);
        });
    });

    describe('instantiate', () => {
        it('substitutes type parameters in members and caches the result', () => {
            const { queue } = createQueueClass();
            expect(queue.toString()).to.eq('Queue<T>');
            expect(queue.isGenericDeclaration).to.be.true;

            const intQueue = queue.instantiate([IntegerType.instance]);
            expect(intQueue.toString()).to.eq('Queue<integer>');
            expect(intQueue.isGenericDeclaration).to.be.false;
            expect(intQueue.genericDeclaration).to.equal(queue);
            expectTypeToBe((intQueue.getMemberType('push', runtime) as TypedFunctionType).params[0].type, IntegerType);
            expectTypeToBe((intQueue.getMemberType('pop', runtime) as TypedFunctionType).returnType, IntegerType);
            expect(intQueue.getMemberType('items', runtime).toString()).to.eq('Array<integer>');

            //cached per set of type arguments
            expect(queue.instantiate([IntegerType.instance])).to.equal(intQueue);
            expect(queue.instantiate([StringType.instance])).to.not.equal(intQueue);

            //the declaration is untouched
            expectTypeToBe((queue.getMemberType('pop', runtime) as TypedFunctionType).returnType, TypeParameterType);
        });

        it('compares instantiations by their type arguments', () => {
            const { queue } = createQueueClass();
            const intQueue = queue.instantiate([IntegerType.instance]);
            const stringQueue = queue.instantiate([StringType.instance]);
            const dynamicQueue = queue.instantiate([DynamicType.instance]);

            expect(intQueue.isTypeCompatible(intQueue)).to.be.true;
            expect(intQueue.isTypeCompatible(stringQueue)).to.be.false;
            expect(intQueue.isTypeCompatible(dynamicQueue)).to.be.true;

            //a subclass of an instantiation is compatible with that instantiation only
            const subclass = new ClassType('IntQueue', intQueue);
            expect(intQueue.isTypeCompatible(subclass)).to.be.true;
            expect(stringQueue.isTypeCompatible(subclass)).to.be.false;
        });

        it('defaults missing type arguments to the constraint or dynamic', () => {
            const { queue } = createQueueClass();
            expect(queue.instantiate([]).toString()).to.eq('Queue<dynamic>');

            const t = new TypeParameterType('T', new ClassType('Animal'));
            const crate = new ClassType('Crate');
            crate.typeParameters = [t];
            crate.addMember('value', {}, t, SymbolTypeFlag.runtime);
            const defaulted = crate.instantiate([]);
            expect(defaulted.toString()).to.eq('Crate<Animal>');
            expect(defaulted.getMemberType('value', runtime).toString()).to.eq('Animal');
        });

        it('instantiates generic interfaces', () => {
            const t = new TypeParameterType('T');
            const container = new InterfaceType('Container');
            container.typeParameters = [t];
            container.addMember('items', {}, new ArrayType(t), SymbolTypeFlag.runtime);
            const stringContainer = container.instantiate([StringType.instance]);
            expect(stringContainer.toString()).to.eq('Container<string>');
            expect(stringContainer.getMemberType('items', runtime).toString()).to.eq('Array<string>');
        });

        it('applyTypeArguments leaves non-generic types alone', () => {
            expect(applyTypeArguments(IntegerType.instance, [StringType.instance])).to.equal(IntegerType.instance);
            const animal = new ClassType('Animal');
            expect(applyTypeArguments(animal, [StringType.instance])).to.equal(animal);
            const { queue } = createQueueClass();
            expect(applyTypeArguments(queue, [IntegerType.instance]).toString()).to.eq('Queue<integer>');
        });
    });

    describe('instantiateFunctionForCall', () => {
        it('binds the type parameters from the argument types', () => {
            const t = new TypeParameterType('T');
            const first = new TypedFunctionType(t);
            first.typeParameters = [t];
            first.addParameter('items', new ArrayType(t), false);

            const instantiated = instantiateFunctionForCall(first, [new ArrayType(IntegerType.instance)]);
            expectTypeToBe(instantiated.returnType, IntegerType);
            expect(instantiated.params[0].type.toString()).to.eq('Array<integer>');
            expect(instantiated.typeParameters).to.be.undefined;
            //original is untouched
            expectTypeToBe(first.returnType, TypeParameterType);

            //non-generic functions are returned as-is
            const plain = new TypedFunctionType(StringType.instance);
            expect(instantiateFunctionForCall(plain, [])).to.equal(plain);
        });
    });

    describe('findConstraintViolations', () => {
        it('finds bindings that do not satisfy the constraint', () => {
            const t = new TypeParameterType('T', new ClassType('Animal'));
            const u = new TypeParameterType('U');
            const ok = createTypeParameterBindings([t, u], [new ClassType('Animal'), StringType.instance]);
            expect(findConstraintViolations([t, u], ok)).to.eql([]);

            const bad = createTypeParameterBindings([t, u], [StringType.instance, StringType.instance]);
            const violations = findConstraintViolations([t, u], bad);
            expect(violations.length).to.eq(1);
            expect(violations[0].typeParameter).to.equal(t);
            expectTypeToBe(violations[0].typeArgument, StringType);
        });
    });
});
