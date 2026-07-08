import type { WriteFileEvent } from '../interfaces';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

export class FileWriter {
    constructor(
        private event: WriteFileEvent
    ) { }

    public async process() {
        //if no plugin has handled this file yet, we will handle it
        if (!this.event.processedFiles.has(this.event.file)) {
            if (this.event.file.data) {
                let data = this.event.file.data;
                //finalize sourcemap source paths now that we know the absolute output path of the
                //.map file. Doing this here (rather than in serialize) means we can compute
                //sources[] paths that are relative to the actual map location on disk.
                if (this.event.file.pkgPath?.endsWith('.map')) {
                    data = this.transformSourceMap(data);
                }
                //write the file to disk
                await fsExtra.outputFile(this.event.outputPath, data);
                this.event.processedFiles.add(this.event.file);
            } else {
                console.warn(`Missing file data for: "${this.event.file.pkgPath}"`);
            }
        }
    }

    /**
     * Apply `relativeSourceMaps` and `sourceRoot` BsConfig options to the sources[] array of
     * the source map, using the .map file's absolute output path to compute relative entries.
     *
     * - `relativeSourceMaps: false` (default): leave sources[] as-is (absolute paths produced by
     *    the transpile step, with `rootDir` already replaced by `sourceRoot` if configured).
     * - `relativeSourceMaps: true` + no `sourceRoot`: rewrite each absolute source path to be
     *    relative to the .map file's directory, so the map is portable across machines.
     * - `relativeSourceMaps: true` + `sourceRoot`: write the `sourceRoot` field and make each
     *    sources[] entry relative to `sourceRoot` (per the sourcemap spec — consumers
     *    reconstruct the full path as `path.resolve(sourceRoot, sources[0])`).
     */
    private transformSourceMap(data: Buffer): Buffer {
        const { relativeSourceMaps, sourceRoot } = this.event.program.options;
        if (!relativeSourceMaps) {
            return data;
        }
        let mapJson: { sources?: string[]; sourceRoot?: string };
        try {
            mapJson = JSON.parse(data.toString('utf8'));
        } catch {
            //not valid json, leave it alone
            return data;
        }
        if (!Array.isArray(mapJson.sources)) {
            return data;
        }
        const outputPath = this.event.outputPath;
        if (sourceRoot) {
            mapJson.sourceRoot = sourceRoot;
            mapJson.sources = mapJson.sources.map(source => {
                const absolute = path.isAbsolute(source) ? source : path.resolve(path.dirname(outputPath), source);
                return path.relative(sourceRoot, absolute).replace(/\\/g, '/');
            });
        } else {
            const mapDir = path.dirname(outputPath);
            mapJson.sources = mapJson.sources.map(source => {
                return path.isAbsolute(source)
                    ? path.relative(mapDir, source).replace(/\\/g, '/')
                    : source;
            });
        }
        return Buffer.from(JSON.stringify(mapJson));
    }
}
