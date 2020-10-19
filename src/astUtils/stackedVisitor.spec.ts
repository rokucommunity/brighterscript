import { expect, assert } from 'chai';
import { createStackedVisitor } from './stackedVisitor';

describe('createStackedVisitor', () => {
    interface StructSpec {
        id: number;
        children?: StructSpec[];
    }

    function visitStruct(struct: StructSpec, parent: StructSpec, visitor: (struct: StructSpec, parent: StructSpec) => void) {
        visitor(struct, parent);
        struct.children?.forEach(s => visitStruct(s, struct, visitor));
    }

    const test1Struct = {
        id: 1,
        children: [
            { id: 2 },
            {
                id: 3, children: [
                    { id: 4 }
                ]
            },
            { id: 5 },
            {
                id: 6, children: [
                    {
                        id: 7, children: [
                            { id: 8 }
                        ]
                    }
                ]
            },
            { id: 9 }
        ]
    };

    it('visits a well-formed structure', () => {
        const actual: string[] = [];
        const stackedVisitor = createStackedVisitor((item: StructSpec, stack: StructSpec[]) => {
            assert(item !== undefined, 'item is undefined');
            assert(item.id !== undefined, 'item.id is undefined');
            assert(stack !== undefined, 'stack is undefined');
            actual.push(`${stack.length ? stack.map(e => e.id).join('/') + '/' : ''}${item.id}`);
        });
        visitStruct(test1Struct, undefined, stackedVisitor);
        expect(actual).to.deep.equal([
            '1',
            '1/2',
            '1/3',
            '1/3/4',
            '1/5',
            '1/6',
            '1/6/7',
            '1/6/7/8',
            '1/9'
        ]);
    });

    it('calls open/close when visiting the structure', () => {
        const actual: string[] = [];
        const stackedVisitor = createStackedVisitor(
            () => { },
            (pushed: StructSpec, stack: StructSpec[]) => {
                assert(pushed !== undefined, 'pushed is undefined');
                assert(pushed.id !== undefined, 'pushed.id is undefined');
                assert(stack !== undefined, 'stack is undefined');
                actual.push(`>${stack.map(e => e.id).join('/')}:${pushed.id}`);
            },
            (popped: StructSpec, stack: StructSpec[]) => {
                assert(popped !== undefined, 'popped is undefined');
                assert(popped.id !== undefined, 'popped.id is undefined');
                assert(stack !== undefined, 'stack is undefined');
                actual.push(`<${stack.map(e => e.id).join('/')}:${popped.id}`);
            });
        visitStruct(test1Struct, undefined, stackedVisitor);
        expect(actual).to.deep.equal([
            '>1:1',
            '>1/3:3',
            '<1:3',
            '>1/6:6',
            '>1/6/7:7',
            '<1/6:7',
            '<1:6'
        ]);
    });
});
