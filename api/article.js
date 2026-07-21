// api/article.js
// ---------------------------------------------------------------------
// Vercel Serverless Function. Serves a genuine, crawlable HTML page at
// /article/:id (see vercel.json for the rewrite that routes there).
//
// WHY THIS EXISTS
// The main site (index.html) is a single-page app that routes with a
// URL hash (#/article/xyz). Search engines don't index hash fragments
// as separate pages — they only ever see one URL, your homepage. This
// function fixes that: each article gets its own real, indexable path
// with the correct <title>, description, and visible article text
// baked right into the HTML (no JavaScript required to read it).
//
// Human visitors who land here can still jump into the full
// interactive app via the "Open in the interactive app" link at the
// bottom, which takes them to the same article inside the SPA.
//
// SETUP ON VERCEL
//   1. Put this file at:      api/article.js   (exact path matters)
//   2. Put vercel.json at:    the project root, next to index.html
//   3. Deploy as usual — Vercel auto-detects the /api folder as
//      serverless functions, no extra config needed beyond vercel.json.
//
// The Supabase URL/key below are the same public "anon" ones already
// visible in index.html's source — safe to leave hardcoded, or move to
// Vercel environment variables (Project Settings → Environment
// Variables) named SUPABASE_URL / SUPABASE_ANON_KEY / SITE_URL if you'd
// rather not hardcode them.
// ---------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || "https://qifucrphtikymxevtwcn.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_SIc3LKDwkWp7nWiZGOLKsg_HpKqbxD1";
const SITE_URL = (process.env.SITE_URL || "https://toon-tribune.vercel.app").replace(/\/$/, "");
const SB_TABLE = "toon_tribune";

module.exports = async (req, res) => {
  const id = (req.query.id || "").toString();
  if (!id) {
    res.status(400).send("Missing article id");
    return;
  }

  let articles = [];
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${SB_TABLE}?key=eq.ttArticles&select=value`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!resp.ok) throw new Error(`Supabase responded ${resp.status}`);
    const rows = await resp.json();
    const raw = rows && rows[0] && rows[0].value;
    articles = raw ? JSON.parse(raw) : [];
  } catch (e) {
    res.status(502).send("Could not load article data right now. Please try again shortly.");
    return;
  }

  const a = articles.find(x => x.id === id && x.status === "live");
  if (!a) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(notFoundHtml());
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(articleHtml(a, articles));
};

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function imageFor(a) {
  // Uploaded images are stored as base64 data URLs, which aren't valid
  // og:image/twitter:image values (must be a real fetchable URL) — but
  // they're fine to use directly as the visible <img src> on the page.
  const raw = typeof a.image === "string" && a.image.indexOf("data:") === 0 ? a.image : null;
  const social = raw ? `${SITE_URL}/logo.png` : `${SITE_URL}/logo.png`;
  return { display: raw, social };
}

function notFoundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Story not found — The Toon Tribune</title>
<meta name="robots" content="noindex">
</head><body style="font-family:Arial,sans-serif;text-align:center;padding:80px 20px;">
<h1>Story not found</h1>
<p>This article may have been unpublished or removed.</p>
<p><a href="${SITE_URL}/">Back to The Toon Tribune</a></p>
</body></html>`;
}

function relatedHtml(current, all) {
  const related = all
    .filter(x => x.status === "live" && x.id !== current.id && x.category === current.category)
    .sort((x, y) => new Date(y.date) - new Date(x.date))
    .slice(0, 3);
  if (!related.length) return "";

  const cards = related.map(r => {
    const { display } = imageFor(r);
    const thumb = display
      ? `<img src="${display}" alt="${esc(r.title)}">`
      : `<span>${esc(r.emoji || "📰")}</span>`;
    return `<a class="related-card" href="${SITE_URL}/article/${encodeURIComponent(r.id)}">
      <div class="related-thumb">${thumb}</div>
      <div class="related-cat">${esc(r.category)}</div>
      <div class="related-title">${esc(r.title)}</div>
    </a>`;
  }).join("\n");

  return `
<section class="related">
  <h2>More in ${esc(current.category)}</h2>
  <div class="related-grid">
    ${cards}
  </div>
</section>`;
}

