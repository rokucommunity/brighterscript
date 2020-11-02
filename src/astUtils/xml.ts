import type { XmlAstAttribute, XmlAstNode } from '../parser/XmlParser';

export function findXmlAstAttribute(node: XmlAstNode, name: string): XmlAstAttribute | undefined {
    return node.attributes.find(att => att.key.text.toLowerCase() === name);
}

export function createXmlAstNode(name: string, attributes: Record<string, string>): XmlAstNode {
    return {
        name: { text: name },
        attributes: Object.keys(attributes)
            .filter(key => attributes[key] !== undefined)
            .map(key => ({
                key: { text: key },
                value: { text: attributes[key] }
            }))
    };
}
