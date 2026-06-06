"""Check chunks structure."""
import sqlite3
DB = r'E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\.storygraph\storygraph.db'

with sqlite3.connect(DB) as con:
    cur = con.cursor()
    # Get schema of chunks
    print('--- chunks schema ---')
    for r in cur.execute("PRAGMA table_info(chunks)").fetchall():
        print(r)

    # Get chunks 1-10
    print('--- chunks 1 to 10 ---')
    for r in cur.execute('SELECT ordinal, title, start_line, end_line, length(text) FROM chunks WHERE ordinal BETWEEN 1 AND 10 ORDER BY ordinal').fetchall():
        print(f"ordinal={r[0]} title={r[1][:50]} lines={r[2]}-{r[3]} text_len={r[4]}")

    # Get 黑书/傲骨金身 chunks
    print('--- chunks where title like 黑书 or 傲骨金身 ---')
    q = "SELECT ordinal, title, start_line, end_line, length(text) FROM chunks WHERE title LIKE ? OR title LIKE ? ORDER BY ordinal"
    for r in cur.execute(q, ('%黑书%', '%傲骨金身%')).fetchall():
        print(f"ordinal={r[0]} title={r[1][:50]} lines={r[2]}-{r[3]} text_len={r[4]}")

    # Check story_nodes (the noisy table)
    print('--- story_nodes (first 5) ---')
    for r in cur.execute("SELECT * FROM story_nodes LIMIT 5").fetchall():
        print(r[:6])

    # Total count
    print('--- counts ---')
    for tbl in ['chunks', 'story_nodes', 'story_edges']:
        cnt = cur.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
        print(f"{tbl}: {cnt}")
