const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

loadEnvFile(path.join(ROOT_DIR, ".env"));

const server = http.createServer(async (req, res) => {
  console.log(`[Server] ${req.method} ${req.url}`);

  if (req.method === "POST" && req.url === "/api/chat") {
    await handleChatRequest(req, res);
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  serveStaticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`);
  console.log("[Server] Open the site through this server so /api/chat works.");
});

async function handleChatRequest(req, res) {
  try {
    const body = await readJsonBody(req);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body?.history) ? body.history : [];

    console.log("[Chat API] Incoming request.", {
      historyItems: history.length,
      messageLength: message.length,
    });

    if (!message) {
      sendJson(res, 400, {
        reply: "Please type a message before sending.",
        error: "EMPTY_MESSAGE",
      });
      return;
    }

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === "your_groq_api_key_here") {
      sendJson(res, 500, {
        reply: "Server is missing GROQ_API_KEY.",
        error: "MISSING_API_KEY",
      });
      return;
    }

    const reply = await getGroqReply(message, history);

    if (!reply) {
      console.error("[Chat API] Groq returned an empty reply.");
      sendJson(res, 502, {
        reply: "Groq returned an empty reply.",
        error: "EMPTY_GROQ_RESPONSE",
      });
      return;
    }

    console.log("[Chat API] Reply sent back to frontend.", {
      replyLength: reply.length,
    });

    sendJson(res, 200, { reply });
  } catch (error) {
    console.error("[Chat API] Request failed.", error);
    sendJson(res, 502, {
      reply: "The assistant could not get a reply from Groq right now.",
      error: error.message || "GROQ_REQUEST_FAILED",
    });
  }
}

async function getGroqReply(message, history) {
  const model = process.env.OPENAI_MODEL || "llama-3.3-70b-versatile";
  const messages = buildMessages(message, history);
  const payload = {
    model,
    messages,
  };

  console.log("[Groq] Sending request.", {
    model,
    inputItems: messages.length,
  });

  const rawResponse = await postJson("https://api.groq.com/openai/v1/chat/completions", payload, {
    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  });

  console.log("[Groq] HTTP status:", rawResponse.statusCode);
  console.log("[Groq] Raw response text:", rawResponse.body);

  let parsed;
  try {
    parsed = JSON.parse(rawResponse.body);
  } catch (error) {
    throw new Error("Groq returned invalid JSON.");
  }

  if (rawResponse.statusCode < 200 || rawResponse.statusCode >= 300) {
    const apiMessage = parsed?.error?.message || "Unknown Groq API error.";
    throw new Error(`Groq API failed: ${apiMessage}`);
  }

  const reply = extractReplyFromGroq(parsed);

  console.log("[Groq] Extracted reply:", reply);
  return reply;
}

function buildMessages(message, history) {
  const safeHistory = Array.isArray(history) ? history.slice(-10) : [];
  const normalizedHistory = safeHistory
    .filter((entry) => entry && typeof entry.text === "string" && typeof entry.type === "string")
    .map((entry) => ({
      role: entry.type === "user" ? "user" : "assistant",
      content: entry.text,
    }));

  return [
    {
      role: "system",
      content:
        "You are LuxyRay Assistant, a helpful clinic chatbot. Answer clearly, briefly, and in beginner-friendly language. If the user asks about treatments, booking, doctors, promotions, contact, or FAQs, respond helpfully and avoid making medical claims you cannot support.",
    },
    ...normalizedHistory,
    {
      role: "user",
      content: message,
    },
  ];
}

function extractReplyFromGroq(data) {
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

function serveStaticFile(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(path.join(ROOT_DIR, requestPath));

  if (!safePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  fs.stat(safePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendHtml(res, 404, "<h1>404 Not Found</h1>");
      return;
    }

    const extension = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(safePath).pipe(res);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function postJson(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const body = JSON.stringify(payload);

    const request = https.request(
      {
        method: "POST",
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode || 500,
            body: responseBody,
          });
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(html);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  });
}