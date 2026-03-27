import type {
	Tool,
	ResponseInputItem as LLMMessage,
} from "openai/resources/responses/responses.mjs";

import llms from "./providers/index";
import type { BrowserSessionBridge } from "./types";
import { LLM, LLMID, LLMModel, Message, ToolCall } from "./types";

import Agent from "./agent";
import {
	countCurrentTokenUsage,
	getEncoder,
	countTokens,
} from "./utils/tokenizer";
import logger from "./utils/logger";

type SessionSubscriber = (
	id: string,
	responseChunk:
		| { type: "chunks-start" }
		| { type: "chunk"; content: string }
		| { type: "chunks-end" },
) => Promise<unknown> | unknown;

class AgentSession {
	id: string = crypto.randomUUID();

	messages: Message[] = [];
	recordedToolCalls: ToolCall[] = [];

	llm: LLM = llms["openai"];
	model: LLMModel = "gpt-4o-mini";

	// conversation: Partial<Conversation>;

	subscribers: Set<SessionSubscriber> = new Set();
	private browser: BrowserSessionBridge | null = null;

	private async setModel(model: LLMModel) {
		// Can be changed per message per call too
		if (
			!model ||
			!llms[this.llm.id as keyof typeof llms].supportedModels.find(
				(supportedModel: LLM["supportedModels"][number]) =>
					supportedModel.id === model,
			)
		) {
			throw new Error(`Model ${model} is not supported by ${this.llm}`);
		}

		this.model = model;
	}

	get modelProperties() {
		return this.llm.supportedModels.find((model) => model.id === this.model)!;
	}

	private async setLLM(llm: LLMID) {
		if (!llm || !llms[llm]) {
			throw new Error(`LLM ${llm} is not supported`);
		}

		this.llm = llms[llm];
	}

	async initialize(options: {
		llm: keyof typeof llms;
		model: (typeof llms)[keyof typeof llms]["supportedModels"][number]["id"];
	}) {
		await this.setLLM(options.llm);
		await this.setModel(options.model);

		this.messages = [];
		this.recordedToolCalls = [];

		// Why remove this? Because we want to manage messages state and compaction ourselves.
		// this.conversation = await this.llm.sdk.conversations.create();
	}

	private notifySubscribers(responseChunk: Parameters<SessionSubscriber>[1]) {
		this.subscribers.forEach((sub) => sub(this.id, responseChunk));
	}

	subscribe(subscriber: SessionSubscriber) {
		this.subscribers.add(subscriber);

		return () => this.subscribers.delete(subscriber);
	}

	attachBrowser(browser: BrowserSessionBridge) {
		this.browser = browser;
	}

	requireBrowser() {
		if (!this.browser) {
			throw new Error("This session is not attached to a browser tab.");
		}

		return this.browser;
	}

	async estimateCurrentTokenUsage() {
		return countCurrentTokenUsage(getEncoder(this.model), this.messages);
	}

	get compactionPoint() {
		return (
			this.modelProperties.COMPACTION_THRESHOLD *
				this.modelProperties.MODEL_CONTEXT_LIMIT -
			this.modelProperties.SAFE_MARGIN
		);
	}

	// Exposed API to decide if some content should be compacted/chunked and summarized
	// for the content before being sent to the model based on the current conversation state.
	async wouldContentFitIntoSafeWindow(content: string) {
		const tokensNeededForContent = countTokens(getEncoder(this.model), content);
		const tokensUsageWithContent =
			(await this.estimateCurrentTokenUsage()) + tokensNeededForContent;
		const tokensLeft = this.compactionPoint - tokensUsageWithContent;

		return { shouldBeChunked: tokensLeft <= 0 };
	}

	async shouldCompactConversation() {
		return (await this.estimateCurrentTokenUsage()) > this.compactionPoint;
	}

	async compactMessages() {
		logger.get()?.info(`[Session: ${this.id}]`, `Compacting messages.`);

		const compactedMessagesList = await this.llm.sdk.responses.compact({
			model: this.model,
			input: (this.messages.length >= 6
				? this.messages.slice(0, -3)
				: this.messages) as Parameters<
				typeof this.llm.sdk.responses.compact
			>[0]["input"],
		});

		this.messages = compactedMessagesList.output as Message[];
	}

