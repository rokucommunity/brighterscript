/**
 * Code blocks in the docs arrive already highlighted by shiki (see code-highlighting.mjs).
 * Render those ourselves (docusaurus' CodeBlock only knows how to highlight plain strings with prism),
 * and leave everything else to the default implementation.
 */
import React from 'react';
import OriginalPre from '@theme-original/MDXComponents/Pre';
import ShikiCodeBlock from '@site/src/components/ShikiCodeBlock';

export default function Pre(props) {
    if (!String(props.className ?? '').split(' ').includes('shiki')) {
        return <OriginalPre {...props} />;
    }
    //children is the <code> element, whose children are shiki's highlighted lines
    return (
        <ShikiCodeBlock className={props.className} style={props.style} code={props['data-code']} title={props['data-title']}>
            {props.children?.props?.children}
        </ShikiCodeBlock>
    );
}
