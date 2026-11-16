/**
 * Navbar dropdown for switching between doc versions (v0, v1, ...).
 *
 * Every version is its own separately built site (see scripts/site.mjs), so:
 *   - the version list is loaded at runtime from /brighterscript/versions.json (written by the host build). That way a version
 *     built from an old release tag still lists versions added after it.
 *   - the links are plain `<a>` tags (full page loads), pointing at the same page in the other version. If that page doesn't
 *     exist there, the site's 404 page handles it.
 */
import React, { useEffect, useState } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useLocation } from '@docusaurus/router';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export default function VersionDropdownNavbarItem(props) {
    const { siteConfig } = useDocusaurusContext();
    const { versionName, rootBaseUrl, fallbackVersions } = siteConfig.customFields;
    const { pathname, hash } = useLocation();
    const [versions, setVersions] = useState(fallbackVersions);

    useEffect(() => {
        fetch(`${rootBaseUrl}versions.json`)
            .then(response => (response.ok ? response.json() : undefined))
            .then(list => {
                if (Array.isArray(list) && list.length > 0) {
                    setVersions(list);
                }
            })
            //not there (i.e. the local dev server). Keep the fallback list
            .catch(() => { });
    }, [rootBaseUrl]);

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
