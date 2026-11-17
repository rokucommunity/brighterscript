/**
 * Adds each page's sidebar label and file name to its keywords, so search finds a page by the name people know it by.
 * For example, "regex" finds "Regular Expression Literals" (sidebar label "Regex Literals", file regex-literals.md).
 * The search plugin indexes the keywords meta tag, so this needs no front matter in the docs.
 */
import React from 'react';
import { PageMetadata } from '@docusaurus/theme-common';
import { useDoc, useDocsSidebar } from '@docusaurus/plugin-content-docs/client';

function findSidebarLabel(items, docId) {
    for (const item of items ?? []) {
        if (item.type === 'link' && item.docId === docId) {
            return item.label;
        }
        const label = findSidebarLabel(item.items, docId);
        if (label) {
            return label;
        }
    }
    return undefined;
}

export default function DocItemMetadata() {
    const { metadata, frontMatter, assets } = useDoc();
    const sidebar = useDocsSidebar();
    const fileName = metadata.id.split('/').pop();
    const keywords = [
        ...(frontMatter.keywords ?? []),
        findSidebarLabel(sidebar?.items, metadata.id),
        //(the home page's file name, readme, isn't a useful keyword)
        /^(readme|index)$/i.test(fileName) ? undefined : fileName.replace(/[-_]+/g, ' ')
    ].filter(Boolean);
    return (
        <PageMetadata
            title={metadata.title}
            description={metadata.description}
            keywords={[...new Set(keywords)]}
            image={assets.image ?? frontMatter.image}
        />
    );
}
