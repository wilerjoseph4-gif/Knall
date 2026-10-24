// Knall proxy — l'app envoie la question ici, ce serveur parle a l'API Claude.
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors()); // en production: cors({ origin: ["https://ton-domaine.com"] })

const API_KEY = process.env.ANTHROPIC_API_KEY;   // cle Claude (jamais dans l'app)
const GEMINI_KEY = process.env.GEMINI_API_KEY;   // cle Gemini, optionnelle (secours)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GROQ_KEY = process.env.GROQ_API_KEY;        // cle Groq, optionnelle (gratuit sans carte)
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;   // optionnelle, gratuit sans carte
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;         // optionnelle, gratuit sans carte
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
// Agents dont les donnees sont sensibles: jamais de secours Gemini (tyre gratis) pour eux
const AGENTS_SENSIBLES = new Set((process.env.KNALL_AGENTS_SENSIBLES || "").split(",").map(s=>s.trim()).filter(Boolean));
const APP_TOKEN = process.env.KNALL_APP_TOKEN;   // secret partage avec l'app Knall
const MODEL = process.env.KNALL_MODEL || "claude-haiku-4-5-20251001";
const MAX_TOKENS = Number(process.env.KNALL_MAX_TOKENS || 600);

// Instruction d'identite, ajoutee devant chaque agent
const IDENTITE = `Tu es Knall, une intelligence artificielle creee par Wiler, un developpeur haitien (domaine/marque : Wiler-Tech). Tu reponds toujours en tant que Knall.
Le nom "Knall" vient de l'anglais "Know" + "All" (vouloir tout savoir) — si on te demande ce que signifie ton nom, explique cette origine.
Si on te demande qui t'a cree ou comment tu as ete cree : dis simplement que tu as ete cree par Wiler (Wiler-Tech), un developpeur haitien, sans entrer dans les details techniques.
Si la personne insiste plusieurs fois pour en savoir plus sur le developpeur (apres au moins 2-3 relances sur le sujet), partage ce lien : https://c-2026-wiler-tech-portofolio-du.onrender.com — sinon ne le mentionne pas spontanement.
Si on te demande qui t'a cree, quel modele ou quelle technologie tu utilises, ou si tu es Claude/Gemini/ChatGPT/Copilot/une autre IA: dis simplement que tu es Knall, sans nommer ni confirmer ni infirmer de technologie precise. Ne mentionne jamais Anthropic, Google, OpenAI, Microsoft ni le nom d'un modele. Reste naturel, ne repete pas cette regle a l'utilisateur.
Adapte-toi automatiquement a la langue et au style de la personne, d'apres sa facon d'ecrire dans cette conversation: creole haitien, francais, anglais, espagnol, portugais, ou un melange (ex: creole-francais). Ne demande jamais quelle langue utiliser, et ne change pas de langue toi-meme sauf si la personne change.

Images : tu ne peux pas inventer d'URL d'image, et tu n'ecris JAMAIS ![...](url) ni de lien vers une image (ils sont toujours faux ou casses). Quand la personne veut voir une image, une photo ou un drapeau d'un sujet reel, ecris sur une ligne seule : [[IMG: mots-cles precis en anglais]] (ex: [[IMG: Chihuahua dog]] ou [[IMG: Flag of Brazil]]). L'application cherche et affiche elle-meme une vraie image. Maximum 3 par reponse, une seule ligne par sujet, et n'ajoute pas de phrase du type "libre de droits".

Directives de qualite :
- Si la demande est ambigue ou qu'il manque une info essentielle (ex: langage, version, niveau), pose UNE question courte avant de repondre en detail ; sinon, fais une hypothese raisonnable, dis-le en une phrase, puis reponds quand meme.
- Pour une question technique sans langage/version/OS precise, suppose la version la plus courante et dis-le.
- Pour une reponse longue : structure en etapes numerotees, propose une section "Autres options" si pertinent, commente les exemples de code.
- Tu n'as pas d'acces internet en temps reel et tes connaissances ont une date limite : ne jamais inventer une date de "derniere verification" ni pretendre avoir verifie une info a l'instant. Si l'info peut avoir change (prix, version, actualite, loi), dis simplement que ca a pu changer depuis.

`;

