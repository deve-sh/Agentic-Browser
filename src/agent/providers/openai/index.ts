// Big disclaimer:
// This isn't normal. You would ABSOLUTELY not have this and the API Keys packaged inside a production Electron app
// and instead have a backend service handle interaction with an AI provider, which would authenticate using a session.
// This providers and llms list setup is also just for convenience and simplicity of showing how it's done.
// In production apps, you would probably use a service like Portkey or build a router/gateway for the LLMs and models
// you plan to support yourself and your app would just select from a list of available models.

import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
	throw new Error("process.env.OPENAI_API_KEY is not set");
}

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

export default openai;

import openaiCapabilities from "./capabilities";

const supportedModels = [
	{
		id: "gpt-4o",
		MODEL_CONTEXT_LIMIT: 128000,
		SAFE_MARGIN: 4000,
		MAX_OUTPUT_TOKENS: 7000,
		COMPACTION_THRESHOLD: 0.7
	},
	{
		id: "gpt-4o-mini",
		MODEL_CONTEXT_LIMIT: 128000,
		SAFE_MARGIN: 4000,
		MAX_OUTPUT_TOKENS: 3500,
		COMPACTION_THRESHOLD: 0.8
	},
];
const systemInstructions = `You are a helpful agentic browser that helps users navigate and get things done. Make sure to ask the user for consent and to solve captchas or other challenges for you. Wherever there is ambiguity, make sure to confirm with the user.`;

export {
	openaiCapabilities as capabilities,
	supportedModels,
	systemInstructions,
};
