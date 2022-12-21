import type { BeforeFileParseEvent, ProvideFileEvent } from '../../interfaces';
import chalk from 'chalk';
import { LogLevel } from '../../Logger';
import type { BrsFile } from '../../files/BrsFile';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { ComponentStatement } from '../../parser/Statement';
import { ParseMode } from '../../parser/Parser';
import * as path from 'path';
import util from '../../util';
import undent from 'undent';
import { Cache } from '../../Cache';

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

        let parseEvent: BeforeFileParseEvent = {
            //TODO remove `pathAbsolute` in v1
            pathAbsolute: this.event.srcPath,
            srcPath: this.event.srcPath,
            source: text
        };
        this.event.program.plugins.emit('beforeFileParse', parseEvent);

        this.logger.time(LogLevel.debug, ['parse', chalk.green(this.event.srcPath)], () => {
            file.parse(parseEvent.source);
        });

        //notify plugins that this file has finished parsing
        this.event.program.plugins.emit('afterFileParse', file);

        this.event.files.push(file);

        //emit new files for comonent statements
        this.handleComponentStatements(file);
    }

    /**
     * Create virtual files for every component statement found in this physical file
     */
    private handleComponentStatements(file: BrsFile) {
        const cache = new Cache<string, string>();
        file.ast.walk(createVisitor({
            ComponentStatement: (node) => {
                //ensure the component resides within the `pkg:/components` folder
                const destDir = cache.getOrAdd('', () => {
                    return path.dirname(file.destPath).replace(/^(.+?)(?=[\/\\]|$)/, (match: string, firstDirName: string) => {
                        return 'components';
                    });
                });

                this.registerComponent(file, node, destDir);
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
    }

    private registerComponent(file: BrsFile, statement: ComponentStatement, destDir: string) {
        let name = statement.getName(ParseMode.BrightScript);
        const xmlFile = this.event.fileFactory.XmlFile({
            srcPath: `virtual:/${destDir}/${name}.xml`,
            destPath: `${destDir}/${name}.xml`
        });
        xmlFile.parse(undent`
            <component name="${name}" extends="${statement.getParentName(ParseMode.BrightScript) ?? 'Group'}">
                <script uri="${util.sanitizePkgPath(file.destPath)}" />
            </component>
        `);
        this.event.files.push(xmlFile);
    }

    private handleXmlFile() {
        //only process files from the components folder (Roku will only parse xml files in the components folder)
        if (!/^(pkg:\/)?components[\/\\]/i.exec(this.event.destPath)) {
            return;
        }
        const text = this.event.data.value.toString();
        //add the file to the program
        const file = this.event.fileFactory.XmlFile(this.event);

        let beforeFileParseEvent: BeforeFileParseEvent = {
            //TODO remove `pathAbsolute` in v1
            pathAbsolute: this.event.srcPath,
            srcPath: this.event.srcPath,
            source: text
        };
        this.event.program.plugins.emit('beforeFileParse', beforeFileParseEvent);

        this.logger.time(LogLevel.debug, ['parse', chalk.green(this.event.srcPath)], () => {
            file.parse(beforeFileParseEvent.source);
        });

        //notify plugins that this file has finished parsing
        this.event.program.plugins.emit('afterFileParse', file);

        this.event.files.push(file);
    }
}