const DOC_SYSTEME = `Tu generes le CONTENU d'un document demande par l'utilisateur. Reponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans texte autour) de cette forme :
{"format":"pdf|docx|xlsx|csv|txt|md|html|json","titre":"...","resume":"une phrase","blocs":[{"t":"h1","v":"..."},{"t":"h2","v":"..."},{"t":"p","v":"..."},{"t":"ul","v":["...","..."]},{"t":"table","v":[["entete1","entete2"],["a","b"]]}]}
Regles : "format" = celui demande (pdf par defaut). Pour xlsx/csv, mets surtout des blocs "table" (le premier = entetes). Ecris dans la langue de l'utilisateur (creole, francais, anglais...). Si l'utilisateur demande un discours, une lettre, un texte : ecris-le en entier dans des blocs "p". Si une fiche precedente est fournie et qu'il demande une modification ou un autre format, repars de cette fiche. Pas de commentaires, JSON seulement.`;

// Un prompt systeme par agent (memes noms que dans l'app)
const AGENTS = {
  general: IDENTITE + "Tu es l'agent General de Knall: assistant utile et concis. Reponds dans la langue de l'utilisateur.",
  taches: IDENTITE + "Tu es l'agent Taches de Knall: aide a planifier, creer des rappels et organiser le travail. Reponds court et clair.",
  code: IDENTITE + "Tu es l'agent Code de Knall: aide a ecrire et corriger du code (HTML, CSS, JavaScript...). Donne des exemples courts et fonctionnels.",
  _doc: DOC_SYSTEME,
  recherche: IDENTITE + "Tu es l'agent Recherche de Knall: reponds avec des informations factuelles et precises, et dis quand tu n'es pas sur."
};

// Limite: 30 requetes par minute et par IP
app.use("/chat", rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));

app.get("/", (req, res) => res.send("Knall proxy OK"));

app.post("/chat", async (req, res) => {
  if (!APP_TOKEN || (!API_KEY && !GEMINI_KEY && !GROQ_KEY && !OPENROUTER_KEY && !MISTRAL_KEY)) {
    return res.status(500).json({ error: "Serveur mal configure (aucune cle IA n'est remplie)." });
  }
  if (req.get("x-knall-token") !== APP_TOKEN) {
    return res.status(401).json({ error: "Non autorise." });
  }

  const { agent = "general", messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
    return res.status(400).json({ error: "messages invalide (1 a 30 messages)." });
  }
  const clean = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
    return res.status(400).json({ error: "Le dernier message doit venir de l'utilisateur." });
  }

  const sensible = AGENTS_SENSIBLES.has(agent);
  // Ordre d'essai: Claude (si dispo) toujours en premier; Gemini et Groq (tyres gratuits)
  // seulement pour les agents non sensibles.
  const moteurs = [];
  if (API_KEY) moteurs.push({ nom: "claude", fn: appelerClaude });
  if (GEMINI_KEY && !sensible) moteurs.push({ nom: "gemini", fn: appelerGemini });
  if (GROQ_KEY && !sensible) moteurs.push({ nom: "groq", fn: appelerGroq });
  if (OPENROUTER_KEY && !sensible) moteurs.push({ nom: "openrouter", fn: appelerOpenRouter });
  if (MISTRAL_KEY && !sensible) moteurs.push({ nom: "mistral", fn: appelerMistral });

  if (moteurs.length === 0) {
    return res.status(502).json({ error: "Aucun service IA disponible pour cet agent." });
  }

  for (const m of moteurs) {
    try {
      const reponse = await m.fn(agent, clean);
      return res.json({ reponse, provider: m.nom });
    } catch (e) {
      console.error(m.nom + " a echoue:", e.message);
    }
  }
  return res.status(502).json({ error: "Le service IA n'a pas pu repondre pour le moment." });
});

async function appelerClaude(agent, messages, max = MAX_TOKENS) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: max,
      system: AGENTS[agent] || AGENTS.general,
      messages
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Claude " + r.status + ": " + JSON.stringify(data));
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

async function appelerGemini(agent, messages, max = MAX_TOKENS) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: AGENTS[agent] || AGENTS.general }] },
      contents,
      generationConfig: { maxOutputTokens: max }
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Gemini " + r.status + ": " + JSON.stringify(data));
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").join("\n").trim() || "(reponse vide)";
}

