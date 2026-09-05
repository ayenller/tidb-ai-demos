/* =====================================================================
 *  i18n.js — UI strings for en / zh / pt / es.
 *
 *  The preset QUERIES are localised too, not just their labels: asking
 *  "aeroporto mais alto dos Andes" is a different test from asking it in
 *  English, and it is the test a Portuguese speaker actually cares about.
 *  The dataset stays in English throughout — that is the whole point of
 *  the cross-language row.
 *
 *  SQL stays in English: it is code, and it is character-for-character
 *  the same SQL that sits in sql/02_queries.sql.
 * ===================================================================== */
const I18N = {

  // ------------------------------------------------------------------ EN
  en: {
    name: "English",
    title: "Airport Search · four ways to retrieve",
    subtitle: "One query, four different paths: LIKE / full-text / vector / fusion — all on one TiDB table",
    offline: "Offline sample",
    live: (n) => `Live TiDB · ${n} airports`,
    globeTitle: "Global airport network",
    hub: "hub", large: "large", regional: "regional",
    globeHint: "drag to spin · scroll to zoom · hover to inspect",
    placeholder: "Search airports — by name, city, IATA code, or just describe what you want…",
    search: "Search",
    compare: "Compare",
    hits: "hits",
    lowConf: (n) => `(+${n} low confidence)`,
    onlyVector: (l) => `Only semantic search found: ${l}`,
    onlyLexical: (l) => `Only keyword search found: ${l}`,
    allAgree: "All three land on the same rows — any of them would do for this query.",
    sqlSummary: "The SQL that actually runs",
    emptyTitle: "Nothing matched at all.",
    emptyLike: "No row contains that string, literally.",
    emptyOther: "Not one word of the query is in the index.",
    gateAllBelow: "⚠ Every result is below the confidence gate — they only matched a word like <code>airport</code> that every row contains. All of them are dropped before fusion.",
    why: {
      code: "exact code match", inName: "substring in name",
      inCity: "substring in city", inCountry: "substring in country",
      bm25: (t) => `matched ${t}`,
      concept: (p) => `concept “${p}”`,
      fuzzy: (v) => `fuzzy ~${v}`,
      neighbour: "semantic neighbourhood",
    },
    cols: {
      like:     { blurb: "Substring scan.", note: "Exact, explainable, zero dependencies — but blind to word order, spelling and synonyms, and no index can serve it." },
      fulltext: { blurb: "Tokenised BM25.", note: "Word order stops mattering and you get real relevance ranking — but it still matches words, and a typo is a different word." },
      vector:   { blurb: "Cosine on embeddings.", note: "Understands meaning, survives typos, crosses languages — but always returns k rows, so it has no way to say “nothing here”." },
      hybrid:   { blurb: "Rank fusion of all three, one SQL statement.", note: "Each retriever covers what the others miss: keywords for precision, vectors for meaning, RRF to merge them." },
    },
    presets: [
      { id: "exact",       q: "Heathrow",                                 label: "Exact name",   hint: "All four agree — this is the baseline." },
      { id: "typo",        q: "heathrwo airprot",                         label: "Typo",         hint: "Both words misspelled: LIKE and full-text both return zero." },
      { id: "crossLang",   q: "首都机场",                                   label: "Another language", hint: "The data is English, the question is Chinese — only the embedding crosses over." },
      { id: "descriptive", q: "airport near Silicon Valley",              label: "Descriptive",  hint: "Not one row anywhere contains the words “Silicon Valley”." },
      { id: "code",        q: "JFK",                                      label: "IATA code",    hint: "The other way round: on a three-letter code, keywords beat the vector." },
      { id: "concept",     q: "windy airport with a difficult landing",   label: "Concept",      hint: "Asks for a feeling, not a name." },
      { id: "reasoning",   q: "highest airport in the Andes",             label: "Common sense", hint: "Has to understand “highest” and “Andes” at the same time." },
      { id: "ambiguous",   q: "london",                                   label: "Ambiguous",    hint: "Three London airports — watch how differently they get ranked." },
    ],
  },

  // ------------------------------------------------------------------ ZH
  zh: {
    name: "中文",
    title: "Airport Search · 四种检索方式",
    subtitle: "同一个查询，四条不同的路：LIKE / 全文 / 向量 / 融合 — 全部跑在一张 TiDB 表上",
    offline: "离线样本",
    live: (n) => `已连接 TiDB · ${n} 个机场`,
    globeTitle: "全球机场网络",
    hub: "枢纽", large: "大型", regional: "支线",
    globeHint: "拖动旋转 · 滚轮缩放 · 悬停查看",
    placeholder: "搜索机场：名称、城市、IATA 代码，或者直接描述你想找什么…",
    search: "搜索",
    compare: "对比",
    hits: "命中",
    lowConf: (n) => `(+${n} 低置信)`,
    onlyVector: (l) => `只有语义检索找到：${l}`,
    onlyLexical: (l) => `只有关键词找到：${l}`,
    allAgree: "三种方式命中同一批结果 — 这类查询用哪种都行。",
    sqlSummary: "实际执行的 SQL",
    emptyTitle: "没有任何一行命中。",
    emptyLike: "字面上不包含这串字符。",
    emptyOther: "查询里的词一个都不在索引里。",
    gateAllBelow: "⚠ 全部结果都低于置信门限 — 只匹配上 <code>airport</code> 这种到处都有的词。融合时全部丢弃。",
    why: {
      code: "代码精确匹配", inName: "名称中的子串",
      inCity: "城市名中的子串", inCountry: "国家名中的子串",
      bm25: (t) => `命中词 ${t}`,
      concept: (p) => `概念「${p}」`,
      fuzzy: (v) => `模糊 ~${v}`,
      neighbour: "语义邻域",
    },
    cols: {
      like:     { blurb: "子串扫描。", note: "精确、可解释、零依赖 — 但不认识词序、拼写和同义词，而且用不了索引。" },
      fulltext: { blurb: "分词 + BM25。", note: "词序无关、有真正的相关性排序 — 但匹配的仍然是「词」，错字就是另一个词。" },
      vector:   { blurb: "embedding 余弦距离。", note: "理解语义、容错、跨语言 — 但永远返回 k 条，没有「没找到」这个概念。" },
      hybrid:   { blurb: "三路名次融合，一条 SQL。", note: "用别人的长处补自己的短处：关键词负责精确，向量负责理解，RRF 负责合并。" },
    },
    presets: [
      { id: "exact",       q: "Heathrow",              label: "精确名称",  hint: "四种方式都能命中 — 基线" },
      { id: "typo",        q: "heathrwo airprot",      label: "拼写错误",  hint: "两个词都拼错 — LIKE 和全文双双归零" },
      { id: "crossLang",   q: "首都机场",               label: "跨语言",    hint: "数据是英文的，中文提问只有向量跨得过去" },
      { id: "descriptive", q: "硅谷附近的机场",          label: "描述式",    hint: "没有一行数据里写着「硅谷」" },
      { id: "code",        q: "JFK",                   label: "IATA 代码", hint: "反过来：三字母代码上关键词完胜向量" },
      { id: "concept",     q: "风大、着陆困难的机场",     label: "概念检索",  hint: "问的是感觉，不是名字" },
      { id: "reasoning",   q: "安第斯山脉海拔最高的机场",  label: "常识推理",  hint: "要同时懂「最高」和「安第斯」" },
      { id: "ambiguous",   q: "伦敦",                   label: "多义词",    hint: "三个伦敦机场 — 中文提问下关键词全军覆没" },
    ],
  },

  // ------------------------------------------------------------------ PT
  pt: {
    name: "Português",
    title: "Airport Search · quatro formas de buscar",
    subtitle: "Uma consulta, quatro caminhos: LIKE / texto completo / vetor / fusão — tudo em uma única tabela TiDB",
    offline: "Amostra offline",
    live: (n) => `TiDB ao vivo · ${n} aeroportos`,
    globeTitle: "Rede global de aeroportos",
    hub: "hub", large: "grande", regional: "regional",
    globeHint: "arraste para girar · role para ampliar · passe o mouse para ver",
    placeholder: "Buscar aeroportos — por nome, cidade, código IATA, ou descreva o que procura…",
    search: "Buscar",
    compare: "Comparar",
    hits: "resultados",
    lowConf: (n) => `(+${n} baixa confiança)`,
    onlyVector: (l) => `Só a busca semântica achou: ${l}`,
    onlyLexical: (l) => `Só a busca por palavra-chave achou: ${l}`,
    allAgree: "As três chegam às mesmas linhas — para esta consulta, qualquer uma serve.",
    sqlSummary: "O SQL que realmente roda",
    emptyTitle: "Nada foi encontrado.",
    emptyLike: "Nenhuma linha contém essa sequência de caracteres.",
    emptyOther: "Nenhuma palavra da consulta está no índice.",
    gateAllBelow: "⚠ Todos os resultados ficaram abaixo do limiar de confiança — só casaram com uma palavra como <code>airport</code>, que está em todas as linhas. Todos são descartados antes da fusão.",
    why: {
      code: "código exato", inName: "trecho no nome",
      inCity: "trecho na cidade", inCountry: "trecho no país",
      bm25: (t) => `casou com ${t}`,
      concept: (p) => `conceito “${p}”`,
      fuzzy: (v) => `aproximado ~${v}`,
      neighbour: "vizinhança semântica",
    },
    cols: {
      like:     { blurb: "Varredura por substring.", note: "Exato, explicável, sem dependências — mas cego a ordem das palavras, erros de digitação e sinônimos, e nenhum índice o atende." },
      fulltext: { blurb: "BM25 sobre tokens.", note: "A ordem das palavras deixa de importar e há ranking de relevância de verdade — mas ainda casa palavras, e um erro de digitação é outra palavra." },
      vector:   { blurb: "Cosseno sobre embeddings.", note: "Entende sentido, tolera erros, atravessa idiomas — mas sempre devolve k linhas, então não sabe dizer “não achei nada”." },
      hybrid:   { blurb: "Fusão de ranks das três, em um só SQL.", note: "Cada uma cobre o que as outras erram: palavra-chave para precisão, vetor para sentido, RRF para juntar." },
    },
    presets: [
      { id: "exact",       q: "Heathrow",                                       label: "Nome exato",    hint: "As quatro acertam — esta é a linha de base." },
      { id: "typo",        q: "heathrwo airprot",                               label: "Erro de digitação", hint: "Duas palavras erradas: LIKE e texto completo zeram." },
      { id: "crossLang",   q: "aeroporto de Pequim",                            label: "Outro idioma",  hint: "Os dados estão em inglês — só o embedding atravessa." },
      { id: "descriptive", q: "aeroporto perto do Vale do Silício",             label: "Descritivo",    hint: "Nenhuma linha contém as palavras “Vale do Silício”." },
      { id: "code",        q: "JFK",                                            label: "Código IATA",   hint: "Ao contrário: em três letras, a palavra-chave ganha do vetor." },
      { id: "concept",     q: "aeroporto com vento forte e pouso difícil",      label: "Conceito",      hint: "Pergunta por uma sensação, não por um nome." },
      { id: "reasoning",   q: "aeroporto mais alto dos Andes",                  label: "Senso comum",   hint: "Precisa entender “mais alto” e “Andes” ao mesmo tempo." },
      { id: "ambiguous",   q: "Londres",                                        label: "Ambíguo",       hint: "Três aeroportos de Londres — em português, só o vetor os acha." },
    ],
  },

  // ------------------------------------------------------------------ ES
  es: {
    name: "Español",
    title: "Airport Search · cuatro formas de buscar",
    subtitle: "Una consulta, cuatro caminos: LIKE / texto completo / vector / fusión — todo sobre una sola tabla TiDB",
    offline: "Muestra sin conexión",
    live: (n) => `TiDB en vivo · ${n} aeropuertos`,
    globeTitle: "Red mundial de aeropuertos",
    hub: "hub", large: "grande", regional: "regional",
    globeHint: "arrastra para girar · rueda para acercar · pasa el cursor para ver",
    placeholder: "Buscar aeropuertos — por nombre, ciudad, código IATA, o describe lo que buscas…",
    search: "Buscar",
    compare: "Comparar",
    hits: "resultados",
    lowConf: (n) => `(+${n} baja confianza)`,
    onlyVector: (l) => `Solo la búsqueda semántica encontró: ${l}`,
    onlyLexical: (l) => `Solo la búsqueda por palabra clave encontró: ${l}`,
    allAgree: "Las tres llegan a las mismas filas — para esta consulta sirve cualquiera.",
    sqlSummary: "El SQL que realmente se ejecuta",
    emptyTitle: "No coincidió nada.",
    emptyLike: "Ninguna fila contiene esa cadena, literalmente.",
    emptyOther: "Ni una palabra de la consulta está en el índice.",
    gateAllBelow: "⚠ Todos los resultados quedaron por debajo del umbral de confianza — solo coincidieron con una palabra como <code>airport</code>, que está en todas las filas. Se descartan antes de la fusión.",
    why: {
      code: "código exacto", inName: "subcadena en el nombre",
      inCity: "subcadena en la ciudad", inCountry: "subcadena en el país",
      bm25: (t) => `coincidió con ${t}`,
      concept: (p) => `concepto “${p}”`,
      fuzzy: (v) => `aproximado ~${v}`,
      neighbour: "vecindad semántica",
    },
    cols: {
      like:     { blurb: "Barrido por subcadena.", note: "Exacto, explicable, sin dependencias — pero ciego al orden de las palabras, a las erratas y a los sinónimos, y ningún índice lo resuelve." },
      fulltext: { blurb: "BM25 sobre tokens.", note: "El orden deja de importar y hay ranking de relevancia real — pero sigue casando palabras, y una errata es otra palabra." },
      vector:   { blurb: "Coseno sobre embeddings.", note: "Entiende el significado, tolera erratas, cruza idiomas — pero siempre devuelve k filas, así que no sabe decir “aquí no hay nada”." },
      hybrid:   { blurb: "Fusión de rangos de las tres, en un solo SQL.", note: "Cada una cubre lo que las otras fallan: palabras clave para la precisión, vectores para el significado, RRF para unirlas." },
    },
    presets: [
      { id: "exact",       q: "Heathrow",                                          label: "Nombre exacto", hint: "Las cuatro aciertan — esta es la línea base." },
      { id: "typo",        q: "heathrwo airprot",                                  label: "Errata",        hint: "Dos palabras mal escritas: LIKE y texto completo se quedan en cero." },
      { id: "crossLang",   q: "aeropuerto de Pekín",                               label: "Otro idioma",   hint: "Los datos están en inglés — solo el embedding cruza." },
      { id: "descriptive", q: "aeropuerto cerca del Valle del Silicio",            label: "Descriptivo",   hint: "Ninguna fila contiene las palabras “Valle del Silicio”." },
      { id: "code",        q: "JFK",                                               label: "Código IATA",   hint: "Al revés: en tres letras, la palabra clave le gana al vector." },
      { id: "concept",     q: "aeropuerto con viento fuerte y aterrizaje difícil", label: "Concepto",      hint: "Pregunta por una sensación, no por un nombre." },
      { id: "reasoning",   q: "aeropuerto más alto de los Andes",                  label: "Sentido común", hint: "Tiene que entender “más alto” y “Andes” a la vez." },
      { id: "ambiguous",   q: "Londres",                                           label: "Ambiguo",       hint: "Tres aeropuertos de Londres — en español solo el vector los encuentra." },
    ],
  },
};

/** Browser language → one of ours, falling back to English. */
function pickLang() {
  try {
    const saved = localStorage.getItem("airport-demo-lang");
    if (saved && I18N[saved]) return saved;
  } catch { /* private mode */ }
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const code = String(l).toLowerCase().split("-")[0];
    if (I18N[code]) return code;
  }
  return "en";
}
