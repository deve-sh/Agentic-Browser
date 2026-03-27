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
