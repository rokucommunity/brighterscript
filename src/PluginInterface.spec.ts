/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { expect } from './chai-config.spec';
import * as sinon from 'sinon';
import PluginInterface from './PluginInterface';
import { createLogger } from './logging';

describe('PluginInterface', () => {
    let pluginInterface: PluginInterface;

    beforeEach(() => {
        pluginInterface = new PluginInterface([], { logger: createLogger() });
    });

    it('allows adding a plugin', () => {
        const beforeSerializeProgram = sinon.spy();
        const plugin = {
            name: 'allows adding a plugin',
            beforeSerializeProgram: beforeSerializeProgram
        };
        pluginInterface.emit('beforeSerializeProgram', {} as any);
        pluginInterface.add(plugin);
        pluginInterface.emit('beforeSerializeProgram', {} as any);
        expect(beforeSerializeProgram.callCount).to.equal(1);
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
        const beforeSerializeProgram = sinon.spy();
        const plugin = {
            name: 'does not allows adding a plugin multiple times',
            beforeSerializeProgram: beforeSerializeProgram
        };
        pluginInterface.add(plugin);
        pluginInterface.add(plugin);
        pluginInterface.emit('beforeSerializeProgram', {} as any);

        expect(beforeSerializeProgram.callCount).to.equal(1);
        pluginInterface.remove(plugin);
        expect(pluginInterface.has(plugin)).to.be.false;
    });

    it('allows removing a plugin', () => {
        const beforeSerializeProgram = sinon.spy();
        const plugin = {
            name: 'allows removing a plugin',
            beforeSerializeProgram: beforeSerializeProgram
        };
        pluginInterface.add(plugin);
        pluginInterface.emit('beforeSerializeProgram', {} as any);
        expect(beforeSerializeProgram.callCount).to.equal(1);
        pluginInterface.remove(plugin);
        pluginInterface.emit('beforeSerializeProgram', {} as any);
        expect(beforeSerializeProgram.callCount).to.equal(1);
    });
});
