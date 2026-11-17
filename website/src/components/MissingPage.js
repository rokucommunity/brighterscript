/**
 * The "this page isn't in this version" page, shown in place of a doc (so the sidebar stays) when the url has `?missing=<path>`.
 *
 *   - If the page only moved in this version (i.e. `classes` -> `language-features/classes`), it goes straight there.
 *   - Otherwise it says so, links to the page in any other version that has it, and suggests similar pages in this one.
 *
 * This version's pages come from the `docs-pages` plugin (docusaurus.config.js). Other versions' pages come from their
 * `pages.json`, which that plugin also writes. A version without one just doesn't get suggested.
 */
import React, { useEffect, useState } from 'react';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { usePluginData } from '@docusaurus/useGlobalData';
import { useHistory, useLocation } from '@docusaurus/router';
import { HtmlClassNameProvider } from '@docusaurus/theme-common';
import useDocVersions from './useDocVersions';

function baseNameOf(pagePath) {
    return pagePath.split('/').pop().toLowerCase();
}

function wordsOf(text) {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2);
}

/**
 * The page at `pagePath`, or else the only page with the same name in another folder
 */
function findPage(pages, pagePath) {
    const exact = pages.find(x => x.path === pagePath);
    if (exact) {
        return exact;
    }
    const sameName = pages.filter(x => x.path !== '' && baseNameOf(x.path) === baseNameOf(pagePath));
    return sameName.length === 1 ? sameName[0] : undefined;
}

/**
 * "spread-operator" -> "Spread Operator"
 */
function titleFromPath(pagePath) {
    return baseNameOf(pagePath).split(/[-_]+/).filter(x => x).map(x => x[0].toUpperCase() + x.substring(1)).join(' ');
}

export default function MissingPage({ missing }) {
    const { siteConfig } = useDocusaurusContext();
    const { versionName, rootBaseUrl } = siteConfig.customFields;
    const { pages } = usePluginData('docs-pages');
    const versions = useDocVersions();
    const history = useHistory();
    const { hash } = useLocation();
    const missingPath = missing.replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    const moved = findPage(pages, missingPath);

    //the page is here, just somewhere else
    useEffect(() => {
        if (moved) {
            history.replace(`${siteConfig.baseUrl}${moved.path}${hash}`);
        }
    }, [moved, history, siteConfig.baseUrl, hash]);

    //the same page in every other version that has it
    const [elsewhere, setElsewhere] = useState([]);
    useEffect(() => {
        let cancelled = false;
        const others = versions.filter(x => x.name !== versionName);
        void Promise.all(others.map(async (version) => {
            try {
                const response = await fetch(`${rootBaseUrl}${version.name}/pages.json`);
                const page = response.ok ? findPage(await response.json(), missingPath) : undefined;
                return page ? { version: version, page: page } : undefined;
            } catch {
                return undefined;
            }
        })).then(results => {
            if (!cancelled) {
                setElsewhere(results.filter(x => x));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [versions, rootBaseUrl, versionName, missingPath]);

    if (moved) {
        return null;
    }

    const title = elsewhere[0]?.page.title ?? titleFromPath(missingPath);
    const versionLabel = versions.find(x => x.name === versionName)?.label ?? versionName;

    //pages in this version that share words with the missing one (i.e. "spread-operator" -> "ternary-operator")
    //(a word matches its plurals and other endings too, i.e. "class" matches "classes")
    const words = [...new Set([...wordsOf(missingPath), ...wordsOf(title)])];
    const matches = (word) => words.some(x => x === word || (Math.min(x.length, word.length) >= 4 && (x.startsWith(word) || word.startsWith(x))));
    const similar = pages
        .filter(x => x.path !== '')
        .map(x => ({ page: x, score: new Set([...wordsOf(x.path), ...wordsOf(x.title)].filter(matches)).size }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(x => x.page);

    return (
        <div className="row">
            {/* (see custom.css) */}
            <HtmlClassNameProvider className="docs-missing-page" />
            <Head>
                <title>{`${title} isn't in the ${versionLabel} docs | ${siteConfig.title}`}</title>
                <meta name="robots" content="noindex" />
            </Head>
            <div className="col">
                <article className="markdown">
                    <h1>{title} isn't in the {versionLabel} docs</h1>
                    <p>
                        There's no <code>{missingPath}</code> page in this version of the documentation.
                    </p>
                    {elsewhere.length > 0 && (
                        <p>
                            {'It\'s available in '}
                            {elsewhere.map((x, i) => (
                                <React.Fragment key={x.version.name}>
                                    {i > 0 && ', '}
                                    <a href={`${rootBaseUrl}${x.version.name}/${x.page.path}${hash}`}>{x.version.label} →</a>
                                </React.Fragment>
                            ))}
                        </p>
                    )}
                    {similar.length > 0 && (
                        <>
                            <p>Similar pages in the {versionLabel} docs:</p>
                            <ul>
                                {similar.map(x => (
                                    <li key={x.path}><Link to={`${siteConfig.baseUrl}${x.path}`}>{x.title}</Link></li>
                                ))}
                            </ul>
                        </>
                    )}
                    <p>
                        Or start at the <Link to={siteConfig.baseUrl}>introduction</Link>, or pick a page from the sidebar.
                    </p>
                </article>
            </div>
        </div>
    );
}
