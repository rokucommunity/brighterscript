/**
 * Maintains a queued/buffered list of file operations. These operations don't actually do anything on their own.
 * You need to call the .apply() function and provide an action to operate on them.
 */
export class DocumentManager {
    private queue = new Map<string, DocumentAction>();

    /**
     * Add/set the contents of a file
     * @param document
     */
    public set(document: Document) {
        if (this.queue.has(document.paths.src)) {
            this.queue.delete(document.paths.src);
        }
        this.queue.set(document.paths.src, { action: 'set', document: document });
    }

    /**
     * Delete a file
     * @param document
     */
    public delete(document: Document) {
        if (this.queue.has(document.paths.src)) {
            this.queue.delete(document.paths.src);
        }
        this.queue.set(document.paths.src, { action: 'delete', document: document });
    }

    /**
     * Are there any pending documents that need to be flushed
     */
    public get hasPendingChanges() {
        return this.queue.size > 0;
    }

    /**
     * Indicates whether we are currently in the middle of an `apply()` session or not
     */
    public isBlocked = false;

    /**
     * Get all of the pending documents and clear the queue
     */
    public async apply<R>(action: (actions: DocumentAction[]) => any): Promise<R> {
        this.isBlocked = true;
        try {
            const documentActions = [...this.queue.values()];
            const result = await Promise.resolve(action(documentActions));
            return result;
        } finally {
            this.isBlocked = false;
        }
    }
}

export interface DocumentAction {
    action: 'set' | 'delete';
    document: Document;
}

export interface Document {
    paths: {
        src: string;
        dest: string;
    };
    getText: () => string;
}
