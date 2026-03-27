import AgentSession from "../session";
import type { BrowserWaitRequest } from "../browser";

const browserLocateTool = {
	toolProperties: {
		type: "function",
		name: "browser_locate",
		description:
			"Search for page elements or wait for them using Playwright locators. This is useful when the agent knows user-facing text, labels, placeholders, roles, or selectors but does not need a full snapshot yet.",
		parameters: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["find", "wait"],
					description:
						"`find` returns matching elements immediately. `wait` waits for a matching element state before returning.",
				},
				ref: {
					type: "string",
					description:
						"Optional ref from `browser_snapshot`, though text/label/placeholder/role lookups are usually more useful here.",
				},
				selector: {
					type: "string",
					description: "Use a raw Playwright selector.",
				},
				text: {
					type: "string",
					description: "Locate elements using Playwright's `getByText`.",
				},
				label: {
					type: "string",
					description: "Locate elements using Playwright's `getByLabel`.",
				},
				placeholder: {
					type: "string",
					description:
						"Locate elements using Playwright's `getByPlaceholder`.",
				},
				role: {
					type: "string",
					description: "Locate elements using Playwright's `getByRole`.",
				},
				name: {
					type: "string",
					description:
						"Optional accessible name when locating by role.",
				},
				title: {
					type: "string",
					description: "Locate elements using Playwright's `getByTitle`.",
				},
				altText: {
					type: "string",
					description:
						"Locate elements using Playwright's `getByAltText`.",
				},
				testId: {
					type: "string",
					description: "Locate elements using Playwright's `getByTestId`.",
				},
				exact: {
					type: "boolean",
					description: "Use exact matching for text-like locators.",
				},
				state: {
					type: "string",
					enum: ["attached", "detached", "visible", "hidden"],
					description:
						"Used only when `mode` is `wait`. Defaults to `visible`.",
				},
				timeoutMs: {
					type: "number",
					description:
						"Used only when `mode` is `wait`. Defaults to 10000 milliseconds.",
				},
				maxResults: {
					type: "number",
					description:
						"Maximum number of match summaries to return. Defaults to 5.",
				},
			},
			required: ["mode"],
		},
	},

	execute: async (
		args: BrowserWaitRequest & { mode: "find" | "wait" },
		session: AgentSession,
	) => {
		if (args.mode === "wait") {
			return session.requireBrowser().waitForElement(args);
		}

		return session.requireBrowser().findElements(args);
	},
};

export default browserLocateTool;
