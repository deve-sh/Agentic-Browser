import type { WebContents } from 'electron';
import * as http from 'http';
import {
  chromium,
  type Browser,
  type ElementHandle,
  type Locator,
  type Page,
} from 'playwright';
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserFindResult,
  BrowserLocatorInput,
  BrowserLocatorMatch,
  BrowserNavigateResult,
  BrowserSnapshotElement,
  BrowserSnapshotOptions,
  BrowserSnapshotResult,
  BrowserWaitRequest,
  BrowserWaitResult,
} from '../agent/browser';

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

type AccessibilityNode = {
  role?: string;
  name?: string;
  valueString?: string;
  children?: AccessibilityNode[];
};

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export class PlaywrightManager {
  private browser: Browser | null = null;
  private snapshotRefs: Map<string, Map<string, ElementHandle>> = new Map();

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

  async snapshot(targetId: string, options: BrowserSnapshotOptions = {}): Promise<BrowserSnapshotResult> {
    const page = await this.getRequiredPageForTarget(targetId);
    const title = await page.title();
    const url = page.url();
    const format = options.format ?? 'ref-list';

    if (format === 'accessibility-tree') {
      const accessibility = (page as unknown as {
        accessibility?: {
          snapshot(options?: { interestingOnly?: boolean }): Promise<unknown>;
        };
      }).accessibility;

      const accessibilityTree = accessibility
        ? ((await accessibility.snapshot({
            interestingOnly: options.interactiveOnly ?? true,
          })) as AccessibilityNode | null)
        : null;

      return {
        format,
        title,
        url,
        accessibilityTree,
        snapshot: this.formatAccessibilityTree(accessibilityTree),
      };
    }

    const { elements, snapshot } = await this.buildInteractiveSnapshot(
      targetId,
      page,
      options,
    );

    return {
      format,
      title,
      url,
      elements,
      snapshot,
    };
  }

  async navigate(targetId: string, url: string): Promise<BrowserNavigateResult> {
    const page = await this.getRequiredPageForTarget(targetId);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    this.clearSnapshotRefs(targetId);

    return {
      success: true,
      title: await page.title(),
      url: page.url(),
    };
  }

  async handleAction(targetId: string, action: BrowserActionRequest): Promise<BrowserActionResult> {
    const page = await this.getRequiredPageForTarget(targetId);
    const target = await this.resolveActionTarget(targetId, page, action);

    try {
      switch (action.type) {
        case 'click':
          await this.clickTarget(target);
          break;
        case 'double_click':
          await this.doubleClickTarget(target);
          break;
        case 'hover':
          await this.hoverTarget(target);
          break;
        case 'fill':
          if (action.value === undefined) {
            throw new Error('Fill actions require a value.');
          }
          await this.fillTarget(target, action.value);
          break;
        case 'type_text':
          if (action.value === undefined) {
            throw new Error('Type actions require a value.');
          }
          await this.typeIntoTarget(page, target, action.value);
          break;
        case 'press_key':
          if (!action.key) {
            throw new Error('Key press actions require a key.');
          }
          await this.pressTarget(target, action.key);
          break;
        case 'backspace':
          await this.backspaceTarget(page, target, action.count ?? 1);
          break;
        case 'attach_file':
          if (!action.filePaths?.length) {
            throw new Error('Attach file actions require at least one file path.');
          }
          await this.attachFilesToTarget(target, action.filePaths);
          break;
        case 'focus':
          await this.focusTarget(target);
          break;
        case 'clear':
          await this.fillTarget(target, '');
          break;
        default:
          throw new Error(`Unsupported action type: ${(action as { type: string }).type}`);
      }
    } finally {
      if (target.kind === 'handle' && target.isEphemeral) {
        await target.handle.dispose().catch(() => undefined);
      }
    }

    this.clearSnapshotRefs(targetId);

    return {
      success: true,
      title: await page.title(),
      url: page.url(),
      refsInvalidated: true,
    };
  }

  async findElements(targetId: string, query: BrowserWaitRequest): Promise<BrowserFindResult> {
    const page = await this.getRequiredPageForTarget(targetId);
    const locator = await this.resolveLocatorFromQuery(targetId, page, query);
    const matches = await this.describeLocatorMatches(locator, query.maxResults ?? 5);

    return {
      title: await page.title(),
      url: page.url(),
      count: await locator.count(),
      matches,
    };
  }

  async waitForElement(targetId: string, query: BrowserWaitRequest): Promise<BrowserWaitResult> {
    const page = await this.getRequiredPageForTarget(targetId);
    const locator = await this.resolveLocatorFromQuery(targetId, page, query);
    const state = query.state ?? 'visible';

    await locator.first().waitFor({
      state,
      timeout: query.timeoutMs ?? 10_000,
    });

    return {
      success: true,
      title: await page.title(),
      url: page.url(),
      state,
      count: await locator.count(),
      matches: await this.describeLocatorMatches(locator, query.maxResults ?? 5),
    };
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

  private async getRequiredPageForTarget(targetId: string): Promise<Page> {
    const page = await this.getPageForTarget(targetId);
    if (!page) {
      throw new Error(`Unable to resolve Playwright page for target ${targetId}.`);
    }

    return page;
  }

  private async buildInteractiveSnapshot(
    targetId: string,
    page: Page,
    options: BrowserSnapshotOptions,
  ): Promise<{ elements: BrowserSnapshotElement[]; snapshot: string }> {
    const handles = await page.locator(INTERACTIVE_SELECTOR).elementHandles();
    const nextRefs: Map<string, ElementHandle> = new Map();
    const elements: BrowserSnapshotElement[] = [];
    const maxElements = options.maxElements ?? 50;

    for (const handle of handles) {
      if (elements.length >= maxElements) {
        await handle.dispose().catch(() => undefined);
        continue;
      }

      const descriptor = await this.describeInteractiveHandle(handle);
      if (!descriptor) {
        await handle.dispose().catch(() => undefined);
        continue;
      }

      const ref = `e${elements.length + 1}`;
      nextRefs.set(ref, handle);
      elements.push({ ref, ...descriptor });
    }

    this.replaceSnapshotRefs(targetId, nextRefs);

    const snapshot = elements.length
      ? elements
          .map((element) => {
            const parts = [
              `- ${element.role} "${element.name || element.text || element.tagName}"`,
              `[ref=${element.ref}]`,
            ];

            if (element.text && element.text !== element.name) {
              parts.push(`text="${element.text}"`);
            }

            if (element.placeholder) {
              parts.push(`placeholder="${element.placeholder}"`);
            }

            if (element.value) {
              parts.push(`value="${element.value}"`);
            }

            if (element.disabled) {
              parts.push('[disabled]');
            }

            return parts.join(' ');
          })
          .join('\n')
      : 'No interactive elements found.';

    return { elements, snapshot };
  }

  private async describeInteractiveHandle(handle: ElementHandle): Promise<Omit<BrowserSnapshotElement, 'ref'> | null> {
    const isVisible = await handle.isVisible().catch(() => false);
    if (!isVisible) {
      return null;
    }

    return handle.evaluate((element) => {
      const getText = (node: any) =>
        (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);

      const inferRole = (node: any) => {
        const explicitRole = node.getAttribute('role');
        if (explicitRole) return explicitRole;

        const tagName = node.tagName.toLowerCase();
        if (tagName === 'a') return 'link';
        if (tagName === 'button') return 'button';
        if (tagName === 'select') return 'combobox';
        if (tagName === 'textarea') return 'textbox';
        if (tagName === 'input') {
          const type = (node.getAttribute('type') || 'text').toLowerCase();
          if (['button', 'submit', 'reset'].includes(type)) return 'button';
          if (['checkbox', 'radio'].includes(type)) return type;
          return 'textbox';
        }

        return tagName;
      };

      const name =
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        ('labels' in element && element.labels?.[0]?.textContent?.trim()) ||
        ('placeholder' in element ? element.getAttribute('placeholder') : null) ||
        getText(element);

      const value =
        'value' in element && typeof element.value === 'string'
          ? element.value.slice(0, 200)
          : undefined;

      return {
        role: inferRole(element),
        name: (name || '').slice(0, 200),
        tagName: element.tagName.toLowerCase(),
        text: getText(element) || undefined,
        value,
        placeholder: element.getAttribute('placeholder') || undefined,
        href: element.tagName?.toLowerCase() === 'a' ? element.href : undefined,
        disabled:
          ('disabled' in element && Boolean(element.disabled)) ||
          element.getAttribute('aria-disabled') === 'true',
      };
    });
  }

  private async resolveActionTarget(
    targetId: string,
    page: Page,
    action: BrowserActionRequest,
  ): Promise<
    | { kind: 'handle'; handle: ElementHandle; isEphemeral: boolean }
    | { kind: 'locator'; locator: Locator }
  > {
    if (action.ref) {
      const handle = this.snapshotRefs.get(targetId)?.get(action.ref) ?? null;
      if (!handle) {
        throw new Error(`Unable to resolve ref ${action.ref}. Take a fresh browser snapshot.`);
      }

      return { kind: 'handle', handle, isEphemeral: false };
    }

    const locator = await this.resolveLocatorFromQuery(targetId, page, action);
    return { kind: 'locator', locator: locator.first() };
  }

  private async resolveLocatorFromQuery(
    targetId: string,
    page: Page,
    query: BrowserLocatorInput,
  ): Promise<Locator> {
    if (query.ref) {
      if (!this.snapshotRefs.get(targetId)?.get(query.ref)) {
        throw new Error(`Unable to resolve ref ${query.ref}. Take a fresh browser snapshot.`);
      }
      throw new Error('Ref-based search/wait is not supported. Use browser_interact with the ref, or search again using selector/text/label/placeholder/role.');
    }

    if (query.selector) {
      return page.locator(query.selector);
    }

    if (query.text) {
      return page.getByText(query.text, { exact: query.exact });
    }

    if (query.label) {
      return page.getByLabel(query.label, { exact: query.exact });
    }

    if (query.placeholder) {
      return page.getByPlaceholder(query.placeholder, { exact: query.exact });
    }

    if (query.role) {
      return page.getByRole(query.role as never, {
        exact: query.exact,
        name: query.name,
      });
    }

    if (query.title) {
      return page.getByTitle(query.title, { exact: query.exact });
    }

    if (query.altText) {
      return page.getByAltText(query.altText, { exact: query.exact });
    }

    if (query.testId) {
      return page.getByTestId(query.testId);
    }

    throw new Error(
      'Provide a ref, selector, text, label, placeholder, role, title, altText, or testId.',
    );
  }

  private async describeLocatorMatches(locator: Locator, maxResults: number): Promise<BrowserLocatorMatch[]> {
    const count = await locator.count();
    const matches: BrowserLocatorMatch[] = [];

    for (let index = 0; index < Math.min(count, maxResults); index += 1) {
      const item = locator.nth(index);
      const text = (await item.textContent().catch(() => null))?.replace(/\s+/g, ' ').trim() || undefined;
      const value = await item.inputValue().catch(() => undefined);
      const placeholder = await item.getAttribute('placeholder').catch(() => undefined);

      matches.push({
        index,
        text: text?.slice(0, 200),
        value: value?.slice(0, 200),
        placeholder: placeholder || undefined,
        visible: await item.isVisible().catch(() => false),
        enabled: await item.isEnabled().catch(() => false),
      });
    }

    return matches;
  }

  private async clickTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.click();
      return;
    }

    await target.locator.click();
  }

  private async doubleClickTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.dblclick();
      return;
    }

    await target.locator.dblclick();
  }

  private async hoverTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.hover();
      return;
    }

    await target.locator.hover();
  }

  private async focusTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.focus();
      return;
    }

    await target.locator.focus();
  }

  private async fillTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
    value: string,
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.fill(value);
      return;
    }

    await target.locator.fill(value);
  }

  private async pressTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
    key: string,
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.press(key);
      return;
    }

    await target.locator.press(key);
  }

  private async typeIntoTarget(
    page: Page,
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
    value: string,
  ): Promise<void> {
    await this.focusTarget(target);
    await page.keyboard.type(value);
  }

  private async backspaceTarget(
    page: Page,
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
    count: number,
  ): Promise<void> {
    await this.focusTarget(target);

    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press('Backspace');
    }
  }

  private async attachFilesToTarget(
    target: { kind: 'handle'; handle: ElementHandle } | { kind: 'locator'; locator: Locator },
    filePaths: string[],
  ): Promise<void> {
    if (target.kind === 'handle') {
      await target.handle.setInputFiles(filePaths);
      return;
    }

    await target.locator.setInputFiles(filePaths);
  }

  private replaceSnapshotRefs(targetId: string, refs: Map<string, ElementHandle>): void {
    this.clearSnapshotRefs(targetId);
    this.snapshotRefs.set(targetId, refs);
  }

  private clearSnapshotRefs(targetId: string): void {
    const existingRefs = this.snapshotRefs.get(targetId);
    if (!existingRefs) {
      return;
    }

    for (const handle of existingRefs.values()) {
      void handle.dispose().catch(() => undefined);
    }

    this.snapshotRefs.delete(targetId);
  }

  private formatAccessibilityTree(node: AccessibilityNode | null, depth = 0): string {
    if (!node) {
      return 'No accessibility nodes found.';
    }

    const prefix = '  '.repeat(depth);
    const description = [node.role || 'node', node.name ? `"${node.name}"` : undefined, node.valueString]
      .filter(Boolean)
      .join(' ');

    const childLines = (node.children || [])
      .map((child) => this.formatAccessibilityTree(child, depth + 1))
      .filter(Boolean);

    return [prefix + description, ...childLines].join('\n');
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
