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
  };
}

export async function POST(req: NextRequest) {
  // Verify the request is from Telegram via secret token
  const secretToken = req.headers.get("x-telegram-bot-api-secret-token");
  if (secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update: TelegramUpdate = await req.json();
  const message = update.message;
  if (!message) {
    return NextResponse.json({ ok: true });
  }

  const text = message.text || message.caption || "";

  // Only process messages that start with /bug or contain #bug
  if (!text.startsWith("/bug") && !text.includes("#bug")) {
    return NextResponse.json({ ok: true });
  }

  // Strip the /bug command prefix
  const description = text.replace(/^\/bug\s*/, "").replace(/#bug\s*/g, "").trim();
  if (!description) {
    await sendTelegram(message.chat.id, "Please include a bug description. Example:\n/bug The dashboard shows wrong currency for INR transactions");
    return NextResponse.json({ ok: true });
  }

  const submitter = message.from?.first_name || "Someone";
  let imageMarkdown = "";

  // Handle photo uploads
  if (message.photo && message.photo.length > 0) {
    try {
      // Get the highest resolution photo
      const photo = message.photo[message.photo.length - 1];
      const fileInfo = await getTelegramFile(photo.file_id);
      const imageBuffer = await downloadTelegramFile(fileInfo.file_path);

      // Upload to the repo as a screenshot
      const timestamp = Date.now();
      const filename = `bug-screenshots/${timestamp}.jpg`;
      const rawUrl = await uploadToGitHub(filename, imageBuffer);
      imageMarkdown = `\n\n### Screenshot\n![Bug screenshot](${rawUrl})\n`;
    } catch (err) {
      console.error("Failed to process image:", err);
      imageMarkdown = "\n\n_Screenshot was attached but failed to upload._\n";
    }
  }

  // Create GitHub Issue
  try {
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
  } catch (err) {
    console.error("Failed to create issue:", err);
    await sendTelegram(
      message.chat.id,
      "Failed to create the issue. Check the webhook logs.",
      message.message_id
    );
  }

  return NextResponse.json({ ok: true });
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
