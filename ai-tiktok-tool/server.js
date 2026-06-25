const http = require("http");
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  getFeishuConfigWithOverrides,
  getTenantAccessToken,
  ensureTableByName,
  parseFeishuBitableUrl,
  listAllTables,
  listFields,
  findRecordByField,
  createRecord,
  updateRecord,
  buildProductInfoFields,
  buildScriptExportFields,
  PRODUCT_FIELDS,
  SCRIPT_FIELDS,
  PRODUCT_TABLE_NAME,
  SCRIPT_TABLE_NAME,
} = require("./feishu");

const PORT = Number(process.env.PORT || 4173);
const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const GEMINI_MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || 3);
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const API_RESPONSE_TIMEOUT_MS = Number(process.env.API_RESPONSE_TIMEOUT_MS || 180000);
const PROXY_CONNECT_TIMEOUT_MS = Number(process.env.PROXY_CONNECT_TIMEOUT_MS || 30000);
const TEAM_USERS = parseTeamUsers(process.env.TEAM_USERS || "");
const AUTH_SECRET = process.env.AUTH_SECRET || "dev-only-change-me";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const ROOT = __dirname;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (req.method === "POST" && urlPath === "/api/login") {
      await handleLogin(req, res);
      return;
    }
    if (req.method === "POST" && urlPath === "/api/logout") {
      handleLogout(req, res);
      return;
    }
    if (req.method === "GET" && urlPath === "/api/me") {
      handleMe(req, res);
      return;
    }
    if (!ensureAuthenticated(req, res, urlPath)) return;

    if (req.method === "POST" && req.url === "/api/analyze") {
      await handleAnalyze(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/copy") {
      await handleCopy(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/sync-copy") {
      await handleSyncCopy(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/script") {
      await handleScript(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/feishu/export") {
      await handleFeishuExport(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/feishu/diagnose") {
      await handleFeishuDiagnose(req, res);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`AI TikTok tool running at http://127.0.0.1:${PORT}`);
});

async function handleLogin(req, res) {
  if (!isAuthEnabled()) {
    sendJson(res, 200, { ok: true, user: "local" });
    return;
  }

  const { username, password } = await readJsonBody(req);
  const expectedPassword = TEAM_USERS.get(String(username || "").trim());
  if (!expectedPassword || String(password || "") !== expectedPassword) {
    sendJson(res, 401, { error: "账号或密码错误" });
    return;
  }

  const token = createSessionToken(String(username).trim());
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": buildSessionCookie(token),
  });
  res.end(JSON.stringify({ ok: true, user: String(username).trim() }));
}

function handleLogout(req, res) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": clearSessionCookie(req),
  });
  res.end(JSON.stringify({ ok: true }));
}

function handleMe(req, res) {
  if (!isAuthEnabled()) {
    sendJson(res, 200, { authenticated: true, user: "local" });
    return;
  }
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { authenticated: false });
    return;
  }
  sendJson(res, 200, { authenticated: true, user: session.user });
}

async function handleAnalyze(req, res) {
  const input = await readJsonBody(req);
  if (process.env.MOCK_AI === "1") {
    sendJson(res, 200, { analysis: createMockAnalysis(input) });
    return;
  }
  if (!hasProviderKey()) {
    sendJson(res, 500, { error: missingKeyMessage() });
    return;
  }

  const analysis = await callModel({
    system:
      "你是跨境 TikTok 带货短视频策略专家。必须只输出合法 JSON，不要 Markdown。你要优先依据用户输入的产品信息、目标国家、输出语言、竞品备注和上传视频元数据推导，不要套模板。竞品视频如果只有文件元数据而没有画面内容，必须在 competitorVideoAnalyses 中标注需要视频理解模型进一步解析，不要假装看过视频。",
    user: buildPrompt(input),
    schemaName: "tiktok_product_analysis",
    schema: analysisSchema(input.planCount),
  });
  sendJson(res, 200, { analysis });
}

async function handleCopy(req, res) {
  const input = await readJsonBody(req);
  if (process.env.MOCK_AI === "1") {
    sendJson(res, 200, { copyDrafts: createMockCopyDrafts(input) });
    return;
  }
  if (!hasProviderKey()) {
    sendJson(res, 500, { error: missingKeyMessage() });
    return;
  }

  const planCount = input.aiAnalysis?.planStrategies?.length || input.productInput?.planCount || 5;
  const copyDrafts = await callModel({
    system:
      "你是极懂 TikTok 网感的跨境带货口播文案专家。必须只输出合法 JSON，不要 Markdown。文案要口语化、有煽动性、适配当地文化，避免翻译腔和宗教/文化禁忌。",
    user: buildCopyPrompt(input),
    schemaName: "tiktok_copy_drafts",
    schema: copySchema(planCount),
  });
  const repairedDrafts = await ensureChineseCopyDrafts(copyDrafts.copyDrafts, input);
  sendJson(res, 200, { copyDrafts: repairedDrafts });
}

async function handleSyncCopy(req, res) {
  const input = await readJsonBody(req);
  if (process.env.MOCK_AI === "1") {
    sendJson(res, 200, {
      voiceover: createMockSyncedVoiceover(input),
    });
    return;
  }
  if (!hasProviderKey()) {
    sendJson(res, 500, { error: missingKeyMessage() });
    return;
  }

  const result = await callModel({
    system:
      "你是跨境 TikTok 带货口播本地化专家。必须只输出合法 JSON，不要 Markdown。你的任务是把用户修改后的中文口播稿，改写成目标语言的自然 TikTok 口播，保留用户意思，不要逐字翻译。",
    user: buildSyncCopyPrompt(input),
    schemaName: "synced_voiceover",
    schema: syncCopySchema(),
  });
  sendJson(res, 200, { voiceover: result.voiceover });
}

async function handleScript(req, res) {
  const input = await readJsonBody(req);
  if (process.env.MOCK_AI === "1") {
    sendJson(res, 200, { scripts: normalizeVideoScripts(createMockVideoScripts(input)) });
    return;
  }
  if (!hasProviderKey()) {
    sendJson(res, 500, { error: missingKeyMessage() });
    return;
  }

  const scriptCount = input.copyDrafts?.length || 1;
  const result = await callModel({
    system:
      "你是 Sora/Veo AI 视频生成提示词专家。必须只输出合法 JSON，不要 Markdown。你的任务是把已确认口播文案转成 AI 视频脚本，包含中文结构化参考图 prompt 和中文结构化视频 prompt。",
    user: buildScriptPrompt(input),
    schemaName: "video_generation_scripts",
    schema: scriptSchema(scriptCount),
  });
  sendJson(res, 200, { scripts: normalizeVideoScripts(result.scripts) });
}

async function handleFeishuExport(req, res) {
  const input = await readJsonBody(req);
  const config = getFeishuConfigWithOverrides(input.feishu || {});
  const tenantAccessToken = await getTenantAccessToken(config);
  const productInput = input.productInput || {};
  const aiAnalysis = input.aiAnalysis || {};
  const videoScripts = Array.isArray(input.videoScripts) ? input.videoScripts : [];
  const selectedScripts = videoScripts.filter((script, index) => input.selectedIndexes?.includes(index) || script.selected);
  if (!selectedScripts.length) {
    sendJson(res, 400, { error: "请至少选择 1 条脚本导出。" });
    return;
  }

  const productTable = await ensureTableByName({
    appToken: config.appToken,
    tenantAccessToken,
    tableId: config.productTableId || "",
    name: PRODUCT_TABLE_NAME,
    fields: PRODUCT_FIELDS,
  });
  const scriptTable = await ensureTableByName({
    appToken: config.appToken,
    tenantAccessToken,
    tableId: config.scriptTableId || "",
    preferredTableId: config.linkedTableId || "",
    name: SCRIPT_TABLE_NAME,
    fields: SCRIPT_FIELDS,
  });

  const productName = productInput.productName || "";
  let productRecord = null;
  if (productName) {
    productRecord = await findRecordByField({
      appToken: config.appToken,
      tableId: productTable.tableId,
      tenantAccessToken,
      fieldName: "产品名称",
      value: productName,
    });
  }

  if (productRecord && !input.confirmProductUpdate) {
    sendJson(res, 200, {
      needConfirmUpdate: true,
      message: `飞书里已经有产品「${productName}」记录，是否更新这条产品信息表？`,
      productTable,
      scriptTable,
      matchedRecordId: productRecord.record_id || "",
    });
    return;
  }

  const productFields = buildProductInfoFields({ productInput, aiAnalysis });
  if (productRecord) {
    await updateRecord({
      appToken: config.appToken,
      tableId: productTable.tableId,
      tenantAccessToken,
      recordId: productRecord.record_id,
      fields: productFields,
    });
  } else {
    await createRecord({
      appToken: config.appToken,
      tableId: productTable.tableId,
      tenantAccessToken,
      fields: productFields,
    });
  }

  const createdRecords = [];
  for (const script of selectedScripts) {
    const fields = buildScriptExportFields({
      script,
      productInput,
      selectedAt: new Date(),
    });
    const record = await createRecord({
      appToken: config.appToken,
      tableId: scriptTable.tableId,
      tenantAccessToken,
      fields,
    });
    createdRecords.push(record?.record_id || "");
  }

  sendJson(res, 200, {
    ok: true,
    updatedProduct: Boolean(productRecord),
    productTable,
    scriptTable,
    createdCount: createdRecords.length,
    createdRecordIds: createdRecords,
  });
}

