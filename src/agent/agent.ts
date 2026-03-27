import llmTools from "./tools";
import type { BrowserSessionBridge } from "./types";
import AgentSession from "./session";

import logger from "./utils/logger";
import runtimeConfig, { type RuntimeConfig } from "./utils/runtime-config";
import { LLMID, LLMModel } from "./types";

type AgentInit = {
	runtimeConfig?: RuntimeConfig;
	logger?: typeof console;
};

export class Agent {
	static tools: typeof llmTools = llmTools;

	sessions: Map<string, any> = new Map();

	constructor(init?: AgentInit) {
		if (init && init.runtimeConfig) {
			for (const key in init.runtimeConfig) {
				runtimeConfig.modifyRuntimeConfig(
					key as keyof RuntimeConfig,
					init.runtimeConfig[key as keyof RuntimeConfig],
				);
			}
		}

		logger.setLogger(init?.logger || console);
	}

	async startSession(options: {
		browser?: BrowserSessionBridge;
		llm: LLMID;
		model: LLMModel;
	}) {
		const agentSession = new AgentSession();

		await agentSession.initialize(options);

		if (options?.browser) agentSession.attachBrowser(options.browser);

		this.sessions.set(agentSession.id, agentSession);

		return agentSession;
	}

	getSession(id: string) {
		return this.sessions.get(id);
	}
}

export default Agent;
