import { BrowserWindow, WebContentsView } from 'electron';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserFindResult,
  BrowserNavigateResult,
  BrowserSessionBridge,
  BrowserSnapshotOptions,
  BrowserSnapshotResult,
  BrowserWaitRequest,
  BrowserWaitResult,
} from '../agent/types';
import type { PlaywrightManager } from './playwrightManager';
import type AgentSession from '../agent/session';
import type Agent from '../agent/agent';

export interface Tab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  isPlaceholderBlankPage?: boolean;
  favicon?: string;
  cdpTargetId?: string;
  cdpWebSocketUrl?: string;
  agentSession?: AgentSession;
  unsubscribeAgentSession?: () => void;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isActive: boolean;
}

export const CHAT_SIDEBAR_MIN_WIDTH = 300;
export const CHAT_SIDEBAR_RATIO = 0.3;
export const MIN_WEBVIEW_WIDTH = 500;
export const CHROME_HEIGHT = 84; // px reserved for the draggable header and nav bar

type AgentStreamEvent =
  | { type: 'chunks-start' }
  | { type: 'chunk'; content: string }
  | { type: 'chunks-end' };

type ChatMessage = {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
};

type ToolCallMetadataEntry = {
  label: string;
  value: string;
};

type ToolCallItem = {
  type: 'tool_call';
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  metadata: ToolCallMetadataEntry[];
};

type AgentProcessingState = {
  tabId: string;
  isProcessing: boolean;
};

type ChatTimelineItem = ChatMessage | ToolCallItem;

