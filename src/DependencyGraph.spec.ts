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
});
