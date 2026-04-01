import { NextRequest, NextResponse } from "next/server";
import { loadClerkAuth } from "@/lib/auth";

const GITHUB_TOKEN = process.env.GITHUB_BOT_TOKEN;
const GITHUB_REPO = "Coconut-Banking/coconut-app";
const GITHUB_API = "https://api.github.com";

interface BugReportBody {
  title: string;
  description: string;
  appVersion?: string;
  deviceModel?: string;
  osVersion?: string;
  currentRoute?: string;
  severity?: "low" | "medium" | "high";
}

function buildIssueBody(body: BugReportBody, userId: string | null): string {
  const lines: string[] = [];

  lines.push(body.description.trim());
  lines.push("");
  lines.push("---");
  lines.push("**Device Info**");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  if (body.appVersion) lines.push(`| App version | \`${body.appVersion}\` |`);
  if (body.deviceModel) lines.push(`| Device | ${body.deviceModel} |`);
  if (body.osVersion) lines.push(`| OS | ${body.osVersion} |`);
  if (body.currentRoute) lines.push(`| Screen | \`${body.currentRoute}\` |`);
  if (body.severity) lines.push(`| Severity | ${body.severity} |`);
  lines.push(`| Reporter | ${userId ? `clerk:${userId.slice(0, 12)}…` : "anonymous"} |`);
  lines.push(`| Source | in-app shake-to-report |`);

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const clerkAuth = await loadClerkAuth();
  if (!clerkAuth.ok) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }
  if (!clerkAuth.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!GITHUB_TOKEN) {
    console.error("[bug-report] GITHUB_BOT_TOKEN is not set");
    return NextResponse.json({ error: "Bug reporting is not configured" }, { status: 503 });
  }

  let body: BugReportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = body.title?.trim();
  const description = body.description?.trim();

  if (!title || title.length < 3) {
    return NextResponse.json({ error: "title must be at least 3 characters" }, { status: 400 });
  }
  if (!description || description.length < 10) {
    return NextResponse.json({ error: "description must be at least 10 characters" }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 });
  }

  const issueTitle = `[User Report] ${title}`;
  const issueBody = buildIssueBody(body, clerkAuth.userId);
  const labels = ["user-reported", "ai-fix", "bug"];

  const ghRes = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title: issueTitle, body: issueBody, labels }),
  });

  if (!ghRes.ok) {
    const ghErr = await ghRes.text();
    console.error(`[bug-report] GitHub API error ${ghRes.status}: ${ghErr}`);
    return NextResponse.json({ error: "Failed to create issue" }, { status: 502 });
  }

  const issue = await ghRes.json() as { number: number; html_url: string };

  return NextResponse.json({ issueNumber: issue.number, issueUrl: issue.html_url }, { status: 201 });
}
