# Upgrade Guide: BrighterScript v0 to v1

This guide helps developers upgrade projects from BrighterScript v0 to v1, highlighting major new features, breaking changes, and adjustments needed for plugins and AST usage.

---

## Table of Contents

- [New Features](#new-features)
- [AST Changes](#ast-changes)
- [Validation Overview](#validation-overview)
- [Plugin Changes](#plugin-changes)
- [General Upgrade Guidance](#general-upgrade-guidance)
- [Further Reading & Resources](#further-reading--resources)

---

## New Features

BrighterScript v1 introduces several enhancements over v0. Some key features include:

### Improved Type Checking ([TODO: create docs/type-checking.md])

- **Built-in types support** for Roku SceneGraph nodes such as `roSGNodeLabel` and BrightScript components like `roDeviceInfo`.
- **Typed arrays**: You can declare arrays with element types (e.g., `Integer[]`, `String[]`).
- **Union types**: Functions, variables, and parameters can be typed to allow multiple types (e.g., `Integer | String`).
- **Typecasts**: Type casting is supported using the `as` keyword.

**Examples:**
```brighterscript
' Typed array
sub logNames(names as String[])
  for each name in names
    print name
  end for
end sub

' Union type parameter
function getId(id as Integer | String) as String
  return id.toStr()
end function

' Typecast
node = m.top as roSGNodeLabel
```

### Extended Plugin API ([docs/plugins.md](./plugins.md))
- Plugins can hook into more lifecycle events and validation steps.

### New AST Nodes ([TODO: create docs/ast.md])
- Several node types have changed and new properties have been added for advanced analysis.

### Enhanced Diagnostics and Validation ([TODO: create docs/validation.md])
- Validation rules are more configurable and extensible.

> See the [TODO: create docs/release-notes.md] for a full list of features.

---

## AST Changes

The Abstract Syntax Tree (AST) was modernized in v1:

- Several node types have changed, with new properties added for improved analysis.
- Legacy v0 AST node types may be deprecated or renamed.
- Traversal utilities have been improved for performance and reliability.

If you rely on AST manipulation or analysis, review the [TODO: create docs/ast.md] for updated node structures and traversal patterns.

---

## Validation Overview

Validation in v1 is more robust and configurable:

- Validation rules are now extensible via the plugin API.
- Diagnostics reporting is more granular, allowing for better error and warning management.
- You can customize validation thresholds and behaviors via project configuration.

See the [TODO: create docs/validation.md] for setup and usage examples.

---

## Plugin Changes

Plugins in v1 use an updated API:

- The plugin registration process has changed ([docs/plugins.md](./plugins.md)).
- Plugins can now hook into more lifecycle events, including AST traversal and validation.
- Breaking changes: some legacy plugin hooks may no longer be supported.

If you maintain plugins, consult the plugin documentation for migration details.

---

## General Upgrade Guidance

- Review your project’s configuration files and update them as per v1 requirements.
- Refactor any custom AST code to comply with the new node types and traversal methods.
- Update plugins to use the new registration and hook APIs.
- Run your build and validation processes, and address new diagnostics or warnings.
- Consult the [TODO: create docs/release-notes.md] for a full changelog.

---

## Further Reading & Resources

- [Type Checking](./type-checking.md) <!-- TODO: create this doc -->
- [Plugins](./plugins.md)
- [AST](./ast.md) <!-- TODO: create this doc -->
- [Validation](./validation.md)
- [Release Notes](./release-notes.md) <!-- TODO: create this doc -->

---

For questions or to report upgrade issues, please visit [GitHub Issue #1444](https://github.com/rokucommunity/brighterscript/issues/1444).
