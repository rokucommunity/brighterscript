import type { BrsValue } from '../BrsType';
import { ValueKind, BrsString, BrsInvalid, BrsBoolean, Uninitialized, valueKindToString } from '../BrsType';
import type { BrsIterable } from './BrsComponent';
import { BrsComponent } from './BrsComponent';
import type { BrsType } from '..';
import { Callable, StdlibArgument } from '../Callable';
declare type Interpreter = any;
import { Int32 } from '../Int32';
import type { AAMember } from './RoAssociativeArray';
import { RoAssociativeArray } from './RoAssociativeArray';
import { RoArray } from './RoArray';
import { Float } from '../Float';

class Field {
    private type: string;
    private value: BrsType;
    private observers: string[] = [];

    constructor(value: BrsType, private alwaysNotify: boolean) {
        this.type = valueKindToString(value.kind);
        this.value = value;
    }

    toString(parent?: BrsType): string {
        return this.value.toString(parent);
    }

    getType(): string {
        return this.type;
    }

    getValue(): BrsType {
        return this.value;
    }

    setValue(value: BrsType) {
        // This is where the Callbacks are called
        if (this.alwaysNotify || this.value !== value) {
            this.executeCallbacks();
        }
        this.value = value;
    }

    addObserver(functionName: BrsString) {
        this.observers.push(functionName.value);
    }

    private executeCallbacks() { }
}

export class RoSGNode extends BrsComponent implements BrsValue, BrsIterable {
    readonly kind = ValueKind.Object;
    private fields = new Map<string, Field>();
    private children: RoSGNode[] = [];
    private parent: RoSGNode | BrsInvalid = BrsInvalid.Instance;
    readonly builtInFields = [
        { name: 'change', type: 'roAssociativeArray' },
        { name: 'focusable', type: 'boolean' },
        { name: 'focusedChild', type: 'dynamic' },
        { name: 'id', type: 'string' }
    ];

    constructor(members: AAMember[], readonly type: string = 'Node') {
        super('roSGNode');

        // All nodes start have some built-in fields when created
        this.builtInFields.forEach(field => {
            this.fields.set(
                field.name.toLowerCase(),
                new Field(this.getDefaultValue(field.type), false)
            );
        });

        members.forEach(member => this.fields.set(member.name.value.toLowerCase(), new Field(member.value, false))
        );

        this.registerMethods([
            // ifAssociativeArray methods
            this.clear,
            this.delete,
            this.addreplace,
            this.count,
            this.doesexist,
            this.append,
            this.keys,
            this.items,
            this.lookup,
            //ifSGNodeField methods
            this.addfield,
            this.addfields,
            this.getfield,
            this.observefield,
            this.removefield,
            this.setfield,
            this.setfields,
            this.update,
            // ifSGNodeChildren methods
            this.appendchild,
            this.getchildcount,
            this.getchildren,
            this.removechild,
            this.getparent,
            this.createchild,
            // ifSGNodeFocus methods
            this.hasfocus,
            this.setfocus,
            this.isinfocuschain,
            //ifSGNodeDict
            this.findnode
        ]);
    }

    toString(parent?: BrsType): string {
        let componentName = 'roSGNode:' + this.type;

        if (parent) {
            return `<Component: ${componentName}>`;
        }

        return [
            `<Component: ${componentName}> =`,
            '{',
            ...Array.from(this.fields.entries()).map(
                ([key, value]) => `    ${key}: ${value.toString(this)}`
            ),
            '}'
        ].join('\n');
    }

    equalTo(other: BrsType) {
        // SceneGraph nodes are never equal to anything
        return BrsBoolean.False;
    }

    getElements() {
        return Array.from(this.fields.keys())
            .sort()
            .map(key => new BrsString(key));
    }

    getValues() {
        return Array.from(this.fields.values())
            .sort()
            .map((field: Field) => field.getValue());
    }

    getFields() {
        return this.fields;
    }

