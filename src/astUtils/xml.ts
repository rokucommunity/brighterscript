import type { SGChildren, SGComponent, SGField, SGFunction, SGInterface, SGNode, SGScript, SGTag } from '../parser/SGTypes';

export function isSGComponent(tag: SGTag): tag is SGComponent {
    return tag?.constructor.name === 'SGComponent';
}
export function isSGInterface(tag: SGTag): tag is SGInterface {
    return tag?.constructor.name === 'SGInterface';
}
export function isSGScript(tag: SGTag): tag is SGScript {
    return tag?.constructor.name === 'SGScript';
}
export function isSGChildren(tag: SGTag): tag is SGChildren {
    return tag?.constructor.name === 'SGChildren';
}
export function isSGField(tag: SGTag): tag is SGField {
    return tag?.constructor.name === 'SGField';
}
export function isSGFunction(tag: SGTag): tag is SGFunction {
    return tag?.constructor.name === 'SGFunction';
}
export function isSGNode(tag: SGTag): tag is SGNode {
    return tag?.constructor.name === 'SGNode';
}
export function isSGCustomization(tag: SGTag): tag is SGNode {
    return isSGNode(tag) && tag.tag?.text?.toLowerCase() === 'customization';
}