export class TabManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private readonly blankPageFilePath = path.join(__dirname, '../../src/renderer/blank.html');

  constructor(
    private readonly window: BrowserWindow,
    private readonly playwrightManager: PlaywrightManager,
    private readonly agentManager: Agent
  ) {
    // Reposition content views when window is resized
    this.window.on('resize', () => this.repositionActiveView());
  }

  newTab(url: string = 'about:blank'): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const tab: Tab = { id, view, title: 'New Tab', url };
    this.tabs.set(id, tab);
    this.hydrateAutomationMetadata(tab);
    void this.agentManager
      .startSession(
        { llm: 'openai', model: 'gpt-4o-mini', browser: this.createBrowserBridge(id) },
      )
      .then((initializedSession) => {
        tab.agentSession = initializedSession;
        tab.unsubscribeAgentSession = initializedSession.subscribe((_sessionId, chunk) => {
          this.window.webContents.send('agent:stream', {
            tabId: id,
            chunk,
          } satisfies { tabId: string; chunk: AgentStreamEvent });
        });
        this.pushAgentMessages(id);
      })
      .catch((error) => {
        console.warn(`Failed to initialize agent session for tab ${id}.`, error);
      });

    view.webContents.on('page-title-updated', (_e, title) => {
      tab.title = tab.isPlaceholderBlankPage ? 'New Tab' : title;
      this.pushTabUpdate(id);
    });

    view.webContents.on('did-navigate', (_e, navUrl) => {
      if (tab.isPlaceholderBlankPage && this.isBlankPlaceholderUrl(navUrl)) {
        tab.url = 'about:blank';
      } else {
        tab.isPlaceholderBlankPage = false;
        tab.url = navUrl;
      }
      this.pushTabUpdate(id);
    });

    view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      if (tab.isPlaceholderBlankPage && this.isBlankPlaceholderUrl(navUrl)) {
        tab.url = 'about:blank';
      } else {
        tab.isPlaceholderBlankPage = false;
        tab.url = navUrl;
      }
      this.pushTabUpdate(id);
    });

    view.webContents.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? undefined;
      this.pushTabUpdate(id);
    });

    view.webContents.on('did-finish-load', () => {
      this.hydrateAutomationMetadata(tab);
    });

    this.loadTabContents(tab, url);
    this.switchTab(id);

    return id;
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (this.activeTabId === tabId) {
      this.window.contentView.removeChildView(tab.view);
      this.activeTabId = null;
    }

    tab.view.webContents.close();
    tab.unsubscribeAgentSession?.();
    this.tabs.delete(tabId);

    const remaining = [...this.tabs.keys()];
    if (remaining.length > 0) {
      this.switchTab(remaining[remaining.length - 1]);
    } else {
      // Keep a blank page ready for the planned custom new-tab UI.
      this.newTab();
    }
  }

  switchTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (this.activeTabId && this.activeTabId !== tabId) {
      const current = this.tabs.get(this.activeTabId);
      if (current) {
        this.window.contentView.removeChildView(current.view);
      }
    }

    this.activeTabId = tabId;
    this.window.contentView.addChildView(tab.view);
    this.repositionActiveView();

    this.pushTabListUpdate();
  }

  navigateActive(url: string): void {
    const tab = this.activeTab();
    if (!tab) return;
    this.loadTabContents(tab, url);
  }

  goBack(): void {
    const tab = this.activeTab();
    if (tab?.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }

  goForward(): void {
    const tab = this.activeTab();
    if (tab?.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }

  reload(): void {
    this.activeTab()?.view.webContents.reload();
  }

  async snapshot(tabId: string, options: BrowserSnapshotOptions = {}): Promise<BrowserSnapshotResult> {
    const targetId = this.requireTargetId(tabId);
    return this.playwrightManager.snapshot(targetId, options);
  }

  async navigate(tabId: string, url: string): Promise<BrowserNavigateResult> {
    const targetId = this.requireTargetId(tabId);
    return this.playwrightManager.navigate(targetId, this.normaliseUrl(url));
  }

  async handleAction(tabId: string, action: BrowserActionRequest): Promise<BrowserActionResult> {
    const targetId = this.requireTargetId(tabId);
    return this.playwrightManager.handleAction(targetId, action);
  }

  async findElements(tabId: string, query: BrowserWaitRequest): Promise<BrowserFindResult> {
    const targetId = this.requireTargetId(tabId);
    return this.playwrightManager.findElements(targetId, query);
  }

  async waitForElement(tabId: string, query: BrowserWaitRequest): Promise<BrowserWaitResult> {
    const targetId = this.requireTargetId(tabId);
    return this.playwrightManager.waitForElement(targetId, query);
  }

  getTabList(): TabInfo[] {
    return [...this.tabs.values()].map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      favicon: t.favicon,
      isActive: t.id === this.activeTabId,
    }));
  }

  async sendAgentMessage(tabId: string, message: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab?.agentSession) {
      throw new Error(`Tab ${tabId} does not have an initialized agent session yet.`);
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    const messageProcessingPromise = tab.agentSession.sendMessage({
      role: 'user',
      content: trimmedMessage,
    });

    this.pushAgentProcessingState(tabId, true);
    this.pushAgentMessages(tabId);

    try {
      await messageProcessingPromise;
    } finally {
      this.pushAgentMessages(tabId);
      this.pushAgentProcessingState(tabId, false);
    }
  }

  cancelAgentMessage(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab?.agentSession) {
      return false;
    }

    return tab.agentSession.cancelCurrentProcess();
  }

  isAgentProcessing(tabId: string): boolean {
    return this.tabs.get(tabId)?.agentSession?.isProcessing ?? false;
  }

  hasActiveAgentProcessing(): boolean {
    return [...this.tabs.values()].some((tab) => tab.agentSession?.isProcessing);
  }

  getAgentMessages(tabId: string): ChatTimelineItem[] {
    const tab = this.tabs.get(tabId);
    if (!tab?.agentSession) {
      return [];
    }

    const timeline: ChatTimelineItem[] = [];
    const toolItemsByCallId = new Map<string, ToolCallItem>();

    for (const message of tab.agentSession.messages) {
      if ('role' in message && (message.role === 'user' || message.role === 'assistant')) {
        timeline.push({
          type: 'message',
          role: message.role,
          content: message.content ?? '',
        });
        continue;
      }

      if ('type' in message && message.type === 'function_call') {
        if (!message.call_id) {
          continue;
        }

        const toolItem: ToolCallItem = {
          type: 'tool_call',
          id: message.call_id,
          name: message.name,
          status: 'running',
          metadata: this.summarizeToolCallArguments(message.name, message.arguments),
        };

        toolItemsByCallId.set(message.call_id, toolItem);
        timeline.push(toolItem);
        continue;
      }

      if ('output' in message && 'call_id' in message) {
        if (!message.call_id) {
          continue;
        }

        const toolItem = toolItemsByCallId.get(message.call_id) ?? {
          type: 'tool_call' as const,
          id: message.call_id,
          name: 'tool_call',
          status: 'running' as const,
          metadata: [],
        };

        const outputSummary = this.summarizeToolCallOutput(message.output);
        toolItem.status = outputSummary.status;
        toolItem.metadata = this.mergeMetadata(toolItem.metadata, outputSummary.metadata);

        if (!toolItemsByCallId.has(message.call_id)) {
          toolItemsByCallId.set(message.call_id, toolItem);
          timeline.push(toolItem);
        }
      }
    }

    return timeline;
  }

  private activeTab(): Tab | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  }

  private requireTargetId(tabId: string): string {
    const targetId = this.tabs.get(tabId)?.cdpTargetId;
    if (!targetId) {
      throw new Error(`Tab ${tabId} does not have a resolved CDP target.`);
    }

    return targetId;
  }

  private repositionActiveView(): void {
    const tab = this.activeTab();
    if (!tab) return;

    const [width, height] = this.window.getContentSize();
    const sidebarWidth = Math.max(
      CHAT_SIDEBAR_MIN_WIDTH,
      Math.floor(width * CHAT_SIDEBAR_RATIO),
    );
    tab.view.setBounds({
      x: sidebarWidth,
      y: CHROME_HEIGHT,
      width: Math.max(0, width - sidebarWidth),
      height: height - CHROME_HEIGHT,
    });
  }

  private pushTabUpdate(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.window.webContents.send('tab:updated', {
      id: tabId,
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      isActive: tabId === this.activeTabId,
    } satisfies TabInfo);
  }

  private pushTabListUpdate(): void {
    this.window.webContents.send('tab:list-updated', this.getTabList());
  }

  private pushAgentMessages(tabId: string): void {
    this.window.webContents.send('agent:messages-updated', {
      tabId,
      messages: this.getAgentMessages(tabId),
    } satisfies { tabId: string; messages: ChatTimelineItem[] });
  }

  private pushAgentProcessingState(tabId: string, isProcessing: boolean): void {
    this.window.webContents.send('agent:processing-state', {
      tabId,
      isProcessing,
    } satisfies AgentProcessingState);
  }

  private hydrateAutomationMetadata(tab: Tab): void {
    void this.playwrightManager
      .resolveTabMetadata(tab.view.webContents)
      .then((metadata) => {
        tab.cdpTargetId = metadata.cdpTargetId;
        tab.cdpWebSocketUrl = metadata.cdpWebSocketUrl;
      })
      .catch((error) => {
        console.warn(`Failed to hydrate automation metadata for tab ${tab.id}.`, error);
      });
  }

  private createBrowserBridge(tabId: string): BrowserSessionBridge {
    return {
      navigate: (url: string) => this.navigate(tabId, url),
      snapshot: (options: BrowserSnapshotOptions) => this.snapshot(tabId, options),
      handleAction: (action: BrowserActionRequest) => this.handleAction(tabId, action),
      findElements: (query: BrowserWaitRequest) => this.findElements(tabId, query),
      waitForElement: (query: BrowserWaitRequest) => this.waitForElement(tabId, query),
    };
  }

  private normaliseUrl(url: string): string {
    if (url === 'about:blank') return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (/^[\w-]+:/i.test(url)) return url;
    if (url.includes(' ') || !url.includes('.')) {
      return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
    return `https://${url}`;
  }

  private loadTabContents(tab: Tab, rawUrl: string): void {
    const targetUrl = this.normaliseUrl(rawUrl);

    if (targetUrl === 'about:blank') {
      tab.isPlaceholderBlankPage = true;
      tab.url = 'about:blank';
      tab.title = 'New Tab';
      tab.favicon = undefined;
      this.pushTabUpdate(tab.id);
      void tab.view.webContents.loadFile(this.blankPageFilePath);
      return;
    }

    tab.isPlaceholderBlankPage = false;
    void tab.view.webContents.loadURL(targetUrl);
  }

  private isBlankPlaceholderUrl(url: string): boolean {
    return url.startsWith('file://') && url.endsWith('/src/renderer/blank.html');
  }

  private summarizeToolCallArguments(name: string, rawArguments: string): ToolCallMetadataEntry[] {
    const args = this.parseRecord(rawArguments);
    const metadata: ToolCallMetadataEntry[] = [{ label: 'Tool', value: name }];

    this.pushMetadataIfPresent(metadata, 'Action', args.action);
    this.pushMetadataIfPresent(metadata, 'URL', args.url);
    this.pushMetadataIfPresent(metadata, 'Ref', args.ref);
    this.pushMetadataIfPresent(metadata, 'Selector', args.selector);
    this.pushMetadataIfPresent(metadata, 'Text', args.text);
    this.pushMetadataIfPresent(metadata, 'Label', args.label);
    this.pushMetadataIfPresent(metadata, 'Placeholder', args.placeholder);
    this.pushMetadataIfPresent(metadata, 'Role', args.role);
    this.pushMetadataIfPresent(metadata, 'Name', args.name);
    this.pushMetadataIfPresent(metadata, 'State', args.state);
    this.pushMetadataIfPresent(metadata, 'Format', args.format);
    this.pushMetadataIfPresent(metadata, 'Key', args.key);
    this.pushMetadataIfPresent(metadata, 'Value', args.value);

    if (typeof args.count === 'number' && args.count > 1) {
      metadata.push({ label: 'Count', value: String(args.count) });
    }

    if (typeof args.timeoutMs === 'number') {
      metadata.push({ label: 'Timeout', value: `${args.timeoutMs}ms` });
    }

    if (Array.isArray(args.filePaths) && args.filePaths.length > 0) {
      metadata.push({
        label: 'Files',
        value: args.filePaths.slice(0, 2).map((filePath) => path.basename(String(filePath))).join(', ')
          + (args.filePaths.length > 2 ? ` +${args.filePaths.length - 2}` : ''),
      });
    }

    return metadata.slice(0, 5);
  }

  private summarizeToolCallOutput(rawOutput?: unknown): {
    status: 'completed' | 'failed';
    metadata: ToolCallMetadataEntry[];
  } {
    const output = this.parseRecord(rawOutput);
    const status = output.type === 'failed' ? 'failed' : 'completed';
    const metadata: ToolCallMetadataEntry[] = [{ label: 'Status', value: status }];
    const value =
      output.value && typeof output.value === 'object' ? (output.value as Record<string, unknown>) : {};

    this.pushMetadataIfPresent(metadata, 'Page', value.title);
    this.pushMetadataIfPresent(metadata, 'URL', value.url);

    if (typeof value.count === 'number') {
      metadata.push({ label: 'Count', value: String(value.count) });
    }

    if (typeof value.state === 'string') {
      metadata.push({ label: 'State', value: value.state });
    }

    if (typeof value.success === 'boolean') {
      metadata.push({ label: 'Success', value: value.success ? 'Yes' : 'No' });
    }

    if (typeof value.refsInvalidated === 'boolean') {
      metadata.push({
        label: 'Refs',
        value: value.refsInvalidated ? 'Invalidated' : 'Preserved',
      });
    }

    if (status === 'failed') {
      this.pushMetadataIfPresent(metadata, 'Reason', output.reason);
    }

    return {
      status,
      metadata: metadata.slice(0, 5),
    };
  }

  private mergeMetadata(
    existingMetadata: ToolCallMetadataEntry[],
    nextMetadata: ToolCallMetadataEntry[],
  ): ToolCallMetadataEntry[] {
    const merged = new Map<string, string>();

    for (const item of [...existingMetadata, ...nextMetadata]) {
      merged.set(item.label, item.value);
    }

    return [...merged.entries()].map(([label, value]) => ({ label, value }));
  }

  private pushMetadataIfPresent(
    metadata: ToolCallMetadataEntry[],
    label: string,
    value: unknown,
  ) {
    if (typeof value !== 'string') {
      return;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return;
    }

    metadata.push({
      label,
      value: trimmedValue.length > 60 ? `${trimmedValue.slice(0, 57)}...` : trimmedValue,
    });
  }

  private parseRecord(rawValue?: unknown): Record<string, unknown> {
    if (!rawValue) {
      return {};
    }

    if (typeof rawValue === 'object') {
      return rawValue as Record<string, unknown>;
    }

    if (typeof rawValue !== 'string') {
      return {};
    }

    try {
      const parsed = JSON.parse(rawValue) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