async function handleFeishuDiagnose(req, res) {
  const input = await readJsonBody(req);
  const config = getFeishuConfigWithOverrides(input.feishu || {});
  const parsed = parseFeishuBitableUrl(config.bitableUrl);

  const result = {
    ok: false,
    parsed: {
      appToken: parsed.appToken,
      tableId: parsed.table || "",
      viewId: parsed.view || "",
    },
    steps: [],
  };

  result.steps.push({ step: "parse_link", ok: true, detail: "已成功解析飞书多维表链接。" });

  const tenantAccessToken = await getTenantAccessToken(config);
  result.steps.push({ step: "get_token", ok: true, detail: "已成功获取 tenant_access_token。" });

  if (parsed.table) {
    try {
      const fields = await listFields({
        appToken: config.appToken,
        tableId: parsed.table,
        tenantAccessToken,
      });
      result.steps.push({
        step: "get_current_table",
        ok: true,
        detail: `可直接读取链接中的 table，当前字段 ${fields.length} 个。`,
      });
    } catch (error) {
      result.steps.push({
        step: "get_current_table",
        ok: false,
        detail: error.message,
      });
    }
  } else {
    result.steps.push({
      step: "get_current_table",
      ok: false,
      detail: "链接中没有 table 参数，暂时无法直接验证当前 sheet。",
    });
  }

  try {
    const tables = await listAllTables({
      appToken: config.appToken,
      tenantAccessToken,
    });
    result.steps.push({
      step: "list_tables",
      ok: true,
      detail: `可列出 ${tables.length} 个 sheet。`,
      tables: tables.slice(0, 10).map((table) => ({
        tableId: table.table_id || table.id || "",
        name: table.name || table.table_name || "",
      })),
    });
  } catch (error) {
    result.steps.push({
      step: "list_tables",
      ok: false,
      detail: error.message,
    });
  }

  result.ok = result.steps.every((item) => item.ok);
  sendJson(res, 200, result);
}

function hasProviderKey() {
  if (AI_PROVIDER === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}

function missingKeyMessage() {
  if (AI_PROVIDER === "gemini") {
    return "缺少 GEMINI_API_KEY。请用 AI_PROVIDER=gemini GEMINI_API_KEY=你的key node server.js 启动。";
  }
  return "缺少 OPENAI_API_KEY。请用 OPENAI_API_KEY=你的key node server.js 启动。";
}

function createMockAnalysis(input) {
  const planCount = Math.max(1, Math.min(Number(input.planCount) || 5, 10));
  const styles = input.selectedStyles?.length
    ? input.selectedStyles
    : ["UGC 真实测评", "痛点解决", "前后对比", "低价冲动购买", "家庭日常场景"];
  const audiences = splitLocal(input.rawAudience || "年轻女生、喜欢衣服香香的人、有车一族、家里有异味困扰的人、家庭主妇").map(
    (name, index) => ({
      name,
      motivation: "希望用低成本改善日常气味体验。",
      contentAngle: "从真实生活小烦恼切入。",
      isPrimary: index === 0,
    })
  );
  const openingHooks = [
    ["引起共鸣", "一拉开衣柜就有闷味，目标人群一秒代入。", "用真实小烦恼直接命中高频用户。", "喜欢衣服香香的人", "衣柜和卧室", "用真实场景 before/after 展示。"],
    ["引起共鸣", "鞋柜、洗手间、车里都有异味，一开场就把生活困扰摆出来。", "多空间困扰容易让用户继续看下去。", "家里有异味困扰的人", "鞋柜、洗手间、车内", "从有味道的空间切到放入产品后的变化。"],
    ["引起好奇", "这么小一个东西为什么能让房间味道变舒服？", "小产品大变化自带反差感。", "想买便宜又实用家居小物的人", "卧室或客厅", "先给变化结果，再回到产品。"],
    ["引起向往", "房间和衣服都闻起来干净又高级，让人想直接复制这种生活感。", "理想生活感容易提升停留。", "年轻女生", "卧室、梳妆区", "展示精致空间和细节。"],
  ].map(([hookType, summary, stayReason, targetAudience, sceneHint, videoExpression], index) => ({
    hookType,
    summary,
    stayReason,
    targetAudience,
    sceneHint,
    videoExpression,
    priority: index + 1,
  }));
  const useCases = splitLocal(input.rawUseCases || "衣柜、鞋柜、洗手间、客厅、车内").map((scene) => ({
    scene,
    shotSuggestion: "手机竖屏实拍，真实家庭场景。",
    localizationNote: `${input.targetCountry || "目标国家"} 本土生活环境，避免棚拍感。`,
  }));
  const coreSellingPointCount = splitLocal(input.rawCoreSellingPoints).length;
  const sellingPoints = splitLocal(
    [input.rawCoreSellingPoints, input.rawSellingPoints].filter(Boolean).join("，") ||
      "香气不冲鼻，自带挂钩，2-3个月还有淡淡香气，6种香味，便宜，造型可爱"
  ).map(
    (item, index) => ({
      title: item.slice(0, 18),
      description: item,
      angle: index < coreSellingPointCount ? "核心卖点，口播文案必须优先覆盖。" : "补充卖点或促销信息，用来叠加值感。",
      isPrimary: index < Math.max(1, coreSellingPointCount),
    })
  );
  const planStrategies = Array.from({ length: planCount }, (_, index) => ({
    planNo: index + 1,
    style: styles[index % styles.length],
    audience: audiences[index % audiences.length]?.name || "目标用户",
    hookType: openingHooks[index % openingHooks.length].hookType,
    openingSummary: openingHooks[index % openingHooks.length].summary,
    openingDetail: openingHooks[index % openingHooks.length].videoExpression,
    stayReason: openingHooks[index % openingHooks.length].stayReason,
    sceneHint: useCases[index % useCases.length]?.scene || "日常场景",
    angle: "开头优先增加停留并打中目标人群，中间叠加卖点，结尾促销下单。",
  }));

  return {
    sellingPoints,
    audiences,
    openingHooks,
    useCases,
    planStrategies,
    competitorVideoAnalyses: (input.competitorVideos || []).map((video, index) => ({
      name: video.name || `竞品视频 ${index + 1}`,
      status: "开发模式未解析视频",
      note: "MOCK_AI=1 仅用于验证流程；真实解析需接视频理解链路。",
      index: index + 1,
    })),
    competitorAnalysis: {
      hook: "房间/衣柜变香的生活化开头。",
      sellingExpression: "围绕淡香、多空间、便宜、可爱造型表达。",
      originalCopy: "My beauty room has been looking so pretty. I'm trying out this fragrance pocket, which smells fresh. You can poke a few holes and hang it up.",
      originalCopyZh: "我的美妆房现在看起来很漂亮。我在试这个香氛袋，闻起来很清新。可以戳几个孔然后挂起来使用。",
      cta: "强调套装更划算，现在下单。",
    },
  };
}

function createMockCopyDrafts(input) {
  const strategies = input.aiAnalysis?.planStrategies || [];
  const requiredPoints = splitLocal(input.productInput?.rawCoreSellingPoints);
  const allPoints = [
    ...requiredPoints,
    ...(input.aiAnalysis?.sellingPoints || []).map((point) => point.title || point.description),
  ]
    .filter(Boolean)
    .filter((point, index, arr) => arr.indexOf(point) === index)
    .slice(0, 5);
  const valueStack = allPoints.join("、") || "香气淡、不刺鼻、自带挂钩、多场景可用、价格划算";
  const promoText = input.productInput?.rawSellingPoints || "";
  const hasPromo = /促销|优惠|折扣|活动|买|送|包邮|低价|便宜|price|sale|promo|discount/i.test(promoText);
  return strategies.map((strategy) => ({
    planNo: strategy.planNo,
    style: strategy.style,
    audience: strategy.audience,
    duration: "20-30s",
    hook: `Kalau ${strategy.audience} terus rasa “ini memang pasal aku”, dengar ni.`,
    voiceover: `Kalau ${strategy.audience} terus rasa “ini memang pasal aku”, benda kecil ni memang kena cuba. Nilai dia banyak: ${valueStack}. Masukkan terus dalam ${strategy.sceneHint}, biar orang nampak perubahan tu cepat. ${hasPromo ? "Promo macam ni memang lagi berbaloi, add to cart sekarang." : "Seller tengah buat promo, jangan tunggu lama, add to cart sekarang."}`,
    voiceoverZh: `先用“${strategy.openingSummary}”把${strategy.audience}留住，这个小东西真的可以试。它要把值感讲满：${valueStack}。直接放进${strategy.sceneHint}这类真实生活流程里，让人马上看到变化。${hasPromo ? "如果用户给了促销信息，就把促销点讲进去并引导下单。" : "如果没有具体促销，就用“现在卖家在做活动”这类宽泛说法引导下单。"}`,
    editedZh: `先用“${strategy.openingSummary}”把${strategy.audience}留住，这个小东西真的可以试。它要把值感讲满：${valueStack}。直接放进${strategy.sceneHint}这类真实生活流程里，让人马上看到变化。${hasPromo ? "如果用户给了促销信息，就把促销点讲进去并引导下单。" : "如果没有具体促销，就用“现在卖家在做活动”这类宽泛说法引导下单。"}`,
    cta: "Add to cart sekarang.",
    selected: true,
  }));
}

async function ensureChineseCopyDrafts(copyDrafts, input) {
  const drafts = Array.isArray(copyDrafts) ? copyDrafts : [];
  const needsRepair = drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) => !isMostlyChinese(draft?.voiceoverZh) || !isMostlyChinese(draft?.editedZh));

  if (!needsRepair.length) {
    return drafts.map((draft) => ({
      ...draft,
      editedZh: draft.editedZh || draft.voiceoverZh || "",
    }));
  }

  try {
    const repaired = await callModel({
      system:
        "你是中文电商口播文案编辑。必须只输出合法 JSON，不要 Markdown。你的任务是把非中文或错误语言的中文稿字段修复为自然简体中文。",
      user: buildChineseCopyRepairPrompt(needsRepair, input),
      schemaName: "chinese_copy_repair",
      schema: chineseCopyRepairSchema(needsRepair.length),
    });
    const repairMap = new Map((repaired.repairedDrafts || []).map((item) => [Number(item.index), item]));
    return drafts.map((draft, index) => {
      const fallbackZh = createFallbackChineseDraft(draft, input, index);
      const repairedItem = repairMap.get(index);
      const repairedZh = repairedItem?.editedZh || repairedItem?.voiceoverZh || "";
      const voiceoverZh = isMostlyChinese(repairedItem?.voiceoverZh)
        ? repairedItem.voiceoverZh
        : isMostlyChinese(repairedZh)
          ? repairedZh
          : isMostlyChinese(draft.voiceoverZh)
            ? draft.voiceoverZh
            : fallbackZh;
      const editedZh = isMostlyChinese(repairedItem?.editedZh)
        ? repairedItem.editedZh
        : isMostlyChinese(draft.editedZh)
          ? draft.editedZh
          : voiceoverZh;
      return {
        ...draft,
        voiceoverZh,
        editedZh,
      };
    });
  } catch (error) {
    console.warn("中文微调稿自动修复失败，使用本地兜底文案：", error.message);
    return drafts.map((draft, index) => {
      const fallbackZh = createFallbackChineseDraft(draft, input, index);
      return {
        ...draft,
        voiceoverZh: isMostlyChinese(draft.voiceoverZh) ? draft.voiceoverZh : fallbackZh,
        editedZh: isMostlyChinese(draft.editedZh) ? draft.editedZh : fallbackZh,
      };
    });
  }
}

