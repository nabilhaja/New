import "./env.js";
import { runStdio } from "./stdio.js";
import { runHttp } from "./http.js";

async function main() {
  const transport = process.env.MCP_TRANSPORT === "http" ? "http" : "stdio";
  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error("Fatal error starting bip-mcp-server:", err);
  process.exit(1);
});