function articleHtml(a, allArticles) {
  const url = `${SITE_URL}/article/${encodeURIComponent(a.id)}`;
  const appUrl = `${SITE_URL}/#/article/${encodeURIComponent(a.id)}`;
  const { display, social } = imageFor(a);
  const body = Array.isArray(a.body) ? a.body : [String(a.body || "")];
  const bodyHtml = body.map((p, i) => {
    let out = `<p>${esc(p)}</p>`;
    if (i === 0 && a.pullquote) out += `<blockquote>${esc(a.pullquote)}</blockquote>`;
    return out;
  }).join("\n");

  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.title,
    description: a.dek,
    datePublished: a.date,
    dateModified: a.date,
    author: [{ "@type": "Person", name: a.author }],
    publisher: { "@type": "Organization", name: "The Toon Tribune", logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` } },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    articleSection: a.category,
    image: [social]
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(a.title)} — The Toon Tribune</title>
<meta name="description" content="${esc(a.dek || "")}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/png" href="${SITE_URL}/logo.png">

<meta property="og:type" content="article">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(a.dek || "")}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${social}">
<meta property="og:site_name" content="The Toon Tribune">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(a.title)}">
<meta name="twitter:description" content="${esc(a.dek || "")}">
<meta name="twitter:image" content="${social}">

<script type="application/ld+json">${JSON.stringify(ld)}</script>

<style>
  body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:0 auto;padding:28px 20px 90px;color:#1a1a1a;line-height:1.7;}
  a{color:#c0102a;}
  header{margin-bottom:28px;font-family:Arial,Helvetica,sans-serif;}
  header a{text-decoration:none;font-weight:800;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:#1a1a1a;}
  .cat{display:inline-block;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#c0102a;margin-bottom:10px;}
  h1{font-size:32px;line-height:1.25;margin:0 0 12px;}
  .dek{font-size:19px;color:#444;margin:0 0 16px;}
  .meta{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#777;margin-bottom:26px;padding-bottom:26px;border-bottom:1px solid #eaeaea;}
  img.hero{width:100%;height:auto;border-radius:6px;margin-bottom:26px;display:block;}
  p{margin:0 0 20px;font-size:18px;}
  blockquote{font-size:22px;font-style:italic;border-left:4px solid #c0102a;margin:24px 0;padding:4px 0 4px 18px;color:#333;}
  .app-link{display:inline-block;margin-top:36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;padding:11px 20px;background:#1a1a1a;color:#fff;border-radius:6px;text-decoration:none;}
  .related{margin-top:44px;padding-top:28px;border-top:1px solid #eaeaea;font-family:Arial,Helvetica,sans-serif;}
  .related h2{font-size:15px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#1a1a1a;margin:0 0 16px;}
  .related-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;}
  .related-card{display:block;text-decoration:none;color:inherit;border:1px solid #eaeaea;border-radius:8px;overflow:hidden;transition:border-color .15s;}
  .related-card:hover{border-color:#c0102a;}
  .related-thumb{width:100%;aspect-ratio:16/9;background:#f4f4f4;display:flex;align-items:center;justify-content:center;font-size:32px;overflow:hidden;}
  .related-thumb img{width:100%;height:100%;object-fit:cover;}
  .related-cat{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#c0102a;margin:10px 12px 4px;}
  .related-title{font-size:14.5px;font-weight:600;line-height:1.35;margin:0 12px 12px;color:#1a1a1a;}
</style>
</head>
<body>
<header><a href="${SITE_URL}/">← The Toon Tribune</a></header>
<article>
  <div class="cat">${esc(a.category)}</div>
  <h1>${esc(a.title)}</h1>
  <p class="dek">${esc(a.dek || "")}</p>
  <div class="meta">${esc(a.author)} · ${esc(a.date)}</div>
  ${display ? `<img class="hero" src="${display}" alt="${esc(a.title)}">` : ""}
  ${bodyHtml}
</article>
${relatedHtml(a, allArticles)}
<a class="app-link" href="${appUrl}">Open in the interactive app →</a>
</body>
</html>`;
}
