import type { ProvideFileEvent } from '../../interfaces';
import chalk from 'chalk';
import { LogLevel } from '../../Logger';
import { util } from '../../util';
import type { AnchorNodeDeclaration } from './AnchorNodeParser';
import { findAnchorNodeDeclarations } from './AnchorNodeParser';

export class FileProvider {
    constructor(
        private event: ProvideFileEvent
    ) { }

    public process() {
        //if the event already has a file for this path, assume some other plugin has processed this event already
        if (this.event.files.find(x => x.srcPath === this.event.srcPath)) {
            return;
        }

        switch (this.event.srcExtension) {
            case '.brs':
            case '.bs':
                return this.handleBrsFile();
            case '.xml':
                return this.handleXmlFile();
            //only TypeScript sources are searched, so the bundled javascript output from the sdk doesn't produce duplicates
            case '.ts':
            case '.tsx':
            case '.mts':
                if (/\.d\.m?ts$/i.test(this.event.srcPath)) {
                    return;
                }
                return this.handleTypeScriptFile();
            default:
            //TODO handle other file types
        }
    }

    private get logger() {
        return this.event.program.logger;
    }

    private handleBrsFile() {
        const file = this.event.fileFactory.BrsFile(this.event);
        const text = this.event.data.value.toString();

        this.logger.time(LogLevel.debug, ['parse', chalk.green(this.event.srcPath)], () => {
            file.parse(text);
        });

        this.event.files.push(file);
    }

    private handleXmlFile() {
        //only process files from the components folder (Roku will only parse xml files in the components folder)
        if (!/^(pkg:\/)?components[\/\\]/i.exec(this.event.destPath)) {
            return;
        }
        const text = this.event.data.value.toString();
        //add the file to the program
        const file = this.event.fileFactory.XmlFile(this.event);

        this.logger.time(LogLevel.debug, ['parse', chalk.green(this.event.srcPath)], () => {
            file.parse(text);
        });

        this.event.files.push(file);
    }

    /**
     * Find any RSG 2.0 SDK anchor nodes (`registerAnchorNode(declaration, ...)`) in a TypeScript file,
     * and represent each of them as a virtual component xml file so they are known to the type system.
     * The virtual files are never written to the output.
     */
    private handleTypeScriptFile() {
        const declarations = this.logger.time(LogLevel.debug, ['find anchor nodes', chalk.green(this.event.srcPath)], () => {
            return findAnchorNodeDeclarations(this.event.data.value?.toString());
        });
        if (declarations.length === 0) {
            //let the program create the default AssetFile
            return;
        }

        //the script file itself is still just an asset
        this.event.files.push(
            this.event.fileFactory.AssetFile({
                srcPath: this.event.srcPath,
                destPath: this.event.destPath,
                data: this.event.data.value
            })
        );

        for (const declaration of declarations) {
            const virtualPath = `anchorNodes/${util.standardizePath(this.event.destPath).replace(/\\/g, '/')}/${declaration.componentName}.xml`;
            const file = this.event.fileFactory.XmlFile({
                srcPath: `virtual:/${virtualPath}`,
                destPath: `components/${virtualPath}`
            });
            file.excludeFromOutput = true;
            file.parse(this.getAnchorNodeXml(declaration));
            this.event.files.push(file);
        }
    }

    /**
     * Build the xml for a component that represents an anchor node
     */
    private getAnchorNodeXml(declaration: AnchorNodeDeclaration) {
        const fields = declaration.fields.map(field => {
            //a field without a known type becomes `dynamic`
            const type = field.type ? ` type="${escapeXml(field.type)}"` : '';
            return `\n        <field id="${escapeXml(field.name)}"${type} />`;
        }).join('');
        return [
            '<?xml version="1.0" encoding="utf-8" ?>',
            //this file is generated, so any diagnostics in it would not be actionable
            '<!-- bs:disable -->',
            `<component name="${escapeXml(declaration.componentName)}" extends="${escapeXml(declaration.extends ?? 'Node')}">`,
            `    <interface>${fields}`,
            '    </interface>',
            '</component>'
        ].join('\n');
    }
}

function escapeXml(text: string) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
