/**
 * Wraps the 404 page: instead of a dead end, send the reader to the "not in this version" page of whichever version the url
 * is in (i.e. /brighterscript/v1/spread-operator -> /brighterscript/v1/?missing=spread-operator), which keeps that version's
 * sidebar. See src/components/MissingPage.js.
 *
 * GitHub Pages serves one root 404.html (the current version's) for every missing url, so this works out the version from
 * the url rather than assuming it's this one. The regular 404 content still renders until the redirect happens (and
 * without JavaScript).
 */
import React, { useEffect } from 'react';
import NotFoundContent from '@theme-original/NotFound/Content';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * Where to send the reader for a missing url, or undefined to just show the 404
 */
export function getMissingPageUrl(pathname, rootBaseUrl, versions) {
    if (!pathname.startsWith(rootBaseUrl)) {
        return undefined;
    }
    const segments = pathname.substring(rootBaseUrl.length).replace(/\.html$/i, '').split('/').filter(x => x);
    const current = versions.find(x => x.current) ?? versions[0];
    //(`latest` is an alias for the current version. See writeSharedFiles in scripts/site.mjs)
    const version = segments[0] === 'latest' ? current : versions.find(x => x.name === segments[0]);
    const targetVersion = version ?? current;
    const missing = (version ? segments.slice(1) : segments).join('/');
    //a version's own root is missing (i.e. a version that doesn't exist), so there's nowhere better to go
    if (!targetVersion || !missing) {
        return undefined;
    }
    return `${rootBaseUrl}${targetVersion.name}/?missing=${encodeURIComponent(missing)}`;
}

export default function NotFoundContentWrapper(props) {
    const { siteConfig } = useDocusaurusContext();
    const { rootBaseUrl, fallbackVersions } = siteConfig.customFields;

    useEffect(() => {
        //a missing page that's already the "not in this version" page would just loop
        if (new URLSearchParams(window.location.search).has('missing')) {
            return;
        }
        const url = getMissingPageUrl(window.location.pathname, rootBaseUrl, fallbackVersions);
        if (url) {
            window.location.replace(url + window.location.hash);
        }
    }, [rootBaseUrl, fallbackVersions]);

    return <NotFoundContent {...props} />;
}
