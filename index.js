#!/usr/bin/env node

import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SITE_BASE_URL = "https://www.bounceprotect.com";
const API_BASE_URL = `${SITE_BASE_URL}/api/v1`;

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

async function callBounceProtectUrl(url, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, message: missingApiKeyText() };
  }

  try {
    const response = await fetch(url, {
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

async function callBounceProtect(path, options = {}) {
  return callBounceProtectUrl(`${API_BASE_URL}${path}`, options);
}

function formatResultLine(row) {
  const icon =
    row.status === "invalid"
      ? "❌"
      : row.status === "risky"
        ? "⚠️"
        : row.status === "unknown"
          ? "❓"
          : "✅";

  const email = row.email ?? row.normalized_email ?? row.original_email ?? "unknown";
  const recommendation = row.send_recommendation ?? "unknown";
  const score = row.deliverability_score ?? "unknown";
  const smtpResult = row.smtp_result ?? "not_checked";
  return `${icon} ${email} — ${row.status ?? "unknown"} | ${recommendation} | Score: ${score}/100 | SMTP: ${smtpResult}`;
}

function formatBulkSummary(rows) {
  return {
    valid: rows.filter((row) => row.status === "valid").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    risky: rows.filter((row) => row.status === "risky").length,
    unknown: rows.filter((row) => row.status === "unknown").length,
  };
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
  const signals = data.signals ?? {};
  const lines = [
    `Email: ${data.email ?? email}`,
    `Status: ${data.status ?? "unknown"} (${data.status_reason ?? "unknown"})`,
    `Recommendation: ${data.send_recommendation ?? "unknown"}`,
    `Deliverability score: ${data.deliverability_score ?? "unknown"}/100`,
    `Spam risk score: ${data.spam_score ?? "unknown"}/100`,
    `SMTP result: ${data.smtp_result ?? "not_checked"}`,
    "",
    "Signals:",
    `- Disposable domain: ${signals.is_disposable ?? false}`,
    `- Role account: ${signals.is_role_account ?? false}`,
    `- Free provider: ${signals.is_free_provider ?? false}`,
    `- Catch-all domain: ${signals.is_catch_all ?? false}`,
    `- Domain typo detected: ${signals.is_possible_typo ?? false}`,
    signals.suggested_domain
      ? `- Suggested correction: ${signals.suggested_domain}`
      : "",
    `- MX records found: ${signals.has_mx ?? false}`,
    `- SPF configured: ${signals.has_spf ?? false}`,
    `- DMARC configured: ${signals.has_dmarc ?? false}`,
    "",
    `Explanation: ${data.status_explanation ?? "No explanation provided."}`,
    `Credits remaining: ${data.credits_remaining ?? "unknown"}`,
  ].filter(Boolean);

  if (data.smtp_pending && data.smtp_upload_id) {
    lines.push("", `smtp_pending: true`, `smtp_upload_id: ${data.smtp_upload_id}`);
    if (data.smtp_message) {
      lines.push(data.smtp_message);
    }
  }

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
  const counts = formatBulkSummary(rows);
  const formattedRows = rows.map(formatResultLine);

  const lines = [
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
  ];

  if (data.smtp_pending && data.smtp_upload_id) {
    lines.push("", "smtp_pending: true", `smtp_upload_id: ${data.smtp_upload_id}`);
    if (data.smtp_message) {
      lines.push(data.smtp_message);
    }
  }

  return textResult(lines.join("\n"));
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

async function getSmtpStatus(uploadId) {
  const statusResult = await callBounceProtectUrl(`${SITE_BASE_URL}/api/uploads/${uploadId}/smtp-status`, {
    method: "GET",
  });

  if (!statusResult.ok) {
    return textResult(statusResult.message);
  }

  const status = statusResult.data ?? {};
  const done = status.smtp_done ?? 0;
  const total = status.total_eligible ?? 0;

  if (!status.is_complete) {
    return textResult(`SMTP verification still running: ${done} of ${total} checked. Try again in 30 seconds.`);
  }

  const rowsResult = await callBounceProtectUrl(
    `${SITE_BASE_URL}/api/uploads/${uploadId}/rows?page=0&page_size=500`,
    { method: "GET" },
  );

  if (!rowsResult.ok) {
    return textResult(rowsResult.message);
  }

  const rowsData = rowsResult.data ?? {};
  const rows = Array.isArray(rowsData.rows) ? rowsData.rows : [];
  const counts = formatBulkSummary(rows);
  const formattedRows = rows.map(formatResultLine);

  return textResult(
    [
      `SMTP verification complete for upload ${uploadId}.`,
      "",
      "Results:",
      ...formattedRows,
      "",
      "Summary:",
      `- Valid: ${counts.valid}`,
      `- Invalid: ${counts.invalid}`,
      `- Risky: ${counts.risky}`,
      `- Unknown: ${counts.unknown}`,
    ].join("\n"),
  );
}

async function triggerDeepAnalysis(uploadId) {
  const result = await callBounceProtectUrl(`${SITE_BASE_URL}/api/uploads/${uploadId}/deep-analysis`, {
    method: "POST",
  });

  if (!result.ok) {
    return textResult(result.message);
  }

  const data = result.data ?? {};

  if (data.already_exists) {
    return textResult(
      `Deep analysis already running or completed for this upload (job_id: ${data.job_id ?? "unknown"}, status: ${data.status ?? "unknown"}). Use get_deep_analysis_status to check progress.`,
    );
  }

  return textResult(
    `Deep analysis started for upload ${uploadId}. Job ID: ${data.job_id ?? "unknown"}. Use get_deep_analysis_status to poll for results — typically completes in 2-5 minutes.`,
  );
}

async function getDeepAnalysisStatus(uploadId) {
  const result = await callBounceProtectUrl(`${SITE_BASE_URL}/api/uploads/${uploadId}/deep-analysis`, {
    method: "GET",
  });

  if (!result.ok) {
    return textResult(result.message);
  }

  const data = result.data ?? {};
  const job = data.job ?? null;

  if (!job) {
    return textResult("No deep analysis job found for this upload. Use trigger_deep_analysis first.");
  }

  if (job.status === "pending" || job.status === "running") {
    return textResult(
      `Deep analysis in progress: ${job.domains_checked ?? 0} of ${job.domains_total ?? 0} domains checked. Check back in 30 seconds.`,
    );
  }

  if (job.status === "failed" || job.status === "stopped") {
    return textResult(`Deep analysis job ${job.status}. Trigger a new one with trigger_deep_analysis.`);
  }

  const domainResults = Array.isArray(data.domain_results) ? data.domain_results : [];
  const lines = [`Deep analysis complete. ${domainResults.length} domains analysed.`, ""];

  for (const row of domainResults) {
    lines.push(
      `🏢 ${row.domain ?? "unknown"} — Score: ${row.business_legitimacy_score ?? "unknown"}/100 | Website: ${row.has_website ?? false} | SSL: ${row.has_ssl ?? false} | Parked: ${row.is_parked ?? false}`,
    );

    if (row.org_matched) {
      lines.push(
        `   Org: ${row.org_name ?? "Unknown"} | ${row.org_industry ?? "Unknown industry"} | ${row.org_employee_size ?? "Unknown"} employees | ${row.org_country ?? "Unknown country"} | ${row.org_linkedin_url ?? "No LinkedIn URL"}`,
      );
    }
  }

  return textResult(lines.join("\n"));
}

const server = new Server(
  {
    name: "bounceprotect",
    version: "1.2.0",
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
      {
        name: "get_smtp_status",
        description:
          "Check whether background SMTP verification has completed for an upload and return updated results when ready.",
        inputSchema: {
          type: "object",
          properties: {
            upload_id: {
              type: "string",
              description: "The upload_id returned by validate_email or validate_emails_bulk when SMTP is still pending.",
            },
          },
          required: ["upload_id"],
        },
      },
      {
        name: "trigger_deep_analysis",
        description:
          "Start deep analysis for an upload so you can inspect domain legitimacy, website/SSL signals, and matched organisation data.",
        inputSchema: {
          type: "object",
          properties: {
            upload_id: {
              type: "string",
              description: "The upload_id to analyse.",
            },
          },
          required: ["upload_id"],
        },
      },
      {
        name: "get_deep_analysis_status",
        description:
          "Check deep analysis progress for an upload and return full domain-level results when the job is complete.",
        inputSchema: {
          type: "object",
          properties: {
            upload_id: {
              type: "string",
              description: "The upload_id returned by a prior validation workflow.",
            },
          },
          required: ["upload_id"],
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

  if (name === "get_smtp_status") {
    return getSmtpStatus(args?.upload_id);
  }

  if (name === "trigger_deep_analysis") {
    return triggerDeepAnalysis(args?.upload_id);
  }

  if (name === "get_deep_analysis_status") {
    return getDeepAnalysisStatus(args?.upload_id);
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
