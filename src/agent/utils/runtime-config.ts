export type RuntimeConfig = {
	debug?: boolean;
};

const runtimeConfig = {
	debug: false,
} as RuntimeConfig;

export default {
	getRuntimeConfig(key?: keyof RuntimeConfig) {
		if (key && typeof key === "string") return runtimeConfig[key];

		return runtimeConfig;
	},
	modifyRuntimeConfig(
		key: keyof RuntimeConfig,
		value: RuntimeConfig[keyof RuntimeConfig],
	) {
		if (key in runtimeConfig) runtimeConfig[key] = value;
	},
};
