// POST /mcp або /mcp/<MCP_TOKEN> — MCP-сервер «Календар майстра» (lib/mcp-calendar.js).
import { handleMcp } from "../../lib/mcp-calendar.js";

export const onRequest = handleMcp;