    get(index: BrsType) {
        if (index.kind !== ValueKind.String) {
            throw new Error('RoSGNode indexes must be strings');
        }

        // TODO: this works for now, in that a property with the same name as a method essentially
        // overwrites the method. The only reason this doesn't work is that getting a method from an
        // associative array and _not_ calling it returns `invalid`, but calling it returns the
        // function itself. I'm not entirely sure why yet, but it's gotta have something to do with
        // how methods are implemented within RBI.
        //
        // Are they stored separately from elements, like they are here? Or does
        // `Interpreter#visitCall` need to check for `invalid` in its callable, then try to find a
        // method with the desired name separately? That last bit would work but it's pretty gross.
        // That'd allow roArrays to have methods with the methods not accessible via `arr["count"]`.
        // Same with RoAssociativeArrays I guess.
        let field = this.fields.get(index.value.toLowerCase());
        if (field) {
            return field.getValue();
        }
        return this.getMethod(index.value) || BrsInvalid.Instance;
    }

    set(index: BrsType, value: BrsType, alwaysNotify = false) {
        if (index.kind !== ValueKind.String) {
            throw new Error('RoSGNode indexes must be strings');
        }
        let mapKey = index.value.toLowerCase();
        let field = this.fields.get(mapKey);
        let valueType = valueKindToString(value.kind);

        if (!field) {
            field = new Field(value, alwaysNotify);
        } else if (field.getType() === valueType) {
            //Fields are not overwritten if they haven't the same type
            field.setValue(value);
        }
        this.fields.set(mapKey, field);
        return BrsInvalid.Instance;
    }

    setParent(parent: RoSGNode) {
        this.parent = parent;
    }

    removeParent() {
        this.parent = BrsInvalid.Instance;
    }

    // recursively search for any child that's focused via DFS
    isChildrenFocused(interpreter: Interpreter): boolean {
        if (this.children.length === 0) {
            return false;
        }

        for (let childNode of this.children) {
            if (interpreter.environment.getFocusedNode() === childNode) {
                return true;
            } else if (childNode.isChildrenFocused(interpreter)) {
                return true;
            }
        }
        return false;
    }

    private getDefaultValue(type: string): BrsType {
        let value: BrsType;

        switch (type.toLowerCase()) {
            case 'boolean':
                value = BrsBoolean.False;
                break;
            case 'dynamic':
                value = BrsInvalid.Instance;
                break;
            case 'integer':
                value = new Int32(0);
                break;
            case 'float':
                value = new Float(0);
                break;
            case 'roArray':
                value = BrsInvalid.Instance;
                break;
            case 'roAssociativeArray':
                value = BrsInvalid.Instance;
                break;
            case 'string':
                value = new BrsString('');
                break;
            default:
                value = Uninitialized.Instance;
                break;
        }

        return value;
    }

    /* searches the node tree for a node with the given id */
    private findNodeById(node: RoSGNode, id: BrsString): RoSGNode | BrsInvalid {
        // test current node in tree
        let currentId = node.get(new BrsString('id'));
        if (currentId.toString() === id.toString()) {
            return node;
        }

        // visit each child
        for (let child of node.children) {
            let result = this.findNodeById(child, id);
            if (result instanceof RoSGNode) {
                return result;
            }
        }

        // name was not found anywhere in tree
        return BrsInvalid.Instance;
    }

    /** Removes all fields from the node */
    // ToDo: Built-in fields shouldn't be removed
    private clear = new Callable('clear', {
        signature: {
            args: [],
            returns: ValueKind.Void
        },
        impl: (interpreter: Interpreter) => {
            this.fields.clear();
            return BrsInvalid.Instance;
        }
    });

