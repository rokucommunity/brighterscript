import { Program } from '../Program';
import { getTestGetTypedef, getTestTranspile, rootDir, tempDir, outDir } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';

describe('BrsFile generics', () => {
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);
    let testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, outDir: outDir });
    });

    afterEach(() => {
        program.dispose();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
    });

    describe('transpile', () => {
        it('erases type parameters from functions', async () => {
            await testTranspile(`
                function first<T>(items as T[]) as T
                    return items[0]
                end function

                function upper<T extends string>(value as T) as T
                    return value
                end function

                sub main()
                    x = first([1, 2])
                    y = upper("a")
                    print x
                    print y
                end sub
            `, `
                function first(items as dynamic) as dynamic
                    return items[0]
                end function

                function upper(value as string) as string
                    return value
                end function

                sub main()
                    x = first([
                        1
                        2
                    ])
                    y = upper("a")
                    print x
                    print y
                end sub
            `);
        });

        it('erases type parameters and type arguments from classes', async () => {
            await testTranspile(`
                class Queue<T>
                    sub push(item as T)
                    end sub

                    function pop() as T
                        return invalid
                    end function
                end class

                sub main()
                    q = new Queue<integer>()
                    q.push(1)
                    other = {} as Queue<Queue<string>>
                    print other
                end sub
            `, `
                sub __Queue_method_new()
                end sub
                sub __Queue_method_push(item as dynamic)
                end sub
                function __Queue_method_pop() as dynamic
                    return invalid
                end function
                function __Queue_builder()
                    instance = {}
                    instance.new = __Queue_method_new
                    instance.push = __Queue_method_push
                    instance.pop = __Queue_method_pop
                    return instance
                end function
                function Queue()
                    instance = __Queue_builder()
                    instance.new()
                    return instance
                end function

                sub main()
                    q = Queue()
                    q.push(1)
                    other = {}
                    print other
                end sub
            `);
        });

        it('erases generic interfaces and namespaced generic classes', async () => {
            await testTranspile(`
                interface Container<T>
                    function get(index as integer) as T
                end interface

                namespace Data
                    class Pair<K, V>
                        key as K
                        value as V
                    end class
                end namespace

                sub useIt(c as Container<string>, p as Data.Pair<string, integer>)
                    print c.get(0)
                    print p.key
                end sub
            `, `
                sub __Data_Pair_method_new()
                    m.key = invalid
                    m.value = invalid
                end sub
                function __Data_Pair_builder()
                    instance = {}
                    instance.new = __Data_Pair_method_new
                    return instance
                end function
                function Data_Pair()
                    instance = __Data_Pair_builder()
                    instance.new()
                    return instance
                end function

                sub useIt(c as dynamic, p as dynamic)
                    print c.get(0)
                    print p.key
                end sub
            `);
        });
    });

    describe('typedef', () => {
        it('keeps type parameters and type arguments', async () => {
            await testGetTypedef(`
                function first<T>(items as T[]) as T
                    return items[0]
                end function

                class Animal
                end class

                class Queue<T extends Animal>
                    sub push(item as T)
                    end sub

                    function pop() as T
                        return invalid
                    end function
                end class

                interface Container<T>
                    function get(index as integer) as T
                    function convert<U>(value as T) as U
                end interface

                sub useIt(q as Queue<Animal>, c as Container<string>)
                end sub
            `, `
                function first<T>(items as dynamic) as T
                end function
                class Animal
                    sub new()
                    end sub
                end class
                class Queue<T extends Animal>
                    sub new()
                    end sub
                    sub push(item as T)
                    end sub
                    function pop() as T
                    end function
                end class
                interface Container<T>
                    function get(index as integer) as T
                    function convert<U>(value as T) as U
                end interface

                sub useIt(q as Queue<Animal>, c as Container<string>)
                end sub
            `);
        });
    });
});
