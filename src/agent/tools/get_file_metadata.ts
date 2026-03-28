import AgentSession from "../session";

const importEsmModule = new Function(
	"specifier",
	"return import(specifier)",
) as <T>(specifier: string) => Promise<T>;

const getFileMetadataTool = {
	toolProperties: {
		type: "function",
		name: "get_file_metadata_tool",
		description:
			"Get metadata for a file." +
			"Useful to determine if the file is a data file (JSON, CSV, XML) or a Text file that can be read and chunked." +
			"Returns the length of the file and the mimetype",
		parameters: {
			type: "object",
			properties: {
				filePath: {
					type: "string",
					description: "The path to the file to read",
				},
			},
		},
	},

	execute: async (args: { filePath: string }, _session: AgentSession) => {
		try {
			const stats = (await import("node:fs")).statSync(args.filePath);

			const { mimeType } = await import("mime-type/with-db");

			const fileType = await mimeType.lookup(args.filePath);

			if (!fileType) return { error: "File could not be read" };

			return {
				error: null,
				fileData: {
					fileSizeInBytes: stats.size,
					createdAt: stats.birthtime,
					mimeType: fileType,
				},
			};
		} catch (error) {
			return {
				error:
					error instanceof Error
						? error.message
						: "File metadata lookup failed.",
			};
		}
	},
};

export default getFileMetadataTool;
