### The main process:

- Maintains a tab manager connected to the main browser window.
- Handles creation of the logical `Tab` entity in a Map. Each Tab is an interface:

```ts
interface Tab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  favicon?: string;
}
```

- Each Tab is linked to a uuid, and has an Active Chromium WebContentsView initialized along with it at startup.
- The tab listens to updates from the webContentsView such as `page-title-updated`, `did-navigate` and so on, and pushes those updates to the renderer process via a `tab:updated` event with the relevant tab info and tab id.
- The history of items per tab's WebContentsView is handled by the WebContentsView itself, with buttons linked to `canGoForward` and `canGoBack`, very similar to the history APIs we are used to with regular JS.
- Essentially, every action on a tab is done to its WebContentsView.
- On resizing of a window, the WebContentsView is resized accordingly.
- There is always a blank tab ready if there are no tabs left in the tabs Map.

<!-- More to be added as this part evolves to include agent -->

### The renderer

We have a single renderer HTML file for now that takes care of displaying the nav bar for the user. The tabs list and the control buttons + Exposing a drag area using the Electron's pre-specified `-webkit-app-region: no-drag` rule.

<!-- More to be added as this part evolves to include agent -->

### The Preload

The Preload script exposes the main process functionality to the renderer via the `globalThis.browserAPI` object.

The renderer just invokes the functions it needs or sends the events it needs acknowledged, and it's up to the main process to handle them.

The preload also exposes global listener functions for the renderer to mount and listen to events received from the main process via `onTabUpdated` being invoked once and then till cleanup listening to the `tab:updated` event from the main process and rendering tabs and their details accordingly.