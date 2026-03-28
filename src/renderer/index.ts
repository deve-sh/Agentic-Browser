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

declare const marked: {
  parse: (markdown: string, options?: { breaks?: boolean; gfm?: boolean }) => string;
};

declare const DOMPurify: {
  sanitize: (dirty: string) => string;
};

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
  sendAgentMessage: (tabId: string, message: string) => Promise<void>;
  getAgentMessages: (tabId: string) => Promise<ChatMessage[]>;
  onTabUpdated: (cb: (tab: TabInfo) => void) => void;
  onTabListUpdated: (cb: (tabs: TabInfo[]) => void) => void;
  onAgentMessagesUpdated: (cb: (payload: { tabId: string; messages: ChatMessage[] }) => void) => void;
  onAgentStream: (cb: (payload: { tabId: string; chunk: AgentStreamEvent }) => void) => void;
};

let tabs: TabInfo[] = [];
const chatMessagesByTab = new Map<string, ChatMessage[]>();
const optimisticMessagesByTab = new Map<string, ChatMessage[]>();
const streamingAssistantByTab = new Map<string, string>();
const pendingTabs = new Set<string>();

const tabsEl = document.getElementById('tabs')!;
const btnNewTab = document.getElementById('btn-new-tab') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const btnForward = document.getElementById('btn-forward') as HTMLButtonElement;
const btnReload = document.getElementById('btn-reload') as HTMLButtonElement;
const addressBar = document.getElementById('address-bar') as HTMLInputElement;
const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement;
const btnMaximize = document.getElementById('btn-maximize') as HTMLButtonElement;
const btnClose = document.getElementById('btn-close') as HTMLButtonElement;
const chatTitle = document.getElementById('chat-title') as HTMLHeadingElement;
const chatMessagesEl = document.getElementById('chat-messages') as HTMLDivElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSend = document.getElementById('chat-send') as HTMLButtonElement;

function renderMarkdown(content: string): string {
  const renderedHtml = marked.parse(content, {
    breaks: true,
    gfm: true,
  });

  return DOMPurify.sanitize(renderedHtml);
}

function activeTab(): TabInfo | undefined {
  return tabs.find((tab) => tab.isActive);
}

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

function renderChat() {
  const currentTab = activeTab();
  chatMessagesEl.innerHTML = '';

  if (!currentTab) {
    chatTitle.textContent = 'No active tab';
    chatInput.disabled = true;
    chatSend.disabled = true;
    chatMessagesEl.appendChild(
      buildEmptyState('Open a tab to start chatting with its attached agent session.'),
    );
    return;
  }

  chatTitle.textContent = currentTab.title || 'New Tab';
  const messages = [
    ...(chatMessagesByTab.get(currentTab.id) ?? []),
    ...(optimisticMessagesByTab.get(currentTab.id) ?? []),
  ];
  const streamingMessage = streamingAssistantByTab.get(currentTab.id);
  const isPending = pendingTabs.has(currentTab.id);

  chatInput.disabled = false;
  chatSend.disabled = isPending;

  if (!messages.length && !streamingMessage) {
    chatMessagesEl.appendChild(
      buildEmptyState('Ask the agent to inspect the page, navigate, or interact with visible elements.'),
    );
  } else {
    for (const message of messages) {
      chatMessagesEl.appendChild(buildChatBubble(message.role, message.content));
    }

    if (streamingMessage) {
      chatMessagesEl.appendChild(
        buildChatBubble('assistant', streamingMessage, true),
      );
    }
  }

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function buildEmptyState(content: string): HTMLDivElement {
  const empty = document.createElement('div');
  empty.className = 'chat-empty';
  empty.textContent = content;
  return empty;
}

function buildChatBubble(
  role: 'user' | 'assistant',
  content: string,
  isStreaming: boolean = false,
): HTMLDivElement {
  const bubble = document.createElement('div');
  bubble.className = `chat-message ${role}${isStreaming ? ' streaming' : ''}`;
  bubble.innerHTML = renderMarkdown(content);
  return bubble;
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

async function syncActiveChat(forceRefresh: boolean = false) {
  const currentTab = activeTab();
  if (!currentTab) {
    renderChat();
    return;
  }

  if (forceRefresh || !chatMessagesByTab.has(currentTab.id)) {
    const messages = await browserAPI.getAgentMessages(currentTab.id);
    chatMessagesByTab.set(currentTab.id, messages);
  }

  renderChat();
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

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const currentTab = activeTab();
  const content = chatInput.value.trim();
  if (!currentTab || !content) {
    return;
  }

  const originalInputValue = content;
  pendingTabs.add(currentTab.id);
  optimisticMessagesByTab.set(currentTab.id, [
    ...(optimisticMessagesByTab.get(currentTab.id) ?? []),
    { role: 'user', content },
  ]);
  chatInput.value = '';
  chatSend.disabled = true;
  renderChat();

  try {
    await browserAPI.sendAgentMessage(currentTab.id, content);
  } catch (error) {
    optimisticMessagesByTab.delete(currentTab.id);
    chatInput.value = originalInputValue;
    throw error;
  } finally {
    pendingTabs.delete(currentTab.id);
    renderChat();
  }
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

browserAPI.onTabUpdated((updated) => {
  const idx = tabs.findIndex((tab) => tab.id === updated.id);
  if (idx !== -1) tabs[idx] = updated;
  else tabs.push(updated);
  renderTabs(tabs);
  void syncActiveChat();
});

browserAPI.onTabListUpdated((list) => {
  renderTabs(list);
  void syncActiveChat();
});

browserAPI.onAgentMessagesUpdated(({ tabId, messages }) => {
  chatMessagesByTab.set(tabId, messages);
  optimisticMessagesByTab.delete(tabId);
  if (activeTab()?.id === tabId) {
    renderChat();
  }
});

browserAPI.onAgentStream(({ tabId, chunk }) => {
  switch (chunk.type) {
    case 'chunks-start':
      streamingAssistantByTab.set(tabId, '');
      break;
    case 'chunk':
      streamingAssistantByTab.set(
        tabId,
        `${streamingAssistantByTab.get(tabId) ?? ''}${chunk.content ?? ''}`,
      );
      break;
    case 'chunks-end':
      streamingAssistantByTab.delete(tabId);
      break;
  }

  if (activeTab()?.id === tabId) {
    renderChat();
  }
});

window.addEventListener('resize', () => {
  void syncWindowControls();
});

(async () => {
  const list = await browserAPI.getTabList();
  renderTabs(list);
  await syncWindowControls();
  await syncActiveChat(true);
})();
