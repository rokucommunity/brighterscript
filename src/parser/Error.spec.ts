import { expect } from 'chai';

import { Int32, ValueKind } from '../brsTypes';
import { getKind, TypeMismatch } from './Error';
import { Range } from 'vscode-languageserver';

describe('parser error', () => {
    let range: Range;
    beforeEach(() => {
        range = Range.create(0, 0, 0, 3);
    });

    describe('getKind', () => {
        it('handles numeric values from enum', () => {
            expect(getKind(ValueKind.Boolean)).to.equal(ValueKind.Boolean);
        });
        it('handles brs types', () => {
            expect(getKind(new Int32(1))).to.equal(ValueKind.Int32);
        });
    });

    describe('TypeMismatch', () => {
        it('constructs', () => {
            const err = new TypeMismatch({
                message: 'TestMismatch',
                left: {
                    type: ValueKind.Int32,
                    range: range
                },
                right: {
                    type: ValueKind.String,
                    range: range
                }
            });
            expect(err.message).to.equal('TestMismatch\n    left: Integer\n    right: String');
        });

        it('handles missing right item', () => {
            const range = Range.create(0, 0, 0, 3);
            const err = new TypeMismatch({
                message: 'TestMismatch',
                left: {
                    type: ValueKind.Int32,
                    range: range
                }
            });
            expect(err.message).to.equal('TestMismatch\n    left: Integer');
        });
    });
});
