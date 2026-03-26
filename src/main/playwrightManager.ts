import type { WebContents } from 'electron';
import * as http from 'http';
import { chromium, type Browser, type Page } from 'playwright';

interface CdpTargetInfo {
  targetId: string;
}

interface CdpTargetResponse {
  targetInfo: CdpTargetInfo;
}

interface CdpListEntry {
  id: string;
  webSocketDebuggerUrl?: string;
}

export interface TabAutomationMetadata {
  cdpTargetId?: string;
  cdpWebSocketUrl?: string;
}

export interface TabAction {
  type: 'click' | 'hover' | 'fill';
  selector: string;
  value?: string;
}

export class PlaywrightManager {
  private browser: Browser | null = null;

  constructor(private readonly remoteDebuggingPort: number) {}

  async connect(): Promise<void> {
    if (this.browser?.isConnected()) {
      return;
    }

    this.browser = await this.withRetries(
      () => chromium.connectOverCDP(`http://127.0.0.1:${this.remoteDebuggingPort}`),
      10,
      300,
    );
  }

  async resolveTabMetadata(webContents: WebContents): Promise<TabAutomationMetadata> {
    await this.connect();

    const cdpTargetId = await this.resolveTargetId(webContents);
    if (!cdpTargetId) {
      return {};
    }

    const cdpWebSocketUrl = await this.withRetries(async () => {
      const targets = await this.fetchTargets();
      return targets.find((target) => target.id === cdpTargetId)?.webSocketDebuggerUrl;
    }, 8, 250).catch(() => undefined);

    return { cdpTargetId, cdpWebSocketUrl };
  }

  async handleAction(targetId: string, action: TabAction): Promise<void> {
    const page = await this.getPageForTarget(targetId);
    if (!page) {
      throw new Error(`Unable to resolve Playwright page for target ${targetId}.`);
    }

    const locator = page.locator(action.selector);

    switch (action.type) {
      case 'click':
        await locator.click();
        return;
      case 'hover':
        await locator.hover();
        return;
      case 'fill':
        if (action.value === undefined) {
          throw new Error('Fill actions require a value.');
        }
        await locator.fill(action.value);
        return;
      default:
        throw new Error(`Unsupported action type: ${(action as { type: string }).type}`);
    }
  }

  private async resolveTargetId(webContents: WebContents): Promise<string | undefined> {
    let attachedHere = false;

    try {
      if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach('1.3');
        attachedHere = true;
      }

      const { targetInfo } = (await webContents.debugger.sendCommand(
        'Target.getTargetInfo',
      )) as CdpTargetResponse;

      return targetInfo.targetId;
    } catch (error) {
      console.warn('Failed to resolve target id for webContents.', error);
      return undefined;
    } finally {
      if (attachedHere && webContents.debugger.isAttached()) {
        try {
          webContents.debugger.detach();
        } catch (error) {
          console.warn('Failed to detach debugger after target lookup.', error);
        }
      }
    }
  }

  private async getPageForTarget(targetId: string): Promise<Page | null> {
    await this.connect();

    return this.withRetries(async () => {
      for (const context of this.browser?.contexts() ?? []) {
        for (const page of context.pages()) {
          const session = await context.newCDPSession(page);

          try {
            const { targetInfo } = (await session.send('Target.getTargetInfo')) as CdpTargetResponse;
            if (targetInfo.targetId === targetId) {
              return page;
            }
          } finally {
            await session.detach().catch(() => undefined);
          }
        }
      }

      throw new Error(`No page found for target ${targetId}.`);
    }, 8, 250).catch(() => null);
  }

  private async fetchTargets(): Promise<CdpListEntry[]> {
    const body = await new Promise<string>((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${this.remoteDebuggingPort}/json/list`, (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`CDP target list request failed with status ${response.statusCode ?? 'unknown'}.`));
          return;
        }

        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => resolve(raw));
      });

      request.on('error', reject);
    });

    return JSON.parse(body) as CdpListEntry[];
  }

  private async withRetries<T>(operation: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Operation failed.');
  }
}
