import * as fsExtra from 'fs';
import { expect } from '../chai-config.spec';
import { getManifest, getBsConst, parseManifest, parseManifestEntries } from './Manifest';
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

    describe('parseManifestEntries (line-aware)', () => {
        it('returns entries with key, value, and a range that covers just the value', () => {
            const entries = parseManifestEntries(trim`
                title=t
                rsg_version=1.2
            `);
            expect(entries).to.have.lengthOf(2);
            expect(entries[0]).to.deep.include({ key: 'title', value: 't' });
            expect(entries[0].range.start).to.eql({ line: 0, character: 6 });
            expect(entries[0].range.end).to.eql({ line: 0, character: 7 });
            expect(entries[1]).to.deep.include({ key: 'rsg_version', value: '1.2' });
            expect(entries[1].range.start).to.eql({ line: 1, character: 12 });
            expect(entries[1].range.end).to.eql({ line: 1, character: 15 });
        });

        it('skips empty lines and comments without breaking line numbers', () => {
            const entries = parseManifestEntries(trim`
                # comment

                title=t
                # another
                rsg_version=1.3
            `);
            expect(entries).to.have.lengthOf(2);
            expect(entries[0].key).to.equal('title');
            expect(entries[0].range.start.line).to.equal(2);
            expect(entries[1].key).to.equal('rsg_version');
            expect(entries[1].range.start.line).to.equal(4);
        });

        it('handles CRLF line endings', () => {
            //CRLF must be a literal `\r\n` in the source — template-literal whitespace stripping
            //cannot reliably produce CRLF, so keep the explicit form here.
            const entries = parseManifestEntries(`title=t\r\nrsg_version=1.2\r\n`);
            expect(entries).to.have.lengthOf(2);
            expect(entries[1].range.start.line).to.equal(1);
        });

        it('throws on lines with no equals sign', () => {
            expect(() => parseManifestEntries('not_a_key_value_line')).to.throw(/No '=' detected/);
        });

        it('parseManifest is consistent with parseManifestEntries', () => {
            const contents = trim`
                title=t
                rsg_version=1.2
                bs_const=DEBUG=true
            `;
            const map = parseManifest(contents);
            const entries = parseManifestEntries(contents);
            //every entry's key should be in the map with the same value
            for (const entry of entries) {
                expect(map.get(entry.key)).to.equal(entry.value);
            }
            //and the map's size matches entry count
            expect(map.size).to.equal(entries.length);
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
