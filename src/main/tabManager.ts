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
  role: 'user' | 'assistant';
  content: string;
};

type AgentProcessingState = {
  tabId: string;
  isProcessing: boolean;
};

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

  getAgentMessages(tabId: string): ChatMessage[] {
    const tab = this.tabs.get(tabId);
    if (!tab?.agentSession) {
      return [];
    }

    return tab.agentSession.messages
      .filter(
        (message): message is { role: 'user' | 'assistant' | 'system'; content?: string } =>
          'role' in message && Boolean(message.content),
      )
      .filter(
        (message): message is { role: 'user' | 'assistant'; content?: string } =>
          message.role === 'user' || message.role === 'assistant',
      )
      .map((message) => ({
        role: message.role,
        content: message.content ?? '',
      }));
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
    } satisfies { tabId: string; messages: ChatMessage[] });
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
}
