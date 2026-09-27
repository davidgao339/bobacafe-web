# Browser Testing Workaround

**Context:** 
The built-in `browser_subagent` tool fails to initialize in this environment because its required Playwright driver returns a 404 during installation.

**Rule:**
- **DO NOT** use the `browser_subagent` tool for browser testing, UI verification, or taking screenshots.
- **INSTEAD**, use the local Playwright installation located in the `scratch_pw` directory at the root of the workspace.
- To test UI behavior or take a screenshot, write a custom Node.js script (e.g., `scratch_pw/browser_test.js`) that imports playwright, run it using `node`, and view the resulting screenshot files.
