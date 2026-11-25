/**
 * Renders GitHub's alert syntax as Docusaurus admonitions, so the same markdown looks right on GitHub and on the site:
 *
 *     > [!NOTE]
 *     > Useful information that users should know, even when skimming content.
 *
 * Supports NOTE, TIP, IMPORTANT, WARNING and CAUTION (https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts)
 */
import { visit } from 'unist-util-visit';

//GitHub alert type -> docusaurus admonition type
const alertTypes = {
    note: 'note',
    tip: 'tip',
    important: 'info',
    warning: 'warning',
    caution: 'danger'
};

const markerRegex = /^\[!(note|tip|important|warning|caution)\][ \t]*(\r?\n|$)/i;

export default function remarkGithubAlerts() {
    return (tree) => {
        visit(tree, 'blockquote', (node, index, parent) => {
            const paragraph = node.children[0];
            const text = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined;
            const match = text?.type === 'text' ? markerRegex.exec(text.value) : undefined;
            if (!match || !parent) {
                return;
            }
            const alertType = match[1].toLowerCase();

            //remove the `[!NOTE]` marker (and the paragraph, if that was all it held)
            text.value = text.value.substring(match[0].length);
            if (text.value === '') {
                paragraph.children.shift();
            }
            if (paragraph.children.length === 0) {
                node.children.shift();
            }

            //docusaurus' admonition plugin turns this directive into an admonition, using the label paragraph as the title
            parent.children[index] = {
                type: 'containerDirective',
                name: alertTypes[alertType],
                attributes: {},
                children: [
                    {
                        type: 'paragraph',
                        data: { directiveLabel: true },
                        children: [{ type: 'text', value: alertType[0].toUpperCase() + alertType.substring(1) }]
                    },
                    ...node.children
                ]
            };
        });
    };
}
