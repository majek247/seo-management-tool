import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_FAILS = 3;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const bare = (h: string) => h.replace(/^www\./, "").toLowerCase();
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

type Outcome =
  | { kind: "live"; rel: string; anchor: string; code: number; relRaw: string }
  | { kind: "changed"; rel: string; anchor: string; code: number; relRaw: string }
  | { kind: "missing"; code: number }
  | { kind: "recheck"; code: number };

async function check(p: any, domain: string): Promise<Outcome> {
  let url = (p.source_url || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GrowUpLinkChecker/1.0)",
        Accept: "text/html",
      },
    });
  } catch {
    return { kind: "recheck", code: 0 };
  } finally {
    clearTimeout(timer);
  }

  const code = res.status;
  if (code === 404 || code === 410) return { kind: "missing", code };
  if (!res.ok) return { kind: "recheck", code };

  const html = await res.text();
  const anchors = [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)];

  // Page with almost no links is probably rendered by JavaScript
  if (anchors.length < 3) return { kind: "recheck", code };

  const hits: { path: string; rel: string; anchor: string }[] = [];
  for (const m of anchors) {
    const href = m[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let u: URL;
    try { u = new URL(href, res.url); } catch { continue; }
    if (bare(u.hostname) !== bare(domain) && !bare(u.hostname).endsWith("." + bare(domain))) continue;
    hits.push({
      path: trimSlash(u.pathname),
      rel: (m[1].match(/rel\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase(),
      anchor: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200),
    });
  }

  if (!hits.length) return { kind: "missing", code };

  // Work out the expected path
  let want: string | null = null;
  if (p.destination) {
    try {
      want = trimSlash(
        p.destination.startsWith("/") ? p.destination : new URL(p.destination).pathname,
      );
    } catch { want = null; }
  }

  const match = want ? hits.find((h) => h.path === want) : hits[0];
  const chosen = match || hits[0];
  const rel = /nofollow|sponsored|ugc/.test(chosen.rel) ? "Nofollow" : "Follow";
  const out = { rel, anchor: chosen.anchor, code, relRaw: chosen.rel };
  return match ? { kind: "live", ...out } : { kind: "changed", ...out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let clientId: string | null = null;
  try { clientId = (await req.json()).client_id ?? null; } catch { /* cron call, no body */ }

  const { data: settings } = await sb.from("authority_settings").select("client_id, client_domain");
  const domains: Record<string, string> = {};
  (settings || []).forEach((s: any) => { if (s.client_domain) domains[s.client_id] = s.client_domain; });

  let q = sb.from("authority_placements").select("*").neq("rel", "No link").not("source_url", "is", null);
  if (clientId) q = q.eq("client_id", clientId);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });

  const summary = { checked: 0, live: 0, changed: 0, missing: 0, recheck: 0, skipped: 0 };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (let i = 0; i < (rows || []).length; i += 5) {
    await Promise.all((rows as any[]).slice(i, i + 5).map(async (p) => {
      const domain = domains[p.client_id];
      if (!domain) { summary.skipped++; return; }

      const r = await check(p, domain);
      summary.checked++;
      const upd: any = {
        last_http_status: r.code,
        last_checked: today,
        last_checked_at: now.toISOString(),
      };

      if (r.kind === "live" || r.kind === "changed") {
        upd.fail_count = 0;
        upd.rel = r.rel;
        upd.rel_raw = r.relRaw;
        upd.anchor = r.anchor || p.anchor;
        upd.status = r.kind === "live" ? "Live" : "Destination changed";
        summary[r.kind === "live" ? "live" : "changed"]++;
      } else {
        const fails = (p.fail_count || 0) + 1;
        upd.fail_count = fails;
        if (r.kind === "missing" && fails >= MAX_FAILS) {
          upd.status = "Link missing";
          summary.missing++;
        } else {
          upd.status = "Needs recheck";
          summary.recheck++;
        }
      }
      await sb.from("authority_placements").update(upd).eq("id", p.id);
    }));
  }

  return new Response(JSON.stringify(summary), { headers: { ...CORS, "Content-Type": "application/json" } });
});