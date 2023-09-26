import { expect } from './chai-config.spec';
import * as sinon from 'sinon';
import { Logger } from './Logger';
import PluginInterface from './PluginInterface';

describe('PluginInterface', () => {
    let pluginInterface: PluginInterface;

    beforeEach(() => {
        pluginInterface = new PluginInterface([], { logger: new Logger() });
    });

    it('allows adding a plugin', () => {
        const beforePublish = sinon.spy();
        const plugin = {
            name: 'allows adding a plugin',
            beforePublish: beforePublish
        };
        pluginInterface.emit('beforeProgramCreate', {} as any);
        pluginInterface.add(plugin);
        pluginInterface.emit('beforeProgramCreate', {} as any);
        expect(beforePublish.callCount).to.equal(1);
    });

    it('allows testing whether a plugin is registered', () => {
        const plugin = {
            name: 'allows testing whether a plugin is registered'
        };
        expect(pluginInterface.has(plugin)).to.be.false;
        pluginInterface.add(plugin);
        expect(pluginInterface.has(plugin)).to.be.true;
    });

    it('does not allows adding a plugin multiple times', () => {
        const beforeProgramCreate = sinon.spy();
        const plugin = {
            name: 'does not allows adding a plugin multiple times',
            beforeProgramCreate: beforeProgramCreate
        };
        pluginInterface.add(plugin);
        pluginInterface.add(plugin);
        pluginInterface.emit('beforeProgramCreate', {} as any);

        expect(beforeProgramCreate.callCount).to.equal(1);
        pluginInterface.remove(plugin);
        expect(pluginInterface.has(plugin)).to.be.false;
    });

    it('allows removing a plugin', () => {
        const beforeProgramCreate = sinon.spy();
        const plugin = {
            name: 'allows removing a plugin',
            beforeProgramCreate: beforeProgramCreate
        };
        pluginInterface.add(plugin);
        pluginInterface.emit('beforeProgramCreate', {} as any);
        expect(beforeProgramCreate.callCount).to.equal(1);
        pluginInterface.remove(plugin);
        pluginInterface.emit('beforeProgramCreate', {} as any);
        expect(beforeProgramCreate.callCount).to.equal(1);
    });
});
