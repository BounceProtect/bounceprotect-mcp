#!/usr/bin/env node

import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE_URL = "https://www.bounceprotect.com/api/v1";

function getApiKey() {
  const apiKey = process.env.BOUNCEPROTECT_API_KEY;
  if (!apiKey) {
    return null;
  }

  return apiKey;
}

function missingApiKeyText() {
  return "BOUNCEPROTECT_API_KEY environment variable is not set. Get your API key at https://bounceprotect.com/dashboard/api-keys";
}

function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

async function callBounceProtect(path, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, message: missingApiKeyText() };
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.ok) {
      return { ok: true, data };
    }

    if (response.status === 402) {
      return {
        ok: false,
        message: "Insufficient credits. Upgrade at https://bounceprotect.com/dashboard/usage",
      };
    }

    if (response.status === 401) {
      return {
        ok: false,
        message: "Invalid API key. Get your key at https://bounceprotect.com/dashboard/api-keys",
      };
    }

    return {
      ok: false,
      message:
        (data && typeof data.error === "string" && data.error) ||
        `Request failed with status ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function validateEmail(email) {
  const result = await callBounceProtect("/validate/email", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  if (!result.ok) {
    return textResult(result.message);
  }

  const data = result.data ?? {};
  const lines = [
    `Email: ${data.email ?? email}`,
    `Status: ${data.status ?? "unknown"} (${data.status_reason ?? "unknown"})`,
    `Recommendation: ${data.send_recommendation ?? "unknown"}`,
    `Deliverability score: ${data.deliverability_score ?? "unknown"}/100`,
    `Spam risk score: ${data.spam_score ?? "unknown"}/100`,
    "",
    "Signals:",
    `- Disposable domain: ${data.is_disposable ?? false}`,
    `- Role account: ${data.is_role_account ?? false}`,
    `- Free provider: ${data.is_free_provider ?? data.is_free_email_provider ?? false}`,
    `- Catch-all domain: ${data.is_catch_all ?? false}`,
    `- Domain typo detected: ${data.is_possible_typo ?? data.is_possible_domain_typo ?? false}`,
    data.suggested_domain
      ? `- Suggested correction: ${data.suggested_domain}`
      : "",
    `- MX records found: ${data.has_mx ?? false}`,
    `- SPF configured: ${data.has_spf ?? false}`,
    `- DMARC configured: ${data.has_dmarc ?? false}`,
    "",
    `Explanation: ${data.status_explanation ?? "No explanation provided."}`,
    `Credits remaining: ${data.credits_remaining ?? "unknown"}`,
  ].filter(Boolean);

  return textResult(lines.join("\n"));
}

async function validateEmailsBulk(emails) {
  const result = await callBounceProtect("/validate/bulk", {
    method: "POST",
    body: JSON.stringify({ emails }),
  });

  if (!result.ok) {
    return textResult(result.message);
  }

  const data = result.data ?? {};
  const rows = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.rows)
      ? data.rows
      : [];

  const counts = {
    valid: rows.filter((row) => row.status === "valid").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    risky: rows.filter((row) => row.status === "risky").length,
    unknown: rows.filter((row) => row.status === "unknown").length,
  };

  const formattedRows = rows.map((row) => {
    const icon =
      row.status === "invalid"
        ? "❌"
        : row.status === "risky"
          ? "⚠️"
          : row.status === "unknown"
            ? "❓"
            : "✅";

    return `${icon} ${row.email ?? row.original_email ?? "unknown"} — ${row.status ?? "unknown"} | ${row.send_recommendation ?? "unknown"} | Score: ${row.deliverability_score ?? "unknown"}/100`;
  });

  const text = [
    `Validated ${data.total ?? rows.length} emails — ${data.credits_used ?? rows.length} credits used, ${data.credits_remaining ?? "unknown"} remaining.`,
    "",
    "Results:",
    ...formattedRows,
    "",
    "Summary:",
    `- Valid: ${counts.valid}`,
    `- Invalid: ${counts.invalid}`,
    `- Risky: ${counts.risky}`,
    `- Unknown: ${counts.unknown}`,
  ].join("\n");

  return textResult(text);
}

async function checkCredits() {
  const result = await callBounceProtect("/account/balance", {
    method: "GET",
  });

  if (!result.ok) {
    return textResult(result.message);
  }

  const data = result.data ?? {};
  return textResult(`Your BounceProtect credit balance: ${data.balance ?? "unknown"} credits remaining.`);
}

const server = new Server(
  {
    name: "bounceprotect",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "validate_email",
        description:
          "Validate a single email address. Returns deliverability status, spam risk score, SMTP verification result, and a send recommendation.",
        inputSchema: {
          type: "object",
          properties: {
            email: {
              type: "string",
              description: "The email address to validate",
            },
          },
          required: ["email"],
        },
      },
      {
        name: "validate_emails_bulk",
        description:
          "Validate up to 100 email addresses at once. Returns validation results for each email including status, recommendation, and deliverability signals.",
        inputSchema: {
          type: "object",
          properties: {
            emails: {
              type: "array",
              items: { type: "string" },
              description: "Array of email addresses to validate (maximum 100)",
              maxItems: 100,
            },
          },
          required: ["emails"],
        },
      },
      {
        name: "check_credits",
        description: "Check your remaining BounceProtect credit balance.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "validate_email") {
    return validateEmail(args?.email);
  }

  if (name === "validate_emails_bulk") {
    return validateEmailsBulk(Array.isArray(args?.emails) ? args.emails : []);
  }

  if (name === "check_credits") {
    return checkCredits();
  }

  return textResult(`Unknown tool: ${name}`);
});

process.on("unhandledRejection", (error) => {
  console.error("[bounceprotect-mcp] Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("[bounceprotect-mcp] Uncaught exception:", error);
});

const transport = new StdioServerTransport();
await server.connect(transport);
