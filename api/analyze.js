const EASTMONEY_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://quote.eastmoney.com/"
};

const US_SYMBOLS = {
  NVDA: { code: "NVDA", name: "英伟达", secid: "105.NVDA", market: "美股", theme: "AI 算力 / 半导体" },
  AMD: { code: "AMD", name: "超威半导体", secid: "105.AMD", market: "美股", theme: "AI 芯片 / 半导体" },
  MSFT: { code: "MSFT", name: "微软", secid: "105.MSFT", market: "美股", theme: "云计算 / AI 应用" },
  AAPL: { code: "AAPL", name: "苹果", secid: "105.AAPL", market: "美股", theme: "端侧 AI / 消费电子" },
  TSLA: { code: "TSLA", name: "特斯拉", secid: "105.TSLA", market: "美股", theme: "机器人 / 自动驾驶 / 新能源车" },
  AVGO: { code: "AVGO", name: "博通", secid: "105.AVGO", market: "美股", theme: "定制芯片 / AI 网络" },
  MU: { code: "MU", name: "美光科技", secid: "105.MU", market: "美股", theme: "存储 / HBM" },
  GOOGL: { code: "GOOGL", name: "谷歌", secid: "105.GOOGL", market: "美股", theme: "AI 应用 / 云计算" },
  META: { code: "META", name: "Meta", secid: "105.META", market: "美股", theme: "AI 应用 / 互联网平台" }
};

