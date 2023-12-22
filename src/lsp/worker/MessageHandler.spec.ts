import { MessageChannel } from 'worker_threads';
import { MessageHandler } from './MessageHandler';
import { expect } from '../../chai-config.spec';

describe('MessageHandler', () => {
    let server: MessageHandler;
    let client: MessageHandler;
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
        let client = new MessageHandler({ port: channel.port2 });
        let error: Error;
        try {
            await client.sendRequest('doSomething');
        } catch (e) {
            error = e as any;
        }
        expect(error).to.exist;
        expect(error).instanceof(Error);
    });
});
