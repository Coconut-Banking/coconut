import { NextRequest, NextResponse } from "next/server";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const GITHUB_TOKEN = process.env.GITHUB_BOT_TOKEN!;
const GITHUB_REPO = process.env.GITHUB_REPO || "Coconut-Banking/coconut";

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
}

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
    const message = update.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const text = message.text || message.caption || "";
    const hasMedia = !!(message.photo || message.video);
    const isBugCommand = text.startsWith("/bug") || text.includes("#bug");

    // If it's a photo/video without /bug, it might be a follow-up in a media group.
    // Add it as a comment on the most recent open ai-fix issue.
    if (hasMedia && !isBugCommand) {
      try {
        const imageUrl = await uploadMedia(message);
        if (imageUrl) {
          const latestIssue = await getLatestAiFixIssue();
          if (latestIssue) {
            await addCommentToIssue(latestIssue.number, `### Additional screenshot\n![screenshot](${imageUrl})`);
          }
        }
      } catch (err) {
        console.error("Failed to add follow-up media:", err);
      }
      return NextResponse.json({ ok: true });
    }

    // Handle /status command
    if (text.startsWith("/status")) {
      const statusMsg = await getAiFixStatus();
      await sendTelegram(message.chat.id, statusMsg, message.message_id);
      return NextResponse.json({ ok: true });
    }

    // Only process /bug commands
    if (!isBugCommand) {
      return NextResponse.json({ ok: true });
    }

    const description = text.replace(/^\/bug\s*/, "").replace(/#bug\s*/g, "").trim();
    if (!description) {
      await sendTelegram(message.chat.id, "Please include a bug description. Example:\n/bug The dashboard shows wrong currency for INR transactions");
      return NextResponse.json({ ok: true });
    }

    const submitter = message.from?.first_name || "Someone";
    let imageMarkdown = "";

    // Handle photo/video uploads
    if (hasMedia) {
      try {
        const mediaUrl = await uploadMedia(message);
        if (mediaUrl) {
          imageMarkdown = `\n\n### Screenshot\n![Bug screenshot](${mediaUrl})\n`;
        }
      } catch (err) {
        console.error("Failed to process media:", err);
        imageMarkdown = "\n\n_Media was attached but failed to upload._\n";
      }
    }

    // Create GitHub Issue
    const issueUrl = await createGitHubIssue({
      title: `Bug: ${description.slice(0, 80)}${description.length > 80 ? "..." : ""}`,
      body: `## Bug Report\n\n${description}${imageMarkdown}\n\n---\n_Submitted by ${submitter} via Telegram_`,
      labels: ["ai-fix"],
    });

    await sendTelegram(
      message.chat.id,
      `Bug filed and Claude is on it.\n${issueUrl}`,
      message.message_id
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function uploadMedia(message: TelegramUpdate["message"]): Promise<string | null> {
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
  return await uploadToGitHub(filename, fileBuffer);
}

async function getLatestAiFixIssue(): Promise<{ number: number } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues?labels=ai-fix&state=open&sort=created&direction=desc&per_page=1`,
    {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    }
  );
  if (!res.ok) return null;
  const issues = await res.json();
  return issues.length > 0 ? { number: issues[0].number } : null;
}

async function addCommentToIssue(issueNumber: number, body: string) {
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues/${issueNumber}/comments`,
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

async function getAiFixStatus(): Promise<string> {
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}` };

  // Fetch open ai-fix issues (the queue)
  const issuesRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues?labels=ai-fix&state=open&sort=created&direction=desc&per_page=20`,
    { headers }
  );
  const openIssues = issuesRes.ok ? await issuesRes.json() : [];

  // Fetch open PRs from the ai-fix bot
  const prsRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=open&sort=created&direction=desc&per_page=10`,
    { headers }
  );
  const allPRs = prsRes.ok ? await prsRes.json() : [];
  const fixPRs = allPRs.filter(
    (pr: { head: { ref: string } }) =>
      pr.head.ref.startsWith("fix/ai-fix-") || pr.head.ref.startsWith("fix/bug-council-")
  );

  // Check CI status on active PRs
  const prStatuses: string[] = [];
  for (const pr of fixPRs) {
    const checksRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/commits/${pr.head.sha}/check-runs?per_page=10`,
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
    prStatuses.push(`  PR #${pr.number}: ${pr.title}\n  CI: ${ciStatus}\n  ${pr.html_url}`);
  }

  // Build the status message
  const lines: string[] = ["--- AI Fix Bot Status ---\n"];

  if (openIssues.length > 0) {
    lines.push(`Open ai-fix issues: ${openIssues.length}`);
    for (const issue of openIssues.slice(0, 10)) {
      lines.push(`  #${issue.number}: ${issue.title}`);
    }
    if (openIssues.length > 10) {
      lines.push(`  ... and ${openIssues.length - 10} more`);
    }
  } else {
    lines.push("Open ai-fix issues: 0 (all clear!)");
  }

  lines.push("");

  if (prStatuses.length > 0) {
    lines.push(`Active fix PRs: ${prStatuses.length}`);
    lines.push(prStatuses.join("\n\n"));
  } else {
    lines.push("Active fix PRs: none");
  }

  return lines.join("\n");
}

async function sendTelegram(chatId: number, text: string, replyTo?: number) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyTo,
      disable_web_page_preview: true,
    }),
  });
}

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

async function uploadToGitHub(path: string, content: Buffer): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
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

async function createGitHubIssue(opts: {
  title: string;
  body: string;
  labels: string[];
}): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues`,
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
