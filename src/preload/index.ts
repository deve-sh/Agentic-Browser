import { contextBridge, ipcRenderer } from 'electron';

interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isActive: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AgentStreamEvent {
  type: 'chunks-start' | 'chunks-end' | 'chunk';
  content?: string;
}

interface AgentProcessingState {
  tabId: string;
  isProcessing: boolean;
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
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  sendAgentMessage: (tabId: string, message: string) =>
    ipcRenderer.invoke('agent:send-message', tabId, message),
  cancelAgentMessage: (tabId: string) => ipcRenderer.invoke('agent:cancel-message', tabId),
  getAgentMessages: (tabId: string) => ipcRenderer.invoke('agent:get-messages', tabId),
  isAgentProcessing: (tabId: string) => ipcRenderer.invoke('agent:is-processing', tabId),

  // Events from main → renderer
  onTabUpdated: (cb: (tab: TabInfo) => void) => {
    ipcRenderer.on('tab:updated', (_e, tab) => cb(tab));
  },
  onTabListUpdated: (cb: (tabs: TabInfo[]) => void) => {
    ipcRenderer.on('tab:list-updated', (_e, tabs) => cb(tabs));
  },
  onAgentMessagesUpdated: (cb: (payload: { tabId: string; messages: ChatMessage[] }) => void) => {
    ipcRenderer.on('agent:messages-updated', (_e, payload) => cb(payload));
  },
  onAgentStream: (cb: (payload: { tabId: string; chunk: AgentStreamEvent }) => void) => {
    ipcRenderer.on('agent:stream', (_e, payload) => cb(payload));
  },
  onAgentProcessingState: (cb: (payload: AgentProcessingState) => void) => {
    ipcRenderer.on('agent:processing-state', (_e, payload) => cb(payload));
  },
});