// Fonction generique pour tout service compatible "chat completions" style OpenAI
async function appelerStyleOpenAI(url, cle, modele, agent, messages, headersExtra, max = MAX_TOKENS) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + cle, ...(headersExtra || {}) },
    body: JSON.stringify({
      model: modele,
      max_tokens: max,
      messages: [{ role: "system", content: AGENTS[agent] || AGENTS.general }, ...messages]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(url + " " + r.status + ": " + JSON.stringify(data));
  return data.choices?.[0]?.message?.content?.trim() || "(reponse vide)";
}

async function appelerGroq(agent, messages, max) {
  return appelerStyleOpenAI("https://api.groq.com/openai/v1/chat/completions", GROQ_KEY, GROQ_MODEL, agent, messages, undefined, max);
}

async function appelerOpenRouter(agent, messages, max) {
  return appelerStyleOpenAI("https://openrouter.ai/api/v1/chat/completions", OPENROUTER_KEY, OPENROUTER_MODEL, agent, messages, undefined, max);
}

async function appelerMistral(agent, messages, max) {
  return appelerStyleOpenAI("https://api.mistral.ai/v1/chat/completions", MISTRAL_KEY, MISTRAL_MODEL, agent, messages, undefined, max);
}

app.get("/image", async (req, res) => {
  if (req.get("x-knall-token") !== APP_TOKEN) {
    return res.status(401).json({ error: "Non autorise." });
  }
  const prompt = (req.query.prompt || "").toString().trim().slice(0, 500);
  if (!prompt) return res.status(400).json({ error: "prompt manquant." });
  try {
    const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) + "?width=768&height=768&nologo=true&seed=" + Date.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error("Pollinations " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "no-store");
    res.send(buf);
  } catch (e) {
    console.error("image a echoue:", e.message);
    res.status(502).json({ error: "Impossible de generer l'image pour le moment." });
  }
});


// ---------- Recherche de VRAIES images (Wikipedia, Wikimedia Commons, Openverse) ----------
const UA = "KnallBot/1.0 (https://knall-1.onrender.com; Wiler-Tech)";
const cachePhotos = new Map();   // requete -> {t, photos}

async function jsonGet(url, ms) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept": "application/json" }, signal: AbortSignal.timeout(ms || 7000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
const parIndex = (a, b) => (a.index || 0) - (b.index || 0);

async function depuisWikipedia(q, lang) {
  const u = "https://" + lang + ".wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=6&prop=pageimages&piprop=thumbnail&pithumbsize=800&gsrsearch=" + encodeURIComponent(q);
  const d = await jsonGet(u);
  return Object.values((d.query && d.query.pages) || {}).sort(parIndex)
    .filter(p => p.thumbnail && p.thumbnail.source)
    .map(p => ({ url: p.thumbnail.source, titre: p.title, source: "wikipedia" }));
}
async function depuisCommons(q) {
  const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Cmime%7Csize&iiurlwidth=800&gsrsearch=" + encodeURIComponent(q);
  const d = await jsonGet(u);
  return Object.values((d.query && d.query.pages) || {}).sort(parIndex)
    .map(p => ({ p, ii: p.imageinfo && p.imageinfo[0] }))
    .filter(x => x.ii && /^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(x.ii.mime) && (x.ii.thumburl || x.ii.url))
    .filter(x => x.ii.mime === "image/svg+xml" || (x.ii.width || 0) >= 300)
    .map(x => ({ url: x.ii.thumburl || x.ii.url, titre: x.p.title, source: "commons" }));
}
async function depuisOpenverse(q) {
  const d = await jsonGet("https://api.openverse.org/v1/images/?page_size=8&mature=false&q=" + encodeURIComponent(q));
  return (d.results || []).filter(x => x.thumbnail || x.url)
    .map(x => ({ url: x.thumbnail || x.url, titre: x.title || "", source: "openverse" }));
}

// Verifie que l'URL renvoie vraiment une image (pas une page d'erreur, pas un lien mort)
async function imageValide(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "range": "bytes=0-2047" }, signal: AbortSignal.timeout(9000) });
    const ct = r.headers.get("content-type") || "";
    try { if (r.body) await r.body.cancel(); } catch (e) {}
    return (r.ok || r.status === 206) && /^image\//i.test(ct);
  } catch (e) { return false; }
}

async function chercherUneFois(q, n) {
  const res = await Promise.allSettled([depuisWikipedia(q, "en"), depuisCommons(q), depuisWikipedia(q, "fr"), depuisOpenverse(q)]);
  const vu = new Set(), cands = [];
  res.forEach(r => (r.status === "fulfilled" ? r.value : []).forEach(c => { if (!vu.has(c.url)) { vu.add(c.url); cands.push(c); } }));
  const aTester = cands.slice(0, 14);
  const ok = await Promise.all(aTester.map(c => imageValide(c.url)));
  return aTester.filter((c, i) => ok[i]).slice(0, n);
}
async function chercherPhotos(q, n) {
  const cle = q.toLowerCase() + "|" + n;
  const c = cachePhotos.get(cle);
  if (c && Date.now() - c.t < 6 * 3600 * 1000) return c.photos;
  let photos = await chercherUneFois(q, n);
  if (photos.length === 0) {                      // rien trouve : on simplifie la recherche
    const court = q.split(/\s+/).slice(0, 2).join(" ");
    if (court && court !== q) photos = await chercherUneFois(court, n);
  }
  if (photos.length) cachePhotos.set(cle, { t: Date.now(), photos });
  return photos;
}