function buildChineseCopyRepairPrompt(items, input) {
  return JSON.stringify(
    {
      task: "修复文案里的中文字段。voiceover 保持原目标语言不改；voiceoverZh 和 editedZh 必须输出自然简体中文。",
      rules: [
        "不要逐字硬翻，要改写成中国团队能直接审核和微调的中文口播稿。",
        "保留原口播里的 hook、卖点叠加、促销/下单理由和语气强度。",
        "如果原中文字段是泰语、马来语、英语或其他语言，必须翻译/改写成中文。",
        "editedZh 必须等于或略优于 voiceoverZh，不能再出现目标语言。",
        "不要添加未经产品信息支持的新功效，不要夸大除菌、治病、永久除味。",
      ],
      productInput: input.productInput,
      aiAnalysis: input.aiAnalysis,
      drafts: items.map(({ draft, index }) => ({
        index,
        planNo: draft.planNo,
        style: draft.style,
        audience: draft.audience,
        hook: draft.hook,
        voiceover: draft.voiceover,
        currentVoiceoverZh: draft.voiceoverZh,
        currentEditedZh: draft.editedZh,
      })),
    },
    null,
    2
  );
}

function createFallbackChineseDraft(draft, input, index) {
  const productInput = input.productInput || {};
  const plan = input.aiAnalysis?.planStrategies?.[index] || {};
  const sellingPoints = [
    ...splitLocal(productInput.rawCoreSellingPoints),
    ...splitLocal(productInput.rawSellingPoints),
    ...(input.aiAnalysis?.sellingPoints || []).flatMap((point) => [point.title, point.description]),
  ]
    .filter(Boolean)
    .filter((point, pointIndex, arr) => arr.indexOf(point) === pointIndex)
    .slice(0, 6);
  const valueStack = sellingPoints.length ? sellingPoints.join("、") : "好看、实用、多场景可用、价格划算";
  const audience = draft?.audience || plan.audience || "目标用户";
  const openingSummary = plan.openingSummary || "先用高停留开头打中目标人群";
  const scene = plan.sceneHint || productInput.rawUseCases || "日常场景";
  const hasPromo = /促销|优惠|折扣|活动|买|送|包邮|低价|便宜|price|sale|promo|discount/i.test(productInput.rawSellingPoints || "");
  return `先用“${openingSummary}”把${audience}留下来，这个${productInput.productName || "产品"}真的可以看看。它不是只靠外观，值感要讲满：${valueStack}。放在${scene}都能用，买几份分开放更划算。${hasPromo ? "把现在的促销信息带上，直接引导下单。" : "现在卖家在做活动，先加购物车会更划算。"}`;
}

function isMostlyChinese(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  const chineseChars = value.match(/[\u3400-\u9fff]/g)?.length || 0;
  const latinOrThaiChars = value.match(/[A-Za-z\u0e00-\u0e7f]/g)?.length || 0;
  if (chineseChars >= 8 && chineseChars >= latinOrThaiChars) return true;
  return chineseChars >= 12 && chineseChars / Math.max(1, value.length) > 0.25;
}

function createMockSyncedVoiceover(input) {
  const language = input.productInput?.outputLanguage || "目标语言";
  return `[${language} synced draft] ${input.draft?.editedZh || ""}`;
}

