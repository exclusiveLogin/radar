// --- runtime exports (schemas, functions, classes) ---
export { classifyContentKind } from "./classifyContentKind.js";
export { extractCounts } from "./extractCounts.js";
export { extractDirection } from "./extractDirection.js";
export { extractEventType } from "./extractEventType.js";
export { extractMacroZone } from "./extractMacroZone.js";
export { extractRepeatFlag } from "./extractRepeatFlag.js";
export { parsePost } from "./parsePost.js";
export { splitMessageBlocks } from "./splitMessageBlocks.js";
export { stripSignature } from "./stripSignature.js";
export { PARSER_VERSION } from "./version.js";

// --- type-only exports ---
export type { ContentKind } from "./classifyContentKind.js";
