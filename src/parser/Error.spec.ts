/* eslint-disable */
import { expect } from 'chai';

import { Int32, ValueKind } from './brsTypes';
import { BrsError, getKind, TypeMismatch } from './Error';
import { Location } from './lexer';

describe('parser error', () => {
    let location: Location;
    beforeEach(() => {
        location = {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 3 },
            file: 'Test.brs'
        };
    });

    describe('brsError', () => {
        describe('format', () => {
            it('works', () => {
                const err = new BrsError('TestError', location);
                expect(err.format()).to.equal('Test.brs(1,0-3): TestError');
            });

            it('handles locations from different lines', () => {
                location.end = Object.assign(location.end);
                location.end.line = location.end.line + 1;
                const err = new BrsError('TestError', location);
                expect(err.format()).to.equal('Test.brs(1,0,2,2): TestError');
            });

            it('handles locations from different columns', () => {
                location.start = Object.assign(location.start);
                location.start.column = 1;
                location.end.column = 1;
                const err = new BrsError('TestError', location);
                expect(err.format()).to.equal('Test.brs(1,1): TestError');
            });
        });
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
