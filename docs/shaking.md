# Tree Shaking

Tree shaking is BrighterScript's dead code elimination feature. When enabled, it can remove functions that have no detectable references and aren't protected entry points, reducing the size of your deployed channel.

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

That's the minimal configuration. With only `enabled: true`, the tree shaker removes functions that have no detectable references and are not protected entry points.

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
| `runScreenSaver` | Screensaver entry point |

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

### Dependency Closure

A `bs:keep` annotation preserves the full call chain of the annotated function. BrighterScript's reference pass walks every function body — including those of kept functions — so anything called directly or transitively from a `bs:keep` function is automatically retained.

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

Matches the path the file will have inside the deployed zip. BrighterScript source files (`.bs`) are matched using their transpiled extension (`.brs`), so always write `.brs` in dest patterns. An optional `pkg:/` prefix is accepted and stripped before matching.

```json
{
    "keep": [
        { "dest": "source/public/**/*.brs" },
        { "dest": "pkg:/source/vendor/**/*.brs" }
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

Keep rules preserve the full call chain of every matched function. BrighterScript's reference pass walks every function body, so anything called directly or transitively from a kept function is automatically retained.

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
