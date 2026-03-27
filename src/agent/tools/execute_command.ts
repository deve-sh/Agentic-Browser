import AgentSession from "../session";

const executeCommandTool = {
	toolProperties: {
		type: "function",
		name: "execute_command",
		description:
			"Executes a command line instruction and sends back the stdio/stderr output",
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"The full command that can be passed to import('node:child_process').execSync(command, { stdio: 'inherit' })",
				},
			},
		},
	},

	execute: async (args: { command: string }, _session: AgentSession) => {
		// TODO: Wait for user input to get consent on whether the command can be executed or not

		const commandOutput = (await import("node:child_process")).execSync(
			args.command,
			{ stdio: "inherit", encoding: "utf-8" },
		);

		return { output: commandOutput };
	},
};

export default executeCommandTool;
