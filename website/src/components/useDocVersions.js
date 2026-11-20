/**
 * The list of docs versions (v0, v1, ...), loaded at runtime from /brighterscript/versions.json (written by the host build),
 * so a version built from an older commit still knows about versions added after it.
 * Until it loads (or if it's not there), it's the list this version was built with.
 */
import { useEffect, useState } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function useDocVersions() {
    const { siteConfig } = useDocusaurusContext();
    const { rootBaseUrl, fallbackVersions } = siteConfig.customFields;
    const [versions, setVersions] = useState(fallbackVersions);

    useEffect(() => {
        fetch(`${rootBaseUrl}versions.json`)
            .then(response => (response.ok ? response.json() : undefined))
            .then(list => {
                if (Array.isArray(list) && list.length > 0) {
                    setVersions(list);
                }
            })
            .catch(() => { });
    }, [rootBaseUrl]);

    return versions;
}
