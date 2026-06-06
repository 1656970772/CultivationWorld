"""Verify anchor citations."""
import sqlite3
DB = r'E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\.storygraph\storygraph.db'

with sqlite3.connect(DB) as con:
    cur = con.cursor()
    # WX-WORLD-001: chunk 1, lines 16-153
    print('--- chunk 1 (lines 16-153) ---')
    r = cur.execute('SELECT ordinal, title, start_line, end_line FROM chunks WHERE ordinal = 1').fetchone()
    print(f"ordinal={r[0]} title={r[1]} lines={r[2]}-{r[3]}")

    # WX-WORLD-002: chunk 4, lines 338-425
    print('--- chunk 4 (lines 338-425) ---')
    r = cur.execute('SELECT ordinal, title, start_line, end_line FROM chunks WHERE ordinal = 4').fetchone()
    print(f"ordinal={r[0]} title={r[1]} lines={r[2]}-{r[3]}")

    # WX-REALM-001: chunk 1 - 淬体境
    print('--- 淬体境 chunks (first 3) ---')
    for r in cur.execute("SELECT ordinal, title, start_line, end_line FROM chunks WHERE text LIKE '%淬体境%' ORDER BY ordinal LIMIT 3").fetchall():
        print(f"ordinal={r[0]} title={r[1]} lines={r[2]}-{r[3]}")

    # WX-FLOW-006: chunk 541 (神识之火)
    print('--- chunk 541 (神识之火) ---')
    r = cur.execute('SELECT ordinal, title, start_line, end_line FROM chunks WHERE ordinal = 541').fetchone()
    print(f"ordinal={r[0]} title={r[1]} lines={r[2]}-{r[3]}")

    # WX-VIEW-010: chunk 2445 (大魔神)
    print('--- chunk 2445 (大魔神) ---')
    r = cur.execute('SELECT ordinal, title, start_line, end_line FROM chunks WHERE ordinal = 2445').fetchone()
    print(f"ordinal={r[0]} title={r[1]} lines={r[2]}-{r[3]}")