    /** Removes a given item from the node */
    // ToDo: Built-in fields shouldn't be removed
    private delete = new Callable('delete', {
        signature: {
            args: [new StdlibArgument('str', ValueKind.String)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, str: BrsString) => {
            this.fields.delete(str.value);
            return BrsBoolean.True; //RBI always returns true
        }
    });

    /** Given a key and value, adds an item to the node if it doesn't exist
     * Or replaces the value of a key that already exists in the node
     */
    private addreplace = new Callable('addreplace', {
        signature: {
            args: [
                new StdlibArgument('key', ValueKind.String),
                new StdlibArgument('value', ValueKind.Dynamic)
            ],
            returns: ValueKind.Void
        },
        impl: (interpreter: Interpreter, key: BrsString, value: BrsType) => {
            this.set(key, value);
            return BrsInvalid.Instance;
        }
    });

    /** Returns the number of items in the node */
    private count = new Callable('count', {
        signature: {
            args: [],
            returns: ValueKind.Int32
        },
        impl: (interpreter: Interpreter) => {
            return new Int32(this.fields.size);
        }
    });

    /** Returns a boolean indicating whether or not a given key exists in the node */
    private doesexist = new Callable('doesexist', {
        signature: {
            args: [new StdlibArgument('str', ValueKind.String)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, str: BrsString) => {
            return this.get(str) !== BrsInvalid.Instance ? BrsBoolean.True : BrsBoolean.False;
        }
    });

    /** Appends a new node to another. If two keys are the same, the value of the original AA is replaced with the new one. */
    private append = new Callable('append', {
        signature: {
            args: [new StdlibArgument('obj', ValueKind.Object)],
            returns: ValueKind.Void
        },
        impl: (interpreter: Interpreter, obj: BrsType) => {
            if (obj instanceof RoAssociativeArray) {
                obj.elements.forEach((value, key) => {
                    this.fields.set(key, new Field(value, false));
                });
            } else if (obj instanceof RoSGNode) {
                obj.getFields().forEach((value, key) => {
                    this.fields.set(key, value);
                });
            }

            return BrsInvalid.Instance;
        }
    });

    /** Returns an array of keys from the node in lexicographical order */
    private keys = new Callable('keys', {
        signature: {
            args: [],
            returns: ValueKind.Object
        },
        impl: (interpreter: Interpreter) => {
            return new RoArray(this.getElements());
        }
    });

    /** Returns an array of values from the node in lexicographical order */
    private items = new Callable('items', {
        signature: {
            args: [],
            returns: ValueKind.Object
        },
        impl: (interpreter: Interpreter) => {
            return new RoArray(this.getValues());
        }
    });

    /** Given a key, returns the value associated with that key. This method is case insensitive. */
    private lookup = new Callable('lookup', {
        signature: {
            args: [new StdlibArgument('key', ValueKind.String)],
            returns: ValueKind.Dynamic
        },
        impl: (interpreter: Interpreter, key: BrsString) => {
            let lKey = key.value.toLowerCase();
            return this.get(new BrsString(lKey));
        }
    });

    /** Adds a new field to the node, if the field already exists it doesn't change the current value. */
    private addfield = new Callable('addfield', {
        signature: {
            args: [
                new StdlibArgument('fieldname', ValueKind.String),
                new StdlibArgument('type', ValueKind.String),
                new StdlibArgument('alwaysnotify', ValueKind.Boolean)
            ],
            returns: ValueKind.Boolean
        },
        impl: (
            interpreter: Interpreter,
            fieldname: BrsString,
            type: BrsString,
            alwaysnotify: BrsBoolean
        ) => {
            let defaultValue = this.getDefaultValue(type.value);

            if (defaultValue !== Uninitialized.Instance && !this.fields.has(fieldname.value)) {
                this.set(fieldname, defaultValue, alwaysnotify.toBoolean());
            }

            return BrsBoolean.True;
        }
    });

    /** Adds one or more fields defined as an associative aray of key values. */
    private addfields = new Callable('addfields', {
        signature: {
            args: [new StdlibArgument('fields', ValueKind.Object)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, fields: RoAssociativeArray) => {
            if (!(fields instanceof RoAssociativeArray)) {
                return BrsBoolean.False;
            }

            fields.getValue().forEach((value, key) => {
                let fieldName = new BrsString(key);
                if (!this.fields.has(key)) {
                    this.set(fieldName, value);
                }
            });

            return BrsBoolean.True;
        }
    });

    /** Returns the value of the field passed as argument, if the field doesn't exist it returns invalid. */
    private getfield = new Callable('getfield', {
        signature: {
            args: [new StdlibArgument('fieldname', ValueKind.String)],
            returns: ValueKind.Dynamic
        },
        impl: (interpreter: Interpreter, fieldname: BrsString) => {
            return this.get(fieldname);
        }
    });

    /** Registers a callback to be executed when the value of the field changes */
    private observefield = new Callable('observefield', {
        signature: {
            args: [
                new StdlibArgument('fieldname', ValueKind.String),
                new StdlibArgument('functionname', ValueKind.String)
            ],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, fieldname: BrsString, functionname: BrsString) => {
            let field = this.fields.get(fieldname.value);
            if (field instanceof Field) {
                field.addObserver(functionname);
            }
            return BrsBoolean.True;
        }
    });

    /** Removes the given field from the node */
    /** TODO: node built-in fields shouldn't be removable (i.e. id, change, focusable,) */
    private removefield = new Callable('removefield', {
        signature: {
            args: [new StdlibArgument('fieldname', ValueKind.String)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, fieldname: BrsString) => {
            this.fields.delete(fieldname.value);
            return BrsBoolean.True; //RBI always returns true
        }
    });

    /** Updates the value of an existing field only if the types match. */
    private setfield = new Callable('setfield', {
        signature: {
            args: [
                new StdlibArgument('fieldname', ValueKind.String),
                new StdlibArgument('value', ValueKind.Dynamic)
            ],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, fieldname: BrsString, value: BrsType) => {
            let field = this.get(fieldname);

            if (!this.fields.has(fieldname.value)) {
                return BrsBoolean.False;
            }

            if (valueKindToString(field.kind) !== valueKindToString(value.kind)) {
                return BrsBoolean.False;
            }

            this.set(fieldname, value);
            return BrsBoolean.True;
        }
    });

    /** Updates the value of multiple existing field only if the types match. */
    private setfields = new Callable('setfields', {
        signature: {
            args: [new StdlibArgument('fields', ValueKind.Object)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, fields: RoAssociativeArray) => {
            if (!(fields instanceof RoAssociativeArray)) {
                return BrsBoolean.False;
            }

            fields.getValue().forEach((value, key) => {
                let fieldName = new BrsString(key);
                if (this.fields.has(key)) {
                    this.set(fieldName, value);
                }
            });

            return BrsBoolean.True;
        }
    });

    /* Updates the value of multiple existing field only if the types match.
    In contrast to setFields method, update always return Uninitialized */
    private update = new Callable('update', {
        signature: {
            args: [new StdlibArgument('aa', ValueKind.Object)],
            returns: ValueKind.Uninitialized
        },
        impl: (interpreter: Interpreter, aa: RoAssociativeArray) => {
            if (!(aa instanceof RoAssociativeArray)) {
                return Uninitialized.Instance;
            }

            aa.getValue().forEach((value, key) => {
                let fieldName = new BrsString(key);
                if (this.fields.has(key)) {
                    this.set(fieldName, value);
                }
            });

            return Uninitialized.Instance;
        }
    });

    /* Return the current number of children in the subject node list of children.
    This is always a non-negative number. */
    private getchildcount = new Callable('getchildcount', {
        signature: {
            args: [],
            returns: ValueKind.Int32
        },
        impl: (interpreter: Interpreter) => {
            return new Int32(this.children.length);
        }
    });

    /* Adds a child node to the end of the subject node list of children so that it is
    traversed last (of those children) during render. */
    private appendchild = new Callable('appendchild', {
        signature: {
            args: [new StdlibArgument('child', ValueKind.Dynamic)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, child: BrsType) => {
            if (child instanceof RoSGNode) {
                if (this.children.includes(child)) {
                    return BrsBoolean.True;
                }
                this.children.push(child);
                child.setParent(this);
                return BrsBoolean.True;
            }
            return BrsBoolean.False;
        }
    });

    /* Retrieves the number of child nodes specified by num_children from the subject
    node, starting at the position specified by index. Returns an array of the child nodes
    retrieved. If num_children is -1, return all the children. */
    private getchildren = new Callable('getchildren', {
        signature: {
            args: [
                new StdlibArgument('num_children', ValueKind.Int32),
                new StdlibArgument('index', ValueKind.Int32)
            ],
            returns: ValueKind.Object
        },
        impl: (interpreter: Interpreter, num_children: Int32, index: Int32) => { //eslint-disable-line
            let numChildrenValue = num_children.getValue();//eslint-disable-line
            let indexValue = index.getValue();
            let childrenSize = this.children.length;
            if (numChildrenValue <= -1 && indexValue === 0) {
                //short hand to return all children
                return new RoArray(this.children.slice());
            } else if (numChildrenValue <= 0 || indexValue < 0 || indexValue >= childrenSize) {
                //these never return any children
                return new RoArray([]);
            } else {
                //only valid cases
                return new RoArray(this.children.slice(indexValue, indexValue + numChildrenValue));
            }

            return new RoArray([]);//eslint-disable-line
        }
    });

    /* Finds a child node in the subject node list of children, and if found,
    remove it from the list of children. The match is made on the basis of actual
    object identity, that is, the value of the pointer to the child node.
    return false if trying to remove anything that's not a node */
    private removechild = new Callable('removechild', {
        signature: {
            args: [new StdlibArgument('child', ValueKind.Dynamic)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, child: BrsType) => {
            if (child instanceof RoSGNode) {
                let spliceIndex = this.children.indexOf(child);
                if (spliceIndex >= 0) {
                    child.removeParent();
                    this.children.splice(spliceIndex, 1);
                }
                return BrsBoolean.True;
            }
            return BrsBoolean.False;
        }
    });
    /* If the subject node has been added to a parent node list of children,
    return the parent node, otherwise return invalid.*/
    private getparent = new Callable('getparent', {
        signature: {
            args: [],
            returns: ValueKind.Dynamic
        },
        impl: (interpreter: Interpreter) => {
            return this.parent;
        }
    });

    /* Creates a child node of type nodeType, and adds the new node to the end of the
    subject node list of children */
    private createchild = new Callable('createchild', {
        signature: {
            args: [new StdlibArgument('nodetype', ValueKind.String)],
            returns: ValueKind.Object
        },
        impl: (interpreter: Interpreter, nodetype: BrsString) => {
            // currently we can't create a custom subclass object of roSGNode,
            // so we'll always create generic RoSGNode object as child
            let child = createNodeByType(nodetype);
            if (child instanceof RoSGNode) {
                this.children.push(child);
                child.setParent(this);
            }
            return child;
        }
    });

    /* Returns true if the subject node has the remote control focus, and false otherwise */
    private hasfocus = new Callable('hasfocus', {
        signature: {
            args: [],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter) => {
            return BrsBoolean.from(interpreter.environment.getFocusedNode() === this);
        }
    });

    /**
     *  If on is set to true, sets the current remote control focus to the subject node,
     *  also automatically removing it from the node on which it was previously set.
     *  If on is set to false, removes focus from the subject node if it had it
     */
    private setfocus = new Callable('setfocus', {
        signature: {
            args: [new StdlibArgument('on', ValueKind.Boolean)],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter, on: BrsBoolean) => {
            interpreter.environment.setFocusedNode(on.toBoolean() ? this : BrsInvalid.Instance);
            return BrsBoolean.False; //brightscript always returns false for some reason
        }
    });

    /**
     *  Returns true if the subject node or any of its descendants in the SceneGraph node tree
     *  has remote control focus
     */
    private isinfocuschain = new Callable('isinfocuschain', {
        signature: {
            args: [],
            returns: ValueKind.Boolean
        },
        impl: (interpreter: Interpreter) => {
            // loop through all children DFS and check if any children has focus
            if (interpreter.environment.getFocusedNode() === this) {
                return BrsBoolean.True;
            }

            return BrsBoolean.from(this.isChildrenFocused(interpreter));
        }
    });

    /* Returns the node that is a descendant of the nearest component ancestor of the subject node whose id field matches the given name,
        otherwise return invalid.
        Implemented as a DFS from the top of parent hierarchy to match the observed behavior as opposed to the BFS mentioned in the docs. */
    private findnode = new Callable('findnode', {
        signature: {
            args: [new StdlibArgument('name', ValueKind.String)],
            returns: ValueKind.Dynamic
        },
        impl: (interpreter: Interpreter, name: BrsString) => {
            // climb parent hierarchy to find node to start search at
            let root: RoSGNode = this;
            while (root.parent && root.parent instanceof RoSGNode) {
                root = root.parent;
            }

            // perform search
            return this.findNodeById(root, name);
        }
    });
}

export function createNodeByType(type: BrsString) {
    if (type.value === 'Node') {
        return new RoSGNode([]);
    } else {
        return BrsInvalid.Instance;
    }
}
