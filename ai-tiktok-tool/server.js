const http = require("http");
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");

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

async function handleAnalyze(req, res) {
  const input = await readJsonBody(req);
  if (!hasProviderKey()) {
    if (process.env.MOCK_AI === "1") {
      sendJson(res, 200, { analysis: createMockAnalysis(input) });
      return;
    }
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
  if (!hasProviderKey()) {
    if (process.env.MOCK_AI === "1") {
      sendJson(res, 200, { copyDrafts: createMockCopyDrafts(input) });
      return;
    }
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
  sendJson(res, 200, { copyDrafts: copyDrafts.copyDrafts });
}

async function handleSyncCopy(req, res) {
  const input = await readJsonBody(req);
  if (!hasProviderKey()) {
    if (process.env.MOCK_AI === "1") {
      sendJson(res, 200, {
        voiceover: createMockSyncedVoiceover(input),
      });
      return;
    }
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
  if (!hasProviderKey()) {
    if (process.env.MOCK_AI === "1") {
      sendJson(res, 200, { scripts: createMockVideoScripts(input) });
      return;
    }
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
  sendJson(res, 200, { scripts: result.scripts });
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
  const painPoints = [
    "衣柜有闷味，衣服不够清新",
    "鞋柜、洗手间、车里有小异味",
    "香薰太浓太刺鼻",
    "想让衣服香香但不想每天喷香水",
    "想买便宜又实用的家居小物",
  ].map((pain, index) => ({
    pain,
    emotion: "希望简单、便宜、马上改善。",
    videoExpression: "用真实场景 before/after 展示。",
    priority: index + 1,
  }));
  const useCases = splitLocal(input.rawUseCases || "衣柜、鞋柜、洗手间、客厅、车内").map((scene) => ({
    scene,
    shotSuggestion: "手机竖屏实拍，真实家庭场景。",
    localizationNote: `${input.targetCountry || "目标国家"} 本土生活环境，避免棚拍感。`,
  }));
  const sellingPoints = splitLocal(input.rawSellingPoints || "6种香味，自带挂钩，香气不冲鼻，便宜，造型可爱").map(
    (item, index) => ({
      title: item.slice(0, 18),
      description: item,
      angle: "适合做短句种草卖点。",
      isPrimary: index === 0,
    })
  );
  const planStrategies = Array.from({ length: planCount }, (_, index) => ({
    planNo: index + 1,
    style: styles[index % styles.length],
    audience: audiences[index % audiences.length]?.name || "目标用户",
    painPoint: painPoints[index % painPoints.length].pain,
    scene: useCases[index % useCases.length]?.scene || "日常场景",
    angle: "开头抓痛点，中间叠加卖点，结尾促销下单。",
  }));

  return {
    sellingPoints,
    audiences,
    painPoints,
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
  return strategies.map((strategy) => ({
    planNo: strategy.planNo,
    style: strategy.style,
    audience: strategy.audience,
    duration: "20-30s",
    hook: `Kalau ${strategy.audience} selalu pening dengan ${strategy.painPoint}, dengar ni.`,
    voiceover: `Kalau ${strategy.audience} selalu pening dengan ${strategy.painPoint}, benda kecil ni memang kena cuba. Gantung je dekat ${strategy.scene}, bau dia lembut, tak menusuk hidung, dan bentuk dia comel. Yang best, boleh beli beberapa pek untuk letak dekat tempat berbeza. Kalau tengah ada promo, jangan tunggu lama, add to cart sekarang.`,
    voiceoverZh: `如果${strategy.audience}经常被“${strategy.painPoint}”困扰，这个小东西真的可以试。直接挂在${strategy.scene}，味道淡淡的，不刺鼻，造型也可爱。最划算的是可以买几包放在不同地方。如果现在有优惠，别等太久，马上加购物车。`,
    editedZh: `如果${strategy.audience}经常被“${strategy.painPoint}”困扰，这个小东西真的可以试。直接挂在${strategy.scene}，味道淡淡的，不刺鼻，造型也可爱。最划算的是可以买几包放在不同地方。如果现在有优惠，别等太久，马上加购物车。`,
    cta: "Add to cart sekarang.",
    selected: true,
  }));
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
            referenceImagePrompt: `【参考图编号】\n${modelName}-第 ${segmentIndex + 1} 段-第 ${shotNo} 镜头\n\n【画面主体】\n${input.productInput?.productName || "产品"} 在真实生活场景中出现，产品外观、颜色、形状、包装、图案和细节如产品参考图所示。\n\n【人物与动作】\n真实 TikTok 用户，穿着日常，表情自然，正在展示产品，产品如图所示；外貌和生活状态符合${input.productInput?.targetCountry || "目标国家"}日常内容氛围，但不使用夸张刻板印象。\n\n【场景与本土化】\n普通家庭环境，衣柜、车内、洗手间等生活空间，通过空间细节体现本土生活方式；产品摆放和使用方式如产品参考图所示。\n\n【画面风格】\n真实手机拍摄、TikTok UGC、自然光、不像广告大片。\n\n【构图】\n竖屏 9:16，中近景或手部特写。\n\n【避免】\n不要夸张香味烟雾，不要产品变形，不要改变产品颜色/形状/包装，不要假，不要欧美豪宅背景。`,
            videoPrompt: `【模型】\n${modelName}\n\n【段落与镜头】\n第 ${segmentIndex + 1} 段，第 ${shotNo} 镜头，时长 ${Math.max(2, Math.round(segmentDuration / (videoModel === "veo" ? 3 : 4)))} 秒。\n\n【参考图】\n分镜图 ${shotNo}\n\n【动态内容】\n人物自然展示产品，画面和产品如分镜图 ${shotNo} 所示。\n\n【镜头运动】\n手持轻微晃动 / 慢推近 / 第一人称视角。\n\n【口播/字幕】\n${draft.voiceover}\n\n【风格】\n真实 TikTok UGC，本土生活感，手机拍摄。\n\n【约束】\n保持产品形状一致，画质风格接地气，不改变产品，不生成夸张，不加入无关人物，不出现乱码文字。`,
          };
        }),
      })),
    };
  });
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI API request failed");
  }

  const text = data.output_text || collectOutputText(data);
  if (!text) throw new Error("OpenAI API 没有返回可解析内容");
  return JSON.parse(text);
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
  return JSON.parse(stripJsonCodeFence(text));
}