function createMockVideoScripts(input) {
  const videoModel = input.videoModel || "sora";
  const modelName = videoModel === "veo" ? "Veo" : "Sora";
  const segmentDuration = videoModel === "veo" ? 10 : 12;
  return (input.copyDrafts || []).map((draft) => {
    const totalDuration = parseDurationSeconds(draft.duration) || 24;
    const segmentCount = Math.max(1, Math.ceil(totalDuration / segmentDuration));
    return {
      planNo: draft.planNo,
      style: draft.style,
      model: modelName,
      totalDuration,
      videoTitle: createMockVideoTitle(input.productInput, draft),
      tags: createMockVideoTags(input.productInput, draft),
      voiceover: draft.voiceover,
      editedZh: draft.editedZh,
      segments: Array.from({ length: segmentCount }, (_, segmentIndex) => ({
        segmentNo: segmentIndex + 1,
        duration: segmentDuration,
        referenceMode:
          videoModel === "veo" ? "本段最多 3 张参考图，对应 3 个关键镜头。" : "本段使用 1 张拼图参考图，拼入 3-5 个关键画面。",
        shots: Array.from({ length: videoModel === "veo" ? 3 : 4 }, (_, shotIndex) => {
          const shotNo = shotIndex + 1;
          return {
            shotNo,
            duration: Math.max(2, Math.round(segmentDuration / (videoModel === "veo" ? 3 : 4))),
            referenceImagePrompt: `【参考图编号】\n${modelName}-第 ${segmentIndex + 1} 段-第 ${shotNo} 镜头\n\n【画面主体】\n${input.productInput?.productName || "产品"} 在真实生活场景中出现，画面信息密度高，同时能看到产品、包装/配件、使用环境和人物动作；产品外观、颜色、形状、包装、图案和细节如产品参考图所示。\n\n【人物与动作】\n真实 TikTok 用户或老板/工厂人员，穿着日常，表情自然，正在展示产品，产品如图所示；如果是工厂/老板视角，老板拿着产品走向镜头，背景工人正在打包或搬纸箱，现场有真实忙碌感。\n\n【场景与本土化】\n普通家庭环境或工厂仓库打包区，通过衣柜、车内、洗手间、纸箱堆、包装台、工人动作等细节体现真实场景；产品摆放和使用方式如产品参考图所示。\n\n【画面风格】\n真实手机拍摄、TikTok UGC、自然光、不像广告大片；允许轻微手持晃动、自然杂乱和现场不完美。\n\n【构图】\n竖屏 9:16，中近景或手部特写；可以做拼图/多宫格参考，让包装、使用状态和效果对比同屏出现。\n\n【避免】\n不要夸张香味烟雾，不要产品变形，不要改变产品颜色/形状/包装，不要假，不要欧美豪宅背景。`,
            videoPrompt: `【模型】\n${modelName}\n\n【段落与镜头】\n第 ${segmentIndex + 1} 段，第 ${shotNo} 镜头，时长 ${Math.max(2, Math.round(segmentDuration / (videoModel === "veo" ? 3 : 4)))} 秒。\n\n【参考图】\n分镜图 ${shotNo}\n\n【动态内容】\n人物自然展示产品，画面和产品如分镜图 ${shotNo} 所示。\n\n【镜头运动】\n手持轻微晃动 / 慢推近 / 第一人称视角。\n\n【口播/字幕】\n${draft.voiceover}\n\n【风格】\n真实 TikTok UGC，本土生活感，手机拍摄。\n\n【约束】\n保持产品形状一致，画质风格接地气，不改变产品，不生成夸张，不加入无关人物，不出现乱码文字。`,
          };
        }),
      })),
    };
  });
}

function createMockVideoTitle(productInput = {}, draft = {}) {
  const productName = productInput.productName || "produk ni";
  if (productInput.targetCountry === "马来西亚" || productInput.outputLanguage === "马来语") {
    return `${productName} kecil tapi rumah terus rasa lain`;
  }
  return `${productName} worth it untuk ${draft.audience || "daily use"}`;
}

function createMockVideoTags(productInput = {}, draft = {}) {
  const productName = String(productInput.productName || "produk").replace(/\s+/g, "");
  const style = String(draft.style || "TikTokFinds").replace(/[^\p{L}\p{N}]+/gu, "");
  return [`#${productName}`, "#TikTokShop", "#ShopeeFinds", `#${style || "WorthIt"}`, "#DailyMustHave"].slice(0, 5);
}

function parseDurationSeconds(durationText) {
  const matches = String(durationText || "").match(/\d+/g);
  if (!matches?.length) return 0;
  return Number(matches[matches.length - 1]);
}

function splitLocal(text) {
  return String(text || "")
    .split(/[\n,，;；、。]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function callModel({ system, user, schemaName, schema }) {
  if (AI_PROVIDER === "gemini") {
    return callGemini({ system, user, schemaName, schema });
  }
  if (AI_PROVIDER !== "openai") {
    throw new Error(`不支持的 AI_PROVIDER：${AI_PROVIDER}。可用值：openai、gemini。`);
  }
  return callOpenAI({ system, user, schemaName, schema });
}

async function callOpenAI({ system, user, schemaName, schema }) {
  const payload = {
    model: MODEL,
    input: [
      {
        role: "system",
        content: system,
      },
      {
        role: "user",
        content: user,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        schema,
        strict: true,
      },
    },
  };

  let response;
  try {
    response = await requestOpenAI(`${OPENAI_BASE_URL}/responses`, payload);
  } catch (error) {
    throw new Error(
      [
        "无法连接 OpenAI API。",
        `请求地址：${OPENAI_BASE_URL}/responses`,
        "这通常是网络、VPN、代理或中转地址配置问题。",
        "如果你在本机使用代理，请确认启动 Node 服务的终端也能访问 api.openai.com；或设置 OPENAI_BASE_URL 为可访问的 OpenAI 兼容地址。",
        `底层错误：${error.message}`,
      ].join("\n")
    );
  }

  const data = await readJsonResponseSafely(response, "OpenAI");
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(data, response.status, "OpenAI"));
  }

  const text = data.output_text || collectOutputText(data);
  if (!text) throw new Error("OpenAI API 没有返回可解析内容");
  try {
    return parseModelJson(text);
  } catch (error) {
    throw new Error(
      [
        "OpenAI 返回的内容不是合法 JSON。",
        `模型返回前 200 字：${String(text || "").slice(0, 200) || "空"}`,
        `底层错误：${error.message}`,
      ].join("\n")
    );
  }
}

async function callGemini({ system, user, schemaName, schema }) {
  const payload = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              user,
              "",
              `请严格输出符合这个 JSON schema 的 JSON 对象，顶层 schema 名称：${schemaName}。`,
              JSON.stringify(schema, null, 2),
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  };

  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].filter((model, index, arr) => model && arr.indexOf(model) === index);
  const data = await requestGeminiWithRetry(models, payload);
  const text = collectGeminiText(data);
  if (!text) throw new Error("Gemini API 没有返回可解析内容");
  return parseModelJson(stripJsonCodeFence(text));
}

async function requestGeminiWithRetry(models, payload) {
  const errors = [];
  for (const model of models) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 1; attempt <= Math.max(1, GEMINI_MAX_RETRIES); attempt += 1) {
      try {
        const response = await requestGemini(url, payload);
        const data = await readJsonResponseSafely(response, "Gemini");
        if (response.ok) return data;

        const message = extractApiErrorMessage(data, response.status, "Gemini");
        const retryable = response.status === 429 || response.status === 500 || response.status === 503 || isGeminiHighDemand(message);
        errors.push(`${model} 第 ${attempt} 次：${message}`);
        if (!retryable || attempt === GEMINI_MAX_RETRIES) break;
        await sleep(getGeminiRetryDelayMs(message, attempt));
      } catch (error) {
        errors.push(`${model} 第 ${attempt} 次：${error.message}`);
        if (attempt === GEMINI_MAX_RETRIES) break;
        await sleep(getGeminiRetryDelayMs(error.message, attempt));
      }
    }
  }

  const lastError = errors[errors.length - 1] || "未知错误";
  if (isGeminiQuotaExceeded(lastError)) {
    throw new Error(
      [
        "Gemini 免费额度/频率限制触发了，已经按提示等待并自动重试，但仍失败。",
        "这不是请求格式问题。请等 1-2 分钟再点一次，或者减少连续生成次数；如果经常发生，需要升级 Gemini 额度或换更高配额的 API Key。",
        `尝试记录：${errors.join(" | ")}`,
      ].join("\n")
    );
  }

  if (isGeminiHighDemand(lastError)) {
    throw new Error(
      [
        "Gemini 当前模型繁忙，已经自动重试但仍失败。",
        "可以稍后再试，或启动服务时配置备用模型：GEMINI_FALLBACK_MODELS=模型1,模型2。",
        `尝试记录：${errors.join(" | ")}`,
      ].join("\n")
    );
  }

  throw new Error(
    [
      "无法连接 Gemini API。",
      `请求地址：${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`,
      "这通常是网络、VPN、代理、Gemini API Key/地区访问、模型名或模型临时繁忙问题。",
      "如果你在本机使用 ClashX，请确认启动 Node 服务的终端设置了 http_proxy/https_proxy。",
      `尝试记录：${errors.join(" | ")}`,
    ].join("\n")
  );
}

function isGeminiHighDemand(message) {
  return /high demand|overloaded|temporarily unavailable|try again later|503/i.test(String(message || ""));
}

function isGeminiQuotaExceeded(message) {
  return /quota exceeded|rate-limits|free_tier_requests|please retry in|429/i.test(String(message || ""));
}

