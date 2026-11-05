"""Builds the client/ and professionals/ taster pages from index.html.
Run after any change to app.html:  python3 build_tasters.py"""
import json, os
src = open("app.html", encoding="utf8").read()
taster_line = next(l for l in src.splitlines() if l.startswith("const TASTER="))
base = json.load(open("manifest.webmanifest"))
for folder, side, name in [("client", "client", "CTX for hiring teams"), ("professionals", "candidate", "CTX for professionals")]:
    s = src.replace(taster_line, f'const TASTER="{side}";')
    for a, b in [('href="icon-180.png"', 'href="../icon-180.png"'),
                 ('href="icon-192.png"', 'href="../icon-192.png"'),
                 ('serviceWorker.register("sw.js")', 'serviceWorker.register("../sw.js")')]:
        assert s.count(a) == 1, a
        s = s.replace(a, b)
    os.makedirs(folder, exist_ok=True)
    open(f"{folder}/index.html", "w", encoding="utf8").write(s)
    m = dict(base, name=name, start_url="./", scope="./",
             icons=[dict(i, src="../" + i["src"]) for i in base["icons"]])
    json.dump(m, open(f"{folder}/manifest.webmanifest", "w"), indent=2)
    print("built", folder)

# ---- live app: real accounts and data on Supabase ----
live = src.replace(taster_line, "const TASTER=null;")
for a, b in [('href="icon-180.png"', 'href="../icon-180.png"'),
             ('href="icon-192.png"', 'href="../icon-192.png"'),
             ('serviceWorker.register("sw.js")', 'serviceWorker.register("../sw.js")'),
             ('<meta name="apple-mobile-web-app-title" content="CTX">', '<meta name="apple-mobile-web-app-title" content="CTX Exchange">'),
             ('<title>Consumer Talent Exchange</title>', '<title>Sign in · Consumer Talent Exchange</title>\n<meta name="description" content="Sign in or join the Consumer Talent Exchange, the private exchange for senior food and drink talent.">\n<meta property="og:title" content="Consumer Talent Exchange">\n<meta property="og:description" content="Sign in or join the private exchange for senior food and drink talent. Now open.">\n<meta property="og:image" content="https://exchange.consumer-talent.com/og-image.png">\n<meta name="twitter:card" content="summary_large_image">'),
             ('\n<script>\nconst SC=', '\n<script src="../supabase-js.min.js"></script>\n<script>window.CTX_LIVE=true</script>\n<script>\nconst SC='),
             ('</script>\n\n<script>if("serviceWorker"', '</script>\n<script>\n' + open("live.js", encoding="utf8").read() + '\n</script>\n\n<script>if("serviceWorker"')]:
    assert live.count(a) == 1, a
    live = live.replace(a, b)
os.makedirs("exchange", exist_ok=True)
open("exchange/index.html", "w", encoding="utf8").write(live)
json.dump(dict(base, name="Consumer Talent Exchange", start_url="./", scope="./", icons=[dict(i, src="../" + i["src"]) for i in base["icons"]]), open("exchange/manifest.webmanifest", "w"), indent=2)
print("built exchange (live)")
