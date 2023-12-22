import { EventEmitter } from 'eventemitter3';
/**
 * A graph of files and their dependencies.
 * Each file will only contain nodes that they directly reference (i.e. script imports, inheritance, etc)
 */
export class DependencyGraph {
    /**
     * A dictionary of all unique nodes in the entire graph
     */
    public nodes = {} as Record<string, Node>;

    /**
     * An internal event emitter for when keys have changed.
     */
    private onchangeEmitter = new EventEmitter<string, DependencyChangedEvent>();

    /**
     * Add a node to the graph.
     */
    public addOrReplace(key: string, dependencies?: string[]) {
        //sort the dependencies
        dependencies = dependencies?.sort() ?? [];

        //dispose any existing node
        this.nodes[key]?.dispose();

        //create a new dependency node
        let node = new Node(key, dependencies, this);
        this.nodes[key] = node;
        this.emit(key, { sourceKey: key, notifiedKeys: new Set() });
    }

    /**
     * Add a new dependency to an existing node (or create a new node if the node doesn't exist
     */
    public addDependency(key: string, dependencyKey: string) {
        let existingNode = this.nodes[key];
        if (existingNode) {
            let dependencies = existingNode.dependencies.includes(dependencyKey) ? existingNode.dependencies : [dependencyKey, ...existingNode.dependencies];
            this.addOrReplace(key, dependencies);
        } else {
            this.addOrReplace(key, [dependencyKey]);
        }
    }

    /**
     * Remove a dependency from an existing node.
     * Do nothing if the node does not have that dependency.
     * Do nothing if that node does not exist
     */
    public removeDependency(key: string, dependencyKey: string) {
        let existingNode = this.nodes[key];
        let idx = (existingNode?.dependencies ?? []).indexOf(dependencyKey);
        if (existingNode && idx > -1) {
            existingNode.dependencies.splice(idx, 1);
            this.addOrReplace(key, existingNode.dependencies);
        }
    }

    /**
     * Get a list of the dependencies for the given key, recursively.
     * @param keys the key (or keys) for which to get the dependencies
     * @param exclude a list of keys to exclude from traversal. Anytime one of these nodes is encountered, it is skipped.
     */
    public getAllDependencies(keys: string | string[] | undefined, exclude?: string[]) {
        if (typeof keys === 'string') {
            return this.nodes[keys]?.getAllDependencies(exclude) ?? [];
        } else if (keys === undefined) {
            return [];
        } else {
            console.log(`keys: ${String(keys)}`);
            const set = new Set<string>();
            for (const key of keys) {
                const dependencies = this.getAllDependencies(key, exclude);
                for (const dependency of dependencies) {
                    set.add(dependency);
                }
            }
            return [...set];
        }
    }

    /**
     * Remove the item. This will emit an onchange event for all dependent nodes
     */
    public remove(key: string) {
        this.nodes[key]?.dispose();
        delete this.nodes[key];
        this.emit(key, { sourceKey: key, notifiedKeys: new Set() });
    }

    /**
     * Emit event that this item has changed
     */
    public emit(key: string, event: DependencyChangedEvent) {
        //prevent infinite event loops by skipping already-notified keys
        if (!event.notifiedKeys.has(key)) {
            event.notifiedKeys.add(key);
            this.onchangeEmitter.emit(key, event);
        }
    }

    /**
     * Listen for any changes to dependencies with the given key.
     * @param key the name of the dependency
     * @param handler a function called anytime changes occur
     */
    public onchange(key: string, handler: (event: DependencyChangedEvent) => void) {
        this.onchangeEmitter.on(key, handler);
        return () => {
            this.onchangeEmitter.off(key, handler);
        };
    }

    public dispose() {
        for (let key in this.nodes) {
            let node = this.nodes[key];
            node.dispose();
        }
        this.onchangeEmitter.removeAllListeners();
    }
}

export interface DependencyChangedEvent {
    /**
     * The key that was the initiator of this event. Child keys will emit this same event object, but this key will remain the same
     */
    sourceKey: string;
    /**
     * A set of keys that have already been notified of this change. Used to prevent circular reference notification cycles
     */
    notifiedKeys: Set<string>;
}

export class Node {
    public constructor(
        public key: string,
        public dependencies: string[],
        public graph: DependencyGraph
    ) {
        if (dependencies.length > 0) {
            this.subscriptions = [];
        }
        for (let dependency of this.dependencies) {
            let sub = this.graph.onchange(dependency, (event) => {
                //notify the graph that we changed since one of our dependencies changed
                this.graph.emit(this.key, event);
            });

            this.subscriptions.push(sub);
        }
    }
    private subscriptions: Array<() => void>;

    /**
     * Return the full list of unique dependencies for this node by traversing all descendents
     * @param exclude a list of keys to exclude from traversal. Anytime one of these nodes is encountered, it is skipped.
     */
    public getAllDependencies(exclude: string[] = []) {
        let dependencyMap = {};
        let dependencyStack = [...this.dependencies];
        //keep walking the dependency graph until we run out of unseen dependencies
        while (dependencyStack.length > 0) {
            let dependency = dependencyStack.pop();

            //if this is a new dependency and we aren't supposed to skip it
            if (!dependencyMap[dependency] && !exclude.includes(dependency)) {
                dependencyMap[dependency] = true;

                //get the node for this dependency
                let node = this.graph.nodes[dependency];
                if (node) {
                    dependencyStack.push(...node.dependencies);
                }
            }
        }
        return Object.keys(dependencyMap);
    }

    public dispose() {
        for (let unsubscribe of this.subscriptions ?? []) {
            unsubscribe();
        }
    }
}
