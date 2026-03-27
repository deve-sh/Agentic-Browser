import AgentSession from "../session";
import getFileMetadataTool from "./get_file_metadata";

const cache: Map<
	string,
	{ contents: string; error?: string | null; cachedAt: Date }
> = new Map();

const onComplete = (
	cacheKey: string,
	outcome: { contents?: string; error?: Error },
) => {
	cache.set(cacheKey, {
		contents: outcome.contents || "",
		error: outcome.error
			? (outcome.error as Error).message ||
				"Something went wrong while reading the file"
			: null,
		cachedAt: new Date(),
	});

	return {
		contents: outcome.contents || null,
		error: outcome.error
			? (outcome.error as Error).message ||
				"Something went wrong while reading the file"
			: null,
	};
};

const readFileTool = {
	toolProperties: {
		type: "function",
		name: "read_file",
		description: "Read a file and return the contents",
		parameters: {
			type: "object",
			properties: {
				filePath: {
					type: "string",
					description: "The path to the file to read",
				},
				startLine: {
					type: "number",
					description:
						"Optional parameter for the start line to start reading from",
				},
				endLine: {
					type: "number",
					description: "Optional parameter for the end line to read till",
				},
			},
		},
	},

	execute: async (
		args: {
			filePath: string;
			startLine?: number;
			endLine?: number;
		},
		session: AgentSession,
	) => {
		let { filePath, startLine, endLine } = args;

		startLine = Math.max(0, startLine || 0);
		endLine = Math.min(Infinity, endLine || Infinity);

		const cacheKey = `${filePath}-${startLine}-${endLine}`;

		try {
			const cachedEntry = cache.get(cacheKey);

			if (
				cachedEntry &&
				new Date().getTime() - cachedEntry?.cachedAt.getTime() <= 30 * 1000
			)
				return { contents: cachedEntry.contents, error: cachedEntry.error };

			const { error: errorReadingFileMetadata, fileData } =
				await getFileMetadataTool.execute({ filePath }, session);

			if (errorReadingFileMetadata || !fileData || !fileData.mimeType)
				return onComplete(cacheKey, {
					error:
						errorReadingFileMetadata || new Error("File could not be read."),
				});

			if (
				!session.llm.capabilities.supportedReadableFileTypes.includes(
					fileData.mimeType,
				)
			)
				return onComplete(cacheKey, {
					error: new Error(
						"File type is not supported for this agent at the moment.",
					),
				});

			let contents = "";

			const fileStream = (await import("node:fs")).createReadStream(
				filePath,
				"utf-8",
			);

			const rl = (await import("readline")).createInterface({
				input: fileStream,
				crlfDelay: Infinity,
			});

			let currentLine = 0;

			for await (const line of rl) {
				currentLine++;

				if (currentLine >= startLine && currentLine <= endLine) {
					contents += line;
				}

				if (currentLine > endLine) break;
			}

			const { shouldBeChunked: shouldContentBeChunked } =
				await session.wouldContentFitIntoSafeWindow(contents);

			if (!shouldContentBeChunked) return onComplete(cacheKey, { contents });

			// Time to chunk and summarize the file contents
			// for the LLM to read from

			const summarizedFile =
				await session.llm.capabilities.chunkReadableFile(contents);

			return onComplete(cacheKey, { contents: summarizedFile });
		} catch (error) {
			return onComplete(cacheKey, { error });
		}
	},
};

export default readFileTool;
