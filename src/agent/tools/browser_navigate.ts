import AgentSession from "../session";

const browserNavigateTool = {
	toolProperties: {
		type: "function",
		name: "browser_navigate",
		description:
			"Navigate the current tab to a new URL. Use this before snapshotting a new page or when the task requires moving to another route.",
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description:
						"The destination URL or search phrase to open in the current browser tab.",
				},
			},
			required: ["url"],
		},
	},

	execute: async (args: { url: string }, session: AgentSession) => {
		return session.requireBrowser().navigate(args.url);
	},
};

export default browserNavigateTool;
