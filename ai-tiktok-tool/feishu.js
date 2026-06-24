const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const DEFAULT_FEISHU_APP_ID = "cli_aab1c7d41f631cd5";
const PRODUCT_TABLE_NAME = process.env.FEISHU_PRODUCT_TABLE_NAME || "产品信息表";
const SCRIPT_TABLE_NAME = process.env.FEISHU_SCRIPT_TABLE_NAME || "脚本文案表";

const PRODUCT_FIELDS = [
  "产品名称",
  "产品图片",
  "卖点/促销",
  "核心卖点",
  "使用场景",
  "目标人群",
  "目标国家",
  "输出语言",
  "生成方案数量",
  "风格库选择",
  "参考文案",
  "竞品视频",
  "竞品备注",
  "确认卖点",
  "确认人群",
  "确认痛点",
  "确认场景",
  "确认方案",
  "更新时间",
  "备注",
];

const SCRIPT_FIELDS = [
  "新增日期",
  "方案编号",
  "产品名称",
  "目标国家",
  "输出语言",
  "风格组合",
  "目标人群",
  "痛点",
  "中文微调稿",
  "目标语言口播",
  "视频标题",
  "Tags",
  "模型类型",
  "总时长",
  "分段数量",
  "参考图 prompt",
  "视频生成 prompt",
  "完整脚本",
  "脚本状态",
  "是否最终选用",
  "备注",
];

function getFeishuConfig() {
  return getFeishuConfigWithOverrides();
}

function getFeishuConfigWithOverrides(overrides = {}) {
  const rawBitableUrl = String(overrides.bitableUrl || overrides.feishuBitableUrl || "").trim();
  const parsedLink = rawBitableUrl ? parseFeishuBitableUrl(rawBitableUrl) : null;
  const config = {
    appId: String(process.env.FEISHU_APP_ID || DEFAULT_FEISHU_APP_ID).trim(),
    appSecret: String(process.env.FEISHU_APP_SECRET || "").trim(),
    appToken: String(overrides.appToken || parsedLink?.appToken || process.env.FEISHU_APP_TOKEN || "").trim(),
    bitableUrl: rawBitableUrl || process.env.FEISHU_BITABLE_URL || "",
    scriptTableId: String(overrides.scriptTableId || process.env.FEISHU_SCRIPT_TABLE_ID || "").trim(),
    productTableId: String(overrides.productTableId || process.env.FEISHU_PRODUCT_TABLE_ID || "").trim(),
    linkedTableId: String(overrides.tableId || parsedLink?.table || "").trim(),
  };

  const missing = [];
  if (!config.appSecret) missing.push("FEISHU_APP_SECRET");
  if (!config.appToken) missing.push("FEISHU_APP_TOKEN");

  if (missing.length) {
    throw new Error(`缺少飞书配置：${missing.join(", ")}`);
  }

  return config;
}

function parseFeishuBitableUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("飞书多维表链接格式不正确，请粘贴完整的 https 链接。");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const baseIndex = segments.findIndex((segment) => segment === "base");
  const appToken = baseIndex >= 0 ? segments[baseIndex + 1] || "" : "";
  if (!appToken) {
    throw new Error("无法从飞书多维表链接中识别 app token，请确认链接是多维表页面链接。");
  }

  return {
    appToken,
    url: url.toString(),
    table: url.searchParams.get("table") || "",
    view: url.searchParams.get("view") || "",
  };
}

async function getTenantAccessToken(config = getFeishuConfig()) {
  const response = await fetch(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(formatFeishuError("获取 tenant_access_token 失败", data, response.status));
  }
  return data.tenant_access_token;
}

async function listRecords({ appToken, tableId, tenantAccessToken, pageSize = 5, pageToken = "" }) {
  const params = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) params.set("page_token", pageToken);

  const response = await fetch(
    `${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${params}`,
    {
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(formatFeishuError("读取多维表格记录失败", data, response.status));
  }
  return data.data || { items: [] };
}

async function listAllTables({ appToken, tenantAccessToken }) {
  const tables = [];
  let pageToken = "";
  do {
    const { response, data } = await requestTableListPage({ appToken, tenantAccessToken, pageToken });
    if (!response.ok || data.code !== 0) {
      throw new Error(formatFeishuError("读取多维表格 sheet 列表失败", data, response.status));
    }
    tables.push(...(data.data?.items || []));
    pageToken = data.data?.page_token || "";
  } while (pageToken);
  return tables;
}

