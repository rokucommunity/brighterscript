// eslint-disable-next-line @typescript-eslint/no-require-imports
import data = require('./data.json');

//apply any transforms/overrides before exporting

export const nodes = data.nodes;
export const components = data.components;
export const interfaces = data.interfaces;
export const events = data.events;

interface BrightScriptDocLookup {
    name: string;
    url?: string;
    description?: string;
}

interface PossiblyDeprecated {
    isDeprecated?: boolean;
    deprecatedDescription?: string;
}

export interface BRSBaseMethodData extends PossiblyDeprecated {
    params: {
        name: string;
        isRequired: boolean;
        type: string;
    }[];
    returnType: string;
}
export interface BRSEventMethodData extends BRSBaseMethodData {
    name: string;
}

export interface BRSInterfaceMethodData extends BRSEventMethodData {
    description: string;
    returnDescription: string;
}

export interface BRSPropertyData {
    name: string;
    description: string;
    default: string;
    type: string;
}

export interface BRSFieldData {
    name: string;
    type: string;
    default: string;
    accessPermission: string;
    description: string;
}


export interface SGNodeData extends BrightScriptDocLookup {
    description: string;
    fields: BRSFieldData[];
    events: BrightScriptDocLookup[];
    interfaces: BrightScriptDocLookup[];
}

export interface BRSComponentData extends BrightScriptDocLookup, PossiblyDeprecated {
    interfaces: BrightScriptDocLookup[];
    events: BrightScriptDocLookup[];
    constructors: BRSBaseMethodData[];
    description: string;
}

export interface BRSInterfaceData extends BrightScriptDocLookup, PossiblyDeprecated {
    properties: BRSPropertyData[];
    implementers: BrightScriptDocLookup[];
    methods: BRSInterfaceMethodData[];
}

export interface BRSEventData extends BrightScriptDocLookup, PossiblyDeprecated {
    properties: BRSPropertyData[];
    implementers: BrightScriptDocLookup[];
    methods: BRSEventMethodData[];
}
