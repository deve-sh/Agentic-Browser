import openai, {
	capabilities as openAICapabilities,
	supportedModels as supportedOpenAIModels,
	systemInstructions as openAISystemInstructions,
} from "./openai";

const llms = {
	openai: {
		id: "openai",
		sdk: openai,
		capabilities: openAICapabilities,
		supportedModels: supportedOpenAIModels,
		systemInstructions: openAISystemInstructions,
	},
} as const;

export default llms;
