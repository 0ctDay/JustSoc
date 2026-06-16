#!/usr/bin/env node

import readline from "node:readline";

const SERVER_NAME = "selk-elasticsearch";
const SERVER_VERSION = "0.1.0";
const SUPPORTED_PROTOCOL_VERSION = "2026-01-26";

const DEFAULT_ENDPOINT =
  process.env.SELK_ES_ENDPOINT ||
  process.env.SELK_ELASTICSEARCH_URL ||
  process.env.ELASTICSEARCH_URL ||
  process.env.ES_URL ||
  "http://elasticsearch:9200";

const toolDefinitions = [
  {
    name: "cluster_info",
    description:
      "Get Elasticsearch cluster information and basic health checks from the configured endpoint.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "list_indices",
    description:
      "List indices visible to the configured Elasticsearch endpoint using the cat indices API.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pattern: {
          type: "string",
          description: "Index pattern, defaults to *.",
        },
        expand_wildcards: {
          type: "string",
          description:
            "Comma-separated expand_wildcards value, for example open,hidden.",
        },
      },
    },
  },
  {
    name: "get_mappings",
    description: "Fetch mappings for one or more indices.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["index"],
      properties: {
        index: {
          type: "string",
          description: "Index name or pattern.",
        },
      },
    },
  },
  {
    name: "field_caps",
    description: "Fetch field capabilities for the provided fields and indices.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        index: {
          type: "string",
          description: "Optional index or pattern.",
        },
        fields: {
          oneOf: [
            { type: "string" },
            {
              type: "array",
              items: { type: "string" },
            },
          ],
          description: "Field name, wildcard, or list of fields. Defaults to *.",
        },
      },
    },
  },
  {
    name: "search",
    description:
      "Run an Elasticsearch search request. Provide either q for Lucene syntax or body for full query DSL.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        index: {
          type: "string",
          description: "Optional index or pattern. Defaults to all indices.",
        },
        q: {
          type: "string",
          description: "Lucene query string passed as the q query parameter.",
        },
        from: {
          type: "integer",
          minimum: 0,
          description: "Pagination offset.",
        },
        size: {
          type: "integer",
          minimum: 0,
          description: "Number of hits to return.",
        },
        sort: {
          oneOf: [
            { type: "string" },
            {
              type: "array",
              items: {
                oneOf: [{ type: "string" }, { type: "object" }],
              },
            },
          ],
          description: "Optional sort definition.",
        },
        _source: {
          oneOf: [
            { type: "boolean" },
            { type: "string" },
            {
              type: "array",
              items: { type: "string" },
            },
          ],
          description: "Optional _source filter.",
        },
        track_total_hits: {
          oneOf: [{ type: "boolean" }, { type: "integer", minimum: 0 }],
          description: "Whether to compute exact total hits.",
        },
        body: {
          description: "Optional raw Elasticsearch query DSL body.",
        },
      },
    },
  },
  {
    name: "count",
    description:
      "Count matching documents. Provide either q for Lucene syntax or body for query DSL.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        index: {
          type: "string",
          description: "Optional index or pattern. Defaults to all indices.",
        },
        q: {
          type: "string",
          description: "Lucene query string passed as the q query parameter.",
        },
        body: {
          description: "Optional raw count query body.",
        },
      },
    },
  },
  {
    name: "get_document",
    description: "Fetch a document by index and id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["index", "id"],
      properties: {
        index: {
          type: "string",
          description: "Index name.",
        },
        id: {
          type: "string",
          description: "Document id.",
        },
        source_includes: {
          oneOf: [
            { type: "string" },
            {
              type: "array",
              items: { type: "string" },
            },
          ],
          description: "Optional _source include filter.",
        },
        source_excludes: {
          oneOf: [
            { type: "string" },
            {
              type: "array",
              items: { type: "string" },
            },
          ],
          description: "Optional _source exclude filter.",
        },
      },
    },
  },
  {
    name: "esql_query",
    description: "Run an ES|QL query against Elasticsearch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "ES|QL query string.",
        },
        columnar: {
          type: "boolean",
          description: "Whether to return columnar results.",
        },
        filter: {
          description: "Optional filter clause for ES|QL.",
        },
        params: {
          type: "array",
          description: "Optional ES|QL params array.",
          items: {},
        },
      },
    },
  },
];

function logError(error) {
  const message =
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.stderr.write(`${message}\n`);
}

