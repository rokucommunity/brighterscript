import { DependencyGraph } from './DependencyGraph';
import * as sinon from 'sinon';
import { expect } from 'chai';

describe('DependencyGraph', () => {
    let graph: DependencyGraph;
    let onchange;
    beforeEach(() => {
        onchange = sinon.stub();
        graph = new DependencyGraph();
    });

    it('does not notify unrelated listeners', () => {
        graph.addOrReplace('a', ['b']);
        graph.addOrReplace('a', ['c']);
        let mockA = sinon.mock();
        let mockB = sinon.mock();
        graph.onchange('a', mockA);
        graph.onchange('b', mockB);
        graph.addOrReplace('c');
        expect(mockA.callCount).to.equal(1);
        expect(mockB.callCount).to.equal(0);
    });

    it('supports subscribing to item before it exists', () => {
        graph.onchange('a', onchange);
        graph.addOrReplace('a');
        expect(onchange.callCount).to.equal(1);
    });

    it('supports subscribing to item after it exists', () => {
        graph.addOrReplace('a', ['b']);
        graph.onchange('a', onchange);
        graph.addOrReplace('a', ['c']);
        expect(onchange.callCount).to.equal(1);
    });

    it('notifies grandparent of grandchild changes', () => {
        graph.onchange('a', onchange);
        graph.addOrReplace('a', ['b']);
        expect(onchange.callCount).to.equal(1);
        graph.addOrReplace('b', ['c']);
        expect(onchange.callCount).to.equal(2);
        graph.addOrReplace('c', ['d']);
        expect(onchange.callCount).to.equal(3);
        graph.addOrReplace('c', ['e']);
        expect(onchange.callCount).to.equal(4);
    });

    it('updates allDependencies list when dependency changes', () => {
        graph.addOrReplace('a', ['b']);
        graph.addOrReplace('b', ['c']);
        expect(graph.nodes['a'].getAllDependencies().sort()).to.eql(['b', 'c']);
        graph.addOrReplace('b', ['d', 'e']);
        expect(graph.nodes['a'].getAllDependencies().sort()).to.eql(['b', 'd', 'e']);
    });

    describe('remove', () => {
        it('notifies parents', () => {
            graph.addOrReplace('a', ['b']);
            graph.addOrReplace('b', ['c']);
            expect(graph.nodes['a'].getAllDependencies().sort()).to.eql(['b', 'c']);
            graph.remove('b');
            expect(graph.nodes['a'].getAllDependencies().sort()).to.eql(['b']);
        });
    });

    describe('addDependency', () => {
        it('adds a new node when it does not exist', () => {
            expect(graph.nodes['a']).not.to.exist;
            graph.addDependency('a', 'b');
            expect(graph.nodes['a']).to.exist;
        });

        it('adds a new entry', () => {
            graph.addOrReplace('a');
            expect(graph.getAllDependencies('a')).to.eql([]);
            graph.addDependency('a', 'b');
            expect(graph.getAllDependencies('a')).to.eql(['b']);
            //doesn't double-add
            graph.addDependency('a', 'b');
            expect(graph.getAllDependencies('a')).to.eql(['b']);
        });
    });

    describe('removeDependency', () => {
        it('does not throw when node does not exist', () => {
            graph.removeDependency('a', 'b');
            //did not throw, test passes!
        });
        it('removes dependency', () => {
            graph.addOrReplace('a', ['b']);
            expect(graph.nodes['a'].dependencies).to.eql([
                'b'
            ]);
            graph.removeDependency('a', 'b');
            expect(graph.nodes['a'].dependencies).to.be.empty;
        });
    });

    describe('getAllDependencies', () => {
        it('does not throw and returns empty array when node does not exist', () => {
            expect(graph.getAllDependencies('a')).to.eql([]);
        });
        it('returns empty list for known dependency', () => {
            graph.addOrReplace('a', []);
            expect(graph.getAllDependencies('a')).to.eql([]);
        });
        it('returns dependencies', () => {
            graph.addOrReplace('a', ['b']);
            expect(graph.getAllDependencies('a')).to.eql([
                'b'
            ]);
        });

        it('does not return duplicate dependencies', () => {
            graph.addOrReplace('a', ['b', 'c']);
            graph.addOrReplace('b', ['c']);
            expect(graph.getAllDependencies('a').sort()).to.eql([
                'b',
                'c'
            ]);
        });

        it('skips dependencies and their descendent dependencies', () => {
            graph.addOrReplace('a', ['b', 'c']);
            graph.addOrReplace('b', ['d', 'e']);
            graph.addOrReplace('c', ['f', 'g']);
            expect(graph.getAllDependencies('a', ['c']).sort()).to.eql([
                'b',
                'd',
                'e'
            ]);
        });
    });

    describe('onchange', () => {
        it('emits when nodes are changed', () => {
            let mock = sinon.mock();
            graph.onchange('a', mock);
            graph.addOrReplace('a');
            expect(mock.callCount).to.equal(1);
        });

        it('emits immediately when configured to do so', () => {
            let mock = sinon.mock();
            graph.onchange('a', mock, true);
            expect(mock.callCount).to.equal(1);
        });
    });

    describe('dispose', () => {
        it('does not throw', () => {
            graph.addOrReplace('a');
            graph.dispose();
            //did not throw...test passes
        });
    });
});
