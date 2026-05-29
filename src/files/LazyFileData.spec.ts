import { expect } from 'chai';
import { LazyFileData } from './LazyFileData';

describe('LazyFileData', () => {
    it('lazy loads string data', () => {
        const data = new LazyFileData('cat');
        expect(data['initialData']).to.eql('cat');
        expect(data['resolvedData']).to.be.undefined;
        expect(data.isValueLoaded).to.be.false;

        //now lazy-load the data
        expect(Buffer.isBuffer(data.value)).to.be.true;
        expect(data['initialData']).to.be.undefined;
        expect(data['resolvedData']?.toString()).to.eql('cat');
        expect(data.isValueLoaded).to.be.true;
    });

    it('supports LazyFileData as initialData', () => {
        const data = new LazyFileData(
            new LazyFileData('cat')
        );
        expect(data.value?.toString()).to.eql('cat');
    });

    it('supports Buffer', () => {
        expect(
            new LazyFileData(Buffer.from('cat')).value.toString()
        ).to.eql('cat');
    });
});
