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
