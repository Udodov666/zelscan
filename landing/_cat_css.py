import io, os
files = [
"assets/css/pages/zelscan_psychology.css",
"assets/css/report-hero.css",
"assets/css/account-ui.css",
"assets/css/responsive.css",
"assets/css/report-shared.css",
"assets/css/menu-v8.css",
"assets/css/sidebar-lab.css",
"assets/css/order-modals.css",
"assets/css/zs-notice.css",
"assets/css/header-logo.css",
"assets/css/loading.css",
]
base = os.path.dirname(os.path.abspath(__file__))
total = 0
with io.open(os.path.join(base,"_css_bundle.css"),"w",encoding="utf-8") as out:
    for f in files:
        p = os.path.join(base, f.replace("/", os.sep))
        with io.open(p,"r",encoding="utf-8") as fh:
            c = fh.read()
        out.write("\n/* ===== %s ===== */\n" % f)
        out.write(c)
        total += len(c)
        print("OK", f, len(c))
print("TOTAL", total)
