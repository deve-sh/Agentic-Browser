import AgentSession from "../session";
import type { BrowserActionRequest } from "../types";

function normalizeOptionalString(value?: string) {
	const trimmedValue = value?.trim();
	return trimmedValue ? trimmedValue : undefined;
}

const browserInteractTool = {
	toolProperties: {
		type: "function",
		name: "browser_interact",
		description:
			"Interact with the attached browser tab using either a ref from `browser_snapshot` or a Playwright locator strategy like selector, text, label, placeholder, role, title, alt text, or test id. Prefer refs whenever possible.",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"click",
						"double_click",
						"hover",
						"fill",
						"type_text",
						"press_key",
						"backspace",
						"attach_file",
						"focus",
						"clear",
					],
					description: "The browser action to perform.",
				},
				ref: {
					type: "string",
					description:
						"A stable ref like `e1` returned by `browser_snapshot`. Preferred over selectors.",
				},
				selector: {
					type: "string",
					description:
						"A raw Playwright selector. Use this only when a ref is unavailable.",
				},
				text: {
					type: "string",
					description: "Find the target using Playwright's `getByText`.",
				},
				label: {
					type: "string",
					description: "Find the target using Playwright's `getByLabel`.",
				},
				placeholder: {
					type: "string",
					description:
						"Find the target using Playwright's `getByPlaceholder`.",
				},
				role: {
					type: "string",
					description: "Find the target using Playwright's `getByRole`.",
				},
				name: {
					type: "string",
					description:
						"Optional accessible name when locating by role.",
				},
				title: {
					type: "string",
					description: "Find the target using Playwright's `getByTitle`.",
				},
				altText: {
					type: "string",
					description:
						"Find the target using Playwright's `getByAltText`.",
				},
				testId: {
					type: "string",
					description: "Find the target using Playwright's `getByTestId`.",
				},
				exact: {
					type: "boolean",
					description: "Use exact matching for text-like locators.",
				},
				value: {
					type: "string",
					description:
						"Required when `action` is `fill` or `type_text`.",
				},
				key: {
					type: "string",
					description:
						"Required when `action` is `press_key`, for example `Enter` or `Tab`.",
				},
				count: {
					type: "number",
					description:
						"Optional repetition count for `backspace`. Defaults to 1.",
				},
				filePaths: {
					type: "array",
					items: { type: "string" },
					description:
						"Required when `action` is `attach_file`. Provide one or more file paths.",
				},
			},
			required: ["action"],
		},
	},

	execute: async (args: BrowserActionRequest, session: AgentSession) => {
		return session.browser.handleAction({
			action: args.action,
			ref: normalizeOptionalString(args.ref),
			selector: normalizeOptionalString(args.selector),
			text: normalizeOptionalString(args.text),
			label: normalizeOptionalString(args.label),
			placeholder: normalizeOptionalString(args.placeholder),
			role: normalizeOptionalString(args.role),
			name: normalizeOptionalString(args.name),
			title: normalizeOptionalString(args.title),
			altText: normalizeOptionalString(args.altText),
			testId: normalizeOptionalString(args.testId),
			exact: args.exact,
			value: normalizeOptionalString(args.value),
			key: normalizeOptionalString(args.key),
			count: args.count,
			filePaths: args.filePaths?.filter(Boolean),
		});
	},
};

export default browserInteractTool;
