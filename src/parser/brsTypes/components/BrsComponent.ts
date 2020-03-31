/* eslint-disable */
import { BrsType } from "..";
import { BrsInvalid, } from "../BrsType";
import { Callable } from "../Callable";

export class BrsComponent {
    private methods: Map<string, Callable> = new Map();
    private readonly componentName: string;

    readonly interfaces: Set<string>;

    constructor(name: string, interfaces: string[] = []) {
        this.componentName = name;
        this.interfaces = new Set(interfaces);
    }

    /**
     * Returns the name of the component, used to create instances via `createObject`.
     * @returns the name of this component.
     */
    getComponentName(): string {
        return this.componentName;
    }

    protected registerMethods(methods: Callable[]) {
        this.methods = new Map(
            methods.map(m => [(m.name || "").toLowerCase(), m] as [string, Callable])
        );
    }

    getMethod(index: string): Callable | undefined {
        return this.methods.get(index.toLowerCase());
    }
}

/** Represents a BrightScript component that has elements that can be iterated across. */
export interface BrsIterable {
    /**
     * Returns the set of iterable elements contained in this component.
     * @returns an array of elements contained in this component.
     */
    getElements(): ReadonlyArray<BrsType>;

    /**
     * Retrieves an element from this component at the provided `index`.
     * @param index the index in this component from which to retrieve the desired element.
     * @returns the element at `index` if one exists, otherwise throws an Error.
     */
    get(index: BrsType): BrsType;

    set(index: BrsType, value: BrsType): BrsInvalid;
}
