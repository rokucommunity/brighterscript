import { expect } from 'chai';

import { Int32, ValueKind } from './brsTypes';
import { getKind, TypeMismatch } from './Error';
import { Location } from './lexer';

describe('parser error', () => {
    let location: Location;
    beforeEach(() => {
        location = {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 3 }
        };
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
                    location: location
                },
                right: {
                    type: ValueKind.String,
                    location: location
                }
            });
            expect(err.message).to.equal('TestMismatch\n    left: Integer\n    right: String');
        });

        it('handles missing right item', () => {
            const location = {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 3 },
                file: 'Test.brs'
            };
            const err = new TypeMismatch({
                message: 'TestMismatch',
                left: {
                    type: ValueKind.Int32,
                    location: location
                }
            });
            expect(err.message).to.equal('TestMismatch\n    left: Integer');
        });
    });
});
