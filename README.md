# Agentic Browser

For an overview of the entire app -> Check [App Details.md](./App%20Details.md).

An Electron-based browser with per-tab `WebContentsView` isolation, built as the foundation for an agentic browsing experience.

## Setup

```bash
npm install
npm start
```

For development with watch mode:

```bash
npm run dev
```

## Project Structure

```
src/
  main/
    index.ts          # Electron main process, IPC handlers, window setup
    tabManager.ts     # WebContentsView lifecycle, tab state, CDP exposure
    playwrightManager.ts  # Handles CDP Connection to the underlying Electron Chromium instance and exposes APIs to automate things like clicking, filling etc
  preload/
    index.ts          # Secure IPC bridge exposed to renderer via contextBridge
  renderer/
    index.html        # Chrome UI shell
    index.ts          # Tab bar, address bar, navigation UI logic
    style.css         # Browser chrome styles
```

## Architecture Notes

- Each tab gets its own `WebContentsView` with isolated `webPreferences`
- The chrome UI (tab bar + address bar) is rendered in the main `BrowserWindow` at a fixed 84px height
- `WebContentsView` instances are repositioned to fill the remaining space below the chrome
- All renderer <-to-from-> main communication goes through the typed `browserAPI` preload bridge
- Tab state is pushed from main → renderer via IPC events (`tab:updated`, `tab:list-updated`)

## Next Steps

- [x] Wire up `webContents.debugger` per tab for CDP access
- [x] Connect Playwright via `chromium.connectOverCDP()` per tab
- [x] Add agent manager and session manager
- [x] Instantiate agent and connect session per tab initialization
- [ ] Add tool definitions and agent loop
- [ ] Add the agent chat panel per tab
- [ ] Implement snapshot/compaction logic
