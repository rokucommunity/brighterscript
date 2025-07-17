# Language Server Settings

The BrighterScript language server provides several configuration options to customize its behavior for your project.

## Configuration

All language server settings are configured under the `brightscript.languageServer` section in your VS Code settings.

### projectDiscoveryExclude

The `projectDiscoveryExclude` setting allows you to exclude files and directories from project discovery using glob patterns. This is useful when you want to prevent the language server from creating projects for certain directories or files.

**Type:** `string[]`

**Default:** `undefined`

**Example:**
```json
{
  "brightscript.languageServer.projectDiscoveryExclude": [
    "**/test/**",
    "**/node_modules/**",
    "**/.build/**",
    "**/dist/**"
  ]
}
```

This setting works similarly to VS Code's `files.exclude` setting but is specifically for controlling which files are considered during project discovery.

### files.watcherExclude Support

The language server now automatically respects VS Code's built-in `files.watcherExclude` setting. This setting allows you to exclude files from being watched for changes, which can improve performance in large projects.

**Type:** `Record<string, boolean>`

**Example:**
```json
{
  "files.watcherExclude": {
    "**/tmp/**": true,
    "**/cache/**": true,
    "**/node_modules/**": true,
    "**/.git/objects/**": true
  }
}
```

Files matching patterns in `files.watcherExclude` will be ignored during file watching, which can help reduce system resource usage and improve performance.

## How Exclusion Works

The language server uses multiple exclusion sources to determine which files to process:

1. **VS Code's built-in exclusions:**
   - `files.exclude` - Files excluded from VS Code's file explorer
   - `files.watcherExclude` - Files excluded from file watching
   - `search.exclude` - Files excluded from search operations

2. **BrighterScript-specific exclusions:**
   - `brightscript.languageServer.projectDiscoveryExclude` - Files excluded from project discovery

3. **Standard exclusions:**
   - `.gitignore` patterns
   - Common directories like `node_modules`, `.git`, `out`, `.roku-deploy-staging`

All these exclusion patterns work together to provide comprehensive control over which files the language server processes.

## Performance Tips

For better performance in large projects, consider excluding:

- Build output directories (`**/dist/**`, `**/build/**`, `**/out/**`)
- Test files that don't need language server analysis (`**/test/**`, `**/*.spec.*`)
- Temporary directories (`**/tmp/**`, `**/cache/**`)
- Package dependencies (`**/node_modules/**`)
- Version control directories (`**/.git/**`)

## Compatibility

Both `projectDiscoveryExclude` and `files.watcherExclude` support work with existing exclusion mechanisms and maintain backward compatibility with existing configurations.