	async sendMessage(message?: Message) {
		logger.get()?.info(`[Session: ${this.id}]`, `Sending message to LLM.`);

		// Initializing messages
		if (!this.messages.length && this.llm.systemInstructions)
			this.messages.push({
				role: "system",
				content: this.llm.systemInstructions,
			});

		// if (!this.conversation) throw new Error("Session not initialized");

		if (await this.shouldCompactConversation()) await this.compactMessages();

		// Why this conditional? Because sendMessage itself calls sendMessage after adding all messages to the internal queue
		if (message) this.messages.push(message);

		const responseStream = await this.llm.sdk.responses.stream({
			model: this.model,
			tools: Agent.tools.map((tool) => tool.toolProperties) as Tool[],
			input: this.messages as LLMMessage[],
			store: false,
			max_output_tokens: this.modelProperties.MAX_OUTPUT_TOKENS,
			// conversation: this.conversation.id,
		});

		let responseText = "";

		for await (const event of responseStream) {
			if (event.type === "response.output_text.delta") {
				if (!responseText) this.notifySubscribers({ type: "chunks-start" });

				responseText += event.delta;

				this.notifySubscribers({ type: "chunk", content: event.delta });
			}
		}

		const responseReceived = await responseStream.finalResponse();

		// TODO: Any other output type, add it to the messages array for the next call?
		if (responseText) {
			this.notifySubscribers({ type: "chunks-end" });

			this.messages.push({
				role: "assistant",
				content: responseText,
			});
		}

		// Time to process the tool call requests
		// Could be done in a sandbox, but that's an implementation detail.
		const toolProcessingPromises: Promise<any>[] = [];
		const toolCallMetadata: { id: string; name: string; arguments: string }[] =
			[];

		for (const output of responseReceived.output) {
			if (output.type === "function_call") {
				const toolCall = output;

				const matchingTool = Agent.tools.find(
					(agentTool) => agentTool.toolProperties.name === toolCall.name,
				);

				if (!matchingTool || !matchingTool.execute) continue;

				logger
					.get()
					?.info(
						`[Session: ${this.id}]`,
						`Calling Tool: `,
						toolCall.name,
						toolCall.arguments,
					);

				toolProcessingPromises.push(
					matchingTool.execute(JSON.parse(toolCall.arguments || "{}"), this),
				);
				toolCallMetadata.push({
					id: toolCall.call_id,
					arguments: toolCall.arguments,
					name: toolCall.name,
				});

				this.messages.push({
					type: "function_call",
					id: toolCall.id,
					name: toolCall.name,
					arguments: toolCall.arguments,
					status: toolCall.status,
					call_id: toolCall.call_id,
				});
			}
		}

		const toolOutcomes = await Promise.allSettled(toolProcessingPromises);

		for (let i = 0; i < toolOutcomes.length; i++) {
			const outcome = toolOutcomes[i];

			let output;

			if (outcome.status === "rejected") {
				logger
					.get()
					?.info(
						`[Session: ${this.id}]`,
						`Tool Call:`,
						toolCallMetadata[i].id,
						toolCallMetadata[i].name,
						"failed with reason",
						outcome.reason,
					);

				output = JSON.stringify({ type: "failed", reason: outcome.reason });

				this.messages.push({
					type: "function_call_output",
					output,
					call_id: toolCallMetadata[i].id,
					status: "incomplete",
				});
			}

			if (outcome.status === "fulfilled") {
				logger
					.get()
					?.info(
						`[Session: ${this.id}]`,
						`Tool Call:`,
						toolCallMetadata[i].id,
						toolCallMetadata[i].name,
						"completed: ",
						outcome.value,
					);

				output = JSON.stringify({ type: "successful", value: outcome.value });

				this.messages.push({
					type: "function_call_output",
					output,
					call_id: toolCallMetadata[i].id,
					status: "completed",
				});
			}

			this.recordedToolCalls.push({
				...toolCallMetadata[i],
				output,
			});

			// At the end of each tool-call output being added to the message list
			// Check if the new tool call crossed the message to go over limit
			// and if yes, compact the messages.
			if (await this.shouldCompactConversation()) await this.compactMessages();
		}

		// Check if there were any tool-calls
		// if there were tool-calls, then there's more processing needed
		// with the outcomes of the tool executions.
		// Thus, trigger the loop again with the new set of messages now.
		if (
			responseReceived.output.some((output) => output.type === "function_call")
		)
			await this.sendMessage();
	}
}

export default AgentSession;
