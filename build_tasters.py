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
