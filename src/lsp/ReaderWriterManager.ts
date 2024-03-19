import { MaybePromise } from '..';
import { Deferred } from '../deferred';

/**
 * Manages multiple readers and writers, and ensures that no readers are reading while a writer is writing.
 * This is useful when multiple file changes show up but we also got a completions request, so we need to wait
 * until the files have been written and the program is validated before executing the completions request
 */
export class ReaderWriterManager {

    private readers: Array<ReaderWriter>;

    private writers: Array<ReaderWriter>;

    /**
     * Register a read action
     * @param action
     */
    public read(action: Action) {
        const reader = {
            action: action,
            deferred: new Deferred()
        };
        this.readers.push(reader);
        void this.execute();
        return reader.deferred.promise;
    }

    /**
     * Register a write action
     * @param action
     */
    public write(action: Action) {
        const writer = {
            action: action,
            deferred: new Deferred()
        };
        this.writers.push(writer);
        void this.execute();
        return writer.deferred.promise;
    }

    private async execute() {
        let item: ReaderWriter;
        if (this.writers.length > 0) {
            item = this.writers.pop();
        } else if (this.readers.length > 0) {
            item = this.readers.pop();

            //there are no more readers or writers, so quit.
        } else {
            return;
        }
        //execute the item
        try {
            const result = await Promise.resolve(
                item.action()
            );
            item.deferred.resolve(result);
        } catch (e) {
            item.deferred.reject(e);
        }
        //execute the next action (if there is one)
        void this.execute();
    }
}

type Action = () => MaybePromise<any>;

interface ReaderWriter {
    action: Action;
    deferred: Deferred;
}
