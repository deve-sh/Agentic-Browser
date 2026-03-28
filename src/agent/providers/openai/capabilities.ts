import { Message } from "../../types";

import openai from ".";
import { getEncoder, splitBasedOnTokens } from "../../utils/tokenizer";

async function summarizeChunk(chunk: string) {
	const response = await openai.responses.create({
		model: "gpt-4.1-nano",
		max_output_tokens: 1000,
		input: `
	Summarize the following content concisely but preserve:
	- Important facts
	- Key entities
	- Technical details
	- Numbers
	- Decisions
	
	Content:
	${chunk}`,
	});

	return response.output_text;
}

async function chunkReadableFile(contents: string): Promise<string> {
	const splitChunks = splitBasedOnTokens(
		getEncoder("gpt-4.1-nano"),
		contents,
		1000,
	);

	const summarizations = (
		await Promise.allSettled(splitChunks.map(summarizeChunk))
	)
		.filter((summary) => summary.status === "fulfilled")
		.map((fulfilledPromise) => fulfilledPromise.value);

	const masterSummary = await openai.responses.create({
		model: "gpt-4.1-nano",
		max_output_tokens: 5000,
		input: `
	Summarize the following summary chunks and give a master summary of them all:
	- Important facts
	- Key entities
	- Technical details
	- Numbers
	- Decisions
	
	Summaries from all the previous chunks:
	${summarizations.join("\n----\n")}`,
	});

	return masterSummary.output_text;
}

const openaiCapabilities = {
	supportedReadableFileTypes: ["text/plain", "text/markdown"],
	summarizeChunk,
	chunkReadableFile,
	supportedDataFileTypes: ["application/json", "text/csv", "application/xml"],
};

export default openaiCapabilities;
