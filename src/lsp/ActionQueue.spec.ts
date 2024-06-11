import { expect } from "chai";
import { ActionQueue } from "./ActionQueue";
import util from "../util";
import { Deferred } from "../deferred";
import { expectThrowsAsync } from "../testHelpers.spec";
import { CancellationToken } from "vscode-languageserver-protocol";

describe.only('ActionQueue', () => {
    let queue: ActionQueue;

    beforeEach(() => {
        queue = new ActionQueue();
    });

    it('runs successful actions in sequence', async () => {
        let results = [];
        queue.run(() => {
            results.push(1);
        });
        await queue.run(() => {
            results.push(2);
        });
        expect(results).to.eql([1, 2]);
    });

    it('runs actions after a failed action', async () => {
        let results = [];
        queue.run(() => {
            results.push(1);
        });
        queue.run(() => {
            throw new Error('Crash');
        });
        await queue.run(() => {
            results.push(3);
        });
        expect(results).to.eql([1, 3]);
    });

    it('properly serializes bigInt', async () => {
        queue = new ActionQueue({
            maxActionDuration: 1
        });
        await expectThrowsAsync(async () => {
            await queue.run(async () => {
                await util.sleep(10);
            }, BigInt(1))
        }, 'Action took longer than 1ms to complete. Data: "1"');
    });

    it('rejects action that took too long, and marks cancellationToken accordingly', async () => {
        queue = new ActionQueue({
            maxActionDuration: 100
        });
        let cancellationToken: CancellationToken;
        let results = [];

        let task1Deferred = new Deferred();
        let task1Promise = queue.run(async (data, token) => {
            await util.sleep(200);
            cancellationToken = token;
            if (!cancellationToken.isCancellationRequested) {
                results.push(1);
            }
            task1Deferred.resolve();
        });

        await queue.run(() => {
            results.push(2);
        });
        expect(results).to.eql([2]);

        //wait for task 1's promise to finish and verify we get an error
        let error;
        try {
            await task1Promise;
        } catch (e) {
            error = e;
        }
        expect(error?.message).to.eql('Action took longer than 100ms to complete. Data: undefined');
        //now wait for task1's work to actually finish
        await task1Deferred.promise;
        //the token should be marked as cancelled
        expect(cancellationToken.isCancellationRequested).to.be.true;
    });
});
