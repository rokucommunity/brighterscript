import { EventEmitter } from 'eventemitter3';
import { util } from './util';
/**
 * A graph of files and their dependencies.
 * Each file will only contain nodes that they directly reference (i.e. script imports, inheritance, etc)
 */
export class DependencyGraph {
    /**
     * A dictionary of all unique nodes in the entire graph
     */
    public nodes = {} as { [key: string]: Node };

    private onchangeEmitter = new EventEmitter();

    /**
     * Add a node to the graph.
     */
    public addOrReplace(key: string, dependencies?: string[]) {
        //sort the dependencies
        dependencies = dependencies?.sort() ?? [];

        let existingNode = this.nodes[key];

        //if the dependencies array hasn't changed
        if (existingNode && util.areArraysEqual(dependencies, existingNode.dependencies)) {
            //do nothing, the dependencies haven't changed

            //create a new dependency node
        } else {
            let node = new Node(key, dependencies, this);
            this.nodes[key] = node;
            this.onchangeEmitter.emit(key, key);
        }
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
     * Get a list of all the dependencies for the given key
     */
    public getAllDependencies(key: string) {
        return this.nodes[key]?.allDependencies ?? [];
    }

    /**
     * Remove the item. This will emit an onchange event for all dependent nodes
     */
    public remove(key: string) {
        delete this.nodes[key];
        this.onchangeEmitter.emit(key, key);
    }

    /**
     * Emit event that this item has changed
     */
    public emit(key: string) {
        this.onchangeEmitter.emit(key, key);
    }

    /**
     * Listen for any changes to dependencies with the given key.
     * @param emitImmediately if true, the handler will be called once immediately.
     */
    public onchange(key: string, handler: (key) => void, emitImmediately = false) {
        this.onchangeEmitter.on(key, handler);
        if (emitImmediately) {
            this.onchangeEmitter.emit(key, key);
        }
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
            let sub = this.graph.onchange(dependency, (dependency) => {
                //notify the graph that we changed since one of our dependencies changed
                this.graph.emit(this.key);

                //erase our full dependency list so it can be regenerated on next read
                this._allDependencies = undefined;
            });

            this.subscriptions.push(sub);
        }
    }
    private subscriptions: Array<() => void>;

    /**
     * The full list of dependencies for this node and all descendent nodes
     */
    public get allDependencies() {
        if (!this._allDependencies) {
            this._allDependencies = this.getAllDependencies();
        }
        return this._allDependencies;
    }
    private _allDependencies: string[];

    /**
     * Return the full list of unique dependencies for this node by traversing all descendents
     */
    private getAllDependencies() {
        let dependencyMap = {};
        let dependencyStack = [...this.dependencies];
        //keep walking the dependency graph until we run out of unseen dependencies
        while (dependencyStack.length > 0) {
            let dependency = dependencyStack.pop();

            //if this is a new dependency
            if (!dependencyMap[dependency]) {
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
