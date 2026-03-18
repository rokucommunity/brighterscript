# Tree Shaking

Tree shaking is BrighterScript's dead code elimination feature. When enabled, any function that is never called — directly or indirectly — is removed from the transpiled output, reducing the size of your deployed channel.

Tree shaking is **disabled by default**. You must explicitly opt in.

## Enabling Tree Shaking

Add a `treeShaking` section to your `bsconfig.json`:

```json
{
    "treeShaking": {
        "enabled": true
    }
}
```

That's the minimal configuration. With only `enabled: true`, any function that cannot be reached from a known entry point will be removed.

## How It Works

BrighterScript performs a two-pass analysis across the entire program before transpiling:

**Pass 1 — collect definitions.** Every `sub` and `function` statement in every `.bs`/`.brs` file is recorded, along with its source file and its transpiled (BrightScript) name. `bs:keep` comments are also detected in this pass (see below). Functions declared in XML `<interface>` elements and `onChange` callbacks are collected from `.xml` component files.

**Pass 2 — collect references.** The AST of every file is walked to find:
- Direct call expressions (`doSomething()`, `myNamespace.helper()`)
- String literals that look like identifiers — conservatively retained to support dynamic dispatch patterns like `observeField("field", "onMyFieldChanged")` and `callFunc`
- Variable expressions that reference a known function name (function-by-reference patterns such as `m.observe(node, "field", onContentChanged)`)
- `@.` callFunc shorthand expressions

After both passes, any function that has no references and is not a protected entry point is removed from the transpiled output by replacing its statement with an empty node.

### Protected Entry Points

The following Roku framework callbacks are **always kept** regardless of whether they appear in any call expression:

| Name | Context |
|---|---|
| `main` | Channel entry point |
| `init` | SceneGraph component lifecycle |
| `onKeyEvent` | Remote key handling |
| `onMessage` | Task/port message handling |
| `runUserInterface` | UI task entry point |
| `runTask` | Background task entry point |

## `bs:keep` Comments

A `bs:keep` comment tells the tree shaker to unconditionally keep a specific function, even if it has no detectable callers. This is useful for functions that are invoked dynamically at runtime in ways the static analysis cannot see.

### Same-Line

Place the comment on the same line as the `sub` or `function` keyword:

```brightscript
sub onMyDynamicCallback() ' bs:keep
    ' ...
end sub
```

### Above the Function

Place the comment anywhere between the end of the previous function and the start of the next one:

```brightscript
end sub

' bs:keep
sub onMyDynamicCallback()
    ' ...
end sub
```

Multiple lines of other comments or blank lines between `bs:keep` and the function are fine — the comment applies to the next function that follows it.

### First Function in a File

For the very first function in a file, `bs:keep` can appear anywhere before it (since there is no previous function to bound the region):

```brightscript
' This file's public API — prevent tree shaking
' bs:keep
sub publicEntry()
    ' ...
end sub
```

### `rem` Syntax

Both `'` and `rem` comment starters are supported:

```brightscript
rem bs:keep
sub legacyEntryPoint()
    ' ...
end sub
```

### What `bs:keep` Does NOT Do

- A `bs:keep` comment placed **inside** a function body does not protect that function.
- A `bs:keep` comment does not automatically keep the functions that the annotated function calls — only the annotated function itself. If those callees are also unused by the rest of the program, they will still be removed. Use [`treeShaking.keep`](#treeshakingkeep-rules) rules with dependency closure, or annotate each callee individually, if you need to retain an entire call graph.

## `treeShaking.keep` Rules

For coarser-grained control — keeping entire files, namespaces, or pattern-matched sets of functions — use the `keep` array in `bsconfig.json`. Each entry is either a plain string (exact function name) or a rule object.

### Plain String

A plain string matches the exact transpiled (BrightScript) function name, case-insensitively:

```json
{
    "treeShaking": {
        "enabled": true,
        "keep": [
            "myPublicFunction",
            "myNamespace_helperFunction"
        ]
    }
}
```

For namespaced BrighterScript functions, use the transpiled underscore form. For example, `namespace myNamespace` + `function helperFunction()` transpiles to `myNamespace_helperFunction`.

### Rule Objects

A rule object can filter by any combination of `functions`, `matches`, `src`, and `dest`. All fields present in a single rule must match simultaneously (AND semantics). Rules in the array are evaluated independently and a function is kept if **any** rule matches (OR semantics).

#### `functions` — exact name list

```json
{
    "keep": [
        { "functions": "myNamespace_init" },
        { "functions": ["analyticsTrack", "analyticsFlush"] }
    ]
}
```

#### `matches` — glob/wildcard against the function name

```json
{
    "keep": [
        { "matches": "analytics_*" },
        { "matches": ["debug_*", "test_*"] }
    ]
}
```

#### `src` — glob against the source file path

The pattern is resolved relative to `rootDir` unless it is an absolute path.

```json
{
    "keep": [
        { "src": "source/public/**/*.bs" },
        { "src": ["source/api.bs", "source/auth.bs"] }
    ]
}
```

#### `dest` — glob against the package-relative destination path

This matches the path the file will have inside the deployed zip (e.g. `pkg:/source/utils.brs`).

```json
{
    "keep": [
        { "dest": "source/public/**/*.brs" }
    ]
}
```

#### Combining Fields (AND within a rule)

Keep only functions whose name starts with `api_` **and** that live in a specific file:

```json
{
    "keep": [
        {
            "src": "source/api.bs",
            "matches": "api_*"
        }
    ]
}
```

### Dependency Closure

Keep rules do not automatically pull in the transitive dependencies of a matched function. If `api_login` calls `crypto_hash` and only `api_login` is matched by a keep rule, `crypto_hash` will still be removed if nothing else calls it.

To retain the entire reachable graph of a kept function, either:
- Add a `bs:keep` comment to each function you want to preserve, or
- Add additional keep rules (e.g. a `src` rule that covers the whole file containing the helpers)

## Configuration Reference

```json
{
    "treeShaking": {
        "enabled": false,
        "keep": []
    }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Must be `true` to activate tree shaking |
| `keep` | `(string \| KeepRule)[]` | `[]` | Functions matching any entry are always retained |

**KeepRule fields** (all optional; at least one required):

| Field | Type | Description |
|---|---|---|
| `functions` | `string \| string[]` | Exact transpiled function name(s), case-insensitive |
| `matches` | `string \| string[]` | Glob pattern(s) matched against the transpiled function name |
| `src` | `string \| string[]` | Glob pattern(s) matched against the source file path |
| `dest` | `string \| string[]` | Glob pattern(s) matched against the package-relative destination path |
