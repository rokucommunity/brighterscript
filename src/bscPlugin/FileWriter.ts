import type { WriteFileEvent } from '../interfaces';
import * as fsExtra from 'fs-extra';

export class FileWriter {
    constructor(
        private event: WriteFileEvent
    ) { }

    public async process() {
        //if no plugin has handled this file yet, we will handle it
        if (!this.event.processedFiles.has(this.event.file)) {
            if (this.event.file.data) {
                //write the file to disk
                await fsExtra.outputFile(this.event.outputPath, this.event.file.data);
                this.event.processedFiles.add(this.event.file);
            } else {
                console.warn(`Missing file data for: "${this.event.file.pkgPath}"`);
            }
        }
    }
}
