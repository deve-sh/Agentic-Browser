import AgentSession from "../session";

const cache: Map<string, { files: string[]; cachedAt: Date }> = new Map();

const listDirectoryFilesTool = {
	toolProperties: {
		type: "function",
		name: "list_directory_files",
		description: "List all files in a directory",
		parameters: {
			type: "object",
			properties: {
				directoryPath: {
					type: "string",
					description: "The path to the directory to list the files of",
				},
			},
		},
	},

	execute: async (args: { directoryPath: string }, _session: AgentSession) => {
		const { directoryPath } = args;

		const cachedEntry = cache.get(directoryPath);

		if (
			cachedEntry &&
			new Date().getTime() - cachedEntry?.cachedAt.getTime() <= 30 * 1000
		)
			return cachedEntry.files;

		const files = (await import("node:fs")).readdirSync(directoryPath);

		cache.set(directoryPath, { files, cachedAt: new Date() });

		return { files };
	},
};

export default listDirectoryFilesTool;
