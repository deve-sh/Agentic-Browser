import { contextBridge, ipcRenderer } from 'electron';

interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isActive: boolean;
}

contextBridge.exposeInMainWorld('browserAPI', {
  // Tab actions
  newTab: (url?: string) => ipcRenderer.invoke('tab:new', url),
  closeTab: (tabId: string) => ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke('tab:switch', tabId),
  navigate: (url: string) => ipcRenderer.invoke('tab:navigate', url),
  goBack: () => ipcRenderer.invoke('tab:go-back'),
  goForward: () => ipcRenderer.invoke('tab:go-forward'),
  reload: () => ipcRenderer.invoke('tab:reload'),
  getTabList: () => ipcRenderer.invoke('tab:list'),

  // Events from main → renderer
  onTabUpdated: (cb: (tab: TabInfo) => void) => {
    ipcRenderer.on('tab:updated', (_e, tab) => cb(tab));
  },
  onTabListUpdated: (cb: (tabs: TabInfo[]) => void) => {
    ipcRenderer.on('tab:list-updated', (_e, tabs) => cb(tabs));
  },
});
