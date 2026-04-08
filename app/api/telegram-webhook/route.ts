import { NextRequest, NextResponse } from "next/server";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const GITHUB_TOKEN = process.env.GITHUB_BOT_TOKEN!;

const REPOS = {
  coconut: "Coconut-Banking/coconut",
  "coconut-app": "Coconut-Banking/coconut-app",
} as const;

type RepoKey = keyof typeof REPOS;

// Match repo from the bug-prompt text in reply_to_message (stateless, no ugly markers)
const REPO_LABEL_RE = /Filing bug for (Web App|Mobile App)/;
const LABEL_TO_REPO: Record<string, RepoKey> = {
  "Web App": "coconut",
  "Mobile App": "coconut-app",
};

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
    reply_to_message?: {
      text?: string;
      from?: { is_bot?: boolean };
    };
  };
  callback_query?: {
    id: string;
    from: { first_name: string; username?: string };
    message: { chat: { id: number }; message_id: number };
    data: string;
  };
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasGithubToken: !!process.env.GITHUB_BOT_TOKEN,
  });
}

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const update: TelegramUpdate = await req.json();

    // ── Handle button presses ──────────────────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;
      const data = cb.data;

      await answerCallbackQuery(cb.id);

      if (data === "bug") {
        await sendRepoSelector(chatId);
        return NextResponse.json({ ok: true });
      }

      if (data === "status") {
        const statusMsg = await getMultiRepoStatus();
        await sendTelegramWithMenu(chatId, statusMsg);
        return NextResponse.json({ ok: true });
      }

      // User picked a repo — ask for description with force_reply (stateless)
      if (data === "repo:coconut" || data === "repo:coconut-app") {
        const repo = data.replace("repo:", "") as RepoKey;
        const label = repo === "coconut" ? "Web App" : "Mobile App";
        await sendBugPrompt(chatId, repo, label);
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: true });
    }

    // ── Handle messages ────────────────────────────────────────────────────
    const message = update.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text || message.caption || "";
    const hasMedia = !!(message.photo || message.video);

    // /start or /menu
    if (text === "/start" || text === "/menu") {
      await sendMainMenu(chatId);
      return NextResponse.json({ ok: true });
    }

    // Legacy /status
    if (text.startsWith("/status")) {
      const statusMsg = await getMultiRepoStatus();
      await sendTelegramWithMenu(chatId, statusMsg);
      return NextResponse.json({ ok: true });
    }

    // Legacy /bug with inline description
    if (text.startsWith("/bug")) {
      const description = text.replace(/^\/bug\s*/, "").replace(/#bug\s*/g, "").trim();
      if (!description) {
        await sendRepoSelector(chatId);
        return NextResponse.json({ ok: true });
      }
      const submitter = message.from?.first_name || "Someone";
      const imageMarkdown = hasMedia ? await getMediaMarkdown(message, "coconut") : "";
      const issueUrl = await createGitHubIssue("coconut", {
        title: `Bug: ${description.slice(0, 80)}${description.length > 80 ? "..." : ""}`,
        body: `## Bug Report\n\n\`\`\`\n${description.replace(/`/g, "'")}\n\`\`\`${imageMarkdown}\n\n---\n_Submitted by ${submitter} via Telegram_`,
        labels: ["ai-fix"],
      });
      await sendTelegramWithMenu(chatId, `Bug filed! Claude is on it.\n${issueUrl}`);
      return NextResponse.json({ ok: true });
    }

    // ── STATELESS bug description: user replied to our force_reply prompt ──
    // Detect repo from the label in the bot's prompt message (no visible markers needed)
    const replyText = message.reply_to_message?.text || "";
    const labelMatch = replyText.match(REPO_LABEL_RE);
    if (labelMatch && message.reply_to_message) {
      const repo = LABEL_TO_REPO[labelMatch[1]];
      const description = text.trim();

      if (!description && !hasMedia) {
        await sendTelegram(chatId, "Please send a bug description (text, or photo with caption).");
        return NextResponse.json({ ok: true });
      }

      const submitter = message.from?.first_name || "Someone";
      const imageMarkdown = hasMedia ? await getMediaMarkdown(message, repo) : "";
      const bugText = description || "(screenshot only — see attached image)";

      const issueUrl = await createGitHubIssue(repo, {
        title: `Bug: ${bugText.slice(0, 80)}${bugText.length > 80 ? "..." : ""}`,
        body: `## Bug Report\n\n\`\`\`\n${bugText.replace(/`/g, "'")}\n\`\`\`${imageMarkdown}\n\n---\n_Submitted by ${submitter} via Telegram_`,
        labels: ["ai-fix"],
      });

      const label = repo === "coconut" ? "Web App" : "Mobile App";
      await sendTelegramWithMenu(chatId, `Bug filed for ${label}! Claude is on it.\n${issueUrl}`);
      return NextResponse.json({ ok: true });
    }

    // Standalone media — attach to latest ai-fix issue
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
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
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
  if (!res.ok) {
    console.error(`[telegram] sendMainMenu failed: ${res.status} ${await res.text()}`);
  }
}

/** Send a message AND include the main menu buttons below it */
async function sendTelegramWithMenu(chatId: number, text: string) {
  // Telegram hard limit is 4096 chars — truncate to avoid silent 400 failures
  const safeText = text.length > 3900 ? text.slice(0, 3900) + "\n…(truncated)" : text;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: safeText,
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: "File another Bug", callback_data: "bug" },
            { text: "Check Status", callback_data: "status" },
          ],
        ],
      },
    }),
  });
  if (!res.ok) {
    console.error(`[telegram] sendTelegramWithMenu failed: ${res.status} ${await res.text()}`);
  }
}

