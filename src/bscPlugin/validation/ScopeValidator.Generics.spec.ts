import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Program } from '../../Program';
import { expectDiagnostics, expectTypeToBe, expectZeroDiagnostics, rootDir, tempDir } from '../../testHelpers.spec';
import { expect } from '../../chai-config.spec';
import * as fsExtra from 'fs-extra';
import type { BrsFile } from '../../files/BrsFile';
import { isAssignmentStatement } from '../../astUtils/reflection';
import type { AssignmentStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { IntegerType } from '../../types/IntegerType';
import { StringType } from '../../types/StringType';
import { WalkMode } from '../../astUtils/visitors';

describe('ScopeValidator generics', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir
        });
        program.createSourceScope();
    });

    afterEach(() => {
        program.dispose();
    });

    /**
     * Get the runtime type of the variable assigned by the statement `<name> = ...` in the given file
     */
    function getAssignedType(file: BrsFile, name: string) {
        const assignment = file.ast.findChild<AssignmentStatement>((node) => {
            return isAssignmentStatement(node) && node.tokens.name.text === name;
        }, { walkMode: WalkMode.visitAllRecursive });
        return assignment.getType({ flags: SymbolTypeFlag.runtime });
    }

    describe('generic functions', () => {
        it('infers the return type from the arguments', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                function first<T>(items as T[]) as T
                    return items[0]
                end function

                sub main()
                    x = first([1, 2, 3])
                    print lcase(x)
                    s = first(["a", "b"])
                    print lcase(s)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
            expectTypeToBe(getAssignedType(file, 'x'), IntegerType);
            expectTypeToBe(getAssignedType(file, 's'), StringType);
        });

        it('infers the return type when the function is declared in another file', () => {
            program.setFile('source/lib.bs', `
                function first<T>(items as T[]) as T
                    return items[0]
                end function
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    x = first([1, 2, 3])
                    print lcase(x)
                    s = first(["a", "b"])
                    print lcase(s)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
            expectTypeToBe(getAssignedType(file, 'x'), IntegerType);
            expectTypeToBe(getAssignedType(file, 's'), StringType);
        });

        it('infers the return type when the function is declared later in the same file', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    x = identity(1)
                    print lcase(x)
                end sub

                function identity<T>(value as T) as T
                    return value
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
            expectTypeToBe(getAssignedType(file, 'x'), IntegerType);
        });

        it('checks every argument against the inferred type argument', () => {
            program.setFile('source/main.bs', `
                function pair<T>(a as T, b as T) as T[]
                    return [a, b]
                end function

                sub main()
                    pair(1, 2)
                    pair(1, "two")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('enforces constraints and allows constraint members inside the function', () => {
            program.setFile('source/main.bs', `
                class Animal
                    sub speak()
                    end sub
                end class

                class Dog extends Animal
                end class

                function loudest<T extends Animal>(a as T) as T
                    a.speak()
                    return a
                end function

                sub main()
                    d = loudest(new Dog())
                    d.speak()
                    loudest("cat")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typeArgumentDoesNotSatisfyConstraint('string', 'T', 'Animal').message
            ]);
        });

        it('only allows a value of the type parameter where the type parameter is expected', () => {
            program.setFile('source/main.bs', `
                function make<T>() as T
                    return 1
                end function

                function passThrough<T>(value as T) as T
                    if value = invalid
                        return invalid
                    end if
                    return value
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('integer', 'T').message
            ]);
        });

        it('allows iterating and indexing arrays of a type parameter', () => {
            program.setFile('source/main.bs', `
                function count<T>(items as T[]) as integer
                    total = 0
                    for each item in items
                        print item
                        total++
                    end for
                    last = items[items.count() - 1]
                    print last
                    return total
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('supports generic functions in namespaces', () => {
            program.setFile('source/main.bs', `
                namespace Data
                    function wrap<T>(value as T) as T[]
                        return [value]
                    end function
                end namespace

                sub main()
                    strings = Data.wrap("x")
                    print lcase(strings[0])
                    ints = Data.wrap(1)
                    print lcase(ints[0])
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });

        it('supports generic methods on non-generic classes', () => {
            program.setFile('source/main.bs', `
                class Wrapper
                    function wrap<T>(value as T) as T[]
                        return [value]
                    end function
                end class

                sub main()
                    w = new Wrapper()
                    print lcase(w.wrap("x")[0])
                    print lcase(w.wrap(1)[0])
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });
    });

    describe('generic classes', () => {
        it('substitutes explicit type arguments into members', () => {
            program.setFile('source/main.bs', `
                class Queue<T>
                    private data as T[] = []

                    sub push(item as T)
                        m.data.push(item)
                    end sub

                    function pop() as T
                        return m.data.shift()
                    end function

                    function self() as Queue<T>
                        return m
                    end function
                end class

                sub main()
                    q = new Queue<integer>()
                    q.push(1)
                    q.push("one")
                    print lcase(q.pop())
                    q.self().push("two")
                    anyQueue = new Queue()
                    anyQueue.push("anything")
                    anyQueue.push(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('infers type arguments from the constructor arguments', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                class Holder<T>
                    value as T

                    sub new(value as T)
                        m.value = value
                    end sub
                end class

                sub main()
                    h = new Holder(1)
                    h.value = "text"
                    h2 = new Holder<string>("text")
                    h2.value = 1
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message,
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);
            expect(getAssignedType(file, 'h').toString()).to.eq('Holder<integer>');
            expect(getAssignedType(file, 'h2').toString()).to.eq('Holder<string>');
        });

        it('enforces constraints on explicit and inferred type arguments', () => {
            program.setFile('source/main.bs', `
                class Animal
                    sub speak()
                    end sub
                end class

                class Crate<T extends Animal>
                    value as T

                    sub new(value as T)
                        m.value = value
                        m.value.speak()
                    end sub
                end class

                sub main()
                    c1 = new Crate(new Animal())
                    c1.value.speak()
                    c2 = new Crate<string>(new Animal())
                    c3 = new Crate("nope")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typeArgumentDoesNotSatisfyConstraint('string', 'T', 'Animal').message,
                DiagnosticMessages.argumentTypeMismatch('Animal', 'string').message,
                DiagnosticMessages.typeArgumentDoesNotSatisfyConstraint('string', 'T', 'Animal').message
            ]);
        });

        it('validates type argument lists', () => {
            program.setFile('source/main.bs', `
                class Animal
                end class

                class Queue<T>
                end class

                sub main()
                    a = {} as Queue<integer, string>
                    b = {} as Animal<integer>
                    c = {} as Queue<Unknown>
                    d = {} as Nope<integer>
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typeArgumentCountMismatch('Queue', 1, 2).message,
                DiagnosticMessages.typeIsNotGeneric('Animal').message,
                DiagnosticMessages.cannotFindName('Unknown').message,
                DiagnosticMessages.cannotFindName('Nope').message
            ]);
        });

        it('supports subclasses of instantiated generic classes', () => {
            program.setFile('source/main.bs', `
                class Queue<T>
                    sub push(item as T)
                    end sub

                    function pop() as T
                        return invalid
                    end function
                end class

                class IntQueue extends Queue<integer>
                end class

                sub takesInts(q as Queue<integer>)
                end sub

                sub takesStrings(q as Queue<string>)
                end sub

                sub main()
                    iq = new IntQueue()
                    iq.push("x")
                    print lcase(iq.pop())
                    takesInts(iq)
                    takesStrings(iq)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.argumentTypeMismatch('IntQueue', 'Queue<string>').message
            ]);
        });

        it('supports nested generic types', () => {
            program.setFile('source/main.bs', `
                class Queue<T>
                    sub push(item as T)
                    end sub

                    function pop() as T
                        return invalid
                    end function
                end class

                sub main()
                    nested = new Queue<Queue<integer>>()
                    nested.push(new Queue<string>())
                    nested.push(new Queue<integer>())
                    inner = nested.pop()
                    inner.push("x")
                    inner.push(1)
                end sub
            `);
            program.validate();
            const diagnostics = program.getDiagnostics();
            expect(diagnostics.map(x => x.code)).to.eql([
                DiagnosticMessages.argumentTypeMismatch('', '').code,
                DiagnosticMessages.argumentTypeMismatch('', '').code
            ]);
            expect(diagnostics[0].message).to.include(`Argument of type 'Queue<string>' is not compatible with parameter of type 'Queue<integer>'`);
            expect(diagnostics[1].message).to.include(`Argument of type 'string' is not compatible with parameter of type 'integer'`);
        });

        it('supports generic classes in namespaces', () => {
            program.setFile('source/main.bs', `
                namespace Data
                    class Pair<K, V>
                        key as K
                        value as V
                    end class
                end namespace

                sub main()
                    p = new Data.Pair<string, integer>()
                    p.key = 1
                    p.value = 1
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);
        });

        it('substitutes type arguments when the class is declared in another file', () => {
            program.setFile('source/lib.bs', `
                class Queue<T>
                    sub push(item as T)
                    end sub

                    function pop() as T
                        return invalid
                    end function
                end class
            `);
            program.setFile('source/main.bs', `
                sub main()
                    q = new Queue<integer>()
                    q.push("one")
                    print lcase(q.pop())
                    anyQueue = new Queue()
                    anyQueue.push("anything")
                end sub

                sub useQueue(q as Queue<string>)
                    q.push(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });
    });

    describe('advanced generic classes', () => {
        it('supports self-referential generics, generic inheritance, and type statements', () => {
            program.setFile('source/main.bs', `
                class LinkedNode<T>
                    value as T
                    nextNode as LinkedNode<T>

                    function getNext() as LinkedNode<T>
                        return m.nextNode
                    end function

                    function withValue<U>(v as U) as LinkedNode<U>
                        result = new LinkedNode<U>()
                        result.value = v
                        return result
                    end function
                end class

                class Base<T>
                    function get() as T
                        return invalid
                    end function
                end class

                class Derived<T> extends Base<T[]>
                end class

                type StringList = LinkedNode<string>

                sub main()
                    n = new LinkedNode<integer>()
                    n.value = "x"
                    print lcase(n.getNext().getNext().value)
                    s = n.withValue("hi")
                    print lcase(s.value)
                    s.value = 1
                    d = new Derived<integer>()
                    arr = d.get()
                    print lcase(arr[0])
                    sl = {} as StringList
                    print lcase(sl.value)
                    sl.value = 1
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);
        });
    });

    describe('generic interfaces', () => {
        it('substitutes type arguments into members', () => {
            program.setFile('source/main.bs', `
                interface Container<T>
                    items as T[]
                    function get(index as integer) as T
                end interface

                sub main()
                    c = {} as Container<string>
                    print lcase(c.get(0))
                    print lcase(c.items[0])
                    c.items.push(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });

        it('checks structural compatibility against instantiated interfaces', () => {
            program.setFile('source/main.bs', `
                interface ValueBox<T>
                    value as T
                end interface

                sub takesStringBox(wrapper as ValueBox<string>)
                end sub

                sub main()
                    takesStringBox({ value: "text" })
                    takesStringBox({ value: 1 })
                end sub
            `);
            program.validate();
            const diagnostics = program.getDiagnostics();
            expect(diagnostics.map(x => x.code)).to.eql([
                DiagnosticMessages.argumentTypeMismatch('', '').code
            ]);
            expect(diagnostics[0].message).to.include(`Argument of type 'roAssociativeArray' is not compatible with parameter of type 'ValueBox<string>'`);
        });
    });
});
