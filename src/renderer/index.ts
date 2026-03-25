interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isActive: boolean;
}

declare const browserAPI: {
  newTab: (url?: string) => Promise<string>;
  closeTab: (tabId: string) => Promise<void>;
  switchTab: (tabId: string) => Promise<void>;
  navigate: (url: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  reload: () => Promise<void>;
  getTabList: () => Promise<TabInfo[]>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onTabUpdated: (cb: (tab: TabInfo) => void) => void;
  onTabListUpdated: (cb: (tabs: TabInfo[]) => void) => void;
};

let tabs: TabInfo[] = [];

const tabsEl = document.getElementById('tabs')!;
const btnNewTab = document.getElementById('btn-new-tab') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const btnForward = document.getElementById('btn-forward') as HTMLButtonElement;
const btnReload = document.getElementById('btn-reload') as HTMLButtonElement;
const addressBar = document.getElementById('address-bar') as HTMLInputElement;
const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement;
const btnMaximize = document.getElementById('btn-maximize') as HTMLButtonElement;
const btnClose = document.getElementById('btn-close') as HTMLButtonElement;

function renderTabs(list: TabInfo[]) {
  tabs = list;
  tabsEl.innerHTML = '';

  for (const tab of list) {
    const el = document.createElement('div');
    el.className = `tab${tab.isActive ? ' active' : ''}`;
    el.dataset.id = tab.id;

    if (tab.favicon) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = tab.favicon;
      img.onerror = () => img.replaceWith(placeholderFavicon());
      el.appendChild(img);
    } else {
      el.appendChild(placeholderFavicon());
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';
    el.appendChild(title);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = 'x';
    close.title = 'Close tab';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void browserAPI.closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => {
      void browserAPI.switchTab(tab.id);
    });

    tabsEl.appendChild(el);

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

async function syncWindowControls() {
  const isMaximized = await browserAPI.isWindowMaximized();
  btnMaximize.title = isMaximized ? 'Restore' : 'Maximize';
  btnMaximize.setAttribute('aria-label', isMaximized ? 'Restore window' : 'Maximize window');
  btnMaximize.classList.toggle('is-maximized', isMaximized);
}

btnNewTab.addEventListener('click', () => {
  void browserAPI.newTab();
});

btnBack.addEventListener('click', () => {
  void browserAPI.goBack();
});

btnForward.addEventListener('click', () => {
  void browserAPI.goForward();
});

btnReload.addEventListener('click', () => {
  void browserAPI.reload();
});

btnMinimize.addEventListener('click', () => {
  void browserAPI.minimizeWindow();
});

btnMaximize.addEventListener('click', async () => {
  await browserAPI.toggleMaximizeWindow();
  await syncWindowControls();
});

btnClose.addEventListener('click', () => {
  void browserAPI.closeWindow();
});

addressBar.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void browserAPI.navigate(addressBar.value.trim());
    addressBar.blur();
  }
});

addressBar.addEventListener('focus', () => addressBar.select());

browserAPI.onTabUpdated((updated) => {
  const idx = tabs.findIndex((tab) => tab.id === updated.id);
  if (idx !== -1) tabs[idx] = updated;
  else tabs.push(updated);
  renderTabs(tabs);
});

browserAPI.onTabListUpdated((list) => {
  renderTabs(list);
});

window.addEventListener('resize', () => {
  void syncWindowControls();
});

(async () => {
  const list = await browserAPI.getTabList();
  renderTabs(list);
  await syncWindowControls();
})();
