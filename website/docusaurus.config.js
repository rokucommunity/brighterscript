// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';
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
                            { label: 'Website source', href: `${repoUrl}/tree/master/website` }
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