function getGeminiRetryDelayMs(message, attempt) {
  const retryMatch = String(message || "").match(/retry in\s+([\d.]+)\s*s/i);
  if (retryMatch) {
    return Math.ceil(Number(retryMatch[1]) * 1000) + 750;
  }
  return Math.min(30000, 1500 * attempt * attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOpenAI(url, payload) {
  const proxyUrl = getProxyUrl();
  const body = JSON.stringify(payload);
  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };

  if (proxyUrl) {
    return requestJsonThroughHttpProxy(url, proxyUrl, headers, body);
  }

  return fetch(url, {
    method: "POST",
    headers,
    body,
  });
}

async function requestGemini(url, payload) {
  const proxyUrl = getProxyUrl();
  const body = JSON.stringify(payload);
  const headers = {
    "x-goog-api-key": process.env.GEMINI_API_KEY,
    "Content-Type": "application/json",
  };

  if (proxyUrl) {
    return requestJsonThroughHttpProxy(url, proxyUrl, headers, body);
  }

  return fetch(url, {
    method: "POST",
    headers,
    body,
  });
}

function getProxyUrl() {
  const raw =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    "";
  if (!raw) return "";
  if (!raw.startsWith("http://")) {
    throw new Error(`当前仅支持 http:// 代理地址，请使用 ClashX 的 http/https_proxy，不要只用 socks5：${raw}`);
  }
  return raw;
}

function requestJsonThroughHttpProxy(targetUrl, proxyUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const proxy = new URL(proxyUrl);
    const targetPort = Number(target.port || 443);
    const proxyPort = Number(proxy.port || 80);
    const connectHost = `${target.hostname}:${targetPort}`;

    const proxySocket = net.connect(proxyPort, proxy.hostname, () => {
      proxySocket.write(
        [
          `CONNECT ${connectHost} HTTP/1.1`,
          `Host: ${connectHost}`,
          "Proxy-Connection: Keep-Alive",
          "",
          "",
        ].join("\r\n")
      );
    });

    proxySocket.setTimeout(PROXY_CONNECT_TIMEOUT_MS);
    proxySocket.once("timeout", () => {
      proxySocket.destroy();
      reject(new Error(`连接代理超时：${proxy.hostname}:${proxyPort}`));
    });
    proxySocket.once("error", reject);

    let connectBuffer = Buffer.alloc(0);
    proxySocket.on("data", function onConnectData(chunk) {
      connectBuffer = Buffer.concat([connectBuffer, chunk]);
      const headerEnd = connectBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      proxySocket.off("data", onConnectData);
      const header = connectBuffer.slice(0, headerEnd).toString("utf8");
      const rest = connectBuffer.slice(headerEnd + 4);
      if (!/^HTTP\/1\.[01] 200/i.test(header)) {
        proxySocket.destroy();
        reject(new Error(`ClashX 代理 CONNECT 失败：${header.split("\r\n")[0] || header}`));
        return;
      }

      proxySocket.setTimeout(0);
      const tlsSocket = tls.connect({
        socket: proxySocket,
        servername: target.hostname,
      });
      tlsSocket.setTimeout(API_RESPONSE_TIMEOUT_MS);

      tlsSocket.once("secureConnect", () => {
        const requestHeaders = {
          ...headers,
          Host: target.hostname,
          "Content-Length": Buffer.byteLength(body),
          Connection: "close",
        };
        const requestHead = [
          `POST ${target.pathname}${target.search} HTTP/1.1`,
          ...Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`),
          "",
          "",
        ].join("\r\n");
        tlsSocket.write(requestHead);
        tlsSocket.write(body);
      });

      tlsSocket.once("error", reject);
      tlsSocket.once("timeout", () => {
        tlsSocket.destroy();
        reject(new Error(`API 响应超时：${Math.round(API_RESPONSE_TIMEOUT_MS / 1000)} 秒内没有返回，请稍后重试或调大 API_RESPONSE_TIMEOUT_MS`));
      });

      const responseChunks = rest.length ? [rest] : [];
      tlsSocket.on("data", (responseChunk) => {
        responseChunks.push(responseChunk);
      });
      tlsSocket.on("end", () => {
        try {
          resolve(parseHttpResponse(Buffer.concat(responseChunks)));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

function parseHttpResponse(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) throw new Error("OpenAI API 返回格式异常：缺少响应头");

  const rawHeaders = buffer.slice(0, headerEnd).toString("utf8");
  const bodyBuffer = buffer.slice(headerEnd + 4);
  const headerLines = rawHeaders.split("\r\n");
  const statusMatch = headerLines[0].match(/^HTTP\/1\.[01]\s+(\d+)/);
  const status = statusMatch ? Number(statusMatch[1]) : 500;
  const headerMap = Object.fromEntries(
    headerLines.slice(1).map((line) => {
      const index = line.indexOf(":");
      return index === -1 ? [line.toLowerCase(), ""] : [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
    })
  );
  const decodedBody =
    headerMap["transfer-encoding"]?.toLowerCase() === "chunked" ? decodeChunkedBody(bodyBuffer) : bodyBuffer;
  const text = decodedBody.toString("utf8");

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerMap,
    json: async () => JSON.parse(text || "{}"),
    text: async () => text,
  };
}

async function readJsonResponseSafely(response, providerName) {
  try {
    return await response.json();
  } catch (error) {
    const rawText = typeof response.text === "function" ? await response.text().catch(() => "") : "";
    const compactText = String(rawText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const contentType =
      response.headers?.get?.("content-type") ||
      response.headers?.["content-type"] ||
      "unknown";
    throw new Error(
      [
        `${providerName} API 返回了非 JSON 响应。`,
        `HTTP 状态：${response.status || "unknown"}`,
        `Content-Type：${contentType}`,
        compactText ? `响应内容：${compactText}` : "响应内容为空。",
        "这通常表示上游接口超时、网关报错、代理/中转返回了错误页，或 OpenAI 兼容地址并未真正返回 JSON。",
      ].join("\n")
    );
  }
}

function extractApiErrorMessage(data, status, providerName) {
  const message =
    data?.error?.message ||
    data?.message ||
    data?.detail ||
    data?.error ||
    "";
  const normalized = String(message || "").trim();
  if (/error code:\s*524|524/i.test(normalized)) {
    return `${providerName} 上游网关超时（HTTP 524）。通常是模型接口、中转地址或代理超时，不是脚本生成逻辑错误。请稍后重试，或检查 OPENAI_BASE_URL / 代理配置。`;
  }
  return normalized || `${providerName} API request failed (HTTP ${status || "unknown"})`;
}

function decodeChunkedBody(buffer) {
  let offset = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeText = buffer.slice(offset, lineEnd).toString("utf8").split(";")[0];
    const size = parseInt(sizeText, 16);
    if (!Number.isFinite(size)) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(buffer.slice(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}

function buildPrompt(input) {
  return JSON.stringify(
    {
      task: "点击 AI 提炼卖点后，生成进入短视频方案前的确认页数据。",
      requirements: [
        "根据产品名称、核心卖点、卖点/促销信息、使用场景、目标人群、目标国家、指定语言、竞品备注推导。",
        "productInput.rawCoreSellingPoints 是必须在后续视频中真实呈现的关键点，生成 sellingPoints 时必须优先保留并标为主项。",
        "productInput.rawSellingPoints 是补充卖点/促销信息/规格/套装/价格优势，用来扩展卖点池、CTA 和值感表达。",
        "productInput.referenceCopies 最多 3 条，是用户提供的参考文案。需要学习其开头 hook、卖点叠加顺序、情绪/网感、CTA 强度和句式节奏，但不得直接照抄原句。",
        "如果参考文案里有明显的高转化表达结构，要在 planStrategies 的 angle、openingHooks 和 competitorAnalysis 的 hook/sellingExpression/cta 中吸收其结构。",
        "目标人群和开头切入要服务于每条生成方案，允许部分重复，但不要无依据乱写。",
        "openingHooks 用来替代单纯的痛点审核，必须优先思考怎样增加停留、怎样在前 1-3 秒打中目标人群。",
        "openingHooks.hookType 必须优先从这些方向中选择或组合：引起共鸣、引起好奇、引起恐惧/避坑、引起向往、引起满足。",
        "不要把所有视频都写成痛点型开头；不同产品、人群、价格带、流量目标应该匹配不同开头切法。",
        "openingHooks.summary 必须具体描述第一眼画面/话术如何留人，不能只写抽象词。",
        "openingHooks.stayReason 必须说明为什么这个切法能提高停留，openingHooks.targetAudience 必须明确命中的人群。",
        "planStrategies 数量必须等于 planCount，最多 10 条。",
        "如果用户选择了风格，优先使用 selectedStyles；如果没选，从风格库自动组合。",
        "所有面向用户编辑的字段用中文输出，后续生成脚本时再输出指定语言。",
        "上传了多个竞品视频时，competitorVideoAnalyses 必须逐个列出。",
        "当前请求只包含视频元数据，不包含视频画面帧和音频；不得声称已看过视频内容。",
        "competitorAnalysis 中只保留开头 hook、卖点表达、CTA，并尽量提取原视频文案 originalCopy 及中文翻译 originalCopyZh；如果没有真实视频内容，只能根据用户备注提取。",
      ],
      styleLibrary: [
        "UGC 真实测评",
        "开箱种草",
        "痛点解决",
        "前后对比",
        "场景演示",
        "达人口播",
        "情绪共鸣",
        "剧情反转",
        "礼物推荐",
        "低价冲动购买",
        "工厂/老板视角",
        "街头采访感",
        "生活小技巧",
        "通勤/旅行场景",
        "家庭日常场景",
        "节日促销场景",
      ],
      productInput: input,
    },
    null,
    2
  );
}

function buildCopyPrompt(input) {
  const confirmedCopyBrief = buildConfirmedCopyBrief(input);
  return JSON.stringify(
    {
      task: "根据已确认的卖点、人群、开头切入和方案策略卡，生成 12-30 秒 TikTok 带货口播文案。",
      copyStandard: {
        duration: "12-30 秒",
        structure: "吸引目标人群注意开头 + 多卖点叠加 + 呼吁下单",
        openingGoal: "解决用户为什么看下去，优先增加停留并打中目标人群",
        middleGoal: "解决用户为什么买：尽可能自然叠加多个卖点，让顾客感觉这个东西功能多、场景多、价格划算，非常值。",
        endingGoal: "解决用户为什么现在买",
        localization:
          "本土化靠目标国家真实用户会使用的表达方式、语气、消费心理、生活场景和促销敏感点体现，不要靠生硬加入“大马人”“新加坡人”等国籍称呼。确保习语、俚语和宗教禁忌符合目标国家文化，避免翻译腔。马来西亚强调促销敏感、实用、省钱、家庭/日常场景。",
        style: "极具 TikTok 网感，口语化、有煽动性、充满活力。",
      },
      outputRules: [
        "每个 planStrategy 生成 1 条文案。",
        "voiceover 使用 productInput.outputLanguage 对应语言。",
        "voiceoverZh 必须是简体中文自然翻译，只能使用中文，不得输出目标语言、泰语、马来语、英语或拼音。",
        "editedZh 初始必须完全等于 voiceoverZh，供用户后续微调；即使指定输出语言不是中文，editedZh 也必须是中文。",
        "如果目标语言是泰语、马来语、英语等，仍然只有 voiceover 字段使用目标语言，voiceoverZh/editedZh 绝不能跟随目标语言。",
        "如果 productInput.referenceCopies 有内容，必须学习参考文案的 hook 类型、句子节奏、卖点叠加方式、CTA 力度和网感表达，但不能复制原句或只替换产品名。",
        "参考文案只作为表达结构和转化方式的学习样本；必须重新结合当前产品、目标人群、目标国家和核心卖点生成新文案。",
        "confirmedCopyBrief 是用户在第二屏确认/修改后的最终文案生成依据，必须优先于第一页原始输入。",
        "每条文案必须基于 confirmedCopyBrief.perPlanBriefs 中对应方案生成，不得脱离第二屏确认后的风格、人群、开头切入和卖点池。",
        "开头第一句必须优先服务停留，不要急着介绍产品；先让目标用户觉得“这是在说我”或“我想继续看”。",
        "如果 perPlanBrief.hookType 是引起共鸣，优先命中高频困扰和精准人群；如果是引起好奇，优先做反差、未完成动作、效果对比、开箱或反直觉；如果是引起恐惧/避坑，优先做用户教育和踩坑提醒；如果是引起向往，优先做身份代入和理想生活投射；如果是引起满足，优先做爽感、整理前后或治愈感。",
        "每条文案必须优先覆盖 confirmedCopyBrief.requiredCoreSellingPoints，不得遗漏用户明确填写或第二屏标为主项的必须视频呈现点。",
        "每条文案必须使用对应 perPlanBrief.mustMentionSellingPoints 和 perPlanBrief.valueStack；如果 valueStack 超过 5 个，至少自然讲到 4 个。",
        "除核心卖点外，必须从补充卖点、使用场景、规格、价格优势或促销信息中继续叠加，形成“太值了”的感觉。",
        "卖点叠加要像真实 TikTok 口播，不要机械罗列；可以用短句、并列句、场景化表达把多个卖点连起来。",
        "如果 confirmedCopyBrief.promotionInfo 中包含具体促销、套装、折扣、赠品、低价、买几件更划算等信息，结尾 CTA 必须使用这些具体信息。",
        "如果用户没有提供明确促销信息，结尾可以使用宽泛但自然的活动说法，例如“现在卖家在做活动”“现在入手更划算”“趁活动还在先加购物车”。",
        "不得用“马来西亚人/大马人/新加坡人/本地人”等标签式称呼来假装本土化，除非用户明确要求。",
        "优先使用目标语言里自然的口语连接词、购买表达、促销表达和生活化说法，让当地用户听起来像真实 TikTok 内容。",
        "不要使用宗教敏感表达，不要夸张承诺除菌、治病、永久除味。",
        "结尾必须给现在买的理由，例如优惠、套装更划算、多空间使用、限时库存等。",
      ],
      confirmedCopyBrief,
      productInput: input.productInput,
      aiAnalysis: input.aiAnalysis,
    },
    null,
    2
  );
}

function buildConfirmedCopyBrief(input) {
  const productInput = input.productInput || {};
  const aiAnalysis = input.aiAnalysis || {};
  const confirmedSellingPoints = (aiAnalysis.sellingPoints || []).map((point, index) => ({
    title: point.title || "",
    description: point.description || "",
    isPrimary: Boolean(point.isPrimary),
    order: index + 1,
  }));
  const primaryConfirmedSellingPoints = confirmedSellingPoints
    .filter((point) => point.isPrimary)
    .flatMap((point) => [point.title, point.description])
    .filter(Boolean);
  const requiredCoreSellingPoints = uniqueItems([
    ...splitLocal(productInput.rawCoreSellingPoints),
    ...primaryConfirmedSellingPoints,
  ]);
  const userSellingAndPromoPoints = splitLocal(productInput.rawSellingPoints);
  const confirmedSellingPointTexts = confirmedSellingPoints
    .flatMap((point) => [point.title, point.description])
    .filter(Boolean);
  const confirmedUseCases = (aiAnalysis.useCases || []).map((item) => item.scene).filter(Boolean);
  const confirmedAudiences = (aiAnalysis.audiences || []).map((item) => item.name || item.motivation).filter(Boolean);
  const confirmedOpeningHooks = (aiAnalysis.openingHooks || []).map((item) => item.summary || item.hookType).filter(Boolean);
  const promotionInfo = userSellingAndPromoPoints.filter((point) =>
    /促销|优惠|折扣|活动|买|送|包邮|低价|便宜|划算|套装|赠品|price|sale|promo|discount/i.test(point)
  );
  const baseValueStack = uniqueItems([
    ...requiredCoreSellingPoints,
    ...userSellingAndPromoPoints,
    ...confirmedSellingPointTexts,
    ...confirmedUseCases.map((scene) => `可用于${scene}`),
  ]).slice(0, 10);

  return {
    source: "second_screen_confirmed_aiAnalysis",
    instruction: "先整合第二屏卖点确认结果，再按文案结构生成口播。",
    confirmedSellingPoints,
    confirmedAudiences,
    confirmedOpeningHooks,
    confirmedUseCases,
    requiredCoreSellingPoints,
    supplementarySellingPoints: uniqueItems([...userSellingAndPromoPoints, ...confirmedSellingPointTexts]).slice(0, 12),
    promotionInfo,
    referenceCopyLearningTargets: (productInput.referenceCopies || []).slice(0, 3).map((copy, index) => ({
      index: index + 1,
      learn: "学习 hook、句子节奏、卖点叠加方式和 CTA 力度，不复制原句。",
      text: copy,
    })),
    perPlanBriefs: (aiAnalysis.planStrategies || []).map((plan, index) => {
      const rotated = rotateItems(baseValueStack, index).slice(0, Math.min(6, Math.max(4, baseValueStack.length)));
      return {
        planNo: plan.planNo || index + 1,
        style: plan.style || "",
        audience: plan.audience || "",
        hookType: plan.hookType || "",
        openingSummary: plan.openingSummary || "",
        openingDetail: plan.openingDetail || "",
        sceneHint: plan.sceneHint || "",
        hookGoal: "开头先提高停留，再用目标人群和开头切入让用户愿意继续看。",
        buyGoal: "中段用确认后的卖点池做值感堆叠，让用户觉得值得买。",
        ctaGoal: promotionInfo.length ? "结尾使用用户提供的促销/价格/套装信息催单。" : "结尾使用宽泛但自然的活动理由催单。",
        mustMentionSellingPoints: requiredCoreSellingPoints,
        valueStack: rotated,
        ctaSource: promotionInfo.length ? promotionInfo : ["现在卖家在做活动", "现在入手更划算", "趁活动还在先加购物车"],
        writingInstruction:
          "严格按“吸引目标群体注意开头 + 卖点叠加 + 呼吁下单”生成；开头必须优先服务停留和人群命中；中段必须围绕 valueStack 做自然口播式卖点叠加，不要像项目符号。",
      };
    }),
  };
}

function uniqueItems(items) {
  return items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function rotateItems(items, offset) {
  if (!items.length) return [];
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function normalizeVideoScripts(scripts = []) {
  return (Array.isArray(scripts) ? scripts : []).map((script) => ({
    ...script,
    segments: (script.segments || []).map((segment) => normalizeVideoSegment(segment, script.model)),
  }));
}

function normalizeVideoSegment(segment = {}, model = "") {
  const normalizedModel = String(model || "").toLowerCase();
  return {
    ...segment,
    referencePrompt: normalizePromptBlock(segment.referencePrompt || ""),
    videoPrompt: normalizeSegmentVideoPrompt(segment.videoPrompt || "", normalizedModel === "veo"),
  };
}

function normalizePromptBlock(text = "") {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSegmentVideoPrompt(text = "", keepReferenceField = false) {
  let normalized = normalizePromptBlock(text)
    .replace(/镜头\s*(\d+)\s*[:：]\s*/g, "\n镜头$1：\n")
    .replace(/【参考图】/g, "\n【参考图】")
    .replace(/【动态内容】/g, "\n【动态内容】")
    .replace(/【镜头运动】/g, "\n【镜头运动】")
    .replace(/【口播\/字幕】/g, "\n【口播/字幕】");

  if (!keepReferenceField) {
    normalized = normalized.replace(/\n【参考图】[^\n]*/g, "");
  }

  return normalized.replace(/\n{3,}/g, "\n\n").trim();
}

function buildSyncCopyPrompt(input) {
  const productInput = input.productInput || {};
  const draft = input.draft || {};
  const mustShowPoints = splitLocal(productInput.rawCoreSellingPoints).slice(0, 4);
  const sellingPoints = splitLocal(productInput.rawSellingPoints).slice(0, 6);
  return JSON.stringify(
    {
      task: "把用户修改后的中文微调稿，同步改写成目标语言口播。",
      requirements: [
        "不要逐字翻译，要改写成目标国家 TikTok 用户听起来自然的口语。",
        "本土化体现在表达方式、语气、生活细节和消费动机，不要通过硬加国籍标签实现。",
        "不得无意义加入“马来西亚人/大马人/新加坡人/本地人”等称呼，除非中文微调稿明确要求。",
        "保留中文微调稿里的卖点顺序、购买理由、CTA 和语气强度。",
        "如果中文微调稿包含多个卖点叠加、必须视频呈现点或促销信息，目标语言口播必须完整保留这种值感，不要压缩成单一卖点。",
        "长度控制在 12-30 秒口播。",
        "开头抓目标人群注意，中间卖点叠加，结尾呼吁下单。",
        "避免当地文化、宗教禁忌；避免夸张承诺除菌、治病、永久除味。",
      ],
      context: {
        productName: productInput.productName || "",
        targetLanguage: productInput.outputLanguage || "",
        targetCountry: productInput.targetCountry || "",
        audience: draft.audience || "",
        style: draft.style || "",
        mustShowPoints,
        supportingSellingPoints: sellingPoints,
      },
      chineseEditedCopy: draft.editedZh || "",
    },
    null,
    2
  );
}

function buildScriptPrompt(input) {
  const productInput = input.productInput || {};
  const draft = Array.isArray(input.copyDrafts) ? input.copyDrafts[0] || {} : input.copyDrafts || {};
  const planNo = Number(draft.planNo) || 1;
  const plan =
    (input.aiAnalysis?.planStrategies || []).find((item) => Number(item.planNo) === planNo) ||
    input.aiAnalysis?.planStrategies?.[0] ||
    {};
  const requiredCoreSellingPoints = uniqueItems([
    ...splitLocal(productInput.rawCoreSellingPoints).slice(0, 4),
    ...((input.aiAnalysis?.sellingPoints || []).filter((item) => item.isPrimary).flatMap((item) => [item.title, item.description]).slice(0, 4)),
  ]).slice(0, 6);
  const supplementalSellingPoints = uniqueItems([
    ...splitLocal(productInput.rawSellingPoints).slice(0, 6),
    ...((input.aiAnalysis?.sellingPoints || []).flatMap((item) => [item.title, item.description]).slice(0, 8)),
  ]).slice(0, 8);
  return JSON.stringify(
    {
      task: "根据最终保留的口播文案，生成给 Sora/Veo 使用的 AI 视频脚本提示词。",
      modelRules: {
        selectedModel: input.videoModel,
        sora: "每段视频最长 12 秒；每段默认 1 张参考图，只有信息密度明显不足时再补充。",
        veo: "每段视频最长 10 秒；每段可使用 1-3 张参考图。",
        segmentation: "必须先判断目标语言口播长度，再按自然停顿和句意拆段，任何一段都不能超过模型单段视频时长上限。",
        shotsPerSegment: "每段控制在 2-4 个镜头说明，按段输出，不要每个镜头单独生成一份完整 prompt。",
        referenceCount: "Sora 每段默认 1 张；Veo 每段 1-3 张，按该段信息量决定。",
      },
      visualRules: [
        "参考图 prompt 要提高画面信息密度：不要只有单一产品大图，画面中应同时包含产品、包装/配件/使用前后状态、人物动作、场景背景、真实生活或工作环境细节。",
        "productInput.rawCoreSellingPoints 是必须在视频中真实呈现的点，生成参考图和视频 prompt 时必须逐段落实到画面、动作、前后对比、使用状态或场景细节里，不能只停留在口播里。",
        "画面真实感优先：模拟手机拍摄、普通人/工厂/仓库/家庭环境、自然杂乱、轻微不完美，不要像棚拍广告大片。",
        "如果方案风格是“工厂/老板视角”，画面应优先包含工厂打包现场、堆叠纸箱、工人操作、老板/厂长拿产品口播、真实小插曲或忙碌背景，让用户感觉正在看到源头现场。",
        "工厂/老板视角可以使用戏剧化但真实的场面调度，例如老板边走边介绍、工人打包、背景有人争论、产品包装/使用效果同屏展示，但不要过度夸张或像影视片。",
        "分镜图可以描述多宫格/拼图参考：例如左边包装，中间正常光线使用效果，右边暗光/对比效果；但产品外观必须如产品参考图所示。",
      ],
      factoryBossStyleReference: {
        structure:
          "高信息密度工厂现场：包装箱/产品包装/产品正常效果/特殊效果或使用前后对比同屏出现，老板或厂长拿产品靠近镜头，背景工人打包、搬货、指挥或发生真实小插曲。",
        camera:
          "像手机临时拍到的真实现场，手持轻微晃动，镜头里允许有人挡一下、走动、背景杂乱，但主体信息清楚。",
        usage:
          "只有当方案风格为工厂/老板视角，或产品适合源头工厂、发货、补货、质量解释、售后承诺、爆款补货等话题时使用。",
      },
      referencePromptFormat: [
        "参考图 prompt 必须一段一个，不要一个镜头一个。",
        "开头先写：生成X张参考图。",
        "然后固定输出【画面风格】【构图】【避免】。",
        "接着按顺序写：第1张：... 第2张：... 第3张：...",
        "每一张都要明确这一张里呈现的产品状态、人物动作、场景、以及这一张负责承接的必须视频呈现点。",
      ],
      videoPromptFormat: [
        "视频 prompt 必须一段一个，不要按镜头拆成多份 prompt。",
        "开头固定输出【风格】【镜头】【约束】。",
        "Veo 的镜头按顺序写：镜头1：{【参考图】【动态内容】【镜头运动】【口播/字幕】}，镜头2：...",
        "Sora 因为每段通常只有 1 张参考图，所以镜头里不要重复写【参考图】字段，只写【动态内容】【镜头运动】【口播/字幕】。",
        "为了后续复制到飞书表格里更易读，每个镜头块必须换行书写，不要把镜头1、镜头2压成一整长行。",
        "镜头里的口播/字幕必须只使用该段对应的目标语言文案片段，不要把整条口播重复塞进每个镜头。",
      ],
      outputStructure: [
        "每条脚本都必须输出 videoTitle（目标语言）和 tags（3-5 个）。",
        "videoTitle 要像当地 TikTok 热门标题，能勾起点击或继续看下去的欲望。",
        "tags 要覆盖产品、场景、风格或购买动机，避免无关热词堆砌。",
      ],
      titleAndTagRules: [
        "每条脚本必须生成 videoTitle：使用 productInput.outputLanguage 对应语言，适合目标国家 TikTok 用户，能制造好奇或利益点，吸引用户继续看。",
        "videoTitle 不要用生硬国籍标签假装本土化，不要虚假承诺，不要夸张医疗/除菌效果。",
        "每条脚本必须生成 tags：3-5 个当地 TikTok 可用 tag，可包含 #TikTokShop、产品类目、使用场景、风格或购买动机。",
        "tags 要服务于搜索和转化，不要堆无关热门词。",
      ],
      currentScriptOnly: {
        planNo,
        videoModel: input.videoModel,
        productName: productInput.productName || "",
        targetCountry: productInput.targetCountry || "",
        outputLanguage: productInput.outputLanguage || "",
        style: draft.style || plan.style || "",
        audience: draft.audience || plan.audience || "",
        hookType: plan.hookType || "",
        openingSummary: plan.openingSummary || "",
        openingDetail: plan.openingDetail || "",
        sceneHint: plan.sceneHint || "",
        requiredCoreSellingPoints,
        supplementalSellingPoints,
        voiceover: draft.voiceover || "",
        editedZh: draft.editedZh || "",
      },
    },
    null,
    2
  );
}

function scriptSchema(scriptCount = 1) {
  const count = Math.max(1, Math.min(Number(scriptCount) || 1, 10));
  const stringField = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["scripts"],
    properties: {
      scripts: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["planNo", "style", "model", "totalDuration", "videoTitle", "tags", "voiceover", "editedZh", "segments"],
          properties: {
            planNo: { type: "number" },
            style: stringField,
            model: stringField,
            totalDuration: { type: "number" },
            videoTitle: stringField,
            tags: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: stringField,
            },
            voiceover: stringField,
            editedZh: stringField,
            segments: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["segmentNo", "duration", "referenceCount", "segmentVoiceover", "segmentEditedZh", "referencePrompt", "videoPrompt", "shots"],
                properties: {
                  segmentNo: { type: "number" },
                  duration: { type: "number" },
                  referenceCount: { type: "number" },
                  segmentVoiceover: stringField,
                  segmentEditedZh: stringField,
                  referencePrompt: stringField,
                  videoPrompt: stringField,
                  shots: {
                    type: "array",
                    minItems: 1,
                    maxItems: 5,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["shotNo", "duration", "referenceRef", "dynamicContent", "cameraMovement", "subtitle"],
                      properties: {
                        shotNo: { type: "number" },
                        duration: { type: "number" },
                        referenceRef: stringField,
                        dynamicContent: stringField,
                        cameraMovement: stringField,
                        subtitle: stringField,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function syncCopySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["voiceover"],
    properties: {
      voiceover: { type: "string" },
    },
  };
}

function chineseCopyRepairSchema(count = 1) {
  const maxItems = Math.max(1, Math.min(Number(count) || 1, 10));
  const stringField = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["repairedDrafts"],
    properties: {
      repairedDrafts: {
        type: "array",
        minItems: maxItems,
        maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "planNo", "voiceoverZh", "editedZh"],
          properties: {
            index: { type: "number" },
            planNo: { type: "number" },
            voiceoverZh: stringField,
            editedZh: stringField,
          },
        },
      },
    },
  };
}

function copySchema(planCount = 5) {
  const maxPlans = Math.max(1, Math.min(Number(planCount) || 5, 10));
  const stringField = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["copyDrafts"],
    properties: {
      copyDrafts: {
        type: "array",
        minItems: maxPlans,
        maxItems: maxPlans,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "planNo",
            "style",
            "audience",
            "duration",
            "hook",
            "voiceover",
            "voiceoverZh",
            "editedZh",
            "cta",
            "selected",
          ],
          properties: {
            planNo: { type: "number" },
            style: stringField,
            audience: stringField,
            duration: stringField,
            hook: stringField,
            voiceover: stringField,
            voiceoverZh: stringField,
            editedZh: stringField,
            cta: stringField,
            selected: { type: "boolean" },
          },
        },
      },
    },
  };
}

function analysisSchema(planCount = 5) {
  const maxPlans = Math.max(1, Math.min(Number(planCount) || 5, 10));
  const stringField = { type: "string" };

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "sellingPoints",
      "audiences",
      "openingHooks",
      "useCases",
      "planStrategies",
      "competitorVideoAnalyses",
      "competitorAnalysis",
    ],
    properties: {
      sellingPoints: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "description", "angle", "isPrimary"],
          properties: {
            title: stringField,
            description: stringField,
            angle: stringField,
            isPrimary: { type: "boolean" },
          },
        },
      },
      audiences: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "motivation", "contentAngle", "isPrimary"],
          properties: {
            name: stringField,
            motivation: stringField,
            contentAngle: stringField,
            isPrimary: { type: "boolean" },
          },
        },
      },
      openingHooks: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["hookType", "summary", "stayReason", "targetAudience", "sceneHint", "videoExpression", "priority"],
          properties: {
            hookType: stringField,
            summary: stringField,
            stayReason: stringField,
            targetAudience: stringField,
            sceneHint: stringField,
            videoExpression: stringField,
            priority: { type: "number" },
          },
        },
      },
      useCases: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["scene", "shotSuggestion", "localizationNote"],
          properties: {
            scene: stringField,
            shotSuggestion: stringField,
            localizationNote: stringField,
          },
        },
      },
      planStrategies: {
        type: "array",
        minItems: maxPlans,
        maxItems: maxPlans,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["planNo", "style", "audience", "hookType", "openingSummary", "openingDetail", "stayReason", "sceneHint", "angle"],
          properties: {
            planNo: { type: "number" },
            style: stringField,
            audience: stringField,
            hookType: stringField,
            openingSummary: stringField,
            openingDetail: stringField,
            stayReason: stringField,
            sceneHint: stringField,
            angle: stringField,
          },
        },
      },
      competitorVideoAnalyses: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "status", "note", "index"],
          properties: {
            name: stringField,
            status: stringField,
            note: stringField,
            index: { type: "number" },
          },
        },
      },
      competitorAnalysis: {
        type: "object",
        additionalProperties: false,
        required: [
          "hook",
          "sellingExpression",
          "originalCopy",
          "originalCopyZh",
          "cta",
        ],
        properties: {
          hook: stringField,
          sellingExpression: stringField,
          originalCopy: stringField,
          originalCopyZh: stringField,
          cta: stringField,
        },
      },
    },
  };
}

function collectOutputText(data) {
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function collectGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("");
}

function stripJsonCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseModelJson(text) {
  const cleaned = stripJsonCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      return JSON.parse(extracted);
    }
    throw error;
  }
}

function extractFirstJsonObject(text) {
  const source = String(text || "").trim();
  const start = source.search(/[\[{]/);
  if (start === -1) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return "";
}

function isAuthEnabled() {
  return TEAM_USERS.size > 0;
}

function ensureAuthenticated(req, res, urlPath) {
  if (!isAuthEnabled()) return true;
  if (urlPath === "/login.html") return true;

  const session = getSession(req);
  if (session) return true;

  if (urlPath.startsWith("/api/")) {
    sendJson(res, 401, { error: "请先登录" });
    return false;
  }

  res.writeHead(302, { Location: "/login.html" });
  res.end();
  return false;
}

function parseTeamUsers(raw) {
  const users = new Map();
  String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const separator = item.indexOf(":");
      if (separator <= 0) return;
      const username = item.slice(0, separator).trim();
      const password = item.slice(separator + 1);
      if (username && password) users.set(username, password);
    });
  return users;
}

function createSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({ user, exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie || "").ai_tiktok_session;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== sign(payload)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.user || !data.exp || Date.now() > data.exp) return null;
    if (!TEAM_USERS.has(data.user)) return null;
    return data;
  } catch {
    return null;
  }
}

function sign(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    String(cookieHeader || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function buildSessionCookie(token) {
  return [
    `ai_tiktok_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie() {
  return [
    "ai_tiktok_session=",
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("请求内容过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON 请求格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": mimeTypes[ext] || "application/octet-stream" };
    if ([".html", ".css", ".js"].includes(ext)) {
      headers["Cache-Control"] = "no-store, max-age=0";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
