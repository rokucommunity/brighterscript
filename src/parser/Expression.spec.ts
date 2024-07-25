import { expect } from 'chai';
import { Parser } from './Parser';
import { isFunctionStatement } from '../astUtils/reflection';
import type { FunctionStatement } from './Statement';

describe('AnnotationExpression', () => {
    describe('getArguments', () => {
        function getArguments(text: string) {
            return Parser.parse(`
                @annotation(${text})
                function test()
                end function
            `).ast.findChild<FunctionStatement>(isFunctionStatement).annotations[0].getArguments();
        }

        it('should return the value of a number', () => {
            expect(getArguments('1')).to.eql([1]);
        });

        it('should return the value of a string', () => {
            expect(getArguments('"hello"')).to.eql(['hello']);
        });

        it('should return the value of a boolean', () => {
            expect(getArguments('true')).to.eql([true]);
        });

        it('should return the value of an object', () => {
            expect(getArguments('{ a: 1 }')).to.eql([{ a: 1 }]);
        });

        it('should return the value of an array', () => {
            expect(getArguments('[1, 2, 3]')).to.eql([
                [1, 2, 3]
            ]);
        });

        it('should return the value of a template string', () => {
            expect(getArguments('`hello`')).to.eql(['hello']);
        });

        it.only('work with complex template string', () => {
            expect(getArguments('`createObject("roSGNode", "BrsComponent")`')).to.eql([`createObject("roSGNode", "BrsComponent")`]);
        });
    });
});
