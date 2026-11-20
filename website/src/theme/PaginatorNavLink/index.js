/**
 * Wraps the Previous / Next buttons at the bottom of each doc to also show the sidebar category the linked page is in
 * (i.e. "NEXT · LANGUAGE FEATURES"), so it's clear when the next page starts a new section.
 * Pages that aren't in a category (like the introduction) just show "Next" / "Previous".
 */
import React from 'react';
import PaginatorNavLink from '@theme-original/PaginatorNavLink';
import { useDocsSidebar } from '@docusaurus/plugin-content-docs/client';

/**
 * The label of the sidebar category that links to `permalink`, or undefined if it's not in one
 */
function findCategory(items, permalink, category) {
    for (const item of items ?? []) {
        if (item.type === 'category') {
            const found = findCategory(item.items, permalink, item.label);
            if (found !== undefined) {
                return found;
            }
        } else if (item.type === 'link' && item.href === permalink) {
            //(null, not undefined, for a top-level page: found, but not in a category)
            return category ?? null;
        }
    }
    return undefined;
}

export default function PaginatorNavLinkWrapper(props) {
    //(null outside of the docs)
    const sidebar = useDocsSidebar();
    const category = sidebar ? findCategory(sidebar.items, props.permalink) : undefined;
    if (!category || !props.subLabel) {
        return <PaginatorNavLink {...props} />;
    }
    return (
        <PaginatorNavLink
            {...props}
            subLabel={<>{props.subLabel}<span className="pagination-nav__category"> · {category}</span></>}
        />
    );
}
