"""Verify 玄界珠 facts."""
import sqlite3
DB = r'E:\AI_Projects\CultivationWorld\docs\世界观参考\武炼巅峰\.storygraph\storygraph.db'

with sqlite3.connect(DB) as con:
    cur = con.cursor()
    # Verify 玄界珠 facts
    for ord_ in [1340, 1341, 1342]:
        r = cur.execute("SELECT text FROM chunks WHERE ordinal=? AND title LIKE '第%'", (ord_,)).fetchone()
        if r:
            if '帝宝二珠' in r[0]:
                idx = r[0].find('帝宝二珠')
                print(f"chunk {ord_}: 帝宝二珠 found at pos {idx}:")
                print(r[0][max(0,idx-30):idx+100])
                print('---')

    # Check 墨族 in chunk 3368-3370
    for ord_ in [3368, 3369, 3370]:
        r = cur.execute("SELECT text FROM chunks WHERE ordinal=? AND title LIKE '第%'", (ord_,)).fetchone()
        if r:
            for kw in ['墨族', '墨虫', '上品开天', '七品']:
                if kw in r[0]:
                    idx = r[0].find(kw)
                    print(f"chunk {ord_}: '{kw}' at pos {idx}:")
                    print(r[0][max(0,idx-30):idx+100])
                    print('---')
