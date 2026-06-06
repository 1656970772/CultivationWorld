"""Helper script to query 武炼巅峰 storygraph.db."""
import sqlite3
import sys

DB = r'E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\.storygraph\storygraph.db'


def list_tables():
    with sqlite3.connect(DB) as con:
        cur = con.cursor()
        print("=== TABLES ===")
        for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            print(r[0])
        print("=== COUNTS ===")
        for tbl in ['chunks', 'story_nodes', 'story_edges']:
            try:
                cnt = cur.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
                print(f"{tbl}: {cnt}")
            except Exception as e:
                print(f"{tbl}: ERR {e}")


def search_chunks(keyword: str, limit: int = 5, offset: int = 0):
    """Find chunks containing keyword. Returns (ordinal, title, start_line, end_line, text)."""
    with sqlite3.connect(DB) as con:
        cur = con.cursor()
        q = """SELECT ordinal, title, start_line, end_line, text
               FROM chunks
               WHERE text LIKE ?
               ORDER BY ordinal
               LIMIT ? OFFSET ?"""
        rows = cur.execute(q, (f'%{keyword}%', limit, offset)).fetchall()
        for r in rows:
            print(f"--- chunk {r[0]} (lines {r[2]}-{r[3]}) [{r[1]}] ---")
            # show only first 600 chars
            txt = r[4] if r[4] else ''
            print(txt[:600])
            print()


def chunk_count(keyword: str) -> int:
    with sqlite3.connect(DB) as con:
        cur = con.cursor()
        return cur.execute("SELECT COUNT(*) FROM chunks WHERE text LIKE ?", (f'%{keyword}%',)).fetchone()[0]


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'tables'
    if cmd == 'tables':
        list_tables()
    elif cmd == 'count':
        kw = sys.argv[2]
        print(f"count({kw!r}) = {chunk_count(kw)}")
    elif cmd == 'search':
        kw = sys.argv[2]
        lim = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        off = int(sys.argv[4]) if len(sys.argv) > 4 else 0
        search_chunks(kw, lim, off)
    elif cmd == 'ranges':
        """Show line range of each chunk containing keyword."""
        kw = sys.argv[2]
        with sqlite3.connect(DB) as con:
            cur = con.cursor()
            for r in cur.execute(
                "SELECT ordinal, title, start_line, end_line FROM chunks WHERE text LIKE ? ORDER BY ordinal LIMIT 30",
                (f'%{kw}%',)
            ).fetchall():
                print(r)
