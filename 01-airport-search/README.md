# 01 · Airport Search — 四种检索方式，同一个问题

> 同一个查询词，分别用 `LIKE`、全文检索、向量检索、以及三者融合去查同一张表，
> 把四份结果并排放在一起看。数据集是 OpenFlights 机场库。

**核心结论不是「向量检索更好」，而是：四种方式各有一类查询会把它打穿，
而它们的失败模式互不重叠 —— 所以真正能用的是融合，而融合需要它们在同一个数据库里。**

---

## 30 秒看到东西

```bash
python3 scripts/dev_server.py 8137
```

打开 http://localhost:8137 。不需要数据库、不需要 API key、不需要构建。
页面自带 107 个真实机场（真实经纬度）和 116 条真实航线，四种检索全部在浏览器里跑。

直接点页面上的预设查询，看四列结果怎么分道扬镳：

| 预设查询 | `LIKE` | 全文 | 向量 | 说明 |
|---|:--:|:--:|:--:|---|
| `Heathrow` | ✅ | ✅ | ✅ | 基线：名字写得一模一样时，谁都行 |
| `heathrwo airprot` | ❌ 0 条 | ❌ 0 条 | ✅ LHR | 两个词都拼错，字面和分词双双归零 |
| `首都机场` | ❌ 0 条 | ❌ 0 条 | ✅ PEK | 数据是英文的，只有 embedding 跨得过去 |
| `airport near Silicon Valley` | ❌ 0 条 | ⚠️ 全是噪音 | ✅ SFO SJC | 没有任何一行数据里写着 Silicon Valley |
| `JFK` | ✅ 精确 | ✅ | ⚠️ 一般 | **反过来**：三字母代码上关键词完胜向量 |
| `highest airport in the Andes` | ❌ | ⚠️ | ✅ LPB | 要同时理解「最高」和「安第斯」 |

`⚠️ 全是噪音` 是页面里能直接看到的一件事：BM25 对
`airport near Silicon Valley` 会返回 10 条结果 —— 因为每一行都含有 `airport` 这个词。
页面会把这些低于置信门限的结果打灰，并在融合阶段全部丢弃。

---

## 四种方式，各自的边界

### 1 · `LIKE` — 子串扫描

```sql
WHERE name LIKE '%heathrow%' OR city LIKE '%heathrow%' OR iata = 'LHR'
```

**行**：三字母代码、前缀、你确定用户会一字不差打出来的东西。
**不行**：词序（`heathrow london`）、错字、同义词、别的语言。
**还有**：它不给你相关性。所有命中行的"相关度"完全相同，排序只能自己编一个
`CASE`。页面里 `london` 这个查询能看到——三个伦敦机场，`LIKE` 分不出哪个更重要。
**代价**：前导通配符用不了索引，这是全表扫描。7 千行无所谓，7 千万行是灾难。

### 2 · 全文检索 — 分词 + BM25

```sql
WHERE FTS_MATCH_WORD('heathrow london', doc)
ORDER BY FTS_MATCH_WORD('heathrow london', doc) DESC
```

**行**：词序无关、真正的相关性打分、停用词、CJK 分词。
**不行**：它匹配的仍然是**词**。错字是另一个词，同义词是另一个词，
描述性的问法（"硅谷附近的机场"）里没有一个词出现在数据里。
**代价**：倒排索引，次线性。

### 3 · 向量检索 — 语义相似度

```sql
ORDER BY VEC_COSINE_DISTANCE(doc_vec, @query_embedding) LIMIT 10
```

**行**：意思。错字、改写、跨语言、用描述代替名字。
**不行**：短而不透明的 token。`JFK` 的 embedding 离一堆无关机场都很近。
更关键的是——**它没有「没找到」这个概念**，永远返回 k 条，
哪怕最好的那条其实毫不相关。页面里搜 `Heathrow` 时，向量列第 2 到第 10 条
就是这种填充噪音。
**代价**：HNSW 索引，跑在列存副本上。

