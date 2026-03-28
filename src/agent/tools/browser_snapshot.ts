import AgentSession from "../session";
import type { BrowserSnapshotFormat } from "../types";

const browserSnapshotTool = {
	toolProperties: {
		type: "function",
		name: "browser_snapshot",
		description:
			"Capture the current browser state for the attached tab. Prefer `ref-list` before interacting so you can use stable refs like `e1`, `e2`, etc. Refs are invalidated after navigation or interaction, so take a fresh snapshot afterward.",
		parameters: {
			type: "object",
			properties: {
				format: {
					type: "string",
					enum: ["ref-list", "accessibility-tree"],
					description:
						"`ref-list` returns interactive elements with stable refs for later actions. `accessibility-tree` returns a Playwright accessibility snapshot.",
				},
				interactiveOnly: {
					type: "boolean",
					description:
						"When true, keeps the snapshot focused on interesting interactive/accessibility nodes. Defaults to true.",
				},
				maxElements: {
					type: "number",
					description:
						"Maximum number of interactive elements to include when using `ref-list`. Defaults to 50.",
				},
			},
		},
	},

	execute: async (
		args: {
			format?: BrowserSnapshotFormat;
			interactiveOnly?: boolean;
			maxElements?: number;
		},
		session: AgentSession,
	) => {
		return session.browser.snapshot({
			format: args.format,
			interactiveOnly: args.interactiveOnly,
			maxElements: args.maxElements,
		});
	},
};

export default browserSnapshotTool;