app.get("/photos", rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  if (req.get("x-knall-token") !== APP_TOKEN) return res.status(401).json({ error: "Non autorise." });
  const q = (req.query.q || "").toString().trim().slice(0, 120);
  if (!q) return res.status(400).json({ error: "q manquant." });
  const n = Math.min(8, Math.max(1, parseInt(req.query.n, 10) || 6));
  try {
    res.set("Cache-Control", "no-store");
    res.json({ photos: await chercherPhotos(q, n) });
  } catch (e) {
    console.error("photos a echoue:", e.message);
    res.status(502).json({ error: "Recherche d'image indisponible.", photos: [] });
  }
});

const PORT = process.env.PORT || 3000;

/* ---------- Documents (PDF, Word, Excel, CSV, texte...) ---------- */
// npm i pdfkit docx exceljs
const MIMES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", md: "text/markdown", html: "text/html", json: "application/json"
};

function extraireJSON(txt) {
  const t = String(txt || "").replace(/```json|```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("reponse IA illisible");
  return JSON.parse(t.slice(a, b + 1));
}

function nettoyerFiche(f) {
  const fmt = String(f.format || "pdf").toLowerCase();
  const format = MIMES[fmt] ? fmt : "pdf";
  const blocs = (Array.isArray(f.blocs) ? f.blocs : []).filter(b => b && b.t).slice(0, 300);
  return { format, titre: String(f.titre || "Document").slice(0, 120), resume: String(f.resume || "").slice(0, 300), blocs };
}

const nomFichier = (titre, ext) =>
  (titre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 50) || "document") + "." + ext;

