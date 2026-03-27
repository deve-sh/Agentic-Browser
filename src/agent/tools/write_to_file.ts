import AgentSession from "../session";

const writeToFileTool = {
	toolProperties: {
		type: "function",
		name: "write_to_file",
		description: "Writes a string to a file",
		parameters: {
			type: "object",
			properties: {
				filePath: {
					type: "string",
					description: "The path to the file to write to",
				},
				contents: {
					type: "string",
					description: "utf-8 (regular) string to write to the file",
				},
				shouldAppend: {
					type: "boolean",
					description:
						"Should append to the file, the lack of this arg or setting it to false will overwrite the contents of the file",
				},
			},
		},
	},

	execute: async (
		args: {
			filePath: string;
			contents: string;
			shouldAppend?: boolean;
		},
		_session: AgentSession,
	) => {
		const { filePath, contents, shouldAppend } = args;

		// TODO: Wait for user input to get consent on whether the file can be written to
		// & store the consent for the session.

		const fs = await import("node:fs");

		if (shouldAppend) {
			await fs.appendFileSync(filePath, contents, "utf-8");
		} else {
			await fs.writeFileSync(filePath, contents, "utf-8");
		}

		return { success: true };
	},
};

export default writeToFileTool;
