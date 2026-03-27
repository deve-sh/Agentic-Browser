import readFileTool from "./read_file";
import listDirectoryFilesTool from "./list_directory_files";
import executeCommandTool from "./execute_command";
import writeToFileTool from "./write_to_file";
import askUserForInputTool from "./ask_user_for_input";
import getFileMetadataTool from "./get_file_metadata";
import browserNavigateTool from "./browser_navigate";
import browserSnapshotTool from "./browser_snapshot";
import browserInteractTool from "./browser_interact";
import browserLocateTool from "./browser_locate";

const availableTools = [
	browserNavigateTool,
	browserSnapshotTool,
	browserInteractTool,
	browserLocateTool,
	readFileTool,
	writeToFileTool,
	listDirectoryFilesTool,
	executeCommandTool,
	askUserForInputTool,
	getFileMetadataTool,
];

export default availableTools;