async function requestTableListPage({ appToken, tenantAccessToken, pageToken = "" }) {
  const headers = {
    Authorization: `Bearer ${tenantAccessToken}`,
  };
  const params = new URLSearchParams({ page_size: "20" });
  if (pageToken) params.set("page_token", pageToken);

  let response = await fetch(`${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?${params}`, {
    headers,
  });
  let data = await response.json().catch(() => ({}));

  const shouldRetryWithoutParams =
    data?.code === 1254001 &&
    String(data?.msg || "").toLowerCase() === "wrongrequestbody" &&
    !pageToken;

  if (shouldRetryWithoutParams) {
    response = await fetch(`${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`, {
      headers,
    });
    data = await response.json().catch(() => ({}));
  }

  return {
    response,
    data,
  };
}

function getTableName(table) {
  return table?.name || table?.table_name || "";
}

function getTableId(table) {
  return table?.table_id || table?.id || "";
}

function findTableByName(tables, name) {
  return tables.find((table) => getTableName(table) === name);
}

async function createTable({ appToken, tenantAccessToken, name, fields }) {
  const response = await fetch(`${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      table: {
        name,
        default_view_name: "默认视图",
        fields: fields.map((fieldName) => ({
          field_name: fieldName,
          type: 1,
        })),
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(formatFeishuError(`创建 sheet「${name}」失败`, data, response.status));
  }
  return data.data?.table || data.data;
}

async function listFields({ appToken, tableId, tenantAccessToken }) {
  const fields = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);
    const response = await fetch(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?${params}`,
      {
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
        },
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0) {
      throw new Error(formatFeishuError("读取字段列表失败", data, response.status));
    }
    fields.push(...(data.data?.items || []));
    pageToken = data.data?.page_token || "";
  } while (pageToken);
  return fields;
}

async function createTextField({ appToken, tableId, tenantAccessToken, fieldName }) {
  const response = await fetch(
    `${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        field_name: fieldName,
        type: 1,
      }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(formatFeishuError(`创建字段「${fieldName}」失败`, data, response.status));
  }
  return data.data?.field || data.data;
}

async function ensureTextFields({ appToken, tableId, tenantAccessToken, fieldNames }) {
  const existingFields = await listFields({ appToken, tableId, tenantAccessToken });
  const existingNames = new Set(existingFields.map((field) => field.field_name || field.name).filter(Boolean));
  const created = [];
  for (const fieldName of fieldNames) {
    if (existingNames.has(fieldName)) continue;
    await createTextField({ appToken, tableId, tenantAccessToken, fieldName });
    created.push(fieldName);
  }
  return created;
}

function isWrongRequestBodyError(error) {
  const message = String(error?.message || error || "");
  return /1254001/.test(message) || /WrongRequestBody/i.test(message);
}

async function ensureTableByName({ appToken, tenantAccessToken, tableId, name, fields, preferredTableId = "" }) {
  if (tableId) {
    await ensureTextFields({ appToken, tableId, tenantAccessToken, fieldNames: fields });
    return { tableId, created: false, name };
  }

  if (preferredTableId) {
    await ensureTextFields({ appToken, tableId: preferredTableId, tenantAccessToken, fieldNames: fields });
    return { tableId: preferredTableId, created: false, name };
  }

  try {
    const tables = await listAllTables({ appToken, tenantAccessToken });
    const existingTable = findTableByName(tables, name);
    if (existingTable) {
      const existingTableId = getTableId(existingTable);
      await ensureTextFields({ appToken, tableId: existingTableId, tenantAccessToken, fieldNames: fields });
      return { tableId: existingTableId, created: false, name: getTableName(existingTable) };
    }
  } catch (error) {
    if (!isWrongRequestBodyError(error)) throw error;
  }

  const table = await createTable({ appToken, tenantAccessToken, name, fields });
  return { tableId: getTableId(table), created: true, name };
}

async function createRecord({ appToken, tableId, tenantAccessToken, fields }) {
  const response = await fetch(
    `${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ fields }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(formatFeishuError("写入多维表格记录失败", data, response.status));
  }
  return data.data?.record;
}

