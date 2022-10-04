import * as fsExtra from 'fs';
import { expect } from '../chai-config.spec';
import { getManifest, getBsConst, parseManifest } from './Manifest';
import { createSandbox } from 'sinon';
import { expectThrows, mapToObject, objectToMap, trim } from '../testHelpers.spec';
const sinon = createSandbox();

describe('manifest support', () => {
    beforeEach(() => {
        sinon.restore();
    });
    afterEach(() => {
        sinon.restore();
    });

    describe('manifest parser', () => {
        it('returns an empty map if manifest not found', async () => {
            sinon.stub(fsExtra, 'readFile').returns(<any>
                Promise.reject(
                    new Error('File not found')
                )
            );

            return expect(await getManifest('/no/manifest/here')).to.eql(new Map());
        });

        it('rejects key-value pairs with no \'=\'', () => {
            expectThrows(() => {
                parseManifest('key');
            });
        });

        it('ignores comments', () => {
            return expect(parseManifest('')).to.eql(new Map());
        });

        it('retains whitespace for keys and values', () => {
            expect(
                mapToObject(
                    parseManifest(' leading interum and trailing key spaces = value ')
                )
            ).to.eql({
                ' leading interum and trailing key spaces ': ' value '
            });
        });

        it('does not convert values to primitives', () => {
            expect(
                mapToObject(
                    parseManifest(trim`
                        name=bob
                        age=12
                        enabled=true
                        height=1.5
                    `)
                )
            ).to.eql({
                name: 'bob',
                age: '12',
                enabled: 'true',
                height: '1.5'
            });
        });
    });

    describe('bs_const parser', () => {
        function test(manifest: string, expected) {
            expect(
                getBsConst(
                    parseManifest(manifest)
                )
            ).to.eql(
                objectToMap(expected)
            );
        }

        it('returns an empty map if \'bs_const\' isn\'t found', () => {
            test('', new Map());
        });

        it('ignores empty key-value pairs', () => {
            test('bs_const=;;;;', new Map());
        });

        it('rejects key-value pairs with no \'=\'', () => {
            expectThrows(() => test(`bs_const=i-have-no-equal`, {}), `No '=' detected for key i-have-no-equal.  bs_const constants must be of the form 'key=value'.`);
        });

        it('trims whitespace from keys and values', () => {
            let manifest = new Map([['bs_const', '   key   =  true  ']]);
            expect(getBsConst(manifest)).to.eql(new Map([['key', true]]));
        });

        it('rejects non-boolean values', () => {
            const manifest = new Map([['bs_const', 'string=word']]);
            expectThrows(() => {
                getBsConst(manifest);
            });
        });

        it('allows case-insensitive booleans', () => {
            let manifest = new Map([['bs_const', 'foo=true;bar=FalSE']]);

            expect(getBsConst(manifest)).to.eql(
                new Map([
                    ['foo', true],
                    ['bar', false]
                ])
            );
        });
    });
});
