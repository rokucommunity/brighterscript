import type { Expression } from '../parser/Expression';
import type { Statement } from '../parser/Statement';

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
     * Remove a property from an object
     */
    public removeProperty<T, K extends keyof T>(obj: T, key: K) {
        const change = new RemovePropertyChange(obj, key);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Set custom text that will be emitted during transpile instead of the original text.
     */
    public overrideTranspileResult(node: Expression | Statement, value: string) {
        this.setProperty(node, 'transpile', (state) => {
            return [
                state.sourceNode(node, value)
            ];
        });
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
     * Removes elements from an array and, if necessary, inserts new elements in their place, returning the deleted elements.
     * @param startIndex The zero-based location in the array from which to start removing elements.
     * @param deleteCount The number of elements to remove.
     * @param items Elements to insert into the array in place of the deleted elements.
     * @returns An array containing the elements that were deleted.
     */
    public arraySplice<T, TItems extends T = T>(array: T[], startIndex: number, deleteCount: number, ...items: TItems[]) {
        const change = new ArraySpliceChange(array, startIndex, deleteCount, items);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Push one or more values to the end of an array
     */
    public arrayPush<T, TItems extends T = T>(array: T[], ...newValues: TItems[]) {
        const change = new ArrayPushChange(array, newValues);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Pop an item from the end of the array
     */
    public arrayPop<T extends any[]>(array: T) {
        const result = array[array.length - 1];
        this.removeFromArray(array, array.length - 1);
        return result;
    }

    /**
     * Removes the first element from an array and returns that removed element. This method changes the length of the array.
     */
    public arrayShift<T extends any[]>(array: T) {
        const result = array[0];
        this.removeFromArray(array, 0);
        return result;
    }

    /**
     * Adds one or more elements to the beginning of an array and returns the new length of the array.
     */
    public arrayUnshift<T extends any[], TItems extends T = T>(array: T, ...items: TItems) {
        const change = new ArrayUnshiftChange(array, items);
        this.changes.push(change);
        change.apply();
    }

    /**
     * Change the value of an item in an array at the specified index
     */
    public setArrayValue<T extends any[], K extends keyof T>(array: T, index: number, newValue: T[K]) {
        this.setProperty(array, index, newValue);
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

class RemovePropertyChange<T, K extends keyof T> implements Change {
    constructor(
        private obj: T,
        private propertyName: K
    ) { }

    private originalValue: T[K];
    /**
     * To keep the object completely pure, this tracks whether the property existed
     * at all before applying the change (even if set to undefined).
     */
    private keyExistedBeforeChange: boolean;

    public apply() {
        this.keyExistedBeforeChange = this.obj.hasOwnProperty(this.propertyName);
        this.originalValue = this.obj[this.propertyName];
        delete this.obj[this.propertyName];
    }

    public undo() {
        if (this.keyExistedBeforeChange) {
            this.obj[this.propertyName] = this.originalValue;
        }
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

class ArrayPushChange<T extends any[], TItems extends T = T> implements Change {
    constructor(
        private array: T,
        private newValues: TItems
    ) { }

    public apply() {
        this.array.push(...this.newValues);
    }

    public undo() {
        this.array.splice(this.array.length - this.newValues.length, this.newValues.length);
    }
}

class ArraySpliceChange<T = any, TItems extends T = T> implements Change {
    constructor(
        private array: Array<T>,
        private startIndex: number,
        private deleteCount: number,
        private newValues: Array<TItems>
    ) { }

    private deletedItems: Array<TItems>;

    public apply() {
        this.deletedItems = this.array.splice(this.startIndex, this.deleteCount, ...this.newValues) as Array<TItems>;
        return [...this.deletedItems];
    }

    public undo() {
        this.array.splice(this.startIndex, this.newValues.length, ...this.deletedItems);
    }
}

class ArrayUnshiftChange<T extends any[]> implements Change {
    constructor(
        private array: T,
        private newValues: T
    ) { }

    public apply() {
        this.array.unshift(...this.newValues);
    }

    public undo() {
        this.array.splice(0, this.newValues.length);
    }
}

