import glob
files = ['zelscan_dashboard.css','zelscan.css','zelscan_psychology.css','zelscan_behavior.css','zelscan_analysis.css','zelscan_activity.css']

# 1) .acc-pill .av -> add overflow:hidden;flex:0 0 auto (only report CSS lacks it)
acc_target = 'font-size:17px;box-shadow:inset 0 0 0 .41px rgba(255,255,255,.1);}'
acc_repl   = 'font-size:17px;overflow:hidden;flex:0 0 auto;box-shadow:inset 0 0 0 .41px rgba(255,255,255,.1);}'
# 2) .sb-user .av -> add overflow:hidden (all 6, already has flex:0 0 auto)
sb_target = 'font-size:18px;box-shadow:inset 0 0 0 .56px rgba(255,255,255,.1);flex:0 0 auto;}'
sb_repl   = 'font-size:18px;overflow:hidden;box-shadow:inset 0 0 0 .56px rgba(255,255,255,.1);flex:0 0 auto;}'

for f in files:
    p = f'assets/css/pages/{f}'
    s = open(p, encoding='utf-8').read()
    c = s
    if acc_target in c:
        c = c.replace(acc_target, acc_repl)
    if sb_target in c:
        c = c.replace(sb_target, sb_repl)
    open(p, 'w', encoding='utf-8').write(c)
    print(f, 'acc' if acc_target in s else '-', 'sb' if sb_target in s else '-')
