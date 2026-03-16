import { NextRequest, NextResponse } from "next/server";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const GITHUB_TOKEN = process.env.GITHUB_BOT_TOKEN!;

const REPOS = {
  coconut: "Coconut-Banking/coconut",
  "coconut-app": "Coconut-Banking/coconut-app",
} as const;

type RepoKey = keyof typeof REPOS;

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number; title?: string };
    from?: { first_name: string; username?: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number; height: number }[];
    video?: { file_id: string; file_name?: string };
    media_group_id?: string;
  };
  callback_query?: {
    id: string;
    from: { first_name: string; username?: string };
    message: { chat: { id: number }; message_id: number };
    data: string;
  };
}

// In-memory conversation state (resets on cold start — fine for personal bot)
const pendingState = new Map<number, { action: string; repo?: RepoKey }>();

// Health check to verify deployment
export async function GET() {
  return NextResponse.json({
    status: "ok",
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasGithubToken: !!process.env.GITHUB_BOT_TOKEN,
  });
}

export async function POST(req: NextRequest) {
  try {
    const update: TelegramUpdate = await req.json();

    // Handle callback queries (button presses)
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;
      const data = cb.data;

      await answerCallbackQuery(cb.id);

      if (data === "bug") {
        pendingState.set(chatId, { action: "bug" });
        await sendRepoSelector(chatId, "Which repo is the bug in?");
        return NextResponse.json({ ok: true });
      }

      if (data === "status") {
        const statusMsg = await getMultiRepoStatus();
        await sendTelegram(chatId, statusMsg);
        return NextResponse.json({ ok: true });
      }

      if (data === "repo:coconut" || data === "repo:coconut-app") {
        const repo = data.replace("repo:", "") as RepoKey;
        const state = pendingState.get(chatId);

        if (state?.action === "bug") {
          pendingState.set(chatId, { action: "bug", repo });
          const label = repo === "coconut" ? "Web App" : "Mobile App";
          await sendTelegram(chatId, `Got it — filing bug for *${label}*.\n\nSend the bug description (text or photo with caption).`, undefined, "Markdown");
          return NextResponse.json({ ok: true });
        }
      }

      return NextResponse.json({ ok: true });
    }

    const message = update.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text || message.caption || "";
    const hasMedia = !!(message.photo || message.video);
    const state = pendingState.get(chatId);

    // /start or /menu — show main menu
    if (text === "/start" || text === "/menu") {
      pendingState.delete(chatId);
      await sendMainMenu(chatId);
      return NextResponse.json({ ok: true });
    }

    // Legacy commands still work
    if (text.startsWith("/status")) {
      const statusMsg = await getMultiRepoStatus();
      await sendTelegram(chatId, statusMsg, message.message_id);
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/bug")) {
      // Legacy /bug command — default to coconut repo
      const description = text.replace(/^\/bug\s*/, "").replace(/#bug\s*/g, "").trim();
      if (!description) {
        pendingState.set(chatId, { action: "bug" });
        await sendRepoSelector(chatId, "Which repo is the bug in?");
        return NextResponse.json({ ok: true });
      }

      const submitter = message.from?.first_name || "Someone";
      const imageMarkdown = hasMedia ? await getMediaMarkdown(message, "coconut") : "";
      const issueUrl = await createGitHubIssue("coconut", {
        title: `Bug: ${description.slice(0, 80)}${description.length > 80 ? "..." : ""}`,
        body: `## Bug Report\n\n${description}${imageMarkdown}\n\n---\n_Submitted by ${submitter} via Telegram_`,
        labels: ["ai-fix"],
      });
      await sendTelegram(chatId, `Bug filed and Claude is on it.\n${issueUrl}`, message.message_id);
      pendingState.delete(chatId);
      return NextResponse.json({ ok: true });
    }

    // If we have a pending bug state with a repo selected, treat this message as the description
    if (state?.action === "bug" && state.repo) {
      const description = text.trim();
      if (!description && !hasMedia) {
        await sendTelegram(chatId, "Please send a bug description (text, or a photo with a caption).");
        return NextResponse.json({ ok: true });
      }

      const submitter = message.from?.first_name || "Someone";
      const repo = state.repo;
      const imageMarkdown = hasMedia ? await getMediaMarkdown(message, repo) : "";
      const bugText = description || "(screenshot only — see attached image)";
      const issueUrl = await createGitHubIssue(repo, {
        title: `Bug: ${bugText.slice(0, 80)}${bugText.length > 80 ? "..." : ""}`,
        body: `## Bug Report\n\n${bugText}${imageMarkdown}\n\n---\n_Submitted by ${submitter} via Telegram_`,
        labels: ["ai-fix"],
      });

      const label = repo === "coconut" ? "Web App" : "Mobile App";
      await sendTelegram(chatId, `Bug filed for *${label}* and Claude is on it.\n${issueUrl}`, message.message_id, "Markdown");
      pendingState.delete(chatId);
      return NextResponse.json({ ok: true });
    }

    // Standalone media with no state — attach to latest ai-fix issue in coconut repo
    if (hasMedia) {
      try {
        const imageUrl = await uploadMedia(message, "coconut");
        if (imageUrl) {
          const latestIssue = await getLatestAiFixIssue("coconut");
          if (latestIssue) {
            await addCommentToIssue("coconut", latestIssue.number, `### Additional screenshot\n![screenshot](${imageUrl})`);
          }
        }
      } catch (err) {
        console.error("Failed to add follow-up media:", err);
      }
      return NextResponse.json({ ok: true });
    }

    // Any other message — show main menu
    await sendMainMenu(chatId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function sendMainMenu(chatId: number) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "What would you like to do?",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "File a Bug", callback_data: "bug" },
            { text: "Check Status", callback_data: "status" },
          ],
        ],
      },
    }),
  });
}

