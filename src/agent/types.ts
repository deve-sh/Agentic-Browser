import type {
	ResponseFunctionToolCall,
	ResponseInputItem,
} from "openai/resources/responses/responses.mjs";

import type llms from "./providers";

type FunctionCallOutput = {
	type?: "function_call_output";
	call_id?: ResponseInputItem.FunctionCallOutput["call_id"];
	output?: ResponseInputItem.FunctionCallOutput["output"];
	status?: ResponseInputItem.FunctionCallOutput["status"];
};

type FunctionCall = ResponseFunctionToolCall;

export type Message =
	| {
			role: "user" | "assistant" | "system";
			content?: string;
	  }
	| FunctionCall
	| FunctionCallOutput;

export type ToolCall = {
	id: string;
	name: string;
	arguments: string;
	output?: string;
};

export type LLMID = keyof typeof llms;
export type LLM = (typeof llms)[keyof typeof llms];
export type LLMModel =
	(typeof llms)[keyof typeof llms]["supportedModels"][number]["id"];

export type BrowserSnapshotFormat = "ref-list" | "accessibility-tree";

export interface BrowserSnapshotOptions {
	format?: BrowserSnapshotFormat;
	interactiveOnly?: boolean;
	maxElements?: number;
}

export interface BrowserSnapshotElement {
	ref: string;
	role: string;
	name: string;
	tagName: string;
	text?: string;
	value?: string;
	placeholder?: string;
	href?: string;
	disabled: boolean;
}

export interface BrowserSnapshotResult {
	format: BrowserSnapshotFormat;
	title: string;
	url: string;
	snapshot: string;
	elements?: BrowserSnapshotElement[];
	accessibilityTree?: unknown;
}

export interface BrowserLocatorInput {
	ref?: string;
	selector?: string;
	text?: string;
	label?: string;
	placeholder?: string;
	role?: string;
	name?: string;
	title?: string;
	altText?: string;
	testId?: string;
	exact?: boolean;
}

export interface BrowserActionRequest extends BrowserLocatorInput {
	type:
		| "click"
		| "double_click"
		| "hover"
		| "fill"
		| "type_text"
		| "press_key"
		| "backspace"
		| "attach_file"
		| "focus"
		| "clear";
	value?: string;
	key?: string;
	count?: number;
	filePaths?: string[];
}

export interface BrowserActionResult {
	success: true;
	title: string;
	url: string;
	refsInvalidated: boolean;
}

export interface BrowserNavigateResult {
	success: true;
	title: string;
	url: string;
}

export interface BrowserLocatorMatch {
	index: number;
	text?: string;
	value?: string;
	placeholder?: string;
	visible: boolean;
	enabled: boolean;
}

export interface BrowserFindResult {
	title: string;
	url: string;
	count: number;
	matches: BrowserLocatorMatch[];
}

export interface BrowserWaitRequest extends BrowserLocatorInput {
	state?: "attached" | "detached" | "visible" | "hidden";
	timeoutMs?: number;
	maxResults?: number;
}

export interface BrowserWaitResult {
	success: true;
	title: string;
	url: string;
	state: "attached" | "detached" | "visible" | "hidden";
	count: number;
	matches: BrowserLocatorMatch[];
}

export interface BrowserSessionBridge {
	navigate(url: string): Promise<BrowserNavigateResult>;
	snapshot(options?: BrowserSnapshotOptions): Promise<BrowserSnapshotResult>;
	handleAction(action: BrowserActionRequest): Promise<BrowserActionResult>;
	findElements(query: BrowserWaitRequest): Promise<BrowserFindResult>;
	waitForElement(query: BrowserWaitRequest): Promise<BrowserWaitResult>;
}