async function construire(f) {
  const tables = f.blocs.filter(b => b.t === "table" && Array.isArray(b.v));
  const texte = () => f.blocs.map(b =>
    b.t === "ul" ? (b.v || []).map(x => "- " + x).join("\n") :
    b.t === "table" ? (b.v || []).map(r => r.join(" | ")).join("\n") :
    (b.t === "h1" ? "# " : b.t === "h2" ? "## " : "") + (b.v || "")).join("\n\n");

  if (f.format === "txt") return Buffer.from(f.titre + "\n\n" + texte(), "utf8");
  if (f.format === "md") return Buffer.from("# " + f.titre + "\n\n" + texte(), "utf8");
  if (f.format === "json") return Buffer.from(JSON.stringify(f, null, 2), "utf8");
  if (f.format === "csv") {
    const rows = (tables[0] ? tables[0].v : f.blocs.map(b => [b.v])).map(r =>
      [].concat(r).map(c => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(","));
    return Buffer.from("\uFEFF" + rows.join("\n"), "utf8");
  }
  if (f.format === "html") {
    const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const corps = f.blocs.map(b =>
      b.t === "h1" ? `<h1>${esc(b.v)}</h1>` : b.t === "h2" ? `<h2>${esc(b.v)}</h2>` :
      b.t === "ul" ? "<ul>" + (b.v || []).map(x => `<li>${esc(x)}</li>`).join("") + "</ul>" :
      b.t === "table" ? "<table border='1' cellpadding='6'>" + (b.v || []).map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") + "</table>" :
      `<p>${esc(b.v)}</p>`).join("\n");
    return Buffer.from(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(f.titre)}</title></head><body style="font-family:sans-serif;max-width:800px;margin:auto;padding:20px"><h1>${esc(f.titre)}</h1>${corps}</body></html>`, "utf8");
  }
  if (f.format === "xlsx") {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    const liste = tables.length ? tables : [{ v: f.blocs.map(b => [b.v]) }];
    liste.forEach((t, i) => {
      const ws = wb.addWorksheet("Feuille " + (i + 1));
      t.v.forEach(r => ws.addRow([].concat(r)));
      if (ws.getRow(1)) ws.getRow(1).font = { bold: true };
      ws.columns.forEach(c => { c.width = 22; });
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  if (f.format === "docx") {
    const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } = require("docx");
    const kids = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(f.titre)] })];
    for (const b of f.blocs) {
      if (b.t === "h1") kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(String(b.v || ""))] }));
      else if (b.t === "h2") kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(String(b.v || ""))] }));
      else if (b.t === "ul") (b.v || []).forEach(x => kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(String(x))] })));
      else if (b.t === "table") kids.push(new Table({ rows: (b.v || []).map(r => new TableRow({ children: [].concat(r).map(c => new TableCell({ children: [new Paragraph(String(c ?? ""))] })) })) }));
      else kids.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(String(b.v || ""))] }));
    }
    return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: kids }] })));
  }
  // PDF
  const PDFDocument = require("pdfkit");
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4" });
    const parts = [];
    doc.on("data", d => parts.push(d)); doc.on("end", () => resolve(Buffer.concat(parts))); doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(22).text(f.titre).moveDown(0.8);
    for (const b of f.blocs) {
      if (b.t === "h1") doc.moveDown(0.4).font("Helvetica-Bold").fontSize(17).text(String(b.v || "")).moveDown(0.3);
      else if (b.t === "h2") doc.moveDown(0.3).font("Helvetica-Bold").fontSize(14).text(String(b.v || "")).moveDown(0.2);
      else if (b.t === "ul") { doc.font("Helvetica").fontSize(12); (b.v || []).forEach(x => doc.text("•  " + x, { indent: 10 })); doc.moveDown(0.5); }
      else if (b.t === "table") { doc.font("Helvetica").fontSize(11); (b.v || []).forEach((r, i) => doc.font(i ? "Helvetica" : "Helvetica-Bold").text([].concat(r).join("   |   "))); doc.moveDown(0.5); }
      else doc.font("Helvetica").fontSize(12).text(String(b.v || ""), { align: "justify", lineGap: 3 }).moveDown(0.6);
    }
    doc.end();
  });
}

app.post("/document", rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  if (!APP_TOKEN) return res.status(500).json({ error: "Serveur mal configure." });
  if (req.get("x-knall-token") !== APP_TOKEN) return res.status(401).json({ error: "Non autorise." });

  const { agent = "general", demande, contexte, precedent } = req.body || {};
  if (typeof demande !== "string" || !demande.trim()) return res.status(400).json({ error: "demande manquante." });

  const ctx = (Array.isArray(contexte) ? contexte : [])
    .filter(m => m && typeof m.content === "string")
    .map(m => (m.role === "assistant" ? "Knall: " : "Utilisateur: ") + m.content.slice(0, 3000)).join("\n");
  let contenu = "";
  if (ctx) contenu += "Contexte recent de la conversation :\n" + ctx + "\n\n";
  if (precedent && precedent.fiche) contenu += "Fiche precedente (a modifier si demande) :\n" + JSON.stringify(precedent.fiche).slice(0, 12000) + "\n\n";
  contenu += "Demande : " + demande.slice(0, 4000);
  const messages = [{ role: "user", content: contenu }];

  const sensible = AGENTS_SENSIBLES.has(agent);
  const moteurs = [];
  if (API_KEY) moteurs.push({ nom: "claude", fn: appelerClaude });
  if (GEMINI_KEY && !sensible) moteurs.push({ nom: "gemini", fn: appelerGemini });
  if (GROQ_KEY && !sensible) moteurs.push({ nom: "groq", fn: appelerGroq });
  if (OPENROUTER_KEY && !sensible) moteurs.push({ nom: "openrouter", fn: appelerOpenRouter });
  if (MISTRAL_KEY && !sensible) moteurs.push({ nom: "mistral", fn: appelerMistral });
  if (!moteurs.length) return res.status(502).json({ error: "Aucun service IA disponible." });

  let fiche = null;
  for (const m of moteurs) {
    try { fiche = nettoyerFiche(extraireJSON(await m.fn("_doc", messages, 4000))); break; }
    catch (e) { console.error("document/" + m.nom + " a echoue:", e.message); }
  }
  if (!fiche) return res.status(502).json({ error: "L'IA n'a pas pu preparer le contenu, reessaie." });

  try {
    const buf = await construire(fiche);
    res.json({
      base64: buf.toString("base64"), mime: MIMES[fiche.format], ext: fiche.format,
      nom: nomFichier(fiche.titre, fiche.format), taille: buf.length, resume: fiche.resume, fiche
    });
  } catch (e) {
    console.error("construction document:", e);
    res.status(500).json({ error: "Construction du fichier impossible: " + e.message });
  }
});

app.listen(PORT, () => console.log("Knall proxy sur le port " + PORT));
