// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';
import fs from 'node:fs';
import path from 'node:path';
import { versions, versionName, docsDir, localDocsDir, strictLinks, rootBaseUrl, siteUrl, baseUrl, editBranch } from './versions.mjs';
import { createSidebarItemsGenerator, sidebarFileName } from './sidebar.mjs';
import { getRehypeCodeHighlighting } from './code-highlighting.mjs';
import remarkGithubAlerts from './remark-github-alerts.mjs';

const repoUrl = 'https://github.com/rokucommunity/brighterscript';

/**
 * This site is ONE docs version (the one this checkout of the repo is), served at /brighterscript/<version>/.
 * See scripts/site.mjs for how every version gets built and combined into the full site.
 * @type {import('@docusaurus/types').Config}
 */
const config = {
    title: 'BrighterScript',
    tagline: 'A superset of Roku\'s BrightScript language',
    favicon: 'img/logo.svg',
    url: siteUrl,
    baseUrl: baseUrl,
    trailingSlash: false,

    organizationName: 'rokucommunity',
    projectName: 'brighterscript',

    onBrokenLinks: strictLinks ? 'throw' : 'warn',
    onBrokenAnchors: 'warn',

    markdown: {
        //treat .md files as plain CommonMark (not MDX) so regular README-style markdown just works.
        //Use a .mdx extension if a page ever needs React components.
        format: 'detect',
        hooks: {
            onBrokenMarkdownLinks: strictLinks ? 'throw' : 'warn'
        }
    },

    customFields: {
        //used by the version dropdown (src/components/VersionDropdownNavbarItem.js)
        versionName: versionName,
        rootBaseUrl: rootBaseUrl,
        //the dropdown loads the real list from /brighterscript/versions.json at runtime. This is just the fallback
        fallbackVersions: versions.map(x => ({ name: x.name, label: x.label, current: !!x.current }))
    },

    plugins: [
        //every page in this version ({ path, title }, path relative to baseUrl), for the "not in this version" page
        //(src/components/MissingPage.js). It's global data for this version, and `pages.json` for the other versions to read
        function docsPages() {
            let pages = [];
            return {
                name: 'docs-pages',
                async allContentLoaded({ allContent, actions }) {
                    const loadedVersions = allContent['docusaurus-plugin-content-docs']?.default?.loadedVersions ?? [];
                    //the sidebar labels are the short names ("Classes" rather than "BrighterScript Classes")
                    const labels = new Map();
                    const collectLabels = (items) => {
                        for (const item of items) {
                            if (item.type === 'doc' && item.label) {
                                labels.set(item.id, item.label);
                            }
                            collectLabels(item.items ?? []);
                        }
                    };
                    for (const version of loadedVersions) {
                        Object.values(version.sidebars ?? {}).forEach(collectLabels);
                    }
                    pages = loadedVersions
                        .flatMap(x => x.docs)
                        .filter(x => !x.unlisted)
                        .map(x => ({ path: x.permalink.substring(baseUrl.length).replace(/\/$/, ''), title: labels.get(x.id) ?? x.title }));
                    actions.setGlobalData({ pages: pages });
                    //`npm run docs`: next to the other versions' prebuilt sites, so they can read it too
                    if (process.env.DOCS_DEV_SITES_DIR) {
                        const dir = path.join(process.env.DOCS_DEV_SITES_DIR, versionName);
                        fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages));
                    }
                },
                async postBuild({ outDir }) {
                    fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(pages));
                }
            };
        },
        //`npm run docs` only: serve the other versions (prebuilt by scripts/site.mjs) next to this checkout's live docs,
        //so the version dropdown works in the dev server too
        process.env.DOCS_DEV_SITES_DIR && function serveOtherVersions() {
            return {
                name: 'serve-other-versions',
                configureWebpack: () => ({
                    devServer: {
                        static: [{
                            publicPath: rootBaseUrl,
                            directory: process.env.DOCS_DEV_SITES_DIR,
                            //pages are built as `classes.html` but linked as `classes` (trailingSlash: false)
                            staticOptions: { extensions: ['html'] },
                            //this version's own pages.json is in there too, so don't list that folder in place of the live home page
                            serveIndex: false,
                            watch: false
                        }]
                    }
                })
            };
        }
    ].filter(Boolean),

    presets: [
        [
            'classic',
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    path: docsDir,
                    routeBasePath: '/',
                    //the docs folder's own sidebar.json (or ours, for releases from before sidebar.json existed)
                    sidebarItemsGenerator: createSidebarItemsGenerator(docsDir, path.join(localDocsDir, sidebarFileName)),
                    //must run before docusaurus' own admonitions plugin, which turns the result into admonitions
                    beforeDefaultRemarkPlugins: [remarkGithubAlerts],
                    rehypePlugins: [getRehypeCodeHighlighting()],
                    //docPath is the file's path within docs/
                    editUrl: ({ docPath }) => `${repoUrl}/edit/${editBranch}/docs/${docPath}`
                },
                blog: false,
                pages: false,
                theme: {
                    customCss: './src/css/custom.css'
                }
            })
        ]
    ],

    themeConfig:
        /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
        ({
            colorMode: {
                defaultMode: 'light',
                respectPrefersColorScheme: true
            },
            docs: {
                sidebar: {
                    hideable: true
                }
            },
            navbar: {
                title: 'BrighterScript',
                logo: { alt: 'BrighterScript', src: 'img/logo.svg' },
                //white text on the purple bar in both color modes (the color itself is set in custom.css)
                style: 'dark',
                items: [
                    { type: 'custom-versionDropdown', position: 'right' },
                    { href: repoUrl, label: 'GitHub', position: 'right' }
                ]
            },
            footer: {
                style: 'dark',
                links: [
                    {
                        title: 'Community',
                        items: [
                            { label: 'RokuCommunity', href: 'https://rokucommunity.github.io' },
                            { label: 'Issues', href: `${repoUrl}/issues` },
                            { label: 'Roku Developers Slack', href: 'https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA' }
                        ]
                    },
                    {
                        title: 'More',
                        items: [
                            { label: 'GitHub', href: repoUrl },
                            { label: 'npm', href: 'https://www.npmjs.com/package/brighterscript' },
                            //where the pages are written (each version's own branch), not the site tooling in website/
                            { label: 'Edit these docs', href: `${repoUrl}/tree/${editBranch}/docs` }
                        ]
                    }
                ],
                copyright: `Copyright © ${new Date().getFullYear()} RokuCommunity. Built with Docusaurus.`
            },
            //docs code blocks are highlighted by shiki (see code-highlighting.mjs). Prism only handles code in React pages
            prism: {
                theme: prismThemes.vsLight,
                darkTheme: prismThemes.vsDark
            }
        })
};

export default config;
