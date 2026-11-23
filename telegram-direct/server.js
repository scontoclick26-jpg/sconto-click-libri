import http from "node:http";

const TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USER_ID = String(process.env.ALLOWED_USER_ID || "");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");

if (!TOKEN || !ALLOWED_USER_ID || !WEBHOOK_SECRET) {
  console.error("Missing BOT_TOKEN, ALLOWED_USER_ID or WEBHOOK_SECRET.");
  process.exit(1);
}

const api = (method) => \`https://api.telegram.org/bot\${TOKEN}/\${method}\`;

async function telegram(method, payload) {
  const response = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.description || \`Telegram API error: \${response.status}\`);
  }
  return data.result;
}

async function reply(chatId, text) {
  return telegram("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#x2F;/g, "/");
}

function metaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (name !== key.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return decodeHtml(content);
  }
  return "";
}

async function getCover(amazonUrl) {
  const response = await fetch(amazonUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      "accept-language": "it-IT,it;q=0.9,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(\`Amazon ha risposto con HTTP \${response.status}\`);
  const html = await response.text();
  let image = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  if (!image) {
    const match = html.match(/\bdata-old-hires=["']([^"']+)["']/i);
    if (match) image = decodeHtml(match[1]);
  }
  if (!image || !/^https:\/\/(m\.)?media-amazon\.com\//i.test(image)) {
    throw new Error("Copertina non trovata nella pagina Amazon.");
  }
  return image;
}

function parseAmount(value) {
  const normalized = value.trim().replace(/[€\\s]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Prezzo non valido.");
  return amount;
}
function euro(value) {
  return value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function rating(value) {
  const v = value.trim().replace(",", ".");
  const n = Number(v.length === 2 && !v.includes(".") ? v[0] + "." + v[1] : v);
  if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error("Valutazione non valida: usa ad esempio 49 per 4,9.");
  return n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function reviews(value) {
  const n = Number(value.trim().replace(/[.\\s]/g, ""));
  if (!Number.isInteger(n) || n < 0) throw new Error("Numero recensioni non valido.");
  return n.toLocaleString("it-IT");
}

function parseCommand(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines[0]?.toLowerCase() !== "/pubblica") throw new Error("Comando non riconosciuto.");
  if (lines.length !== 8 && lines.length !== 9) {
    throw new Error("Formato non corretto. Servono 7 dati dopo /pubblica (8 righe totali), oppure 8 con la dicitura Ebook Kindle.");
  }
  const kindle = lines.length === 9 || /^📲\s*ebook kindle$/i.test(lines[1]);
  const offset = kindle ? 1 : 0;
  const [amazonUrl, title, currentRaw, previousRaw, ratingRaw, reviewsRaw, synopsisUrl] = lines.slice(1 + offset);
  if (!/^https:\/\/(www\.)?amazon\.[a-z.]+\/|^https:\/\/amzn\.to\//i.test(amazonUrl)) throw new Error("Il primo link deve essere un link Amazon.");
  if (!/^https?:\/\//i.test(synopsisUrl)) throw new Error("Il link della panoramica non è valido.");
  if (!title || title.length > 180) throw new Error("Titolo mancante o troppo lungo.");
  const current = parseAmount(currentRaw);
  const previous = previousRaw && previousRaw !== "-" ? parseAmount(previousRaw) : null;
  const discount = previous && previous > current ? Math.round((1 - current / previous) * 100) : 0;
  const priceLine = previous && previous > current
    ? \`⭕️ <b>\${euro(current)}€</b> anziché <s>\${euro(previous)}€</s> (-\${discount}%)\`
    : \`⭕️ <b>Solo \${euro(current)}€</b>\`;
  const caption = [
    ...(kindle ? ["📲 Ebook Kindle"] : []),
    \`📚 <b>\${escapeHtml(title)}</b>\`,
    "",
    \`⭐️⭐️⭐️⭐️⭐️ \${rating(ratingRaw)} (\${reviews(reviewsRaw)})\`,
    \`<a href="\${escapeAttribute(synopsisUrl)}"><b>🔎 Di cosa si tratta?</b></a>\`,
    "",
    priceLine,
    "",
    "#adv"
  ].join("\n");
  if (caption.length > 1024) throw new Error("Didascalia troppo lunga per Telegram.");
  return { amazonUrl, caption };
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  if (String(message.from?.id) !== ALLOWED_USER_ID || message.chat.type !== "private") {
    await reply(chatId, "Bot di prova: accesso non autorizzato.");
    return;
  }
  if (message.text.trim() === "/start") {
    await reply(chatId, "Bot ScontoLibri di prova pronto. Invia /pubblica seguito dai dati del libro.");
    return;
  }
  if (!message.text.trim().startsWith("/pubblica")) return;

  try {
    const { amazonUrl, caption } = parseCommand(message.text);
    await reply(chatId, "Sto recuperando la copertina da Amazon…");
    const photo = await getCover(amazonUrl);
    await telegram("sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{
          text: "🛒 VAI ALL’OFFERTA",
          url: amazonUrl
        }]]
      }
    });
  } catch (error) {
    console.error("Publish error:", error.message);
    await reply(chatId, \`Non sono riuscito a pubblicare: \${error.message}\nControlla il link Amazon e i dati, poi riprova.\`);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/telegram") {
    res.writeHead(404); res.end("not found"); return;
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) {
    res.writeHead(401); res.end("unauthorized"); return;
  }
  let body = "";
  req.setEncoding("utf8");
  for await (const chunk of req) body += chunk;
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
  try {
    const update = JSON.parse(body);
    await handleUpdate(update);
  } catch (error) {
    console.error("Update error:", error.message);
  }
});

server.listen(PORT, async () => {
  console.log(\`ScontoLibri test bot listening on \${PORT}\`);
  if (PUBLIC_URL) {
    try {
      await telegram("setWebhook", {
        url: \`\${PUBLIC_URL}/telegram\`,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message"]
      });
      console.log("Telegram webhook configured.");
    } catch (error) {
      console.error("Webhook setup failed:", error.message);
    }
  } else {
    console.warn("PUBLIC_URL not set: configure the Telegram webhook after deployment.");
  }
});
