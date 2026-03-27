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
const systemInstructions = `You are a helpful assistant that helps the user with regular summarization and data tasks. You have access to tools.`;

export {
	openaiCapabilities as capabilities,
	supportedModels,
	systemInstructions,
};
