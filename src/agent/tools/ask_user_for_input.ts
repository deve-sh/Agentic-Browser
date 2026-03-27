import AgentSession from "../session";

const _dummy_promptUser = async (_message: string) =>
	`Do whatever you think would be the ideal way to achieve the desired output. Thank you.`;

const askUserForInputTool = {
	toolProperties: {
		type: "function",
		name: "ask_user_for_input",
		description:
			"Request user explicitly for information if needed in the middle of a processing step",
		parameters: {
			type: "object",
			properties: {
				messageToUser: {
					type: "string",
					description: "markdown or text string to ask the user a question",
				},
			},
		},
	},

	execute: async (args: { messageToUser: string }, _session: AgentSession) => {
		// TODO: Build a User UI Bridge for interacting

		const userResponse = await _dummy_promptUser(args.messageToUser);

		return { output: userResponse };
	},
};

export default askUserForInputTool;
