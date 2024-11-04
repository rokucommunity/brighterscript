import { MessageChannel } from 'worker_threads';
import { MessageHandler } from './MessageHandler';
import { expect } from '../../chai-config.spec';
import type { LspProject } from '../LspProject';
import util from '../../util';

describe('MessageHandler', () => {
    let server: MessageHandler<LspProject>;
    let client: MessageHandler<LspProject>;
    let channel: MessageChannel;

    beforeEach(() => {
        channel = new MessageChannel();
    });

    afterEach(() => {
        server?.dispose();
        client?.dispose();
        channel.port1.close();
        channel.port2.close();
    });

    it('serializes an error when present', async () => {
        let server = new MessageHandler({
            port: channel.port1,
            onRequest: (request) => {
                server.sendResponse(request, {
                    error: new Error('Crash')
                });
            }
        });
        let client = new MessageHandler<LspProject>({ port: channel.port2 });
        let error: Error;
        try {
            await client.sendRequest('activate');
        } catch (e) {
            error = e as any;
        }
        expect(error).to.exist;
        expect(error).instanceof(Error);
    });

    it('terminates pending request promises when disposed', async () => {
        let server = new MessageHandler({
            port: channel.port1,
            onRequest: (request) => {
                //never respond to any requests
            }
        });
        let client = new MessageHandler<LspProject>({ port: channel.port2 });
        let error: Error;
        //send a request that will never be responded to
        let responsePromise = client.sendRequest('activate');
        //sleep a bit to settle
        await util.sleep(10);
        server.dispose();
        client.dispose();
        try {
            await responsePromise;
        } catch (e) {
            error = e as any;
        }
        expect(error?.message).to.eql('Request 0 has been rejected because MessageHandler is now disposed');
    });
});