function response(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function normalizeList(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}

function encodePathSegment(value) {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildHeaders() {
  const headers = {
    Accept: "application/json",
    "User-Agent": `${SERVER_NAME}/${SERVER_VERSION}`,
  };

  const apiKey = process.env.ES_API_KEY || process.env.ELASTIC_API_KEY;
  const bearerToken = process.env.ES_BEARER_TOKEN || process.env.ELASTIC_BEARER_TOKEN;
  const username = process.env.ES_USERNAME || process.env.ELASTIC_USERNAME;
  const password = process.env.ES_PASSWORD || process.env.ELASTIC_PASSWORD;
  const customHeaders = process.env.ES_HEADERS_JSON;

  if (apiKey) {
    headers.Authorization = apiKey.startsWith("ApiKey ") ? apiKey : `ApiKey ${apiKey}`;
  } else if (bearerToken) {
    headers.Authorization = bearerToken.startsWith("Bearer ")
      ? bearerToken
      : `Bearer ${bearerToken}`;
  } else if (username && password) {
    const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  if (customHeaders) {
    try {
      const parsed = JSON.parse(customHeaders);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          headers[key] = String(value);
        }
      }
    } catch (error) {
      throw new Error(`Failed to parse ES_HEADERS_JSON: ${error.message}`);
    }
  }

  return headers;
}

async function esRequest(method, path, { query, body } = {}) {
  const base = DEFAULT_ENDPOINT.endsWith("/") ? DEFAULT_ENDPOINT : `${DEFAULT_ENDPOINT}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, base);

  if (query && typeof query === "object") {
    for (const [key, rawValue] of Object.entries(query)) {
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        continue;
      }
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(rawValue));
      }
    }
  }

  const headers = buildHeaders();
  const init = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  console.error('[DEBUG] Fetching:', method, url.toString(), 'headers:', JSON.stringify(headers));
  const res = await fetch(url, init);
  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("json");
  const parsed = isJson && text ? JSON.parse(text) : text;

  if (!res.ok) {
    throw new Error(
      `Elasticsearch request failed: ${method} ${url} -> ${res.status} ${res.statusText}\n${typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}`,
    );
  }

  return {
    endpoint: DEFAULT_ENDPOINT,
    method,
    path,
    url: url.toString(),
    status: res.status,
    data: parsed,
  };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "cluster_info":
      return esRequest("GET", "/");
    case "list_indices": {
      const pattern = args.pattern || "*";
      return esRequest("GET", `/_cat/indices/${encodePathSegment(pattern)}`, {
        query: {
          format: "json",
          expand_wildcards: args.expand_wildcards,
          v: "true",
        },
      });
    }
    case "get_mappings":
      return esRequest("GET", `/${encodePathSegment(args.index)}/_mapping`);
    case "field_caps":
      return esRequest(
        "GET",
        args.index
          ? `/${encodePathSegment(args.index)}/_field_caps`
          : "/_field_caps",
        {
          query: {
            fields: normalizeList(args.fields) || "*",
          },
        },
      );
    case "search": {
      const path = args.index
        ? `/${encodePathSegment(args.index)}/_search`
        : "/_search";
      const body =
        args.body && typeof args.body === "object" && !Array.isArray(args.body)
          ? { ...args.body }
          : args.body;
      const query = {
        q: args.q,
        from: args.from,
        size: args.size,
        track_total_hits: args.track_total_hits,
      };

      if (args.sort !== undefined) {
        if (
          typeof args.sort === "string" ||
          (Array.isArray(args.sort) && args.sort.every((item) => typeof item === "string"))
        ) {
          query.sort = Array.isArray(args.sort) ? args.sort.join(",") : args.sort;
        } else if (body && typeof body === "object") {
          body.sort = args.sort;
        }
      }
      if (args._source !== undefined) {
        if (body && typeof body === "object") {
          body._source = args._source;
        } else {
          query._source = normalizeList(args._source);
        }
      }

      return esRequest("POST", path, {
        query,
        body: body ?? (args.q ? undefined : { query: { match_all: {} } }),
      });
    }
    case "count":
      return esRequest(
        "POST",
        args.index ? `/${encodePathSegment(args.index)}/_count` : "/_count",
        {
          query: {
            q: args.q,
          },
          body: args.body,
        },
      );
    case "get_document":
      return esRequest(
        "GET",
        `/${encodePathSegment(args.index)}/_doc/${encodeURIComponent(String(args.id))}`,
        {
          query: {
            _source_includes: normalizeList(args.source_includes),
            _source_excludes: normalizeList(args.source_excludes),
          },
        },
      );
    case "esql_query":
      return esRequest("POST", "/_query", {
        body: {
          query: args.query,
          ...(args.columnar === undefined ? {} : { columnar: args.columnar }),
          ...(args.filter === undefined ? {} : { filter: args.filter }),
          ...(args.params === undefined ? {} : { params: args.params }),
        },
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function formatToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}

async function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      return response(message.id, {
        protocolVersion:
          message.params?.protocolVersion || SUPPORTED_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
    case "ping":
      return response(message.id, {});
    case "tools/list":
      return response(message.id, {
        tools: toolDefinitions,
      });
    case "tools/call": {
      const toolName = message.params?.name;
      const args = message.params?.arguments ?? {};
      const result = await callTool(toolName, args);
      return response(message.id, formatToolResult(result));
    }
    case "resources/list":
      return response(message.id, {
        resources: [],
      });
    case "prompts/list":
      return response(message.id, {
        prompts: [],
      });
    default:
      return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    logError(`Failed to parse MCP message: ${trimmed}\n${error.message}`);
    return;
  }

  if (!message || typeof message !== "object") {
    return;
  }

  if (message.id === undefined) {
    return;
  }

  try {
    const result = await handleRequest(message);
    if (result) {
      writeMessage(result);
    }
  } catch (error) {
    logError(error);
    writeMessage(
      errorResponse(
        message.id,
        -32000,
        error instanceof Error ? error.message : "Unknown server error",
      ),
    );
  }
});

rl.on("close", () => {
  process.exit(0);
});