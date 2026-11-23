import http from "node:http";

const TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USER_ID = String(process.env.ALLOWED_USER_ID || "");
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");

if (!TOKEN || !ALLOWED_USER_ID || !WEBHOOK_SECRET || !CHANNEL_ID) {
  console.error("Missing BOT_TOKEN, ALLOWED_USER_ID, WEBHOOK_SECRET or CHANNEL_ID.");
  process.exit(1);
}

const api = (method) => "https://api.telegram.org/bot" + TOKEN + "/" + method;
const sessions = new Map();

async function telegram(method, payload) {
  const response = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || ("Telegram API error: " + response.status));
  return data.result;
}
async function say(chatId, text, extra = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}
async function answerCallback(id, text) {
  return telegram("answerCallbackQuery", { callback_query_id: id, text });
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
function decodeHtml(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
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
async function getCover(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      "accept-language": "it-IT,it;q=0.9,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Amazon ha risposto con HTTP " + response.status);
  const html = await response.text();
  const image = metaContent(html, "og:image") || metaContent(html, "twitter:image") ||
    decodeHtml(html.match(/\bdata-old-hires=["']([^"']+)["']/i)?.[1] || "");
  if (!image || !/^https:\/\/[^/]*(?:media-amazon|images-amazon|ssl-images-amazon)\.com\//i.test(image)) {
    throw new Error("Copertina non trovata nella pagina Amazon.");
  }
  return image;
}
function parseAmount(value, optional = false) {
  const raw = String(value || "").trim();
  if (optional && (!raw || raw === "-")) return null;
  const normalized = raw.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Prezzo non valido. Esempio: 31,28");
  return amount;
}
function euro(value) {
  return value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatRating(value) {
  const raw = String(value).trim().replace(",", ".");
  const n = Number(raw.length === 2 && !raw.includes(".") ? raw[0] + "." + raw[1] : raw);
  if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error("Valutazione non valida. Inserisci ad esempio 49 per 4,9.");
  return n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function formatReviews(value) {
  const n = Number(String(value).trim().replace(/[.\s]/g, ""));
  if (!Number.isInteger(n) || n < 0) throw new Error("Numero recensioni non valido. Esempio: 1250");
  return n.toLocaleString("it-IT");
}
function validAmazonUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (/(^|\.)amazon\.[a-z.]+$/.test(u.hostname) || u.hostname === "amzn.to");
  } catch { return false; }
}
function validHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:"; }
  catch { return false; }
}
function buildCaption(d) {
  const discount = d.previous && d.previous > d.current ? Math.round((1 - d.current / d.previous) * 100) : 0;
  const price = discount
    ? "⭕️ <b>" + euro(d.current) + "€</b> anziché <i>" + euro(d.previous) + "€</i> (-" + discount + "%)"
    : "⭕️ <b>Solo " + euro(d.current) + "€</b>";
  const lines = [
    ...(d.kindle ? ["📲 Ebook Kindle"] : []),
    "📚 <b>" + escapeHtml(d.title) + "</b>",
    "",
    "⭐️⭐️⭐️⭐️⭐️ " + d.rating + " (" + d.reviews + ")",
    '<a href="' + escapeAttribute(d.synopsis) + '"><b>🔎 Di cosa si tratta?</b></a>',
    "",
    price,
    "",
    "#adv"
  ];
  const caption = lines.join("\n");
  if (caption.length > 1024) throw new Error("Didascalia troppo lunga per Telegram.");
  return caption;
}
function start(chatId, userId) {
  sessions.set(userId, { step: "amazon", data: {} });
  say(chatId, "📚 Prepariamo un nuovo post ScontoLibri.\n\nIncolla per primo il link Amazon affiliato.");
}
async function promptNext(chatId, userId, text) {
  const session = sessions.get(userId);
  if (!session) return;
  const d = session.data;
  try {
    switch (session.step) {
      case "amazon":
        if (!validAmazonUrl(text)) throw new Error("Link non valido. Incolla un link Amazon.it o amzn.to.");
        d.amazon = text;
        session.step = "title";
        await say(chatId, "Perfetto. Ora scrivi il titolo del libro.");
        break;
      case "title":
        if (!text || text.length > 180) throw new Error("Titolo mancante o troppo lungo (massimo 180 caratteri).");
        d.title = text;
        session.step = "kindle";
        await say(chatId, "È un Ebook Kindle?", { reply_markup: { inline_keyboard: [[
          { text: "📲 Sì, Kindle", callback_data: "kindle_yes" },
          { text: "No, libro cartaceo", callback_data: "kindle_no" }
        ]] }});
        break;
      case "rating":
        d.rating = formatRating(text);
        session.step = "reviews";
        await say(chatId, "Quante recensioni ha? Esempio: 1250");
        break;
      case "reviews":
        d.reviews = formatReviews(text);
        session.step = "current";
        await say(chatId, "Qual è il prezzo attuale? Esempio: 31,28");
        break;
      case "current":
        d.current = parseAmount(text);
        session.step = "previous";
        await say(chatId, "Prezzo precedente? Scrivi il prezzo oppure - se non c'è.");
        break;
      case "previous":
        d.previous = parseAmount(text, true);
        session.step = "synopsis";
        await say(chatId, "Incolla il link della panoramica del libro.");
        break;
      case "synopsis":
        if (!validHttpUrl(text)) throw new Error("Link non valido. Incolla un URL completo che inizi con https://");
        d.synopsis = text;
        d.caption = buildCaption(d);
        session.step = "confirm";
        await showPreview(chatId, userId, session);
        break;
      default:
        await say(chatId, "Usa /pubblica per iniziare un nuovo inserimento oppure /annulla per interrompere.");
    }
  } catch (error) {
    await say(chatId, error.message + "\nRiprova inserendo il dato richiesto.");
  }
}
async function showPreview(chatId, userId, session) {
  const d = session.data;
  let cover = null;
  try { cover = await getCover(d.amazon); } catch (error) {
    console.warn("Cover unavailable:", error.message);
  }
  session.cover = cover;
  const keyboard = { inline_keyboard: [[
    { text: "✅ Pubblica nel canale", callback_data: "publish" },
    { text: "❌ Annulla", callback_data: "cancel" }
  ]]};
  if (cover) {
    await telegram("sendPhoto", {
      chat_id: chatId, photo: cover, caption: d.caption, parse_mode: "HTML",
      reply_markup: keyboard
    });
  } else {
    await say(chatId, "⚠️ Amazon non ha reso disponibile la copertina. Puoi comunque pubblicare il post senza immagine.\n\n" + d.caption,
      { parse_mode: "HTML", reply_markup: keyboard, disable_web_page_preview: true });
  }
}
async function publish(chatId, userId, callbackId) {
  const session = sessions.get(userId);
  if (!session || session.step !== "confirm") {
    await answerCallback(callbackId, "Nessun post da pubblicare.");
    return;
  }
  const d = session.data;
  try {
    const keyboard = { inline_keyboard: [[{ text: "🛒 VAI ALL’OFFERTA", url: d.amazon }]]};
    if (session.cover) {
      await telegram("sendPhoto", {
        chat_id: CHANNEL_ID, photo: session.cover, caption: d.caption,
        parse_mode: "HTML", reply_markup: keyboard
      });
    } else {
      await telegram("sendMessage", {
        chat_id: CHANNEL_ID, text: d.caption, parse_mode: "HTML",
        reply_markup: keyboard, disable_web_page_preview: true
      });
    }
    sessions.delete(userId);
    await answerCallback(callbackId, "Post pubblicato!");
    await say(chatId, "✅ Post pubblicato nel canale ScontoLibri.");
  } catch (error) {
    console.error("Publish failed:", error.message);
    await answerCallback(callbackId, "Pubblicazione non riuscita.");
    await say(chatId, "Non sono riuscito a pubblicare nel canale: " + error.message +
      "\nVerifica che il bot sia amministratore del canale e possa pubblicare messaggi.");
  }
}
async function handleCallback(query) {
  const userId = String(query.from?.id);
  const chatId = query.message?.chat?.id;
  if (userId !== ALLOWED_USER_ID || !chatId) {
    await answerCallback(query.id, "Accesso non autorizzato.");
    return;
  }
  const session = sessions.get(userId);
  if (query.data === "cancel") {
    sessions.delete(userId);
    await answerCallback(query.id, "Inserimento annullato.");
    await say(chatId, "Inserimento annullato. Per ricominciare invia /pubblica.");
    return;
  }
  if (query.data === "publish") return publish(chatId, userId, query.id);
  if (!session || session.step !== "kindle") {
    await answerCallback(query.id, "Questa scelta non è più valida.");
    return;
  }
  if (query.data === "kindle_yes" || query.data === "kindle_no") {
    session.data.kindle = query.data === "kindle_yes";
    session.step = "rating";
    await answerCallback(query.id, "Scelta salvata.");
    await say(chatId, "Inserisci la valutazione. Esempio: 49 per 4,9.");
  }
}
async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const userId = String(message.from?.id);
  if (userId !== ALLOWED_USER_ID || message.chat.type !== "private") {
    await say(chatId, "Bot privato: accesso non autorizzato.");
    return;
  }
  const text = message.text.trim();
  if (text === "/start" || text === "/help") {
    await say(chatId, "Benvenuto nel bot di inserimento ScontoLibri.\n\n/pubblica — crea un nuovo post\n/annulla — interrompe l'inserimento\n\nTi guiderò un dato alla volta. Il post verrà pubblicato nel canale solo dopo la tua conferma.");
    return;
  }
  if (text === "/pubblica") return start(chatId, userId);
  if (text === "/annulla") {
    sessions.delete(userId);
    await say(chatId, "Inserimento annullato. Per ricominciare invia /pubblica.");
    return;
  }
  if (!sessions.has(userId)) {
    await say(chatId, "Per creare un post invia /pubblica.");
    return;
  }
  await promptNext(chatId, userId, text);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); return;
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
  res.writeHead(200, { "content-type": "text/plain" }); res.end("ok");
  try { await handleUpdate(JSON.parse(body)); }
  catch (error) { console.error("Update error:", error.message); }
});
server.listen(PORT, async () => {
  console.log("ScontoLibri guided bot listening on " + PORT);
  if (PUBLIC_URL) {
    try {
      await telegram("setWebhook", {
        url: PUBLIC_URL + "/telegram",
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"]
      });
      console.log("Telegram webhook configured.");
    } catch (error) { console.error("Webhook setup failed:", error.message); }
  } else {
    console.warn("PUBLIC_URL not set: configure the Telegram webhook after deployment.");
  }
});
