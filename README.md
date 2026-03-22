# Agentic Browser

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
  preload/
    index.ts          # Secure IPC bridge exposed to renderer via contextBridge
  renderer/
    index.html        # Chrome UI shell
    index.ts          # Tab bar, address bar, navigation UI logic
    style.css         # Browser chrome styles
```

## Architecture Notes

- Each tab gets its own `WebContentsView` with isolated `webPreferences`
- The chrome UI (tab bar + address bar) is rendered in the main `BrowserWindow` at a fixed 80px height
- `WebContentsView` instances are repositioned to fill the remaining space below the chrome
- All renderer ↔ main communication goes through the typed `browserAPI` preload bridge
- Tab state is pushed from main → renderer via IPC events (`tab:updated`, `tab:list-updated`)

## Next Steps

- Wire up `webContents.debugger` per tab for CDP access
- Connect Playwright via `chromium.connectOverCDP()` per tab
- Add the agent chat panel per tab
- Implement snapshot/compaction logic
- Add tool definitions and agent loop
