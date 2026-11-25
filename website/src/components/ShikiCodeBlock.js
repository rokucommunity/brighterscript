import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import IconCopy from '@theme/Icon/Copy';
import IconSuccess from '@theme/Icon/Success';

/**
 * A code block whose contents were already highlighted by shiki at build time
 */
export default function ShikiCodeBlock({ className, style, code, title, children }) {
    return (
        <div className={clsx('shiki-code-block', title && 'shiki-code-block--titled')}>
            {title && <div className="shiki-code-block__title">{title}</div>}
            <div className="shiki-code-block__body">
                <pre className={clsx(className, 'thin-scrollbar')} style={style} tabIndex={0}>
                    <code>{children}</code>
                </pre>
                {code !== undefined && <CopyButton code={code} />}
            </div>
        </div>
    );
}

function CopyButton({ code }) {
    const [isCopied, setIsCopied] = useState(false);
    const timeout = useRef(undefined);
    useEffect(() => () => window.clearTimeout(timeout.current), []);

    const copy = useCallback(async () => {
        await navigator.clipboard.writeText(code);
        setIsCopied(true);
        window.clearTimeout(timeout.current);
        timeout.current = window.setTimeout(() => setIsCopied(false), 1000);
    }, [code]);

    return (
        <button
            type="button"
            className="clean-btn shiki-code-block__copy"
            aria-label={isCopied ? 'Copied' : 'Copy code to clipboard'}
            title="Copy"
            onClick={copy}>
            {isCopied ? <IconSuccess /> : <IconCopy />}
        </button>
    );
}
