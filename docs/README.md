# mcp-projection docs

Projection adds a live, styled UI for humans to an MCP server without changing what the model sees. These docs describe version 0.3.

**New here.** Read these in order.

1. [Getting started](getting-started.md): check fit, install, write one file, change one line, verify.
2. [Worked example: a tasks server](example-tasks.md): a complete UI with search, status changes, confirm dialogs and an activity feed.
3. [How it works](how-it-works.md): the model behind it, the update cycle, cost and limits.

**Building a UI.**

- [Design the UI](design.md): what the screen should show, mapping tools to UI, layout patterns, visual rules.
- [Views and actions](views-and-actions.md): the view, HTML, components, params, actions, forms, confirm dialogs.
- [Users and security](users-and-security.md): identity from MCP `authInfo`, and what a UI exposes.
- [Styling](styling.md): tokens, themes, light and dark, replacing the kit.
- [Web mode](web-mode.md): the same UI on a normal URL, through a single-use link.
- [Testing](testing.md): `testUi`, previews and screenshots, the tool snapshot.

**Looking something up.**

- [Reference](reference.md): every option, member, component, attribute and error.
- [Troubleshooting](troubleshooting.md): symptom, cause, fix.
- [Recipes](../skills/mcp-projection/references/recipes.md): tested code for common patterns.

**Letting an agent do it.** Give it the skill in [`skills/mcp-projection`](../skills/mcp-projection/SKILL.md). It carries copies of the reference and troubleshooting pages.

## Editing these docs

`reference.md` and `troubleshooting.md` are copied into `skills/mcp-projection/references/` by `npm run build`, so the skill works on its own. Edit them here, never in the skill. They may link only to each other and to files under `skills/mcp-projection/`; the build fails on any other relative link. Link to a section by its heading, never by a number in the prose.
