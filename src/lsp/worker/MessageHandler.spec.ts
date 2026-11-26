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

    it('is safe to call dispose() twice, even with pending requests', async () => {
        let localServer = new MessageHandler({
            port: channel.port1,
            onRequest: (request) => {
                //never respond, so the request stays pending
            }
        });
        let localClient = new MessageHandler<LspProject>({ port: channel.port2 });

        const pendingRequest = localClient.sendRequest('activate');

        //first dispose should reject the pending request
        localClient.dispose();
        let error: Error;
        try {
            await pendingRequest;
        } catch (e) {
            error = e as any;
        }
        expect(error).to.exist;

        //second dispose should be a no-op, not throw
        expect(() => localClient.dispose()).to.not.throw();

        localServer.dispose();
    });

    it('reject is only sent once when dispose is called multiple times', async () => {
        let localServer = new MessageHandler({
            port: channel.port1,
            onRequest: (request) => {
                //never respond, so the request stays pending
            }
        });
        let localClient = new MessageHandler<LspProject>({ port: channel.port2 });

        const pendingRequest = localClient.sendRequest('activate');

        //first dispose should reject the pending request
        localClient.dispose();
        let error: Error;
        try {
            await pendingRequest;
        } catch (e) {
            error = e as any;
        }
        expect(error?.message).to.eql('Request 0 has been rejected because MessageHandler is now disposed');

        //second dispose should not cause any additional errors
        localClient.dispose();
        localClient.dispose();
        //no errors thrown = test passes

        localServer.dispose();
    });

    it('rejects sendRequest() calls made after dispose()', async () => {
        let client = new MessageHandler<LspProject>({ port: channel.port2 });
        client.dispose();

        let error: Error;
        try {
            await client.sendRequest('activate');
        } catch (e) {
            error = e as any;
        }
        expect(error).to.exist;
        expect(error.message).to.include('disposed');
    });
});
