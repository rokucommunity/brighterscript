import * as childProcess from 'child_process';
import * as path from 'path';
import * as fsExtra from 'fs-extra';

export const scenariosDir = __dirname;
export const tempDir = path.join(__dirname, '..', '.tmp', 'scenarios');

export interface ScenarioProject {
    name: string;
    description?: string;
    /**
     * git url to clone. Use with `ref` so results stay comparable over time
     */
    repo?: string;
    /**
     * commit sha (preferred), tag or branch to check out
     */
    ref?: string;
    /**
     * local path to the project (absolute, or relative to benchmarks/scenarios). Used instead of `repo`
     */
    path?: string;
    /**
     * run `npm install` in the project before running (needed when the project's plugins live in its own node_modules)
     */
    install?: boolean;
    /**
     * path to a bsconfig.json, relative to the project dir
     */
    bsconfig?: string;
    /**
     * BsConfig settings, applied on top of `bsconfig`
     */
    config?: Record<string, any>;
    /**
     * explicit edit targets (paths relative to the project dir). Picked automatically when omitted
     */
    editFiles?: {
        shared?: string;
        leaf?: string;
    };
}

/**
 * Load project definitions from projects.json, plus projects.local.json (gitignored, for private projects) if it exists
 */
export function loadProjects(): ScenarioProject[] {
    const projects: ScenarioProject[] = fsExtra.readJsonSync(path.join(scenariosDir, 'projects.json'));
    const localPath = path.join(scenariosDir, 'projects.local.json');
    if (fsExtra.pathExistsSync(localPath)) {
        projects.push(...fsExtra.readJsonSync(localPath) as ScenarioProject[]);
    }
    return projects;
}

/**
 * Get the project on disk (cloning/installing if needed), and return its directory
 */
export function prepareProject(project: ScenarioProject): string {
    let projectDir: string;
    if (project.path) {
        projectDir = path.resolve(scenariosDir, project.path);
        if (!fsExtra.pathExistsSync(projectDir)) {
            throw new Error(`Project '${project.name}' path does not exist: ${projectDir}`);
        }
    } else if (project.repo) {
        projectDir = path.join(tempDir, 'projects', `${project.name}@${(project.ref ?? 'HEAD').slice(0, 12)}`);
        if (!fsExtra.pathExistsSync(projectDir)) {
            console.log(`scenarios: cloning ${project.repo}${project.ref ? ` @ ${project.ref}` : ''}`);
            fsExtra.ensureDirSync(path.dirname(projectDir));
            exec(`git clone --quiet --filter=blob:none "${project.repo}" "${projectDir}"`);
            if (project.ref) {
                exec(`git checkout --quiet "${project.ref}"`, projectDir);
            }
        }
    } else {
        throw new Error(`Project '${project.name}' needs either a 'repo' or a 'path'`);
    }

    const installMarker = path.join(projectDir, 'node_modules', '.scenarios-installed');
    if (project.install && !fsExtra.pathExistsSync(installMarker)) {
        console.log(`scenarios: npm install for ${project.name}`);
        exec('npm install --no-audit --no-fund --loglevel=error', projectDir);
        fsExtra.outputFileSync(installMarker, '');
    }
    return projectDir;
}

/**
 * Resolve a `--bsc` value to a brighterscript package directory.
 *  - `local`: this repo (uses its `dist` folder)
 *  - a path to a brighterscript package folder
 *  - an npm version or dist-tag, installed into .tmp
 */
export function resolveBsc(bsc: string, build: boolean): { label: string; bscPath: string } {
    if (bsc === 'local') {
        const bscPath = path.resolve(scenariosDir, '..', '..');
        if (build) {
            console.log('scenarios: building local brighterscript');
            exec('npm run build', bscPath);
        }
        if (!fsExtra.pathExistsSync(path.join(bscPath, 'dist', 'index.js'))) {
            throw new Error(`Local brighterscript is not built. Run 'npm run build' first, or pass --build`);
        }
        return { label: 'local', bscPath: bscPath };
    }
    const asPath = path.resolve(bsc);
    if (fsExtra.pathExistsSync(path.join(asPath, 'package.json'))) {
        return { label: path.basename(asPath), bscPath: asPath };
    }
    const installDir = path.join(tempDir, 'bsc', bsc);
    const bscPath = path.join(installDir, 'node_modules', 'brighterscript');
    if (!fsExtra.pathExistsSync(path.join(bscPath, 'package.json'))) {
        console.log(`scenarios: installing brighterscript@${bsc}`);
        fsExtra.ensureDirSync(installDir);
        exec(`npm install --no-save --no-audit --no-fund --loglevel=error --prefix "${installDir}" "brighterscript@${bsc}"`);
    }
    return { label: bsc, bscPath: bscPath };
}

function exec(command: string, cwd = scenariosDir) {
    childProcess.execSync(command, { cwd: cwd, stdio: 'inherit' });
}
