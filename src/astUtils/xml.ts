import type { SGChildren, SGComponent, SGField, SGFunction, SGInterface, SGNode, SGScript, SGTag } from '../parser/SGTypes';

export function isSGComponent(tag: SGTag): tag is SGComponent {
    return tag?.sgkind === 'component';
}
export function isSGInterface(tag: SGTag): tag is SGInterface {
    return tag?.sgkind === 'interface';
}
export function isSGScript(tag: SGTag): tag is SGScript {
    return tag?.sgkind === 'script';
}
export function isSGChildren(tag: SGTag): tag is SGChildren {
    return tag?.sgkind === 'children';
}
export function isSGField(tag: SGTag): tag is SGField {
    return tag?.sgkind === 'field';
}
export function isSGFunction(tag: SGTag): tag is SGFunction {
    return tag?.sgkind === 'function';
}
export function isSGNode(tag: SGTag): tag is SGNode {
    return tag?.sgkind === 'node';
}
