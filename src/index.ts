import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as bip from "./bipClient.js";

const server = new McpServer({
  name: "bip-mcp-server",
  version: "1.0.0",
});

function toolResult(payload: bip.BipResponse<unknown>) {
  const { data, rateLimitRemaining } = payload;
  const text =
    typeof data === "string"
      ? data
      : JSON.stringify(
          { data, rateLimitRemaining: rateLimitRemaining ?? undefined },
          null,
          2,
        );
  return { content: [{ type: "text" as const, text }] };
}

function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const criteriaField = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Additional/raw search criteria to send as-is in the request body, using the exact field names from the BiP Open API Swagger spec (https://app.bipintelligence.com/open-api/swagger-ui/index.html). Merged with any named parameters above.",
  );

// --- Notices ----------------------------------------------------------------

server.registerTool(
  "bip_search_notices",
  {
    title: "Search BiP tender notices",
    description:
      "Search UK public-sector tender notices via the BiP Open API (POST /notices). " +
      "Common response/filter fields: title, awardingAuthority, country, value, currency, " +
      "publishedDate, startDate, endDate, deadlineDate (dates as YYYY-MM-DD). " +
      "Requires the OPENAPI_NOTICES scope on the access token.",
    inputSchema: {
      title: z.string().optional().describe("Filter by (part of) the notice title"),
      awardingAuthority: z.string().optional().describe("Filter by awarding authority name"),
      country: z.string().optional().describe("Filter by country"),
      publishedDateFrom: z.string().optional().describe("YYYY-MM-DD"),
      publishedDateTo: z.string().optional().describe("YYYY-MM-DD"),
      deadlineDateFrom: z.string().optional().describe("YYYY-MM-DD"),
      deadlineDateTo: z.string().optional().describe("YYYY-MM-DD"),
      page: z.number().int().min(0).optional(),
      size: z.number().int().min(1).optional(),
      criteria: criteriaField,
    },
  },
  async (args) => {
    try {
      const { criteria, ...named } = args;
      const body = { ...named, ...(criteria ?? {}) };
      return toolResult(await bip.searchNotices(body));
    } catch (err) {
      return toolError(err);
    }
  },
);

server.registerTool(
  "bip_get_notice",
  {
    title: "Get a BiP tender notice by ID",
    description:
      "Fetch full detail for a single tender notice (GET /notices/{id}), including contact, address, and CPV codes. Requires OPENAPI_NOTICES scope.",
    inputSchema: {
      id: z.union([z.string(), z.number()]).describe("Notice ID, from bip_search_notices results"),
    },
  },
  async ({ id }) => {
    try {
      return toolResult(await bip.getNotice(id));
    } catch (err) {
      return toolError(err);
    }
  },
);

// --- Awards -------------------------------------------------------------------

server.registerTool(
  "bip_search_awards",
  {
    title: "Search BiP contract awards",
    description:
      "Search UK public-sector contract awards via the BiP Open API (POST /awards). " +
      "Common response/filter fields: title, awardingAuthority, suppliers, country, value, currency, " +
      "publishedDate, startDate, endDate (dates as YYYY-MM-DD). Requires the OPENAPI_AWARDS scope.",
    inputSchema: {
      title: z.string().optional().describe("Filter by (part of) the award title"),
      awardingAuthority: z.string().optional().describe("Filter by awarding authority name"),
      supplier: z.string().optional().describe("Filter by supplier name"),
      country: z.string().optional().describe("Filter by country"),
      publishedDateFrom: z.string().optional().describe("YYYY-MM-DD"),
      publishedDateTo: z.string().optional().describe("YYYY-MM-DD"),
      page: z.number().int().min(0).optional(),
      size: z.number().int().min(1).optional(),
      criteria: criteriaField,
    },
  },
  async (args) => {
    try {
      const { criteria, ...named } = args;
      const body = { ...named, ...(criteria ?? {}) };
      return toolResult(await bip.searchAwards(body));
    } catch (err) {
      return toolError(err);
    }
  },
);

server.registerTool(
  "bip_get_award",
  {
    title: "Get a BiP contract award by ID",
    description:
      "Fetch full detail for a single contract award (GET /awards/{id}), including suppliers, contact, and address. Requires OPENAPI_AWARDS scope.",
    inputSchema: {
      id: z.union([z.string(), z.number()]).describe("Award ID, from bip_search_awards results"),
    },
  },
  async ({ id }) => {
    try {
      return toolResult(await bip.getAward(id));
    } catch (err) {
      return toolError(err);
    }
  },
);

// --- Spend ----------------------------------------------------------------------

server.registerTool(
  "bip_list_spend_buyers",
  {
    title: "List BiP spend-data buyers",
    description:
      "List buyer organisation names for which BiP holds spend data (GET /spend/buyers). Requires OPENAPI_SPEND scope.",
    inputSchema: {
      page: z.number().int().min(0).optional(),
      size: z.number().int().min(1).optional(),
    },
  },
  async (args) => {
    try {
      return toolResult(await bip.listSpendBuyers(args));
    } catch (err) {
      return toolError(err);
    }
  },
);

server.registerTool(
  "bip_list_spend_suppliers",
  {
    title: "List BiP spend-data suppliers",
    description:
      "List supplier organisation names for which BiP holds spend data (GET /spend/suppliers). Requires OPENAPI_SPEND scope.",
    inputSchema: {
      page: z.number().int().min(0).optional(),
      size: z.number().int().min(1).optional(),
    },
  },
  async (args) => {
    try {
      return toolResult(await bip.listSpendSuppliers(args));
    } catch (err) {
      return toolError(err);
    }
  },
);

server.registerTool(
  "bip_search_spend_transactions",
  {
    title: "Search BiP spend transactions",
    description:
      "Fetch spend transactions for a given buyer/supplier name and date range (POST /spend/transactions). " +
      "buyerName and/or supplierName should match names returned by bip_list_spend_buyers / bip_list_spend_suppliers. " +
      "Requires OPENAPI_SPEND scope.",
    inputSchema: {
      buyerName: z.string().optional(),
      supplierName: z.string().optional(),
      dateFrom: z.string().optional().describe("YYYY-MM-DD"),
      dateTo: z.string().optional().describe("YYYY-MM-DD"),
      page: z.number().int().min(0).optional(),
      size: z.number().int().min(1).optional(),
      criteria: criteriaField,
    },
  },
  async (args) => {
    try {
      const { criteria, ...named } = args;
      const body = { ...named, ...(criteria ?? {}) };
      return toolResult(await bip.searchSpendTransactions(body));
    } catch (err) {
      return toolError(err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting bip-mcp-server:", err);
  process.exit(1);
});
