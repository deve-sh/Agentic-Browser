import type { TabInfo } from '../main/tabManager';

// browserAPI is injected by the preload script
declare const browserAPI: {
  newTab: (url?: string) => Promise<string>;
  closeTab: (tabId: string) => Promise<void>;
  switchTab: (tabId: string) => Promise<void>;
  navigate: (url: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  reload: () => Promise<void>;
  getTabList: () => Promise<TabInfo[]>;
  onTabUpdated: (cb: (tab: TabInfo) => void) => void;
  onTabListUpdated: (cb: (tabs: TabInfo[]) => void) => void;
};

// ── State ────────────────────────────────────────────────────────────────────

let tabs: TabInfo[] = [];

// ── DOM refs ─────────────────────────────────────────────────────────────────

const tabsEl = document.getElementById('tabs')!;
const btnNewTab = document.getElementById('btn-new-tab')!;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const btnForward = document.getElementById('btn-forward') as HTMLButtonElement;
const btnReload = document.getElementById('btn-reload')!;
const addressBar = document.getElementById('address-bar') as HTMLInputElement;

// ── Render ───────────────────────────────────────────────────────────────────

function renderTabs(list: TabInfo[]) {
  tabs = list;
  tabsEl.innerHTML = '';

  for (const tab of list) {
    const el = document.createElement('div');
    el.className = `tab${tab.isActive ? ' active' : ''}`;
    el.dataset.id = tab.id;

    // Favicon
    if (tab.favicon) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = tab.favicon;
      img.onerror = () => img.replaceWith(placeholderFavicon());
      el.appendChild(img);
    } else {
      el.appendChild(placeholderFavicon());
    }

    // Title
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';
    el.appendChild(title);

    // Close button
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      browserAPI.closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => browserAPI.switchTab(tab.id));
    tabsEl.appendChild(el);

    // Update address bar for the active tab
    if (tab.isActive) {
      addressBar.value = tab.url === 'about:blank' ? '' : tab.url;
    }
  }
}

function placeholderFavicon(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'tab-favicon-placeholder';
  return div;
}

// ── Events ───────────────────────────────────────────────────────────────────

btnNewTab.addEventListener('click', () => browserAPI.newTab());

btnBack.addEventListener('click', () => browserAPI.goBack());
btnForward.addEventListener('click', () => browserAPI.goForward());
btnReload.addEventListener('click', () => browserAPI.reload());

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    browserAPI.navigate(addressBar.value.trim());
    addressBar.blur();
  }
});

addressBar.addEventListener('focus', () => addressBar.select());

// ── IPC listeners ─────────────────────────────────────────────────────────────

browserAPI.onTabUpdated((updated) => {
  const idx = tabs.findIndex((t) => t.id === updated.id);
  if (idx !== -1) tabs[idx] = updated;
  else tabs.push(updated);
  renderTabs(tabs);
});

browserAPI.onTabListUpdated((list) => {
  renderTabs(list);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  const list = await browserAPI.getTabList();
  renderTabs(list);
})();
