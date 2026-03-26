import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";

import { PlaywrightManager } from "./playwrightManager";
import { TabManager } from "./tabManager";

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let playwrightManager: PlaywrightManager | null = null;

async function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		frame: false,
		titleBarStyle: "hidden",
		backgroundColor: "#f5f5f3",
		webPreferences: {
			preload: path.join(__dirname, "../../dist/preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	await mainWindow.loadFile(
		path.join(__dirname, "../../src/renderer/index.html"),
	);

	if (!playwrightManager) {
		throw new Error(
			"Playwright manager was not initialized before creating the window.",
		);
	}

	tabManager = new TabManager(mainWindow, playwrightManager);

	// Open devtools for the chrome UI in dev
	// mainWindow.webContents.openDevTools({ mode: 'detach' });

	mainWindow.on("closed", () => {
		mainWindow = null;
		tabManager = null;
	});

	tabManager.newTab("about:blank");
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle("tab:new", (_event, url?: string) => {
	return tabManager?.newTab(url);
});

ipcMain.handle("tab:close", (_event, tabId: string) => {
	tabManager?.closeTab(tabId);
});

ipcMain.handle("tab:switch", (_event, tabId: string) => {
	tabManager?.switchTab(tabId);
});

ipcMain.handle("tab:navigate", (_event, url: string) => {
	tabManager?.navigateActive(url);
});

ipcMain.handle("tab:go-back", () => {
	tabManager?.goBack();
});

ipcMain.handle("tab:go-forward", () => {
	tabManager?.goForward();
});

ipcMain.handle("tab:reload", () => {
	tabManager?.reload();
});

ipcMain.handle("tab:list", () => {
	return tabManager?.getTabList() ?? [];
});

ipcMain.handle("window:minimize", () => {
	mainWindow?.minimize();
});

ipcMain.handle("window:maximize-toggle", () => {
	if (!mainWindow) return false;

	if (mainWindow.isMaximized()) {
		mainWindow.unmaximize();
		return false;
	}

	mainWindow.maximize();
	return true;
});

ipcMain.handle("window:close", () => {
	mainWindow?.close();
});

ipcMain.handle("window:is-maximized", () => {
	return mainWindow?.isMaximized() ?? false;
});

// ── App lifecycle ────────────────────────────────────────────────────────────

const DEFAULT_DEBUGGER_PORT = 9322;

async function bootstrap(): Promise<void> {
	const { default: findUnusedPort } = await import("detect-port");
	const availableRemoteDebuggingPort = await findUnusedPort(
		DEFAULT_DEBUGGER_PORT,
	);
	app.commandLine.appendSwitch(
		"remote-debugging-port",
		String(availableRemoteDebuggingPort),
	);

	await app.whenReady();

	playwrightManager = new PlaywrightManager(availableRemoteDebuggingPort);
	await playwrightManager.connect();
	await createWindow();
}

void bootstrap().catch((error) => {
	console.error("Application bootstrap failed.", error);
	app.quit();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		void createWindow();
	}
});