### 4 · 融合 — Reciprocal Rank Fusion

```
rrf(d) = Σ over retrievers r:   weight_r / (k + rank_r(d))       k = 60
```

RRF 融合的是**名次**不是分数，所以你不需要把 BM25 分数、余弦相似度、
和一个手写的 `CASE` 表达式归一化到同一个尺度上——这件事在实践中很难做对。

但纯 RRF 有个真实的弱点：它完全无视分数大小，
**一个什么都没找到的检索器，照样能用它排第一的垃圾投票**。
所以融合之前要过一道分数门限（`engine.js` 里的 `GATE`，页面上打灰的那些行就是被它拦下的）：

```js
GATE = {
  vector: 0.58,       // 余弦相似度绝对下限
  fulltextRel: 0.12,  // 本次查询最高 BM25 分的比例
  fulltextAbs: 0.30,  // 绝对下限：只匹配上 "airport" 不算匹配
}
```

完整的融合 SQL 在 [`sql/02_queries.sql`](sql/02_queries.sql) —— 一条语句，一次往返，
一个一致性快照。

---

## 跑真的 TiDB

页面每次加载会探测 `/api/health`。探测到后端就自动切到真实 TiDB（右上角
`OFFLINE SAMPLE` 会变成绿色的 `LIVE TiDB · N airports`），此时向量列是真的
`VEC_COSINE_DISTANCE`，不再是模拟。

```bash
pip install -r requirements.txt
cp .env.example .env      # 填 TiDB Cloud 连接串 + 一个 OpenAI 兼容的 embedding endpoint

mysql --comments < sql/01_schema.sql        # 或者贴进 TiDB Cloud SQL Editor
python -m scripts.load_data --limit 1500    # 先小规模跑一遍，几分钱
uvicorn app.main:app --port 8000
open http://localhost:8000
```

`--limit` 会按航线度数排序后截断，所以小规模跑到的都是真正有人搜的大机场。
全量 7,698 个机场用 `text-embedding-3-small` 大约几美分。

**版本要求**：全文检索（`FTS_MATCH_WORD` / `WITH PARSER MULTILINGUAL`）目前在
TiDB Cloud Starter / Essential 上可用；向量索引需要表有 TiFlash 副本
（`sql/01_schema.sql` 里已经带了 `ALTER TABLE ... SET TIFLASH REPLICA 1`）。
Dedicated 集群请先确认版本。

---

## 关于离线模式的诚实说明

浏览器里跑不了 embedding 模型。所以离线样本里：

- **`LIKE` 是真的** —— 和 SQL 里的子串语义一模一样。
- **全文是真的** —— `engine.js` 里是一份完整的 BM25 实现，跑在和 TiDB 里
  `FULLTEXT INDEX` 完全相同的 `doc` 字段上。
- **RRF 是真的** —— 和 SQL 版本是同一套算术。
- **向量是模拟的** —— 用概念标签 + 三元组模糊匹配去复现 embedding 的**行为**
  （容错、跨语言、改写理解），让对比有意义，但它不是真的 embedding。
  数据里 `tags` / `aliases` 两个字段只服务于这个模拟，连上真实 TiDB 后完全不用。

模拟的边界在页面上也看得见：搜 `airport near Silicon Valley` 时
墨西哥城（MEX）会挤进结果——因为它的描述里有 "valley of mexico"。
真实 embedding 一般不会犯这个错，但这种**语义近邻的误伤**本身就是向量检索的
典型失败模式，留着反而有用。

---

## 数据模型

一张表同时是关系表、倒排索引和向量索引：

