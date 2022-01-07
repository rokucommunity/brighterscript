export class AstEditor {
    private changes: Change[] = [];

    /**
     * Indicates whether the editor have changes that were applied
     */
    public get hasChanges() {
        return this.changes.length > 0;
    }

    /**
     * Change the value of an object's property
     */
    public setProperty<T, K extends keyof T>(obj: T, key: K, newValue: T[K]) {
        const change = new EditPropertyChange(obj, key, newValue);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Insert an element into an array at the specified index
     */
    public addToArray<T extends any[]>(array: T, index: number, newValue: T[0]) {
        const change = new AddToArrayChange(array, index, newValue);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Remove an element from an array at the specified index
     */
    public removeFromArray<T extends any[]>(array: T, index: number) {
        const change = new RemoveFromArrayChange(array, index);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Unto all changes.
     */
    public undoAll() {
        for (let i = this.changes.length - 1; i >= 0; i--) {
            this.changes[i].undo();
        }
        this.changes = [];
    }
}

interface Change {
    apply();
    undo();
}

class EditPropertyChange<T, K extends keyof T> implements Change {
    constructor(
        private obj: T,
        private propertyName: K,
        private newValue: T[K]
    ) { }

    private originalValue: T[K];

    public apply() {
        this.originalValue = this.obj[this.propertyName];
        this.obj[this.propertyName] = this.newValue;
    }

    public undo() {
        this.obj[this.propertyName] = this.originalValue;
    }
}

class AddToArrayChange<T extends any[]> implements Change {
    constructor(
        private array: T,
        private index: number,
        private newValue: any
    ) { }

    public apply() {
        this.array.splice(this.index, 0, this.newValue);
    }

    public undo() {
        this.array.splice(this.index, 1);
    }
}

/**
 * Remove an item from an array
 */
class RemoveFromArrayChange<T extends any[]> implements Change {
    constructor(
        private array: T,
        private index: number
    ) { }

    private originalValue: any;

    public apply() {
        [this.originalValue] = this.array.splice(this.index, 1);
    }

    public undo() {
        this.array.splice(this.index, 0, this.originalValue);
    }
}
