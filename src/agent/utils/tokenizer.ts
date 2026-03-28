import { encoding_for_model, type TiktokenModel } from "tiktoken";
import { Message } from "../types";

export function getEncoder(model: string) {
	const encoder = encoding_for_model(model as TiktokenModel);

	return encoder;
}

export function countTokens(
	encoder: ReturnType<typeof getEncoder>,
	text: string,
): number {
	return encoder.encode(text).length;
}

export function countCurrentTokenUsage(
	encoder: ReturnType<typeof getEncoder>,
	messages: Message[],
): number {
	let total = 0;

	for (const msg of messages) {
		const valueToCount =
			"output" in msg
				? msg.output
				: "content" in msg
					? msg.content
					: "arguments" in msg
						? msg.arguments
						: undefined;

		if (typeof valueToCount === "string" && valueToCount.length > 0) {
			total += countTokens(encoder, valueToCount);
		}
	}

	return total;
}

export function splitBasedOnTokens(
	encoder: ReturnType<typeof getEncoder>,
	text: string,
	maxTokensPerChunk: number = 1000,
) {
	// Try paragraph split
	let units = text.split(/\n\s*\n/).filter(Boolean);

	// Try sentence split
	if (units.length === 1) {
		units = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];
	}

	// Try clause split
	if (units.length === 1) {
		units = text.split(/[,;:]\s+/).filter(Boolean);
	}

	const chunks: string[] = [];

	let currentChunk = "";

	for (const unit of units) {
		const tentative = currentChunk ? currentChunk + " " + unit : unit;

		if (countTokens(encoder, tentative) > maxTokensPerChunk) {
			if (currentChunk) {
				chunks.push(currentChunk.trim());
			}

			// If single unit itself too large → hard split
			if (countTokens(encoder, unit) > maxTokensPerChunk) {
				const hardChunks = hardTokenSplit(encoder, unit, maxTokensPerChunk);

				chunks.push(...hardChunks);

				currentChunk = "";
			} else {
				currentChunk = unit;
			}
		} else {
			currentChunk = tentative;
		}
	}

	if (currentChunk) {
		chunks.push(currentChunk.trim());
	}

	return chunks;
}

const textDecoder = new TextDecoder();

function hardTokenSplit(
	encoder: ReturnType<typeof getEncoder>,
	text: string,
	maxTokensPerChunk: number,
) {
	const tokens = encoder.encode(text);

	const chunks: string[] = [];

	for (let i = 0; i < tokens.length; i += maxTokensPerChunk) {
		const slice = tokens.slice(i, i + maxTokensPerChunk);
		chunks.push(textDecoder.decode(encoder.decode(slice)));
	}

	return chunks;
}