async function sendRepoSelector(chatId: number) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Which repo is the bug in?",
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

/** Ask for bug description — uses force_reply so the user's next message is a reply.
 *  Repo is detected from "Filing bug for {label}" in the reply text (fully stateless). */
async function sendBugPrompt(chatId: number, repo: RepoKey, label: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `Filing bug for ${label}.\n\nSend the bug description (text or photo with caption).`,
      reply_markup: {
        force_reply: true,
        selective: true,
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

async function sendTelegram(chatId: number, text: string, replyTo?: number) {
  const safeText = text.length > 3900 ? text.slice(0, 3900) + "\n…(truncated)" : text;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: safeText,
      reply_to_message_id: replyTo,
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) {
    console.error(`[telegram] sendTelegram failed: ${res.status} ${await res.text()}`);
  }
}

// ── Multi-repo status ─────────────────────────────────────────────────────────

async function getMultiRepoStatus(): Promise<string> {
  const repoEntries = Object.entries(REPOS) as [RepoKey, string][];
  const results = await Promise.allSettled(
    repoEntries.map(([, repoFullName]) => getRepoStatus(repoFullName))
  );

  const sections: string[] = ["--- Coconut Bot Status ---\n"];
  for (let i = 0; i < repoEntries.length; i++) {
    const [key] = repoEntries[i];
    const label = key === "coconut" ? "Web App (coconut)" : "Mobile App (coconut-app)";
    sections.push(`== ${label} ==`);
    const result = results[i];
    if (result.status === "fulfilled") {
      sections.push(result.value);
    } else {
      console.error(`[telegram] getRepoStatus failed for ${repoEntries[i][1]}:`, result.reason);
      sections.push(`(failed to fetch status: ${result.reason instanceof Error ? result.reason.message : String(result.reason)})`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

async function getRepoStatus(repo: string): Promise<string> {
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}` };

  const [labeledRes, userReportedRes, allRes, prsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}/issues?labels=ai-fix&state=open&sort=created&direction=desc&per_page=20`, { headers }),
    fetch(`https://api.github.com/repos/${repo}/issues?labels=user-reported&state=open&sort=created&direction=desc&per_page=20`, { headers }),
    fetch(`https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=20`, { headers }),
    fetch(`https://api.github.com/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=10`, { headers }),
  ]);
  const [labeledIssues, userReportedIssues, allIssues, allPRs] = await Promise.all([
    labeledRes.ok ? labeledRes.json() : Promise.resolve([]),
    userReportedRes.ok ? userReportedRes.json() : Promise.resolve([]),
    allRes.ok ? allRes.json() : Promise.resolve([]),
    prsRes.ok ? prsRes.json() : Promise.resolve([]),
  ]);

  // Also include any with "Bug:" title prefix
  const bugIssues = allIssues.filter(
    (i: { title: string }) => i.title.startsWith("Bug:")
  );

  // Merge and deduplicate by issue number
  const seen = new Set<number>();
  const openIssues = [...labeledIssues, ...userReportedIssues, ...bugIssues].filter(
    (i: { number: number }) => {
      if (seen.has(i.number)) return false;
      seen.add(i.number);
      return true;
    }
  );
  const fixPRs = allPRs.filter(
    (pr: { head: { ref: string } }) =>
      pr.head.ref.startsWith("fix/ai-fix-") || pr.head.ref.startsWith("fix/bug-council-")
  );

  const lines: string[] = [];

  if (openIssues.length > 0) {
    const urCount = userReportedIssues.length;
    lines.push(`Open issues to fix: ${openIssues.length}${urCount > 0 ? ` (${urCount} user-reported)` : ""}`);
    for (const issue of openIssues.slice(0, 5)) {
      const isUserReport = (issue as { labels?: { name: string }[] }).labels?.some(
        (l: { name: string }) => l.name === "user-reported"
      );
      lines.push(`  #${issue.number}: ${issue.title}${isUserReport ? " 📱" : ""}`);
    }
    if (openIssues.length > 5) {
      lines.push(`  ... and ${openIssues.length - 5} more`);
    }
  } else {
    lines.push("Open issues to fix: 0 (all clear!)");
  }

  if (fixPRs.length > 0) {
    lines.push(`Active fix PRs: ${fixPRs.length}`);
    const prLines = await Promise.all(
      fixPRs.map(async (pr: { number: number; title: string; html_url: string; head: { sha: string } }) => {
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
        return `  PR #${pr.number}: ${pr.title} (CI: ${ciStatus})\n  ${pr.html_url}`;
      })
    );
    lines.push(...prLines);
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
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}` };
  // Try ai-fix label first, then fall back to user-reported
  for (const label of ["ai-fix", "user-reported"]) {
    const res = await fetch(
      `https://api.github.com/repos/${REPOS[repo]}/issues?labels=${label}&state=open&sort=created&direction=desc&per_page=1`,
      { headers }
    );
    if (!res.ok) continue;
    const issues = await res.json();
    if (issues.length > 0) return { number: issues[0].number };
  }
  return null;
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

  // If labels cause a permission error, retry without them
  if (!res.ok && opts.labels.length > 0) {
    const errText = await res.text();
    if (res.status === 403 || res.status === 422) {
      console.warn(`Label issue on ${repo}, retrying without labels: ${errText}`);
      const { labels: _labels, ...withoutLabels } = opts;
      const retry = await fetch(
        `https://api.github.com/repos/${REPOS[repo]}/issues`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(withoutLabels),
        }
      );
      if (!retry.ok) {
        throw new Error(`GitHub issue creation failed: ${retry.status} ${await retry.text()}`);
      }
      const data = await retry.json();
      return data.html_url;
    }
    throw new Error(`GitHub issue creation failed: ${res.status} ${errText}`);
  }

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
