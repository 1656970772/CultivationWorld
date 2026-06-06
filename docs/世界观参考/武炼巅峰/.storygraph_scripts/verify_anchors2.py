"""Verify anchor citations more carefully."""
import sqlite3
DB = r'E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\.storygraph\storygraph.db'

with sqlite3.connect(DB) as con:
    cur = con.cursor()
    # Filter to only novel chapter chunks (title contains '第' but not '《')
    print('--- novel chapter chunks (filter by title) ---')
    q = "SELECT ordinal, title, start_line, end_line FROM chunks WHERE title LIKE '第%章%' AND ordinal IN (1, 4, 5, 7, 8, 32, 44, 71, 81, 83, 199, 514, 541, 556, 588, 830, 865, 902, 1157, 1169, 1340, 1341, 1342, 1631, 1632, 1642, 1823, 1825, 2111, 2112, 2158, 2160, 2445, 2546, 2549, 2819) ORDER BY ordinal"
    for r in cur.execute(q).fetchall():
        print(f"ordinal={r[0]} title={r[1][:40]} lines={r[2]}-{r[3]}")

    # Check 淬体境 evidence anchor
    print('--- 淬体境 in chunk 1 (first 1000 chars) ---')
    r = cur.execute("SELECT text FROM chunks WHERE ordinal=1 AND title LIKE '第%'").fetchone()
    if r:
        text = r[0]
        if '淬体' in text:
            idx = text.find('淬体')
            print(f"淬体 found at position {idx}")
            print(text[max(0,idx-50):idx+200])
        else:
            print("淬体 NOT in chunk 1")
            print("First 500 chars:")
            print(text[:500])
