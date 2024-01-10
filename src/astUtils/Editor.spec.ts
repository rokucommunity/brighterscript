import { expect } from '../chai-config.spec';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { Editor } from './Editor';
import { util } from '../util';
import { createToken } from './creators';
import { TokenKind } from '../lexer/TokenKind';
import { Program } from '../Program';
import { BrsFile } from '../files/BrsFile';
import { LiteralExpression } from '../parser/Expression';
import { SourceNode } from 'source-map';

describe('Editor', () => {
    let editor: Editor;
    let obj: ReturnType<typeof getTestObject>;

    beforeEach(() => {
        editor = new Editor();
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

        editor.setProperty(obj, 'name', 'jack');
        expect(obj.name).to.eql('jack');

        editor.undoAll();
        expect(obj.name).to.eql('parent');
    });

    it('inserts at beginning of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.addToArray(obj.hobbies, 0, 'climbing');
        expect(obj.hobbies).to.eql(['climbing', 'gaming', 'reading', 'cycling']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('inserts at middle of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.addToArray(obj.hobbies, 1, 'climbing');
        expect(obj.hobbies).to.eql(['gaming', 'climbing', 'reading', 'cycling']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('changes the value at an array index', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.setArrayValue(obj.hobbies, 1, 'sleeping');
        expect(obj.hobbies).to.eql(['gaming', 'sleeping', 'cycling']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('inserts at end of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.addToArray(obj.hobbies, 3, 'climbing');
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling', 'climbing']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('removes at beginning of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.removeFromArray(obj.hobbies, 0);
        expect(obj.hobbies).to.eql(['reading', 'cycling']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('removes at middle of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.removeFromArray(obj.hobbies, 1);
        expect(obj.hobbies).to.eql(['gaming', 'cycling']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('removes at middle of array', () => {
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);

        editor.removeFromArray(obj.hobbies, 2);
        expect(obj.hobbies).to.eql(['gaming', 'reading']);

        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('restores array after being removed', () => {
        editor.removeFromArray(obj.hobbies, 0);
        editor.setProperty(obj, 'hobbies', undefined as any);
        expect(obj.hobbies).to.be.undefined;
        editor.undoAll();
        expect(obj.hobbies).to.eql(['gaming', 'reading', 'cycling']);
    });

    it('works for many changes', () => {
        expect(obj).to.eql(getTestObject());
        editor.setProperty(obj, 'name', 'bob');
        editor.setProperty(obj.children[0], 'name', 'jimmy');
        editor.addToArray(obj.children, obj.children.length, { name: 'sally', age: 1 });
        editor.removeFromArray(obj.jobs, 1);
        editor.removeFromArray(obj.hobbies, 0);
        editor.removeFromArray(obj.hobbies, 0);
        editor.removeFromArray(obj.hobbies, 0);
        editor.setProperty(obj, 'hobbies', undefined as any);

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

        editor.undoAll();
        expect(obj).to.eql(getTestObject());
    });

    describe('overrideTranspileResult', () => {
        const state = new BrsTranspileState(new BrsFile({
            srcPath: '',
            destPath: '',
            program: new Program({})
        }));
        function transpileToString(transpilable: { transpile: (state: BrsTranspileState) => any }) {
            if (transpilable.transpile) {
                const result = transpilable.transpile(state);
                if (Array.isArray(result)) {
                    return new SourceNode(null, null, null, result).toString();
                }
            }
        }
        it('overrides existing transpile method', () => {
            const expression = new LiteralExpression(createToken(TokenKind.IntegerLiteral, 'original'));

            expect(transpileToString(expression)).to.eql('original');

            editor.overrideTranspileResult(expression, 'replaced');
            expect(transpileToString(expression)).to.eql('replaced');

            editor.undoAll();
            expect(transpileToString(expression)).to.eql('original');
        });

        it('gracefully handles missing transpile method', () => {
            const expression = {
                range: util.createRange(1, 2, 3, 4)
            } as any;
            expect(expression.transpile).not.to.exist;
            editor.overrideTranspileResult(expression, 'replaced');
            expect(transpileToString(expression)).to.eql('replaced');
            editor.undoAll();
            expect(expression.transpile).not.to.exist;
        });
    });

    it('arrayPush works', () => {
        const array = [1, 2, 3];
        editor.arrayPush(array, 4);
        expect(array).to.eql([1, 2, 3, 4]);
        editor.undoAll();
        expect(array).to.eql([1, 2, 3]);
    });

    it('arrayPop works', () => {
        const array = [1, 2, 3];
        expect(
            editor.arrayPop(array)
        ).to.eql(3);
        expect(array).to.eql([1, 2]);
        editor.undoAll();
        expect(array).to.eql([1, 2, 3]);
    });

    it('arrayShift works', () => {
        const array = [1, 2, 3];
        expect(
            editor.arrayShift(array)
        ).to.eql(1);
        expect(array).to.eql([2, 3]);
        editor.undoAll();
        expect(array).to.eql([1, 2, 3]);
    });

    it('arrayUnshift works at beginning', () => {
        const array = [1, 2, 3];
        editor.arrayUnshift(array, -1, 0);
        expect(array).to.eql([-1, 0, 1, 2, 3]);
        editor.undoAll();
        expect(array).to.eql([1, 2, 3]);
    });

    it('removeProperty removes existing property', () => {
        const obj = {
            name: 'bob'
        };
        editor.removeProperty(obj, 'name');
        expect(obj).not.haveOwnProperty('name');
        editor.undoAll();
        expect(obj).haveOwnProperty('name');
    });

    it('removeProperty leaves non-present property as non-present after undo', () => {
        const obj = {};
        editor.removeProperty(obj as any, 'name');
        expect(obj).not.haveOwnProperty('name');
        editor.undoAll();
        expect(obj).not.haveOwnProperty('name');
    });

    it('arraySplice works properly at beginning', () => {
        const arr = [1, 2, 3];
        editor.arraySplice(arr, 0, 2, -1, 0);
        expect(arr).to.eql([-1, 0, 3]);
        editor.undoAll();
        expect(arr).to.eql([1, 2, 3]);
    });

    it('arraySplice works properly at the middle', () => {
        const arr = [1, 2, 3];
        editor.arraySplice(arr, 1, 2, 4, 5);
        expect(arr).to.eql([1, 4, 5]);
        editor.undoAll();
        expect(arr).to.eql([1, 2, 3]);
    });

    it('arraySplice works properly at the end', () => {
        const arr = [1, 2, 3];
        editor.arraySplice(arr, 3, 2, 4, 5);
        expect(arr).to.eql([1, 2, 3, 4, 5]);
        editor.undoAll();
        expect(arr).to.eql([1, 2, 3]);
    });

    it('edit works', () => {
        const testObj = getTestObject();
        editor.edit((data) => {
            data.oldValue = testObj.name;
            testObj.name = 'new name';
        }, (data) => {
            testObj.name = data.oldValue;
        });
        expect(testObj.name).to.eql('new name');
        editor.undoAll();
        expect(testObj.name).to.eql(getTestObject().name);
    });

    it('edit handles missing functions', () => {
        //missing undo
        editor.edit((data) => { }, undefined as any);
        //missing edit
        editor.edit(undefined as any, (data) => { });

        //test passes if no exceptions were thrown
    });
});