async function getJson(url) {
  const r = await fetch(url, { headers: EASTMONEY_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function parseAStockSearch(data) {
  const rows = data?.QuotationCodeTable?.Data || [];
  const row = rows.find(x => x.Classify === "AStock") || rows[0];
  if (!row) return null;
  return {
    code: row.Code,
    name: row.Name,
    secid: row.QuoteID,
    market: row.SecurityTypeName || "A股",
    theme: "待识别"
  };
}

async function resolveSymbol(q) {
  const input = String(q || "").trim();
  const upper = input.toUpperCase();

  if (US_SYMBOLS[upper]) return US_SYMBOLS[upper];

  const url =
    "https://searchapi.eastmoney.com/api/suggest/get?input=" +
    encodeURIComponent(input) +
    "&type=14&token=D43BF722C8E33F4E9A7F7E8A4D3D6A6D";

  const data = await getJson(url);
  const stock = parseAStockSearch(data);

  if (stock) return stock;

  return null;
}

function quoteFromEastMoney(data, stock) {
  const d = data?.data || {};
  return {
    code: d.f57 || stock.code,
    name: d.f58 || stock.name,
    market: stock.market,
    price: d.f43,
    high: d.f44,
    low: d.f45,
    open: d.f46,
    volume: d.f47,
    amount: d.f48,
    prevClose: d.f60,
    marketCap: d.f116,
    floatMarketCap: d.f117,
    pe: d.f162,
    pb: d.f167,
    turnover: d.f168,
    pct: d.f170,
    amplitude: d.f171,
    roe: d.f173,
    grossMargin: d.f174,
    netMargin: d.f175,
    debtRatio: d.f176,
    industryCode: d.f198,
    raw: d
  };
}

function parseKlines(data) {
  const rows = data?.data?.klines || [];
  return rows.map(line => {
    const [date, open, close, high, low, volume, amount, amplitude, pct, change, turnover] = line.split(",");
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      amplitude: Number(amplitude),
      pct: Number(pct),
      change: Number(change),
      turnover: Number(turnover)
    };
  });
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildAnalysis(stock, quote, klines) {
  const last = klines[klines.length - 1];
  const last5 = klines.slice(-5);
  const last20 = klines.slice(-20);
  const ma5 = avg(last5.map(x => x.close));
  const ma20 = avg(last20.map(x => x.close));
  const vol5 = avg(last5.map(x => x.volume));
  const vol20 = avg(last20.map(x => x.volume));
  const amount5 = avg(last5.map(x => x.amount));
  const amount20 = avg(last20.map(x => x.amount));

  const price = Number(quote.price || last?.close || 0);
  const pct = Number(quote.pct || last?.pct || 0);
  const turnover = Number(quote.turnover || last?.turnover || 0);
  const amount = Number(quote.amount || last?.amount || 0);

  const volumeSignal =
    vol5 && vol20
      ? vol5 > vol20 * 1.35
        ? "近 5 日成交量明显高于 20 日均量，资金参与度提升。"
        : vol5 < vol20 * 0.75
          ? "近 5 日成交量低于 20 日均量，资金参与度偏弱。"
          : "近 5 日成交量接近 20 日均量，资金参与度中性。"
      : "成交量均线数据不足。";

  const trendSignal =
    ma5 && ma20
      ? price > ma5 && ma5 > ma20
        ? "价格位于 5 日均线上方，且 5 日均线高于 20 日均线，短线结构偏强。"
        : price < ma5 && ma5 < ma20
          ? "价格低于 5 日均线，且 5 日均线低于 20 日均线，短线结构偏弱。"
          : "价格和均线结构处于交织状态，短线趋势仍在分化。"
      : "均线数据不足。";

  const capitalSignal =
    pct > 3 && vol5 && vol20 && vol5 > vol20 * 1.2
      ? "放量上涨，资金确认度较强。"
      : pct > 0 && amount5 && amount20 && amount5 >= amount20
        ? "上涨且成交额维持，资金确认度中等偏强。"
        : pct < -3 && vol5 && vol20 && vol5 > vol20 * 1.2
          ? "放量下跌，资金分歧或抛压较强。"
          : "资金确认度一般，需要继续观察成交额和板块强弱。";

  const valuationSignal =
    quote.pe
      ? quote.pe > 80
        ? "市盈率处于较高区间，估值对业绩兑现敏感。"
        : quote.pe > 35
          ? "市盈率处于中高区间，需要业绩增长匹配。"
          : quote.pe > 0
            ? "市盈率相对不高，但仍需结合行业周期和利润质量。"
            : "市盈率为负或不可比，需要重点看盈利修复。"
      : "估值数据不足。";

  const fundamentalSignal = [
    quote.roe ? `ROE 约 ${quote.roe}%，反映当前盈利能力。` : "ROE 数据不足。",
    quote.grossMargin ? `毛利率约 ${quote.grossMargin}%。` : "毛利率数据不足。",
    quote.netMargin ? `净利率约 ${quote.netMargin}%。` : "净利率数据不足。",
    quote.debtRatio ? `资产负债率约 ${quote.debtRatio}%。` : "负债率数据不足。"
  ];

  const heatTheme =
    /AI|芯片|半导体|算力|HBM|云|机器人|新能源|光伏|储能|消费电子/.test(stock.theme)
      ? stock.theme
      : guessTheme(stock.name);

  const conclusion =
    pct > 3 && price > (ma5 || 0)
      ? "短线状态偏强，但需要确认成交额是否持续放大以及是否强于所属板块。"
      : pct < -3
        ? "短线状态偏弱或处于分歧释放阶段，优先观察是否止跌和缩量企稳。"
        : "短线状态偏中性，重点看后续量能和行业热点是否共振。";

  return {
    conclusion,
    labels: {
      status: pct > 3 ? "强势" : pct < -3 ? "偏弱" : "分化/观察",
      capital: capitalSignal.includes("较强") ? "强" : capitalSignal.includes("中等") ? "中强" : "中/弱",
      trend: trendSignal.includes("偏强") ? "偏强" : trendSignal.includes("偏弱") ? "偏弱" : "震荡",
      theme: heatTheme
    },
    quote: {
      price,
      pct,
      amount,
      turnover,
      marketCap: quote.marketCap,
      pe: quote.pe,
      pb: quote.pb
    },
    technical: {
      ma5,
      ma20,
      vol5,
      vol20,
      amount5,
      amount20,
      volumeSignal,
      trendSignal,
      capitalSignal
    },
    fundamentals: {
      valuationSignal,
      items: fundamentalSignal
    },
    industry: {
      theme: heatTheme,
      comment: buildIndustryComment(heatTheme)
    },
    risks: [
      "若上涨但成交额无法延续，容易从趋势确认转为短线分歧。",
      "若社交媒体热度明显高于资金流确认，需警惕情绪交易。",
      "若估值较高，后续业绩、订单或盈利预测不及预期会放大波动。",
      "行业热点退潮时，个股即使基本面较好也可能受到风格压制。"
    ],
    watchlist: [
      "成交额是否继续高于 20 日均额。",
      "股价是否维持在 5 日和 20 日均线上方。",
      "所属行业是否强于主要指数。",
      "是否有公告、财报、订单、研报或政策继续验证逻辑。",
      "X / 雪球讨论是否被资金流和量价结构确认。"
    ]
  };
}

function guessTheme(name) {
  if (/光伏|阳光|隆基|通威|晶科|晶澳|天合|逆变|储能/.test(name)) return "光伏 / 储能 / 新能源";
  if (/芯|半导体|华创|中微|寒武|海光|韦尔|兆易/.test(name)) return "半导体 / AI 芯片";
  if (/机器人|三花|汇川|拓普|绿的/.test(name)) return "机器人 / 高端制造";
  if (/电池|宁德|亿纬|比亚迪/.test(name)) return "新能源车 / 电池";
  if (/通信|中际|新易盛|光迅|天孚/.test(name)) return "AI 算力 / 光模块";
  return "待进一步识别行业主题";
}

function buildIndustryComment(theme) {
  if (/光伏|储能|新能源/.test(theme)) {
    return "该方向受全球装机需求、逆变器出口、储能订单、价格周期和政策预期影响。需要重点跟踪订单、毛利率、海外收入和现金流。";
  }
  if (/半导体|芯片|HBM/.test(theme)) {
    return "该方向与 AI 算力、国产替代、先进封装和设备材料周期相关。需要跟踪订单、库存、资本开支和毛利率变化。";
  }
  if (/机器人/.test(theme)) {
    return "该方向处于技术路线和量产节奏验证期，需重点看订单、客户验证、BOM 降本和量产时间表。";
  }
  if (/算力|光模块/.test(theme)) {
    return "该方向与云厂商资本开支、AI 服务器需求、光模块速率升级和数据中心建设相关。";
  }
  return "需要结合所属行业景气度、公司业务结构、资金流和市场热点进一步判断。";
}

export default async function handler(req, res) {
  try {
    const q = req.query.q;
    if (!q) {
      res.status(400).json({ error: "missing q" });
      return;
    }

    const stock = await resolveSymbol(q);
    if (!stock) {
      res.status(404).json({ error: "未找到股票", query: q });
      return;
    }

    const quoteUrl =
      "https://push2.eastmoney.com/api/qt/stock/get?secid=" +
      stock.secid +
      "&fltt=2&fields=f43,f44,f45,f46,f47,f48,f49,f57,f58,f60,f116,f117,f162,f167,f168,f170,f171,f173,f174,f175,f176,f198,f292";

    const klineUrl =
      "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" +
      stock.secid +
      "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=60";

    const [quoteData, klineData] = await Promise.all([
      getJson(quoteUrl),
      getJson(klineUrl)
    ]);

    const quote = quoteFromEastMoney(quoteData, stock);
    const klines = parseKlines(klineData);
    const analysis = buildAnalysis(stock, quote, klines);

    res.status(200).json({
      query: q,
      stock,
      quote,
      klines,
      analysis,
      asOf: new Date().toISOString(),
      disclaimer: "研究辅助，不构成投资建议。"
    });
  } catch (e) {
    res.status(500).json({
      error: e.message || "analysis failed"
    });
  }
}
