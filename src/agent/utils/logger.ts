// TODO: Add capability to plug in other loggers and drains

import runtimeConfig from "./runtime-config";

let loggerToUse: typeof console | null = console;

function setLogger(loggerToAssign = console) {
	if (!runtimeConfig.getRuntimeConfig("debug")) loggerToUse = null;

	loggerToUse = loggerToAssign;
}

setLogger();

export default {
	get: () => loggerToUse,
	setLogger,
};
