import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { TabManager } from './tabManager';

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../../dist/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  tabManager = new TabManager(mainWindow);

  // Open devtools for the chrome UI in dev
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
    tabManager = null;
  });

  // Once the chrome UI is ready, open a default tab
  mainWindow.webContents.once('did-finish-load', () => {
    tabManager?.newTab('https://www.google.com');
  });
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('tab:new', (_event, url?: string) => {
  return tabManager?.newTab(url);
});

ipcMain.handle('tab:close', (_event, tabId: string) => {
  tabManager?.closeTab(tabId);
});

ipcMain.handle('tab:switch', (_event, tabId: string) => {
  tabManager?.switchTab(tabId);
});

ipcMain.handle('tab:navigate', (_event, url: string) => {
  tabManager?.navigateActive(url);
});

ipcMain.handle('tab:go-back', () => {
  tabManager?.goBack();
});

ipcMain.handle('tab:go-forward', () => {
  tabManager?.goForward();
});

ipcMain.handle('tab:reload', () => {
  tabManager?.reload();
});

ipcMain.handle('tab:list', () => {
  return tabManager?.getTabList() ?? [];
});

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