async function updateRecord({ appToken, tableId, tenantAccessToken, recordId, fields }) {
  const response = await fetch(
    `${FEISHU_BASE_URL}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ fields }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(formatFeishuError("更新多维表格记录失败", data, response.status));
  }
  return data.data?.record;
}

async function findRecordByField({ appToken, tableId, tenantAccessToken, fieldName, value }) {
  let pageToken = "";
  do {
    const data = await listRecords({ appToken, tableId, tenantAccessToken, pageSize: 100, pageToken });
    const record = (data.items || []).find((item) => stringifyFieldValue(item.fields?.[fieldName]) === String(value || ""));
    if (record) return record;
    pageToken = data.page_token || "";
  } while (pageToken);
  return null;
}

function normalizeLegacyRecords(records = []) {
  return records.map((record, index) => {
    const fields = record.fields || {};
    const filledEntries = Object.entries(fields).filter(([, value]) => hasValue(value));
    return {
      index: index + 1,
      recordId: record.record_id || "",
      rawFields: fields,
      referenceText: filledEntries.map(([key, value]) => `${key}：${stringifyFieldValue(value)}`).join("\n"),
      detectedLanguage: detectLanguage(filledEntries.map(([, value]) => stringifyFieldValue(value)).join("\n")),
      possibleType: inferPossibleType(fields),
    };
  });
}

function buildProductInfoFields({ productInput = {}, aiAnalysis = {} }) {
  return {
    产品名称: productInput.productName || "",
    产品图片: (productInput.productImages || []).join("\n"),
    "卖点/促销": productInput.rawSellingPoints || "",
    核心卖点: productInput.rawCoreSellingPoints || "",
    使用场景: productInput.rawUseCases || "",
    目标人群: productInput.rawAudience || "",
    目标国家: productInput.targetCountry || "",
    输出语言: productInput.outputLanguage || "",
    生成方案数量: String(productInput.planCount || ""),
    风格库选择: (productInput.selectedStyles || []).join("、"),
    参考文案: (productInput.referenceCopies || []).join("\n\n---\n\n"),
    竞品视频: (productInput.competitorVideos || []).map((video) => video.name).join("\n"),
    竞品备注: productInput.competitorNotes || "",
    确认卖点: (aiAnalysis.sellingPoints || []).map((point) => `${point.title || ""}：${point.description || ""}`).join("\n"),
    确认人群: (aiAnalysis.audiences || []).map((item) => `${item.name || ""}：${item.motivation || ""}`).join("\n"),
    确认痛点: (aiAnalysis.painPoints || []).map((item) => `${item.pain || ""}：${item.emotion || ""}`).join("\n"),
    确认场景: (aiAnalysis.useCases || []).map((item) => `${item.scene || ""}：${item.shotSuggestion || ""}`).join("\n"),
    确认方案: (aiAnalysis.planStrategies || [])
      .map((item) => `方案${item.planNo || ""}｜${item.style || ""}｜${item.audience || ""}｜${item.painPoint || ""}｜${item.scene || ""}`)
      .join("\n"),
    更新时间: formatLocalDateTime(),
    备注: "由 AI TikTok 带货短视频工作台同步",
  };
}

function buildScriptRecordFields(input = {}) {
  return {
    新增日期: input.createdAt || formatLocalDateTime(),
    方案编号: String(input.planNo || "测试方案"),
    产品名称: input.productName || "飞书模块测试产品",
    目标国家: input.targetCountry || "马来西亚",
    输出语言: input.outputLanguage || "马来语",
    风格组合: input.style || "工厂/老板视角 + 痛点解决",
    目标人群: input.audience || "测试目标人群",
    痛点: input.painPoint || "测试痛点",
    中文微调稿: input.editedZh || "这是一条飞书模块化写入测试中文稿。",
    目标语言口播: input.voiceover || "Ini ialah test copy untuk Feishu.",
    视频标题: input.videoTitle || "Test title untuk Feishu",
    Tags: input.tags || "#TikTokShop #Test #Feishu",
    模型类型: input.model || "Veo",
    总时长: input.totalDuration ? `${input.totalDuration}s` : "",
    分段数量: input.segmentCount ? String(input.segmentCount) : "",
    "参考图 prompt": input.referenceImagePrompt || "测试参考图 prompt：产品如图所示，真实手机拍摄。",
    "视频生成 prompt": input.videoPrompt || "测试视频生成 prompt：真实 TikTok UGC 风格。",
    完整脚本: input.fullScript || "",
    脚本状态: input.status || "测试写入",
    是否最终选用: input.selected || "否",
    备注: input.note || `飞书模块测试写入 ${new Date().toISOString()}`,
  };
}

function buildScriptExportFields({ script = {}, productInput = {}, selectedAt = new Date() } = {}) {
  return buildScriptRecordFields({
    ...script,
    createdAt: formatLocalDateTime(selectedAt),
    productName: productInput.productName || script.productName || "",
    targetCountry: productInput.targetCountry || script.targetCountry || "",
    outputLanguage: productInput.outputLanguage || script.outputLanguage || "",
    style: script.style || "",
    audience: script.audience || "",
    painPoint: script.painPoint || "",
    voiceover: script.voiceover || "",
    editedZh: script.editedZh || "",
    videoTitle: script.videoTitle || "",
    tags: Array.isArray(script.tags) ? script.tags.join(" ") : String(script.tags || ""),
    model: script.model || "",
    segmentCount: (script.segments || []).length,
    referenceImagePrompt: buildScriptPromptText(script, "reference"),
    videoPrompt: buildScriptPromptText(script, "video"),
    fullScript: buildScriptFullText(script, true),
    status: "已导出",
    selected: script.selected ? "是" : "否",
    note: "由 AI TikTok 带货短视频工作台导出",
  });
}

function buildScriptPromptText(script = {}, type = "reference") {
  const lines = [];
  for (const segment of script.segments || []) {
    lines.push(`第 ${segment.segmentNo || ""} 段｜${segment.duration || ""}s｜参考图 ${segment.referenceCount || 1} 张`);
    lines.push(type === "reference" ? "参考图 prompt:" : "视频生成 prompt:");
    lines.push(type === "reference" ? segment.referencePrompt || "" : segment.videoPrompt || "");
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildScriptFullText(script = {}, includeReference = true) {
  const lines = [
    `方案 ${script.planNo || ""}｜${script.style || ""}`,
    `模型：${script.model || ""}`,
    `总时长：${script.totalDuration || ""}s`,
    `当地视频标题：${script.videoTitle || ""}`,
    `Tag 推荐：${Array.isArray(script.tags) ? script.tags.join(" ") : String(script.tags || "")}`,
    "",
  ];
  for (const segment of script.segments || []) {
    lines.push(`第 ${segment.segmentNo || ""} 段｜${segment.duration || ""}s｜参考图 ${segment.referenceCount || 1} 张`);
    lines.push("目标语言段文案：");
    lines.push(segment.segmentVoiceover || "");
    lines.push("中文段文案：");
    lines.push(segment.segmentEditedZh || "");
    if (includeReference) {
      lines.push("参考图 prompt:");
      lines.push(segment.referencePrompt || "");
    }
    lines.push("视频生成 prompt:");
    lines.push(segment.videoPrompt || "");
    lines.push("");
  }
  return lines.join("\n").trim();
}

function formatLocalDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function hasValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

function stringifyFieldValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(stringifyFieldValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.name) return String(value.name);
    if (value.link) return String(value.link);
    return JSON.stringify(value);
  }
  return String(value);
}

function detectLanguage(text) {
  const value = String(text || "");
  const zh = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const th = (value.match(/[\u0e00-\u0e7f]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const languages = [];
  if (zh > 10) languages.push("zh");
  if (th > 10) languages.push("th");
  if (latin > 20) languages.push("latin/ms/en");
  return languages.length > 1 ? "mixed" : languages[0] || "unknown";
}

function inferPossibleType(fields) {
  const keys = Object.keys(fields).join(" ");
  const text = Object.values(fields).map(stringifyFieldValue).join("\n");
  if (/prompt|提示词|分镜|Sora|Veo/i.test(`${keys}\n${text}`)) return "视频prompt/分镜";
  if (/标题|tag|#/i.test(`${keys}\n${text}`)) return "标题/tag";
  if (/口播|文案|Hook|CTA/i.test(`${keys}\n${text}`)) return "口播文案";
  return "参考素材";
}

function formatFeishuError(prefix, data, status) {
  const hint =
    data?.code === 1254001
      ? "可能原因：飞书多维表链接不是标准 base 链接，或当前应用没有目标多维表权限，或飞书接口参数格式不被当前租户接受。"
      : "";
  return [
    prefix,
    `HTTP 状态：${status}`,
    `飞书 code：${data.code ?? "unknown"}`,
    `飞书 msg：${data.msg || data.message || "unknown"}`,
    hint,
  ].join("\n");
}

module.exports = {
  PRODUCT_FIELDS,
  SCRIPT_FIELDS,
  PRODUCT_TABLE_NAME,
  SCRIPT_TABLE_NAME,
  getFeishuConfig,
  getFeishuConfigWithOverrides,
  getTenantAccessToken,
  parseFeishuBitableUrl,
  listAllTables,
  getTableName,
  getTableId,
  findTableByName,
  createTable,
  listFields,
  createTextField,
  ensureTextFields,
  ensureTableByName,
  listRecords,
  createRecord,
  updateRecord,
  findRecordByField,
  normalizeLegacyRecords,
  buildScriptRecordFields,
  buildProductInfoFields,
  buildScriptExportFields,
  buildScriptFullText,
};
