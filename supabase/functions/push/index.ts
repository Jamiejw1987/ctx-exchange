// Sends phone/desktop push notifications for the Exchange.
// Called by the database (notification trigger) with a shared secret; never by the app.
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE, PUSH_SECRET (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are built in).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

webpush.setVapidDetails("mailto:jamie@consumer-talent.com", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET")) return new Response("no", { status: 401 });
  const { user_ids, title, body, url, tag } = await req.json();
  if (!Array.isArray(user_ids) || !user_ids.length) return Response.json({ sent: 0 });
  const { data: subs } = await db.from("push_subs").select("id,sub").in("user_id", user_ids);
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 86400 }); sent++; }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await db.from("push_subs").delete().eq("id", s.id); }
  }));
  return Response.json({ sent, of: (subs || []).length });
});
