import { expect } from '../chai-config.spec';
import { createStringLiteral } from './creators';

describe('creators', () => {

    describe('createStringLiteral', () => {
        it('wraps the value in quotes', () => {
            expect(createStringLiteral('hello world').tokens.value.text).to.equal('"hello world"');
        });
        it('does not wrap already-quoted value in extra quotes', () => {
            expect(createStringLiteral('"hello world"').tokens.value.text).to.equal('"hello world"');
        });

        it('does not wrap badly quoted value in additional quotes', () => {
            //leading
            expect(createStringLiteral('"hello world').tokens.value.text).to.equal('"hello world');
            //trailing
            expect(createStringLiteral('hello world"').tokens.value.text).to.equal('hello world"');
        });
    });
});