async function requestGeminiWithRetry(models, payload) {
  const errors = [];
  for (const model of models) {
    const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 1; attempt <= Math.max(1, GEMINI_MAX_RETRIES); attempt += 1) {
      try {
        const response = await requestGemini(url, payload);
        const data = await response.json();
        if (response.ok) return data;

        const message = data.error?.message || "Gemini API request failed";
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
    json: async () => JSON.parse(text || "{}"),
    text: async () => text,
  };
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
        "根据产品名称、卖点、使用场景、目标人群、目标国家、指定语言、竞品备注推导。",
        "目标人群和痛点要服务于每条生成方案，允许部分重复，但不要无依据乱写。",
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
  return JSON.stringify(
    {
      task: "根据已确认的卖点、人群、痛点、场景和方案策略卡，生成 12-30 秒 TikTok 带货口播文案。",
      copyStandard: {
        duration: "12-30 秒",
        structure: "吸引目标人群注意开头 + 卖点叠加 + 呼吁下单",
        openingGoal: "解决用户为什么看下去",
        middleGoal: "解决用户为什么买",
        endingGoal: "解决用户为什么现在买",
        localization:
          "本土化靠目标国家真实用户会使用的表达方式、语气、消费心理、生活场景和促销敏感点体现，不要靠生硬加入“大马人”“新加坡人”等国籍称呼。确保习语、俚语和宗教禁忌符合目标国家文化，避免翻译腔。马来西亚强调促销敏感、实用、省钱、家庭/日常场景。",
        style: "极具 TikTok 网感，口语化、有煽动性、充满活力。",
      },
      outputRules: [
        "每个 planStrategy 生成 1 条文案。",
        "voiceover 使用 productInput.outputLanguage 对应语言。",
        "voiceoverZh 是自然中文翻译。",
        "editedZh 初始等于 voiceoverZh，供用户后续微调。",
        "不得用“马来西亚人/大马人/新加坡人/本地人”等标签式称呼来假装本土化，除非用户明确要求。",
        "优先使用目标语言里自然的口语连接词、购买表达、促销表达和生活化说法，让当地用户听起来像真实 TikTok 内容。",
        "不要使用宗教敏感表达，不要夸张承诺除菌、治病、永久除味。",
        "结尾必须给现在买的理由，例如优惠、套装更划算、多空间使用、限时库存等。",
      ],
      productInput: input.productInput,
      aiAnalysis: input.aiAnalysis,
    },
    null,
    2
  );
}

function buildSyncCopyPrompt(input) {
  return JSON.stringify(
    {
      task: "把用户修改后的中文微调稿，同步改写成目标语言口播。",
      requirements: [
        "不要逐字翻译，要改写成目标国家 TikTok 用户听起来自然的口语。",
        "本土化体现在表达方式、语气、生活细节和消费动机，不要通过硬加国籍标签实现。",
        "不得无意义加入“马来西亚人/大马人/新加坡人/本地人”等称呼，除非中文微调稿明确要求。",
        "保留中文微调稿里的卖点顺序、购买理由、CTA 和语气强度。",
        "长度控制在 12-30 秒口播。",
        "开头抓目标人群注意，中间卖点叠加，结尾呼吁下单。",
        "避免当地文化、宗教禁忌；避免夸张承诺除菌、治病、永久除味。",
      ],
      productInput: input.productInput,
      draft: input.draft,
      chineseEditedCopy: input.draft?.editedZh || "",
      targetLanguage: input.productInput?.outputLanguage || "",
      targetCountry: input.productInput?.targetCountry || "",
    },
    null,
    2
  );
}

function buildScriptPrompt(input) {
  return JSON.stringify(
    {
      task: "根据最终保留的口播文案，生成给 Sora/Veo 使用的 AI 视频脚本提示词。",
      modelRules: {
        selectedModel: input.videoModel,
        sora: "每段视频 12 秒；每段只能 1 张参考图，因此参考图 prompt 需要是拼图参考图，包含 3-5 个关键画面。",
        veo: "每段视频 10 秒；每段最多 3 张参考图。",
        segmentation: "根据每条口播文案时长拆成尽可能少的段数。",
        shotsPerSegment: "每段 10-12 秒控制在 3-5 个镜头。",
        referenceCount: "参考图尽量只用 1-3 张。",
      },
      referencePromptFormat: [
        "【参考图编号】模型-第 X 段-第 X 镜头",
        "【画面主体】描述人物/产品/场景；凡是描述产品外观、颜色、形状、包装、材质、图案、挂钩、尺寸等产品细节，必须写“产品如图所示”或“产品外观如产品参考图所示”。",
        "【人物与动作】人物是谁，符合目标国家真实 TikTok 用户的自然外貌与生活状态；描述皮肤、发型、五官、表情、姿势、动作，但不要用刻板印象或国籍标签；人物展示或使用产品时必须注明产品如图所示。",
        "【场景与本土化】目标国家生活环境。",
        "【画面风格】真实手机拍摄、TikTok UGC、自然光、不像广告大片。",
        "【构图】竖屏 9:16，近景/中景/俯拍/手部特写等。",
        "【避免】不要夸张香味烟雾，不要产品变形，不要改变产品颜色/形状/包装，不要假，不要欧美豪宅背景。",
      ],
      videoPromptFormat: [
        "【模型】Sora / Veo",
        "【段落与镜头】第 X 段，第 X 镜头，时长 X 秒。",
        "【参考图】分镜图 X",
        "【动态内容】描述视频中发生什么动作。",
        "【镜头运动】手持轻微晃动 / 慢推近 / 轻微横移 / 定机位 / 第一人称视角",
        "【口播/字幕】该段对应的目标语言口播和字幕，严格按照上一个阶段生成的文案。",
        "【风格】真实 TikTok UGC，本土生活感，手机拍摄。",
        "【约束】保持产品形状一致，画质风格接地气，不改变产品，不生成夸张，不加入无关人物，不出现乱码文字。",
      ],
      productInput: input.productInput,
      aiAnalysis: input.aiAnalysis,
      copyDrafts: input.copyDrafts,
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
          required: ["planNo", "style", "model", "totalDuration", "voiceover", "editedZh", "segments"],
          properties: {
            planNo: { type: "number" },
            style: stringField,
            model: stringField,
            totalDuration: { type: "number" },
            voiceover: stringField,
            editedZh: stringField,
            segments: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["segmentNo", "duration", "referenceMode", "shots"],
                properties: {
                  segmentNo: { type: "number" },
                  duration: { type: "number" },
                  referenceMode: stringField,
                  shots: {
                    type: "array",
                    minItems: 1,
                    maxItems: 5,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["shotNo", "duration", "referenceImagePrompt", "videoPrompt"],
                      properties: {
                        shotNo: { type: "number" },
                        duration: { type: "number" },
                        referenceImagePrompt: stringField,
                        videoPrompt: stringField,
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
      "painPoints",
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
      painPoints: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["pain", "emotion", "videoExpression", "priority"],
          properties: {
            pain: stringField,
            emotion: stringField,
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
          required: ["planNo", "style", "audience", "painPoint", "scene", "angle"],
          properties: {
            planNo: { type: "number" },
            style: stringField,
            audience: stringField,
            painPoint: stringField,
            scene: stringField,
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
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
