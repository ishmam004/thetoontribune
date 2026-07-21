#!/usr/bin/env node
/**
 * generate-sitemap.js
 * ---------------------------------------------------------------------
 * Generates sitemap.xml for The Toon Tribune from whatever is currently
 * published in Supabase (the same "toon_tribune" key/value table the
 * site itself reads from).
 *
 * USAGE
 *   node generate-sitemap.js
 *   -> writes sitemap.xml in the current folder
 *
 * SETUP
 *   npm install @supabase/supabase-js
 *   Fill in SUPABASE_URL / SUPABASE_ANON_KEY / SITE_URL below (or set
 *   them as environment variables — see the bottom of this file).
 *
 * WHEN TO RE-RUN
 *   Any time you publish, unpublish, or delete a story in the Newsroom.
 *   For a fully automatic setup, run this on a schedule (cron / GitHub
 *   Action / Supabase Edge Function on a timer) and upload the result
 *   next to index.html.
 *
 * NOTE ON URLS
 * ---------------------------------------------------------------------
 * Article pages now use a real, crawlable path — /article/:id — served
 * by the api/article.js Vercel function (see vercel.json for the
 * rewrite). That's what this sitemap lists for articles, so Google can
 * index each story on its own.
 *
 * Category pages still use the SPA's hash router (#/category/...) and
 * are NOT separately indexable — they're included below only as a
 * discovery hint, not something to rely on for ranking. If category
 * pages ever need to rank individually, they'd need the same real-path
 * treatment as articles.
 * ---------------------------------------------------------------------
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

// ---- fill these in (must match supabaseConfig in index.html) ----
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qifucrphtikymxevtwcn.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_SIc3LKDwkWp7nWiZGOLKsg_HpKqbxD1";
const SITE_URL = (process.env.SITE_URL || "https://toon-tribune.vercel.app").replace(/\/$/, "");
const SB_TABLE = "toon_tribune";
const OUTPUT_FILE = "sitemap.xml";

const CATEGORIES = ["National","International","Sports","Media","Research","Entertainment","Technology","Politics"];

async function main(){
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await db.from(SB_TABLE).select("value").eq("key", "ttArticles").maybeSingle();
  if(error){
    console.error("Couldn't reach Supabase:", error.message);
    process.exit(1);
  }

  let articles = [];
  if(data && data.value){
    try{ articles = JSON.parse(data.value); }
    catch(e){ console.error("Couldn't parse article data from Supabase:", e.message); process.exit(1); }
  } else {
    console.warn("No articles found in Supabase yet — writing a sitemap with just the homepage.");
  }

  const live = articles.filter(a => a.status === "live");

  const urls = [];

  // Homepage — the one URL that's reliably indexable given hash routing.
  urls.push({ loc: SITE_URL + "/", lastmod: today(), priority: "1.0" });

  // Category pages (see caveat above — hash fragments, discovery hint only).
  CATEGORIES.forEach(cat => {
    if(live.some(a => a.category === cat)){
      urls.push({ loc: `${SITE_URL}/#/category/${encodeURIComponent(cat)}`, priority: "0.6" });
    }
  });

  // Article pages — now served as real, crawlable HTML via the
  // /article/:id Vercel serverless function (see api/article.js and
  // vercel.json). These are indexable on their own, unlike the old
  // #/article/... hash links.
  live
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .forEach(a => {
      urls.push({
        loc: `${SITE_URL}/article/${encodeURIComponent(a.id)}`,
        lastmod: a.date,
        priority: a.featured ? "0.9" : "0.7"
      });
    });

  const xml = buildXml(urls);
  fs.writeFileSync(OUTPUT_FILE, xml, "utf8");
  console.log(`Wrote ${OUTPUT_FILE} with ${urls.length} URLs (${live.length} live articles).`);
}

function today(){
  return new Date().toISOString().slice(0,10);
}

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" }[c]));
}

function buildXml(urls){
  const body = urls.map(u => `  <url>
    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
    <priority>${u.priority}</priority>
  </url>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

main();
