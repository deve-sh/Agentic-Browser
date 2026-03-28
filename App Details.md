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

### How PlayWright plugs in

- When the Electron app loads, it by default starts a [remote debugging session](chrome://inspect/#remote-debugging) for the entire Chromium instance at a WS URL (`ws://127.0.0.1:<port>/<session>/<uuid>`). This is so that we can plug into this remote debugging WS URL via PlayWright's `connectOverCDP` function.
- On each tab load, the TabManager initializes the loading of a `WebContentsView` which is a mirror image of a tab running in the Chromium instance.
- A `PlayWrightManager` class is also instantiated during the app load, which connects over CDP to the Chromium Remote Debugging session.
- The `TabManager` communicates with the `PlayWrightManager` instance and asks for the CDP `cdpTargetId` and `cdpWebSocketUrl` for the specific WebContentsView per tab and stores it for use in performing actions such as click, fill, focus, snapshot later on agent request via a tool-call.
- The `PlayWrightManager` class takes care of using the Remote Debugging central URL to list targets and filter out the webcontents that are running and finding the right one for which the url and target is being requested.

### Agent and Agent Session

- The `src/agent/agent.ts` file contains an Agent manager class, one that instantiates an `AgentSession` and takes care of initializing the runtime config as needed (logging) and keeps the LLM list as well.
- The Agent Session is the brain of the browser, it handles storing of messages, interfacing with the provider API and handling auto-compaction when we're close to reaching the limits of the context window.
- It executes as a loop:
  1. User sends a message.
  2. It checks if there are any messages already, if not, it prepends system instructions to the LLM messages list.
  3. It adds the message to the list, if the message is too big for the currently occupied context window, it invokes the provider's API to summarize the message and substitutes it.
  4. It also checks for snapshots or other redundant data such as click/navigation metadata received from previous tool calls which are no longer relevant and compacts them.
  5. It does all the above while maintaining a copy of the messages in memory to display to the user.
  6. It then checks if the entire messages list is too big to fit into a single context window and runs compaction for the previous messages if not.
  7. Once all this is done. It sends the messages list and the available tools to the LLM and waits for a response (Streamed), it checks if there are any `function_calls` necessary for the current iteration of the loop. If yes, it executes the function calls with the arguments.
  8. Each tool / function call is parallelly invoked for this iteration and their outcomes are compiled and added back to the messages list for the agent to process.
  9. If there were no function calls needed, the loop is over and the user can type in and send more data if requested by the agent. The loop continues if so.

### How the agent-main-renderer communication loop works

- Each tab has an `AgentSession` associated with it and vice-verca, it's a 1-1 mapping, limited and scoped APIs to interact with the browser are made available to the agent session using a `BrowserSessionBridge`.
- The main process (`TabManager`) registers a subscription to the `AgentSession`, which provides it the latest stream of the currently processing message to render to the user in real-time.
- The renderer mounts a listener for the `agent:messages-updated` event which gets sent by the main process on any updates to the messages list in the session. This happens twice, once when the message is added to the queue so the user can see their sent message immediately and once after the current loop from the agent session is done processing.
- The renderer process works with a chat sidebar (30% of the width of the screen) which renders the current messages with the tab's agent session, which is sent to the renderer from the main process via tab's `pushAgentMessages` function (Which dispatches the `agent:messages-updated` event with the latest set of messages).