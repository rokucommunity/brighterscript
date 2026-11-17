/**
 * Navbar dropdown for switching between doc versions (v0, v1, ...).
 *
 * Every version is its own separately built site (see scripts/site.mjs), so:
 *   - the version list is loaded at runtime from /brighterscript/versions.json (written by the host build). That way a version
 *     built from an old release tag still lists versions added after it.
 *   - the links are plain `<a>` tags (full page loads), pointing at the same page in the other version. If that page doesn't
 *     exist there, that version's 404 page sends you to its "not in this version" page (see src/theme/NotFound/Content),
 *     which keeps the sidebar, and goes straight to the page if it only moved.
 */
import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useLocation } from '@docusaurus/router';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';
import useDocVersions from './useDocVersions';

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export default function VersionDropdownNavbarItem(props) {
    const { siteConfig } = useDocusaurusContext();
    const { versionName, rootBaseUrl } = siteConfig.customFields;
    const { pathname, hash } = useLocation();
    const versions = useDocVersions();

    //nothing to switch between
    if (versions.length < 2) {
        return null;
    }

    const relativePath = pathname.startsWith(siteConfig.baseUrl) ? pathname.substring(siteConfig.baseUrl.length) : '';
    const linkClass = props.mobile ? 'menu__link' : 'dropdown__link';
    const activeLabel = versions.find(x => x.name === versionName)?.label ?? versionName;

    return (
        <DropdownNavbarItem
            {...props}
            label={activeLabel}
            items={versions.map(version => {
                const className = `${linkClass}${version.name === versionName ? ` ${linkClass}--active` : ''}`;
                const href = `${rootBaseUrl}${version.name}/${relativePath}${hash}`;
                return {
                    type: 'html',
                    value: `<a class="${className}" href="${escapeHtml(href)}">${escapeHtml(version.label)}</a>`
                };
            })}
        />
    );
}