async function sendRepoSelector(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Web App (coconut)", callback_data: "repo:coconut" },
            { text: "Mobile App (coconut-app)", callback_data: "repo:coconut-app" },
          ],
        ],
      },
    }),
  });
}

async function answerCallbackQuery(callbackQueryId: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function sendTelegram(chatId: number, text: string, replyTo?: number, parseMode?: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyTo,
      disable_web_page_preview: true,
      ...(parseMode && { parse_mode: parseMode }),
    }),
  });
}

// ── Multi-repo status ─────────────────────────────────────────────────────────

async function getMultiRepoStatus(): Promise<string> {
  const sections: string[] = ["--- Coconut Bot Status ---\n"];

  for (const [key, repoFullName] of Object.entries(REPOS)) {
    const label = key === "coconut" ? "Web App (coconut)" : "Mobile App (coconut-app)";
    sections.push(`== ${label} ==`);

    const status = await getRepoStatus(repoFullName);
    sections.push(status);
    sections.push("");
  }

  return sections.join("\n");
}

async function getRepoStatus(repo: string): Promise<string> {
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}` };

  const issuesRes = await fetch(
    `https://api.github.com/repos/${repo}/issues?labels=ai-fix&state=open&sort=created&direction=desc&per_page=20`,
    { headers }
  );
  const openIssues = issuesRes.ok ? await issuesRes.json() : [];

  const prsRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=10`,
    { headers }
  );
  const allPRs = prsRes.ok ? await prsRes.json() : [];
  const fixPRs = allPRs.filter(
    (pr: { head: { ref: string } }) =>
      pr.head.ref.startsWith("fix/ai-fix-") || pr.head.ref.startsWith("fix/bug-council-")
  );

  const lines: string[] = [];

  if (openIssues.length > 0) {
    lines.push(`Open ai-fix issues: ${openIssues.length}`);
    for (const issue of openIssues.slice(0, 5)) {
      lines.push(`  #${issue.number}: ${issue.title}`);
    }
    if (openIssues.length > 5) {
      lines.push(`  ... and ${openIssues.length - 5} more`);
    }
  } else {
    lines.push("Open ai-fix issues: 0 (all clear!)");
  }

  if (fixPRs.length > 0) {
    lines.push(`Active fix PRs: ${fixPRs.length}`);
    for (const pr of fixPRs) {
      const checksRes = await fetch(
        `https://api.github.com/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=10`,
        { headers }
      );
      let ciStatus = "unknown";
      if (checksRes.ok) {
        const checksData = await checksRes.json();
        const runs = checksData.check_runs || [];
        if (runs.length === 0) {
          ciStatus = "pending";
        } else if (runs.every((r: { conclusion: string }) => r.conclusion === "success")) {
          ciStatus = "passing";
        } else if (runs.some((r: { conclusion: string }) => r.conclusion === "failure")) {
          ciStatus = "failing";
        } else {
          ciStatus = "in progress";
        }
      }
      lines.push(`  PR #${pr.number}: ${pr.title} (CI: ${ciStatus})\n  ${pr.html_url}`);
    }
  } else {
    lines.push("Active fix PRs: none");
  }

  return lines.join("\n");
}

// ── Media helpers ─────────────────────────────────────────────────────────────

async function getMediaMarkdown(message: TelegramUpdate["message"], repo: RepoKey): Promise<string> {
  try {
    const mediaUrl = await uploadMedia(message, repo);
    if (mediaUrl) {
      return `\n\n### Screenshot\n![Bug screenshot](${mediaUrl})\n`;
    }
  } catch (err) {
    console.error("Failed to process media:", err);
    return "\n\n_Media was attached but failed to upload._\n";
  }
  return "";
}

async function uploadMedia(message: TelegramUpdate["message"], repo: RepoKey): Promise<string | null> {
  if (!message) return null;

  let fileId: string | null = null;
  let ext = "jpg";

  if (message.photo && message.photo.length > 0) {
    fileId = message.photo[message.photo.length - 1].file_id;
    ext = "jpg";
  } else if (message.video) {
    fileId = message.video.file_id;
    ext = "mp4";
  }

  if (!fileId) return null;

  const fileInfo = await getTelegramFile(fileId);
  const fileBuffer = await downloadTelegramFile(fileInfo.file_path);
  const timestamp = Date.now();
  const filename = `bug-screenshots/${timestamp}.${ext}`;
  return await uploadToGitHub(REPOS[repo], filename, fileBuffer);
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function getLatestAiFixIssue(repo: RepoKey): Promise<{ number: number } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${REPOS[repo]}/issues?labels=ai-fix&state=open&sort=created&direction=desc&per_page=1`,
    {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    }
  );
  if (!res.ok) return null;
  const issues = await res.json();
  return issues.length > 0 ? { number: issues[0].number } : null;
}

async function addCommentToIssue(repo: RepoKey, issueNumber: number, body: string) {
  await fetch(
    `https://api.github.com/repos/${REPOS[repo]}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
}

async function createGitHubIssue(repo: RepoKey, opts: {
  title: string;
  body: string;
  labels: string[];
}): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${REPOS[repo]}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(opts),
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub issue creation failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.html_url;
}

// ── File upload helpers ───────────────────────────────────────────────────────

async function getTelegramFile(fileId: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return data.result as { file_path: string };
}

async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
  );
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadToGitHub(repo: string, path: string, content: Buffer): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `chore: add bug screenshot ${path}`,
        content: content.toString("base64"),
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub upload failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.content.download_url;
}
