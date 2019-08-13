import * as chokidar from 'chokidar';

import { BsConfig } from './BsConfig';

/**
 * There are some bugs with chokidar, so this attempts to mitigate them
 */
export class Watcher {
    constructor(
        private options: BsConfig
    ) {

    }

    private watchers = <chokidar.FSWatcher[]>[];

    /**
     * Watch the paths or globs
     * @param paths
     */
    public watch(paths: string | string[]) {
        let watcher = chokidar.watch(paths, {
            cwd: this.options.rootDir,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 100
            }
        });
        this.watchers.push(watcher);

        return () => {
            //unwatch all paths
            watcher.unwatch(paths);
            //close the watcher
            watcher.close();
            //remove the watcher from our list
            this.watchers.splice(this.watchers.indexOf(watcher), 1);
        };
    }

    /**
     * Be notified of all events
     * @param event
     * @param callback
     */
    public on(event: 'all', callback: (event, path, details) => void) {
        let watchers = [...this.watchers];
        for (let watcher of watchers) {
            watcher.on(event, cb);
        }

        function cb(event, path, details) {
            callback(event, path, details);
        }

        //a disconnect function
        return () => {
            for (let watcher of watchers) {
                watcher.removeListener('all', cb);
            }
        };
    }

    public dispose() {
        for (let watcher of this.watchers) {
            watcher.removeAllListeners();
        }
    }
}
