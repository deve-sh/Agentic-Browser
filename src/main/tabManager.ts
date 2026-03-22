import { BrowserWindow, WebContentsView } from 'electron';
import { randomUUID } from 'crypto';

export interface Tab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  favicon?: string;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isActive: boolean;
}

const CHROME_HEIGHT = 80; // px reserved for tab bar + address bar

export class TabManager {
  private tabs: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private window: BrowserWindow;

  constructor(window: BrowserWindow) {
    this.window = window;

    // Reposition content views when window is resized
    this.window.on('resize', () => this.repositionActiveView());
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  newTab(url: string = 'https://www.google.com'): string {
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

    // Wire up tab metadata updates → push to renderer
    view.webContents.on('page-title-updated', (_e, title) => {
      tab.title = title;
      this.pushTabUpdate(id);
    });

    view.webContents.on('did-navigate', (_e, navUrl) => {
      tab.url = navUrl;
      this.pushTabUpdate(id);
    });

    view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      tab.url = navUrl;
      this.pushTabUpdate(id);
    });

    view.webContents.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? undefined;
      this.pushTabUpdate(id);
    });

    view.webContents.loadURL(this.normaliseUrl(url));
    this.switchTab(id);

    return id;
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Remove view from window if it's currently attached
    if (this.activeTabId === tabId) {
      this.window.contentView.removeChildView(tab.view);
      this.activeTabId = null;
    }

    tab.view.webContents.close();
    this.tabs.delete(tabId);

    // Switch to the last remaining tab if any
    const remaining = [...this.tabs.keys()];
    if (remaining.length > 0) {
      this.switchTab(remaining[remaining.length - 1]);
    } else {
      // No tabs left — open a blank one
      this.newTab();
    }
  }

  switchTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Detach current active view
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
    tab.view.webContents.loadURL(this.normaliseUrl(url));
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

  getTabList(): TabInfo[] {
    return [...this.tabs.values()].map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      favicon: t.favicon,
      isActive: t.id === this.activeTabId,
    }));
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private activeTab(): Tab | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  }

  private repositionActiveView(): void {
    const tab = this.activeTab();
    if (!tab) return;

    const [width, height] = this.window.getContentSize();
    tab.view.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width,
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

  private normaliseUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    if (/^[\w-]+:\/\//i.test(url)) return url;
    // Treat as search if it contains spaces or has no dot
    if (url.includes(' ') || !url.includes('.')) {
      return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
    return `https://${url}`;
  }
}
