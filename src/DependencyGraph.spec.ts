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

    it('does not emit when dependencies did not change', () => {
        graph.addOrReplace('a', ['b']);
        graph.onchange('a', onchange);
        graph.addOrReplace('a', ['b']);
        expect(onchange.callCount).to.equal(0);
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
});