```sql
CREATE TABLE airports (
    id       INT PRIMARY KEY,
    name     VARCHAR(255),
    lat      DOUBLE,  lon DOUBLE,  alt_ft INT,     -- 关系
    doc      TEXT,                                 -- 全文
    doc_vec  VECTOR(1536),                         -- 向量
    FULLTEXT INDEX ft_doc (doc) WITH PARSER MULTILINGUAL,
    VECTOR INDEX idx_doc_vec ((VEC_COSINE_DISTANCE(doc_vec)))
);
```

`doc` 是唯一的检索文档，全文索引和 embedding 看到的是同一份文本——
这样两者的差异才纯粹来自**匹配方式**，而不是喂了不同的数据。
构造逻辑见 [`scripts/load_data.py`](scripts/load_data.py) 里的 `build_doc()`。

顺带一提，这是向量数据库做不到的那一类查询——语义检索 + 关系过滤 + JOIN，
一条语句，事务一致：

```sql
SELECT a.name, a.alt_ft, COUNT(r.id) AS out_routes
FROM airports a JOIN routes r ON r.src_iata = a.iata
WHERE a.alt_ft > 8000                             -- 关系过滤
GROUP BY a.id HAVING out_routes > 50              -- 聚合
ORDER BY VEC_COSINE_DISTANCE(a.doc_vec, @qv)      -- 语义排序
LIMIT 10;
```

---

## 文件

```
sql/01_schema.sql        建表：关系 + 全文索引 + 向量索引
sql/02_queries.sql       四种检索的 SQL 原文，逐条带注释 ← 想看重点看这个
scripts/load_data.py     下载 OpenFlights、构造 doc、批量 embedding、写入
scripts/dev_server.py    不带缓存的静态服务器
scripts/build_outlines.py 重新生成 web/js/world.js（只依赖标准库）
app/search.py            四个检索函数 + RRF 融合（Python 侧）
app/main.py              FastAPI：/api/search、/api/airports、静态页面
web/index.html           页面
web/js/data.js           离线样本：107 个机场 + 116 条航线 + 预设查询
web/js/engine.js         浏览器里的四个检索器（BM25 真实、向量模拟）
web/js/world.js          国家轮廓：Natural Earth 110m，离线简化过（6.6k 点 / 83KB）
web/js/globe.js          three.js 地球；three.js 加载失败时降级到等距圆柱 2D canvas
web/js/app.js            UI
```

## 关于那个地球

- **大陆轮廓**是 Natural Earth 1:110m 国界，用 Douglas-Peucker（eps 0.2°）离线简化到
  6.6k 个点、83KB，直接编进 `web/js/world.js`——不在运行时拉 CDN，所以断网也能看。
  简化之后还做了一次「加密」：把过长的线段重新打点，否则它在球面上会变成一条穿过球体的弦。
- **机场点**按 hub / large / regional 分成三层，hub 那层的点会随时间轻微呼吸。
- **航班**是沿真实航线曲线跑的彗星：一个亮头 + 14 段渐隐拖尾，用逐顶点颜色做 alpha
  （加法混合下，颜色变暗就等于变透明）。
- **选中机场**会被转到正对镜头的正中央，同时把它的进出港航线一条条画出来
  （`setDrawRange` 逐帧推进），并挂一个 HUD 标签。
  居中用的是绕 Y 转到方位角 0、再绕 X 抬起 `lat` —— three.js 的 XYZ 欧拉序是先 Y 后 X，
  所以 Y 要取方位角的**负值**。
- 补间用的是按时间的指数平滑（`1 - exp(-dt·7.5)`），不是每帧固定比例，
  这样 30fps 和 144fps 下的动画时长一致。

## 数据来源

- [OpenFlights](https://github.com/jpatokal/openflights)（airports.dat / routes.dat，ODbL）。
  `web/js/data.js` 里的 107 个机场是从中挑出的子集，另外手工加了 `tags` / `aliases`
  两个字段专供离线模拟使用。
- [Natural Earth](https://www.naturalearthdata.com/) 1:110m admin-0（public domain），
  简化后即 `web/js/world.js`。
