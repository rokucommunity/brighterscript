import { expect } from 'chai';
import { AstEditor } from './AstEditor';

describe('AstEditor', () => {
    let changer: AstEditor;
    let obj: ReturnType<typeof getTestObject>;

    beforeEach(() => {
        changer = new AstEditor();
        obj = getTestObject();
    });

    function getTestObject() {
        return {
            name: 'parent',
            hobbies: ['gaming', 'reading', 'cycling'],
            children: [{
                name: 'oldest',
                age: 15
            }, {
                name: 'middle',
                age: 10
            }, {
                name: 'youngest',
                age: 5
            }],
            jobs: [{
                title: 'plumber',
                annualSalary: 50000
            }, {
                title: 'carpenter',
                annualSalary: 75000
            }]
        };
    }

    it('applies single property change', () => {
        expect(obj.name).to.eql('parent');

        changer.setProperty(obj, 'name', 'jack');
        expect(obj.name).to.eql('jack');

        changer.undoAll();
        expect(obj.name).to.eql('parent');
    });

    it('inserts at beginning of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        changer.addToArray(obj.hobbies, 0, 'climbing');
        expect(obj.hobbies).to.eql(['climbing', 'gaming', 'reading', 'cycling']);

        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('inserts at middle of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        changer.addToArray(obj.hobbies, 1, 'climbing');
        expect(obj.hobbies).to.eql(['gaming', 'climbing', 'reading', 'cycling']);

        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('inserts at end of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        changer.addToArray(obj.hobbies, 3, 'climbing');
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling', 'climbing']);

        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('removes at beginning of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        changer.removeFromArray(obj.hobbies, 0);
        expect(obj.hobbies).to.eql(['reading', 'cycling']);

        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('removes at middle of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        changer.removeFromArray(obj.hobbies, 1);
        expect(obj.hobbies).to.eql(['gaming', 'cycling']);

        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('removes at middle of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        changer.removeFromArray(obj.hobbies, 2);
        expect(obj.hobbies).to.eql(['gaming', 'reading']);

        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('restores array after being removed', () => {
        changer.removeFromArray(obj.hobbies, 0);
        changer.setProperty(obj, 'hobbies', undefined);
        expect(obj.hobbies).to.be.undefined;
        changer.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('works for many changes', () => {
        expect(obj).to.eql(getTestObject());
        changer.setProperty(obj, 'name', 'bob');
        changer.setProperty(obj.children[0], 'name', 'jimmy');
        changer.addToArray(obj.children, obj.children.length, { name: 'sally', age: 1 });
        changer.removeFromArray(obj.jobs, 1);
        changer.removeFromArray(obj.hobbies, 0);
        changer.removeFromArray(obj.hobbies, 0);
        changer.removeFromArray(obj.hobbies, 0);
        changer.setProperty(obj, 'hobbies', undefined);

        expect(obj).to.eql({
            name: 'bob',
            hobbies: undefined,
            children: [{
                name: 'jimmy',
                age: 15
            }, {
                name: 'middle',
                age: 10
            }, {
                name: 'youngest',
                age: 5
            }, {
                name: 'sally',
                age: 1
            }],
            jobs: [{
                title: 'plumber',
                annualSalary: 50000
            }]
        });

        changer.undoAll();
        expect(obj).to.eql(getTestObject());
    });
});
