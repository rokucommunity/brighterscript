/**
 * Wraps every doc page so `?missing=<path>` shows the "not in this version" page in place of the doc, keeping the sidebar.
 * The 404 page sends readers here (see src/theme/NotFound/Content).
 */
import React from 'react';
import Layout from '@theme-original/DocItem/Layout';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { useLocation } from '@docusaurus/router';
import MissingPage from '@site/src/components/MissingPage';

export default function DocItemLayoutWrapper(props) {
    //the static html never has a query string, so only check after hydration (or React complains about the mismatch)
    const isBrowser = useIsBrowser();
    const { search } = useLocation();
    const missing = isBrowser ? new URLSearchParams(search).get('missing') : null;
    if (missing) {
        return <MissingPage missing={missing} />;
    }
    return <Layout {...props} />;
}
