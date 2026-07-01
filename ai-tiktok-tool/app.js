const state = {
  productInput: null,
  aiAnalysis: null,
  copyDrafts: [],
  selectedCopyDrafts: [],
  videoScripts: [],
  selectedVideoModel: "sora",
  pendingFeishuExport: false,
  scriptCache: {},
  manualCopyMode: false,
};

const FEISHU_CONFIG_STORAGE_KEY = "ai_tiktok_tool_feishu_config";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const inputView = $("#inputView");
const reviewView = $("#reviewView");
const copyView = $("#copyView");
const scriptView = $("#scriptView");
const productForm = $("#productForm");
const planCount = $("#planCount");
const planCountOutput = $("#planCountOutput");
const imageInput = $("#productImages");
const videoInput = $("#competitorVideos");
const imagePreview = $("#imagePreview");
const videoList = $("#videoList");

const countryLanguageMap = {
  泰国: "泰语",
  越南: "越南语",
  印尼: "印尼语",
  马来西亚: "马来语",
  菲律宾: "菲律宾语",
  新加坡: "英语",
};

const categorySignals = {
  家居: ["收纳", "清洁", "厨房", "家居", "卧室", "浴室", "置物", "整理"],
  饰品: ["耳环", "项链", "戒指", "首饰", "饰品", "手链", "发夹"],
  箱包: ["包", "背包", "旅行", "通勤", "手提", "斜挎", "收纳袋", "行李"],
};

const styleLibrary = [
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
];

planCount.addEventListener("input", () => {
  planCountOutput.textContent = `${planCount.value} 条`;
});

function syncCountryLanguage(countrySelect, languageSelect) {
  const language = countryLanguageMap[countrySelect?.value];
  if (language && languageSelect) languageSelect.value = language;
}

$("#targetCountry").addEventListener("change", (event) => {
  syncCountryLanguage(event.target, $("#outputLanguage"));
});

$("#manualTargetCountry")?.addEventListener("change", (event) => {
  syncCountryLanguage(event.target, $("#manualOutputLanguage"));
});

$("#logoutButton")?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login.html";
});

imageInput.addEventListener("change", () => {
  imagePreview.innerHTML = "";
  Array.from(imageInput.files).forEach((file) => {
    const item = document.createElement("div");
    item.className = "image-thumb";
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = file.name;
    const label = document.createElement("span");
    label.textContent = file.name;
    item.append(image, label);
    imagePreview.appendChild(item);
  });
});

videoInput.addEventListener("change", renderVideoList);

$("#selectAllStyles").addEventListener("click", () => {
  $$('input[name="styles"]').forEach((input) => {
    input.checked = true;
  });
});

$("#clearStyles").addEventListener("click", () => {
  $$('input[name="styles"]').forEach((input) => {
    input.checked = false;
  });
});

$("#fillDemo").addEventListener("click", () => {
  $("#productName").value = "多层首饰收纳盒";
  $("#sellingPoints").value = "分层收纳，透明抽屉，适合小卧室和租房空间；现在有活动，送礼也合适";
  $("#coreSellingPoints").value = "防止项链打结；快速找到饰品；桌面马上变整齐";
  $("#useCases").value = "卧室梳妆台、早上通勤前搭配、节日礼物";
  $("#audience").value = "18-30 岁年轻女性、学生、通勤白领、喜欢饰品但桌面容易乱的人";
  $$(".reference-copy")[0].value = "桌面乱到每次出门都找不到耳环？这个收纳盒分层很清楚，项链不会缠在一起，透明抽屉一眼就能看到。现在活动价真的很适合入。";
  $("#targetCountry").value = "泰国";
  $("#outputLanguage").value = "泰语";
  $("#planCount").value = "5";
  planCountOutput.textContent = "5 条";
  $("#competitorNotes").value = "竞品常用 before/after 对比，前 3 秒展示凌乱桌面，字幕很短，CTA 偏限时折扣。";
  const demoStyles = ["UGC 真实测评", "开箱种草", "痛点解决", "前后对比", "礼物推荐"];
  $$('input[name="styles"]').forEach((input) => {
    input.checked = demoStyles.includes(input.value);
  });
});

$("#directToManualCopy")?.addEventListener("click", () => {
  openManualCopyMode();
});

productForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runAiAnalysis();
});

async function runAiAnalysis() {
  const productInput = collectProductInput();
  if (!productInput.productName || !productInput.targetCountry || !productInput.outputLanguage) return;

  const submitButton = productForm.querySelector('button[type="submit"]');
  setSubmitLoading(submitButton, true);

  try {
    state.productInput = productInput;
    state.aiAnalysis = await requestAiAnalysis(productInput);
    renderReview();
    showReview();
  } catch (error) {
    console.error(error);
    alert(error.message || "AI 模型调用失败，请检查服务和 API Key。");
  } finally {
    setSubmitLoading(submitButton, false);
  }
}

$("#backToInput").addEventListener("click", showInput);
$("#rerunAnalysis").addEventListener("click", () => {
  runAiAnalysis();
});

$("#confirmAnalysis").addEventListener("click", () => {
  syncAnalysisFromDom();
  runCopyGeneration();
});

$("#backToReview").addEventListener("click", showReview);

$("#regenerateCopy").addEventListener("click", () => {
  syncAnalysisFromDom();
  runCopyGeneration();
});

$("#syncSelectedCopy").addEventListener("click", () => {
  syncSelectedEditedCopiesToVoiceover();
});

$("#confirmCopy").addEventListener("click", () => {
  syncCopyDraftsFromDom();
  state.selectedCopyDrafts = state.copyDrafts.filter((draft) => draft.selected);
  if (state.selectedCopyDrafts.length === 0) {
    alert("请至少选择 1 条最终保留文案。");
    return;
  }
  renderScriptSetup();
  showScript();
});

$("#backToCopy").addEventListener("click", showCopy);

$("#backToFullFlow")?.addEventListener("click", () => {
  state.manualCopyMode = false;
  renderCopyView();
  showInput();
});

$("#generateManualScripts")?.addEventListener("click", () => {
  generateScriptsFromManualCopy();
});

$("#generateScripts").addEventListener("click", () => {
  runScriptGeneration();
});

$("#openFeishuConfig")?.addEventListener("click", () => {
  openFeishuConfigDialog({ exportAfterSave: false });
});

$("#exportToFeishu")?.addEventListener("click", () => {
  exportSelectedScriptsToFeishu();
});

$("#exportExcelTable")?.addEventListener("click", () => {
  exportSelectedScriptsAsExcelTable();
});

$("#copyReadableScripts")?.addEventListener("click", () => {
  copySelectedScriptsAsReadableText();
});

$("#closeDialog").addEventListener("click", () => {
  $("#nextStepDialog").close();
});

$("#cancelFeishuConfig")?.addEventListener("click", () => {
  state.pendingFeishuExport = false;
  $("#feishuConfigDialog")?.close();
});

$("#feishuConfigForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const config = collectFeishuConfigFromForm();
    saveFeishuConfig(config);
    $("#feishuConfigDialog")?.close();
    if (state.pendingFeishuExport) {
      state.pendingFeishuExport = false;
      await exportSelectedScriptsToFeishu();
    } else {
      alert("飞书配置已保存。");
    }
  } catch (error) {
    alert(error.message || "飞书配置保存失败。");
  }
});

$("#testFeishuConfig")?.addEventListener("click", async () => {
  const button = $("#testFeishuConfig");
  setButtonLoading(button, true, "测试中...", "测试连接");
  try {
    const config = collectFeishuConfigFromForm();
    saveFeishuConfig(config);
    const result = await requestFeishuDiagnose({ feishu: config });
    const lines = [
      result.ok ? "飞书连接测试成功。" : "飞书连接测试未完全通过。",
      "",
      `app token：${result.parsed?.appToken || "未识别"}`,
      `table id：${result.parsed?.tableId || "链接中未带 table 参数"}`,
      "",
      ...((result.steps || []).map((item, index) => `${index + 1}. [${item.ok ? "OK" : "失败"}] ${item.step}\n${item.detail || ""}`)),
    ];
    alert(lines.join("\n"));
  } catch (error) {
    alert(error.message || "飞书连接测试失败。");
  } finally {
    setButtonLoading(button, false, "测试中...", "测试连接");
  }
});

$$("[data-add]").forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.add;
    syncAnalysisFromDom();
    state.aiAnalysis[type].push(createEmptyItem(type));
    renderReview();
  });
});

function collectProductInput() {
  return {
    productName: $("#productName").value.trim(),
    productImages: Array.from(imageInput.files).map((file) => file.name),
    rawSellingPoints: $("#sellingPoints").value.trim(),
    rawCoreSellingPoints: $("#coreSellingPoints").value.trim(),
    rawUseCases: $("#useCases").value.trim(),
    rawAudience: $("#audience").value.trim(),
    referenceCopies: $$(".reference-copy")
      .map((field) => field.value.trim())
      .filter(Boolean)
      .slice(0, 3),
    targetCountry: $("#targetCountry").value,
    outputLanguage: $("#outputLanguage").value,
    planCount: Number($("#planCount").value),
    selectedStyles: getSelectedStyles(),
    competitorVideos: Array.from(videoInput.files).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })),
    competitorNotes: $("#competitorNotes").value.trim(),
  };
}

function collectManualCopyInput() {
  return {
    productName: $("#manualProductName").value.trim(),
    targetCountry: $("#manualTargetCountry").value,
    outputLanguage: $("#manualOutputLanguage").value,
    sourceCopy: $("#manualSourceCopy").value.trim(),
    sourceLanguage: $("#manualSourceLanguage").value,
  };
}

async function requestAiAnalysis(productInput) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(productInput),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "AI 模型调用失败");
  }
  return normalizeAiAnalysis(payload.analysis, productInput);
}

async function runCopyGeneration() {
  if (!state.aiAnalysis?.planStrategies?.length) {
    alert("请至少保留 1 个方案后再生成文案。");
    return;
  }
  const button = $("#confirmAnalysis");
  const regenButton = $("#regenerateCopy");
  setButtonLoading(button, true, "AI 正在生成文案...", "确认卖点，生成文案");
  setButtonLoading(regenButton, true, "AI 正在重写...", "重新生成文案");

  try {
    state.copyDrafts = await requestCopyDrafts({
      productInput: state.productInput,
      aiAnalysis: state.aiAnalysis,
    });
    renderCopyView();
    showCopy();
  } catch (error) {
    console.error(error);
    alert(error.message || "AI 文案生成失败，请检查服务和 API Key。");
  } finally {
    setButtonLoading(button, false, "AI 正在生成文案...", "确认卖点，生成文案");
    setButtonLoading(regenButton, false, "AI 正在重写...", "重新生成文案");
  }
}

async function openManualCopyMode() {
  state.manualCopyMode = true;
  const product = state.productInput || collectProductInput();
  state.productInput = {
    ...(state.productInput || {}),
    ...product,
    planCount: product.planCount || 1,
  };
  $("#manualProductName").value = product.productName || "";
  $("#manualTargetCountry").value = product.targetCountry || "";
  $("#manualOutputLanguage").value = product.outputLanguage || "";
  $("#manualSourceLanguage").value = "自动识别";
  $("#manualSourceCopy").value = state.copyDrafts.find((draft) => draft?.editedZh)?.editedZh || "";
  renderCopyView();
  showCopy();
}

async function generateScriptsFromManualCopy() {
  const manual = collectManualCopyInput();
  if (!manual.sourceCopy || !manual.targetCountry || !manual.outputLanguage) {
    alert("请先填写文案、国家和输出语言。");
    return;
  }

  const button = $("#generateManualScripts");
  setButtonLoading(button, true, "正在处理文案...", "直接生成脚本");
  try {
    state.productInput = {
      ...(state.productInput || {}),
      productName: manual.productName || state.productInput?.productName || "手动文案",
      targetCountry: manual.targetCountry,
      outputLanguage: manual.outputLanguage,
      planCount: 1,
    };
    state.copyDrafts = createManualCopyDrafts(manual, state.productInput);
    if (manual.sourceCopy) {
      state.copyDrafts = await requestManualCopyDrafts({
        productInput: {
          productName: manual.productName || state.productInput.productName,
          targetCountry: manual.targetCountry,
          outputLanguage: manual.outputLanguage,
          planCount: 1,
        },
        aiAnalysis: state.aiAnalysis || { planStrategies: [] },
        manualCopy: manual,
      });
    }
    state.selectedCopyDrafts = state.copyDrafts.filter((draft) => draft.selected);
    renderScriptSetup();
    showScript();
  } catch (error) {
    console.error(error);
    alert(error.message || "手动文案生成脚本失败。");
  } finally {
    setButtonLoading(button, false, "正在处理文案...", "下一步：选择模型");
  }
}

async function requestCopyDrafts(payload) {
  const response = await fetch("/api/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "AI 文案生成失败");
  }
  return normalizeCopyDrafts(data.copyDrafts, payload.productInput, payload.aiAnalysis);
}

async function requestManualCopyDrafts(payload) {
  const response = await fetch("/api/manual-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "AI 文案处理失败");
  }
  return normalizeCopyDrafts(data.copyDrafts, payload.productInput, payload.aiAnalysis);
}

async function runScriptGeneration() {
  state.selectedVideoModel = $('input[name="videoModel"]:checked')?.value || "sora";
  const button = $("#generateScripts");
  setButtonLoading(button, true, "AI 正在生成脚本...", "生成脚本提示词");
  try {
    const scripts = [];
    for (const draft of state.selectedCopyDrafts) {
      button.textContent = `AI 正在生成脚本 ${draft.planNo}/${state.selectedCopyDrafts.length}...`;
      const cacheKey = buildScriptCacheKey(draft, state.selectedVideoModel);
      let currentScripts = state.scriptCache[cacheKey];
      if (!currentScripts) {
        currentScripts = await requestVideoScriptsWithRetry({
          productInput: state.productInput,
          aiAnalysis: state.aiAnalysis,
          copyDrafts: [draft],
          videoModel: state.selectedVideoModel,
        });
        state.scriptCache[cacheKey] = currentScripts;
      }
      if (Array.isArray(currentScripts) && currentScripts.length) {
        scripts.push(...currentScripts);
      }
    }
    state.videoScripts = scripts;
    renderScriptResults();
  } catch (error) {
    console.error(error);
    alert(error.message || "AI 脚本生成失败，请检查服务和 API Key。");
  } finally {
    setButtonLoading(button, false, "AI 正在生成脚本...", "生成脚本提示词");
  }
}

async function requestVideoScripts(payload) {
  const response = await fetch("/api/script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "AI 脚本生成失败");
  }
  if (data.warning) {
    console.warn(data.warning);
  }
  const scripts = Array.isArray(data.scripts) && data.scripts.length ? data.scripts : generateMockVideoScripts(payload);
  return completeVideoScripts(scripts, payload);
}

async function requestVideoScriptsWithRetry(payload, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      return await requestVideoScripts(payload);
    } catch (error) {
      lastError = error;
      if (attempt > maxRetries || !isRetryableScriptError(error)) break;
      await wait(1200 * attempt);
    }
  }
  throw lastError;
}

function isRetryableScriptError(error) {
  const message = String(error?.message || "");
  return /524|超时|timeout|网关|非 JSON 响应/i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildScriptCacheKey(draft, videoModel) {
  return JSON.stringify({
    videoModel,
    planNo: draft?.planNo,
    style: draft?.style,
    audience: draft?.audience,
    voiceover: draft?.voiceover,
    editedZh: draft?.editedZh,
  });
}

function buildSyncCopyPayload(draft) {
  return {
    productInput: {
      productName: state.productInput.productName,
      targetCountry: state.productInput.targetCountry,
      outputLanguage: state.productInput.outputLanguage,
      rawCoreSellingPoints: state.productInput.rawCoreSellingPoints,
      rawSellingPoints: state.productInput.rawSellingPoints,
    },
    draft: {
      planNo: draft.planNo,
      style: draft.style,
      audience: draft.audience,
      editedZh: draft.editedZh,
    },
  };
}

async function syncEditedCopyToVoiceover(index, button) {
  syncCopyDraftsFromDom();
  const draft = state.copyDrafts[index];
  if (!draft?.editedZh) {
    alert("请先填写用户中文微调稿。");
    return;
  }

  setButtonLoading(button, true, "同步中...", "同步到目标语言");
  try {
    const response = await fetch("/api/sync-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSyncCopyPayload(draft)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "同步目标语言口播失败");
    }
    state.copyDrafts[index] = {
      ...draft,
      voiceover: data.voiceover || draft.voiceover,
    };
    const card = button.closest(".copy-card");
    const voiceoverField = card?.querySelector('[data-copy-field="voiceover"]');
    if (voiceoverField) {
      voiceoverField.value = state.copyDrafts[index].voiceover;
    }
  } catch (error) {
    console.error(error);
    alert(error.message || "同步目标语言口播失败。");
  } finally {
    setButtonLoading(button, false, "同步中...", "同步到目标语言");
  }
}

async function syncSelectedEditedCopiesToVoiceover() {
  syncCopyDraftsFromDom();
  const selectedIndexes = state.copyDrafts
    .map((draft, index) => (draft.selected ? index : -1))
    .filter((index) => index >= 0);

  if (!selectedIndexes.length) {
    alert("请先勾选至少 1 条保留文案。");
    return;
  }

  const missingEditedZh = selectedIndexes.find((index) => !state.copyDrafts[index]?.editedZh);
  if (missingEditedZh != null) {
    alert(`方案 ${state.copyDrafts[missingEditedZh].planNo} 还没有填写中文微调稿。`);
    return;
  }

  const button = $("#syncSelectedCopy");
  setButtonLoading(button, true, "批量同步中...", "一键同步保留文案到目标语言");

  try {
    for (const index of selectedIndexes) {
      const draft = state.copyDrafts[index];
      const response = await fetch("/api/sync-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSyncCopyPayload(draft)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `方案 ${draft.planNo} 同步目标语言口播失败`);
      }
      state.copyDrafts[index] = {
        ...draft,
        voiceover: data.voiceover || draft.voiceover,
      };
    }

    const cards = $$(".copy-card");
    selectedIndexes.forEach((index) => {
      const card = cards[index];
      const voiceoverField = card?.querySelector('[data-copy-field="voiceover"]');
      if (voiceoverField) {
        voiceoverField.value = state.copyDrafts[index].voiceover;
      }
    });
    alert(`已同步 ${selectedIndexes.length} 条保留文案到目标语言。`);
  } catch (error) {
    console.error(error);
    alert(error.message || "批量同步目标语言口播失败。");
  } finally {
    setButtonLoading(button, false, "批量同步中...", "一键同步保留文案到目标语言");
  }
}

function normalizeCopyDrafts(copyDrafts, productInput, aiAnalysis) {
  const fallback = generateMockCopyDrafts(productInput, aiAnalysis);
  const drafts = Array.isArray(copyDrafts) && copyDrafts.length ? copyDrafts : fallback;
  return drafts.slice(0, productInput.planCount).map((draft, index) => ({
    planNo: Number(draft.planNo) || index + 1,
    style: draft.style || aiAnalysis.planStrategies[index]?.style || "自动组合",
    audience: draft.audience || aiAnalysis.planStrategies[index]?.audience || "",
    duration: draft.duration || "20-30s",
    hook: draft.hook || "",
    voiceover: draft.voiceover || "",
    voiceoverZh: draft.voiceoverZh || "",
    editedZh: draft.editedZh || draft.voiceoverZh || "",
    cta: draft.cta || "",
    selected: draft.selected ?? true,
  }));
}

function normalizeAiAnalysis(analysis, productInput) {
  const localFallback = generateMockAnalysis(productInput);
  return {
    sellingPoints: Array.isArray(analysis?.sellingPoints) && analysis.sellingPoints.length ? analysis.sellingPoints : localFallback.sellingPoints,
    audiences: Array.isArray(analysis?.audiences) && analysis.audiences.length ? analysis.audiences : localFallback.audiences,
    openingHooks:
      Array.isArray(analysis?.openingHooks) && analysis.openingHooks.length ? analysis.openingHooks : localFallback.openingHooks,
    useCases: Array.isArray(analysis?.useCases) && analysis.useCases.length ? analysis.useCases : localFallback.useCases,
    planStrategies:
      Array.isArray(analysis?.planStrategies) && analysis.planStrategies.length
        ? analysis.planStrategies.slice(0, productInput.planCount)
        : localFallback.planStrategies,
    competitorVideoAnalyses: Array.isArray(analysis?.competitorVideoAnalyses)
      ? analysis.competitorVideoAnalyses
      : localFallback.competitorVideoAnalyses,
    competitorAnalysis: analysis?.competitorAnalysis || localFallback.competitorAnalysis,
  };
}

function setSubmitLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? "AI 正在提炼..." : "AI 提炼卖点";
}

function setButtonLoading(button, loading, loadingText, normalText) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? loadingText : normalText;
}

function getSelectedStyles() {
  return $$('input[name="styles"]:checked').map((input) => input.value);
}

function renderVideoList() {
  videoList.innerHTML = "";
  Array.from(videoInput.files).forEach((file) => {
    const row = document.createElement("div");
    row.className = "video-row";
    row.innerHTML = `<span>${escapeHtml(file.name)}</span><strong>${formatFileSize(file.size)}</strong>`;
    videoList.appendChild(row);
  });
}

function generateMockAnalysis(input) {
  const category = inferCategory(input);
  const sourceSellingPoints = splitText(input.rawSellingPoints);
  const sourceCoreSellingPoints = splitText(input.rawCoreSellingPoints);
  const sourceUseCases = splitText(input.rawUseCases);
  const sourceAudiences = splitText(input.rawAudience);
  const hasCompetitor = input.competitorVideos.length > 0 || input.competitorNotes;

  const defaults = getDefaults(category, input.targetCountry);
  const insightText = [
    input.productName,
    input.rawCoreSellingPoints,
    input.rawSellingPoints,
    input.rawUseCases,
    input.rawAudience,
    ...(input.referenceCopies || []),
    input.competitorNotes,
  ].join(" ");

  const sellingPoints = buildSellingPoints([...sourceCoreSellingPoints, ...sourceSellingPoints], defaults.sellingPoints, input, sourceCoreSellingPoints.length);
  const useCases = buildUseCases(sourceUseCases, defaults.useCases, input);
  const audiences = buildAudiences(sourceAudiences, defaults.audiences, category, insightText);
  const openingHooks = buildOpeningHooks(defaults.openingHooks, category, insightText, useCases, audiences);

  return {
    sellingPoints,
    audiences,
    openingHooks,
    useCases,
    planStrategies: generatePlanStrategies(input, audiences, openingHooks, useCases),
    competitorVideoAnalyses: input.competitorVideos.map((video, index) => ({
      name: video.name || video,
      status: "待视频模型解析",
      note:
        input.competitorNotes ||
        (input.referenceCopies?.length ? "已记录参考文案。当前会学习其结构和表达节奏，不直接照抄。" : "已记录该视频。当前静态原型不能读取视频画面和声音，接入后端视频理解模型后会逐个分析。"),
      index: index + 1,
    })),
    competitorAnalysis: hasCompetitor
      ? {
          hook: inferCompetitorHook(input),
          sellingExpression: inferSellingExpression(sellingPoints, openingHooks),
          originalCopy: input.competitorNotes || "已上传竞品参考，待视频理解模型提取原视频文案。",
          originalCopyZh: input.competitorNotes || "已上传竞品参考，待视频理解模型提取原视频文案并翻译。",
          cta: inferCta(input.competitorNotes),
        }
      : {
          hook: "未上传竞品参考，本次分析基于产品信息和目标市场生成。",
          sellingExpression: "围绕产品卖点、目标人群和高停留开头切入进行表达。",
          originalCopy: input.referenceCopies?.[0] || "未上传竞品参考。",
          originalCopyZh: input.referenceCopies?.[0] || "未上传竞品参考。",
          cta: input.referenceCopies?.length ? "学习参考文案里的 CTA 强度和下单理由，但不照抄。" : "根据价格和活动信息补充购买引导。",
        },
  };
}

function generateMockCopyDrafts(productInput, aiAnalysis) {
  return aiAnalysis.planStrategies.map((strategy) => {
    const requiredPoints = splitText(productInput.rawCoreSellingPoints);
    const pointTitles = aiAnalysis.sellingPoints
      .map((point) => point.title)
      .filter(Boolean);
    const valueStack = [...requiredPoints, ...pointTitles]
      .filter((point, index, arr) => point && arr.indexOf(point) === index)
      .slice(0, 5);
    const valueStackMs = valueStack.length
      ? valueStack.join(", ")
      : aiAnalysis.sellingPoints[(strategy.planNo - 1) % aiAnalysis.sellingPoints.length]?.title || "senang guna";
    const valueStackZh = valueStack.length ? valueStack.join("、") : "实用、好看、多场景可用、价格划算";
    const promoText = productInput.rawSellingPoints || "";
    const hasPromo = /促销|优惠|折扣|活动|买|送|包邮|低价|便宜|price|sale|promo|discount/i.test(promoText);
    const nowReason = hasPromo
      ? "Kalau nampak promo sekarang, memang lagi berbaloi."
      : productInput.targetCountry === "马来西亚"
        ? "Seller tengah buat promo, jangan tunggu lama."
        : "Seller is running a deal now, add to cart first.";
    const openingLine = strategy.openingLine || `Kalau ${strategy.audience} terus rasa “${strategy.openingSummary || strategy.hookType}”, tengok ni.`;
    return {
      planNo: strategy.planNo,
      style: strategy.style,
      audience: strategy.audience,
      duration: "20-30s",
      hook: openingLine,
      voiceover: `${openingLine} Nilai dia banyak: ${valueStackMs}. Sesuai untuk ${strategy.sceneHint || strategy.audience}, boleh terus nampak perubahan dekat ${strategy.sceneHint || "daily routine"}. ${nowReason}`,
      voiceoverZh: `${strategy.openingSummary || `先用${strategy.hookType || "开头切入"}抓住${strategy.audience}`}。它的值感要讲满：${valueStackZh}。画面里直接放到${strategy.sceneHint || "真实生活流程"}里，让人一眼看到改善。${hasPromo ? "有促销信息就直接带上。" : "现在卖家在做活动，别等太久。"}`,
      editedZh: `${strategy.openingSummary || `先用${strategy.hookType || "开头切入"}抓住${strategy.audience}`}。它的值感要讲满：${valueStackZh}。画面里直接放到${strategy.sceneHint || "真实生活流程"}里，让人一眼看到改善。${hasPromo ? "有促销信息就直接带上。" : "现在卖家在做活动，别等太久。"}`,
      cta: nowReason,
      selected: true,
    };
  });
}

function createManualCopyDrafts(manualCopy, productInput) {
  const sourceCopy = String(manualCopy.sourceCopy || "").trim();
  const language = productInput.outputLanguage || manualCopy.outputLanguage || "目标语言";
  const country = productInput.targetCountry || manualCopy.targetCountry || "目标国家";
  const inputLooksChinese = /中文|自动识别/i.test(manualCopy.sourceLanguage || "") ? true : isMostlyChinese(sourceCopy);
  const voiceover = inputLooksChinese ? `[${language}待同步] ${sourceCopy}` : sourceCopy || "请先输入中文或目标语言文案。";
  const editedZh = inputLooksChinese
    ? sourceCopy
    : `根据${country} / ${language} 的目标受众，将已有文案改写成更自然的本地表达。`;
  return [
    {
      planNo: 1,
      style: "我已有文案",
      audience: "已有文案复用",
      duration: "20-30s",
      hook: "直接复用已有文案",
      voiceover,
      voiceoverZh: editedZh,
      editedZh,
      cta: "直接生成脚本",
      selected: true,
    },
  ];
}

function generateMockVideoScripts({ productInput, copyDrafts, videoModel }) {
  const modelName = videoModel === "veo" ? "Veo" : "Sora";
  const segmentDuration = videoModel === "veo" ? 10 : 12;
  return copyDrafts.map((draft) => {
    const estimatedDuration = estimateVoiceoverDurationSeconds(draft.voiceover, draft.editedZh) || parseDurationSeconds(draft.duration) || 24;
    const segmentTexts = splitScriptIntoSegments(draft.voiceover, draft.editedZh, segmentDuration);
    const segments = segmentTexts.map((segmentText, segmentIndex) => {
      const referenceCount = videoModel === "veo" ? Math.min(3, Math.max(1, segmentText.units.length)) : 1;
      const shots = segmentText.units.map((unit, shotIndex) => ({
        shotNo: shotIndex + 1,
        duration: Math.max(2, Math.round(segmentText.duration / Math.max(1, segmentText.units.length))),
        referenceRef: `第${Math.min(referenceCount, shotIndex + 1)}张参考图`,
        dynamicContent: `围绕“${unit.zh || draft.editedZh}”展示 ${productInput.productName} 的真实使用场景，并把“${(productInput.rawCoreSellingPoints || "必须呈现点").split(/[；;，,、]/).filter(Boolean).slice(0, 2).join("、") || "产品关键点"}”落实到画面里。`,
        cameraMovement: shotIndex % 2 === 0 ? "手持轻微晃动，慢推近。" : "中近景定机位，轻微横移。",
        subtitle: unit.voiceover || draft.voiceover,
      }));
      return {
        segmentNo: segmentIndex + 1,
        duration: segmentText.duration,
        referenceCount,
        segmentVoiceover: segmentText.voiceover,
        segmentEditedZh: segmentText.zh,
        referencePrompt: buildSegmentReferencePrompt({
          productInput,
          draft,
          segmentNo: segmentIndex + 1,
          modelName,
          referenceCount,
          units: segmentText.units,
        }),
        videoPrompt: buildSegmentVideoPrompt({
          productInput,
          draft,
          segmentNo: segmentIndex + 1,
          shots,
          modelName,
        }),
        shots,
      };
    });
    return {
      planNo: draft.planNo,
      style: draft.style,
      model: modelName,
      totalDuration: Math.max(estimatedDuration, segments.reduce((sum, segment) => sum + segment.duration, 0)),
      videoTitle: generateMockVideoTitle(productInput, draft),
      tags: generateMockVideoTags(productInput, draft),
      voiceover: draft.voiceover,
      editedZh: draft.editedZh,
      segments,
    };
  });
}

function completeVideoScripts(scripts, payload) {
  const fallbackScripts = generateMockVideoScripts(payload);
  return (scripts || []).map((script, scriptIndex) => {
    const fallback = fallbackScripts[scriptIndex] || fallbackScripts[0] || {};
    const fallbackSegments = fallback.segments || [];
    const segments = Array.isArray(script.segments) && script.segments.length ? script.segments : fallbackSegments;
    return {
      ...fallback,
      ...script,
      voiceover: script.voiceover || fallback.voiceover || payload.copyDrafts?.[scriptIndex]?.voiceover || "",
      editedZh: script.editedZh || fallback.editedZh || payload.copyDrafts?.[scriptIndex]?.editedZh || "",
      segments: segments.map((segment, segmentIndex) => {
        const fallbackSegment = fallbackSegments[segmentIndex] || fallbackSegments[0] || {};
        return {
          ...fallbackSegment,
          ...segment,
          segmentVoiceover: segment.segmentVoiceover || fallbackSegment.segmentVoiceover || script.voiceover || fallback.voiceover || "",
          segmentEditedZh: segment.segmentEditedZh || fallbackSegment.segmentEditedZh || script.editedZh || fallback.editedZh || "",
          referencePrompt: segment.referencePrompt || fallbackSegment.referencePrompt || "",
          videoPrompt: segment.videoPrompt || fallbackSegment.videoPrompt || "",
          shots: Array.isArray(segment.shots) && segment.shots.length ? segment.shots : fallbackSegment.shots || [],
        };
      }),
    };
  });
}

function generateMockVideoTitle(productInput = {}, draft = {}) {
  const productName = productInput.productName || "produk ni";
  if (productInput.targetCountry === "马来西亚" || productInput.outputLanguage === "马来语") {
    return `${productName} kecil tapi rasa berbaloi gila`;
  }
  return `${productName} worth it untuk ${draft.audience || "daily use"}`;
}

function generateMockVideoTags(productInput = {}, draft = {}) {
  const productName = String(productInput.productName || "produk").replace(/\s+/g, "");
  const style = String(draft.style || "TikTokFinds").replace(/[^\p{L}\p{N}]+/gu, "");
  return [`#${productName}`, "#TikTokShop", "#ShopeeFinds", `#${style || "WorthIt"}`, "#DailyMustHave"].slice(0, 5);
}

function parseDurationSeconds(durationText) {
  const matches = String(durationText || "").match(/\d+/g);
  if (!matches?.length) return 0;
  return Number(matches[matches.length - 1]);
}

function estimateVoiceoverDurationSeconds(voiceover = "", editedZh = "") {
  const voiceoverWordCount = String(voiceover || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const zhLength = String(editedZh || "").replace(/\s+/g, "").length;
  const fromVoiceover = voiceoverWordCount ? Math.ceil(voiceoverWordCount / 2.8) : 0;
  const fromZh = zhLength ? Math.ceil(zhLength / 5) : 0;
  return Math.max(fromVoiceover, fromZh, 0);
}

function splitScriptIntoSegments(voiceover = "", editedZh = "", maxDuration = 12) {
  const totalDuration = estimateVoiceoverDurationSeconds(voiceover, editedZh);
  if (totalDuration > 0 && totalDuration <= maxDuration) {
    return [{ voiceover: voiceover || "", zh: editedZh || "", duration: Math.max(3, totalDuration), units: [{ voiceover, zh: editedZh }] }];
  }

  const voiceParts = splitScriptUnits(voiceover);
  const zhParts = splitScriptUnits(editedZh);
  const count = Math.max(voiceParts.length, zhParts.length, 1);
  const units = Array.from({ length: count }, (_, index) => ({
    voiceover: voiceParts[index] || "",
    zh: zhParts[index] || "",
  })).filter((unit) => unit.voiceover || unit.zh);

  if (!units.length) {
    return [{ voiceover: voiceover || "", zh: editedZh || "", duration: Math.max(3, maxDuration), units: [{ voiceover, zh: editedZh }] }];
  }

  const segments = [];
  let current = [];
  let currentDuration = 0;

  units.forEach((unit) => {
    const unitDuration = Math.max(2, estimateVoiceoverDurationSeconds(unit.voiceover, unit.zh));
    if (current.length && currentDuration + unitDuration > maxDuration) {
      segments.push(buildSegmentChunk(current, currentDuration, maxDuration));
      current = [unit];
      currentDuration = unitDuration;
    } else {
      current.push(unit);
      currentDuration += unitDuration;
    }
  });

  if (current.length) {
    segments.push(buildSegmentChunk(current, currentDuration, maxDuration));
  }

  return segments;
}

function buildSegmentChunk(units, duration, maxDuration) {
  return {
    voiceover: units.map((unit) => unit.voiceover).filter(Boolean).join(" "),
    zh: units.map((unit) => unit.zh).filter(Boolean).join(""),
    duration: Math.min(maxDuration, Math.max(3, duration)),
    units,
  };
}

function splitScriptUnits(text = "") {
  return String(text || "")
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSegmentReferencePrompt({ productInput, draft, segmentNo, modelName, referenceCount, units }) {
  const mustShowPoints = splitText(productInput.rawCoreSellingPoints).slice(0, 3);
  const pointText = mustShowPoints.length ? mustShowPoints.join("、") : "产品关键使用点";
  const imageLines = Array.from({ length: referenceCount }, (_, index) => {
    const unit = units[Math.min(index, units.length - 1)] || units[0] || {};
    return `第${index + 1}张：围绕“${unit.zh || draft.editedZh || productInput.productName}”设计画面，产品如图所示，必须把${pointText}通过人物动作、产品状态、使用前后对比或收纳细节真实呈现出来。场景保持 ${draft.style || "真实 TikTok UGC"} 风格，符合 ${productInput.targetCountry || "目标国家"} 日常生活环境。`;
  });
  return [
    `生成${referenceCount}张参考图`,
    "【画面风格】真实手机拍摄、TikTok UGC、自然光、生活化，不像棚拍广告。",
    "【构图】竖屏 9:16，中近景、手部特写、前后对比或多宫格拼图，保证产品和动作都清楚。",
    "【避免】不要改变产品颜色/形状/包装，不要夸张特效，不要欧美豪宅背景，不要假 logo。",
    ...imageLines,
  ].join("\n");
}

function buildSegmentVideoPrompt({ productInput, draft, segmentNo, shots, modelName }) {
  const isVeo = String(modelName || "").toLowerCase() === "veo";
  return [
    "【风格】真实 TikTok UGC，本土生活感，手机拍摄，自然手持感。",
    `【镜头】第 ${segmentNo} 段共 ${shots.length} 个镜头，围绕 ${productInput.productName} 的使用过程、前后对比和必须呈现点展开。`,
    "【约束】保持产品外观如图所示，不夸大功效，不添加无关人物，不出现乱码文字。",
    ...shots.map(
      (shot) =>
        isVeo
          ? `镜头${shot.shotNo}：\n【参考图】${shot.referenceRef}\n【动态内容】${shot.dynamicContent}\n【镜头运动】${shot.cameraMovement}\n【口播/字幕】${shot.subtitle}`
          : `镜头${shot.shotNo}：\n【动态内容】${shot.dynamicContent}\n【镜头运动】${shot.cameraMovement}\n【口播/字幕】${shot.subtitle}`
    ),
  ].join("\n");
}

function buildSellingPoints(sourceSellingPoints, fallbackItems, input, coreCount = 0) {
  const items = sourceSellingPoints.map((point, index) => ({
    title: point.slice(0, 18),
    description: point,
    angle: index < coreCount ? "核心卖点，口播文案必须优先覆盖" : "补充卖点或促销信息，用来叠加值感",
    isPrimary: index < Math.max(1, coreCount),
  }));

  if (items.length > 0) return items;
  if (input.competitorNotes) {
    return splitText(input.competitorNotes).slice(0, 3).map((note, index) => ({
      title: `参考竞品卖点 ${index + 1}`,
      description: note,
      angle: "根据竞品备注提炼，需人工确认是否适合本产品",
      isPrimary: index === 0,
    }));
  }
  return fallbackItems;
}

function buildUseCases(sourceUseCases, fallbackItems, input) {
  const items = sourceUseCases.map((scene) => ({
    scene,
    shotSuggestion: "围绕用户真实动作拍摄，不做广告大片感",
    localizationNote: `${input.targetCountry} 本土日常环境，自然光、手机手持拍摄。`,
  }));
  return items.length > 0 ? items : fallbackItems;
}

function buildAudiences(sourceAudiences, fallbackItems, category, text) {
  const direct = sourceAudiences.map((audience, index) => ({
    name: audience,
    motivation: inferAudienceMotivation(audience, text),
    contentAngle: index === 0 ? "从这个人群的真实使用场景切入" : "用场景演示让用户代入",
    isPrimary: index === 0,
  }));
  const inferred = inferAudiencesFromText(text, category);
  const pool = direct.length > 0 ? [...direct, ...inferred] : [...inferred, ...fallbackItems];
  return uniqueByName(pool).slice(0, 6);
}

function buildOpeningHooks(defaultOpeningHooks, category, text, useCases = [], audiences = []) {
  const inferred = inferOpeningHooksFromText(text, category, useCases, audiences);
  const expanded = expandOpeningHooks(defaultOpeningHooks, category);
  return uniqueByKey([...inferred, ...expanded], "summary").slice(0, 8);
}

function inferAudiencesFromText(text, category) {
  const rules = [
    [/学生|宿舍|上课|校园/, "学生和宿舍用户", "预算敏感，空间有限，希望东西好找又不占地方。"],
    [/通勤|上班|白领|办公室/, "通勤上班族", "希望出门准备更快，产品要实用、好搭配、不麻烦。"],
    [/旅行|出差|出游|行李/, "旅行和短途出行用户", "需要轻便、容量够、使用步骤简单的产品。"],
    [/妈妈|家庭|孩子|家里|厨房|客厅/, "家庭日常用户", "希望减少家务压力，让家里更整洁好用。"],
    [/礼物|送礼|生日|节日|闺蜜/, "送礼人群", "想买好看、实用、不容易踩雷的小礼物。"],
    [/年轻女性|女生|饰品|耳环|项链|戒指/, "年轻女性", "希望穿搭更精致，同时产品价格和质感都要合适。"],
    [/租房|小户型|卧室|收纳/, "租房和小户型人群", "想用低预算改善空间乱、物品多的问题。"],
  ];
  const matched = rules
    .filter(([pattern]) => pattern.test(text))
    .map(([, name, motivation], index) => ({
      name,
      motivation,
      contentAngle: "根据用户输入和竞品备注推导，需确认是否作为核心人群。",
      isPrimary: index === 0,
    }));

  if (matched.length > 0) return matched;
  return category === "箱包"
    ? [{ name: "通勤和出行用户", motivation: "需要容量、轻便和搭配效率。", contentAngle: "从真实装包和出门流程切入。", isPrimary: true }]
    : [];
}

function inferOpeningHooksFromText(text, category, useCases = [], audiences = []) {
  const sceneHint = useCases[0]?.scene || "真实生活场景";
  const audienceHint = audiences[0]?.name || "目标人群";
  const rules = [
    [/打结|缠|找不到|丢|散落/, "引起共鸣", "一上来就拍出门前找不到、拿不顺、越找越乱的瞬间，精准打中需要整理的人。", "先拍混乱状态，再切到产品整理后的结果。", audienceHint],
    [/乱|凌乱|整理|收纳|空间|小户型|租房/, "引起共鸣", "直接把小空间乱糟糟的画面摆出来，让租房和小户型人群立刻代入。", "用 before/after 对比展示变化。", audienceHint],
    [/容量|装不下|分区|包里|小物/, "引起好奇", "开头先抛出“这么小怎么装下这么多”的反差，靠装包过程留人。", "用真实装包过程证明容量和分区。", audienceHint],
    [/防水|下雨|潮湿|热带/, "引起恐惧/避坑", "先点出潮湿闷热环境下最容易踩坑的问题，再引出产品。", "展示雨天、潮湿环境或耐用细节。", audienceHint],
    [/贵|价格|便宜|优惠|限时|低价/, "引起好奇", "先用低门槛、低风险、现在买更值的角度让用户继续看。", "突出价格、活动和即时改善。", audienceHint],
    [/送礼|礼物|生日|节日/, "引起向往", "把开头做成收到礼物或准备送礼的理想画面，让用户投射关系和场合。", "展示包装、上手效果和适用人群。", audienceHint],
    ];
  const matched = rules
    .filter(([pattern]) => pattern.test(text))
    .map(([, hookType, summary, videoExpression, targetAudience], index) => ({
      hookType,
      summary,
      stayReason: "优先命中目标人群，并在前 1-3 秒制造代入或反差，提升停留。",
      targetAudience,
      sceneHint,
      videoExpression,
      priority: index + 1,
    }));

  if (matched.length > 0) return matched;
  return category === "饰品"
    ? [
        {
          hookType: "引起向往",
          summary: "先让用户看到基础穿搭到精致搭配的变化，立刻产生‘我也想这样’的投射。",
          stayReason: "靠视觉变化和身份代入提升停留。",
          targetAudience: audienceHint,
          sceneHint,
          videoExpression: "展示搭配前后变化。",
          priority: 1,
        },
      ]
    : [];
}

function inferAudienceMotivation(audience, text) {
  if (/学生|宿舍/.test(audience)) return "预算敏感、空间有限，需要实用且低成本的改善。";
  if (/通勤|白领|上班/.test(audience)) return "希望减少出门准备时间，同时保持体面和效率。";
  if (/送礼|礼物/.test(text)) return "需要一个好看、实用、不容易踩雷的购买理由。";
  return "希望产品能直接解决日常小麻烦，并且适合当地生活场景。";
}

function inferCompetitorHook(input) {
  if (!input.competitorNotes) {
    return input.competitorVideos.length
      ? "已上传多个竞品视频；当前需接入视频理解模型后逐个提取开头 hook。"
      : "未上传竞品参考，本次分析基于产品信息和目标市场生成。";
  }
  return splitText(input.competitorNotes)[0] || input.competitorNotes;
}

function inferVisualPace(notes) {
  if (/快|节奏|2秒|3秒|短镜头/.test(notes)) return "根据备注判断：节奏偏快，适合 2-3 秒一个镜头。";
  if (/慢|细节|质感/.test(notes)) return "根据备注判断：需要更多细节近景，节奏可稍慢。";
  return "待视频模型解析后确认；当前建议 TikTok 短镜头节奏。";
}

function inferSellingExpression(sellingPoints, openingHooks) {
  return `围绕“${sellingPoints[0]?.title || "核心卖点"}”，结合“${openingHooks[0]?.hookType || "高停留开头"}”做短句化表达。`;
}

function inferSubtitleStyle(notes) {
  if (/字幕|大字|短|高亮/.test(notes)) return "根据备注判断：使用大字短字幕，重点词高亮。";
  return "建议短句字幕，单屏不超过两行；待视频模型解析后优化。";
}

function inferCta(notes) {
  if (/优惠|限时|低价|折扣/.test(notes)) return "结尾强调限时优惠、低价入手或点击购物车。";
  if (/评论|留言/.test(notes)) return "结尾引导评论区互动，再承接购买入口。";
  return "根据价格和活动信息补充购买引导。";
}

function inferBorrowableStructure(notes) {
  if (/before|after|前后|对比/.test(notes)) return "痛点画面 → 产品出现 → 前后对比 → 细节证明 → CTA。";
  if (/开箱/.test(notes)) return "开箱 → 第一反应 → 细节展示 → 使用场景 → CTA。";
  return "痛点 → 产品展示 → 使用场景 → 结果变化 → CTA。";
}

function generatePlanStrategies(input, audiences, openingHooks, useCases) {
  const styles = input.selectedStyles.length > 0 ? input.selectedStyles : styleLibrary;
  return Array.from({ length: input.planCount }, (_, index) => {
    const style = styles[index % styles.length];
    const audience = audiences[index % audiences.length];
    const openingHook = openingHooks[index % openingHooks.length];
    const scene = useCases[index % useCases.length];
    return {
      planNo: index + 1,
      style,
      audience: audience.name,
      hookType: openingHook.hookType,
      openingSummary: openingHook.summary,
      openingDetail: openingHook.videoExpression,
      stayReason: openingHook.stayReason,
      openingLine: buildOpeningLine(openingHook, audience.name),
      sceneHint: scene.scene,
      angle: getStyleAngle(style, openingHook, scene.scene, audience.name),
    };
  });
}

function buildOpeningLine(openingHook, audienceName) {
  const target = audienceName || openingHook.targetAudience || "目标人群";
  const type = openingHook.hookType || "开头切入";
  if (type === "引起好奇") return `Kalau ${target} nampak benda macam ni, mesti terus nak tengok habis.`;
  if (type === "引起恐惧/避坑") return `Kalau ${target} selalu buat benda ni, memang senang terus踩坑.`;
  if (type === "引起向往") return `Kalau ${target} nak rasa hidup terus lebih精致, tengok ni.`;
  if (type === "引起满足") return `Kalau ${target} suka tengok perubahan yang sangat爽, tengok ni.`;
  return `Kalau ${target} terus rasa “ini memang cakap pasal aku”, tengok ni.`;
}

function getStyleAngle(style, openingHook, scene, audienceName) {
  const hookType = openingHook?.hookType || "开头切入";
  const openingSummary = openingHook?.summary || "先命中目标人群";
  const angleMap = {
    "UGC 真实测评": `像真实用户一样先用“${hookType}”命中${audienceName}，再展示产品在${scene}里的改善。`,
    开箱种草: `从${hookType}切入，先留住人，再自然带到${scene}里的产品细节。`,
    痛点解决: `前 3 秒先把“${openingSummary}”拍出来，中段用产品给出直接解决。`,
    前后对比: `用 before/after 对比把“${openingSummary}”可视化，再展示${scene}中的变化。`,
    场景演示: `完整演示${scene}中的使用步骤，强调真实生活感。`,
    达人口播: `用达人推荐口吻讲清楚为什么这个产品适合${audienceName}，开头先用${hookType}留人。`,
    情绪共鸣: `先让${audienceName}觉得“这就是我”，再把产品作为轻松变好的小改变。`,
    剧情反转: `前半段制造小麻烦，后半段用产品完成反转。`,
    礼物推荐: `把产品包装成送礼选择，强调实用、好看、不容易踩雷。`,
    低价冲动购买: `突出低决策成本和即时可得的改善，CTA 更直接。`,
    "工厂/老板视角": `用工厂/仓库/老板或厂长视角制造高信息密度：包装箱、产品细节、工人动作、老板口播、真实小插曲同时出现。`,
    街头采访感: `用路人提问或快速反应测试带出卖点。`,
    生活小技巧: `把产品作为一个实用小技巧，降低广告感。`,
    "通勤/旅行场景": `放到出门、通勤或旅行准备流程里展示。`,
    家庭日常场景: `放进家庭日常，让使用结果自然出现。`,
    节日促销场景: `结合节日/活动氛围，强调礼物和限时优惠。`,
  };
  return angleMap[style] || `围绕${hookType}、${scene}和${audienceName}生成短视频方案。`;
}

function expandOpeningHooks(baseOpeningHooks, category) {
  const extras = {
    家居: [
      {
        hookType: "引起满足",
        summary: "开头先给用户看一秒归位、瞬间变整齐的爽感，天然容易停留。",
        stayReason: "整理前后强变化，本身就有停留力。",
        targetAudience: "想轻松整理空间的人",
        sceneHint: "收纳整理流程",
        videoExpression: "展示一秒归位或随手整理，降低使用门槛。",
        priority: 3,
      },
      {
        hookType: "引起向往",
        summary: "先给出整洁舒服、拍照更好看的理想生活画面，再让用户想知道怎么做到。",
        stayReason: "理想生活感容易引发投射和收藏。",
        targetAudience: "想让家里更整洁好看的人",
        sceneHint: "卧室或客厅",
        videoExpression: "从手机镜头里的杂乱空间切到整洁画面。",
        priority: 4,
      },
    ],
    饰品: [
      {
        hookType: "引起向往",
        summary: "让用户先看到同一套穿搭加上产品前后的精致变化，立刻产生向往。",
        stayReason: "身份投射和前后变化同时成立。",
        targetAudience: "年轻女性",
        sceneHint: "通勤或约会前",
        videoExpression: "展示基础穿搭加上饰品后的变化。",
        priority: 2,
      },
      {
        hookType: "引起向往",
        summary: "把开头做成收到礼物时的惊喜感，让用户快速代入送礼和收礼场景。",
        stayReason: "礼物场景自带情绪价值。",
        targetAudience: "送礼人群",
        sceneHint: "生日或节日送礼",
        videoExpression: "用礼物开箱和上手细节降低送礼风险。",
        priority: 3,
      },
    ],
    箱包: [
      {
        hookType: "引起共鸣",
        summary: "先拍包里又乱又难找的瞬间，一秒打中通勤和出行人群。",
        stayReason: "高频困扰强代入。",
        targetAudience: "通勤和旅行用户",
        sceneHint: "装包和取物过程",
        videoExpression: "展示包内分区和快速取物。",
        priority: 2,
      },
      {
        hookType: "引起好奇",
        summary: "直接告诉用户一个包怎么切三种出门场景，形成反差和好奇。",
        stayReason: "一包多用有明显反直觉感。",
        targetAudience: "不想买太多包的人",
        sceneHint: "通勤、逛街、旅行",
        videoExpression: "切换通勤、逛街、旅行三个场景。",
        priority: 3,
      },
    ],
  };
  return [...baseOpeningHooks, ...(extras[category] || [])];
}

function expandAudiences(baseAudiences, category, defaultAudiences) {
  const extras = {
    家居: [
      {
        name: "宿舍和租房用户",
        motivation: "想用小预算解决空间乱、东西没地方放的问题。",
        contentAngle: "小空间改造、桌面整理、房间变整洁。",
        isPrimary: false,
      },
      {
        name: "重视效率的上班族",
        motivation: "希望日常物品更好拿、更好归位，减少找东西时间。",
        contentAngle: "早晚高频使用场景和省时间对比。",
        isPrimary: false,
      },
    ],
    饰品: [
      {
        name: "学生和年轻通勤女性",
        motivation: "想让日常穿搭更精致，同时控制预算。",
        contentAngle: "通勤、上课、约会前快速搭配。",
        isPrimary: false,
      },
      {
        name: "送礼人群",
        motivation: "想买好看、实用、不容易出错的小礼物。",
        contentAngle: "生日、节日、闺蜜礼物推荐。",
        isPrimary: false,
      },
    ],
    箱包: [
      {
        name: "每天通勤的人",
        motivation: "需要能装、好拿、好搭配的日常包。",
        contentAngle: "真实装包和上班路上使用。",
        isPrimary: false,
      },
      {
        name: "周末旅行和短途出行用户",
        motivation: "想要一个轻便但容量够的包。",
        contentAngle: "旅行打包、机场/车站/逛街场景。",
        isPrimary: false,
      },
    ],
  };
  const merged = [...baseAudiences, ...defaultAudiences, ...(extras[category] || [])];
  const seen = new Set();
  return merged.filter((item) => {
    const key = item.name.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferCategory(input) {
  const text = `${input.productName} ${input.rawCoreSellingPoints} ${input.rawSellingPoints} ${input.rawUseCases}`.toLowerCase();
  const match = Object.entries(categorySignals).find(([, words]) =>
    words.some((word) => text.includes(word.toLowerCase()))
  );
  return match ? match[0] : "家居";
}

function getDefaults(category, country) {
  const commonLocalization = `${country} 本土生活场景，自然光、手机手持拍摄、真实居家或通勤环境。`;

  const presets = {
    家居: {
      sellingPoints: [
        {
          title: "节省空间",
          description: "适合小户型、宿舍和租房环境，把零散物品集中整理。",
          angle: "before/after 对比，从凌乱桌面切到整洁空间。",
          isPrimary: true,
        },
        {
          title: "提升日常效率",
          description: "让用户更快找到需要的物品，减少出门前和做家务时的混乱感。",
          angle: "展示早晨或晚间日常流程中的省心瞬间。",
          isPrimary: false,
        },
      ],
      audiences: [
        {
          name: "租房和小户型人群",
          motivation: "希望用低预算让空间更整洁、更好用。",
          contentAngle: "从小房间东西太多、桌面太乱切入。",
          isPrimary: true,
        },
        {
          name: "年轻家庭用户",
          motivation: "想让家里更容易收拾，减少重复整理。",
          contentAngle: "展示家庭日常高频使用场景。",
          isPrimary: false,
        },
      ],
      openingHooks: [
        {
          hookType: "引起共鸣",
          summary: "先拍桌面乱、东西找不到的瞬间，让租房和小户型人群立刻觉得这是在说自己。",
          stayReason: "高频困扰强代入，最容易在前 2 秒留人。",
          targetAudience: "租房和小户型人群",
          sceneHint: "卧室或客厅整理前",
          videoExpression: "先拍凌乱桌面，再切到产品整理后的画面。",
          priority: 1,
        },
        {
          hookType: "引起满足",
          summary: "直接给用户看整理后一秒变清爽的爽感，天然适合短视频停留。",
          stayReason: "前后反差明显，用户愿意继续看完变化过程。",
          targetAudience: "想让空间马上变整洁的人",
          sceneHint: "小空间整理过程",
          videoExpression: "用俯拍展示产品占用空间和收纳容量。",
          priority: 2,
        },
      ],
      useCases: [
        {
          scene: "卧室或客厅日常整理",
          shotSuggestion: "手持手机从凌乱区域推近到产品细节。",
          localizationNote: commonLocalization,
        },
      ],
    },
    饰品: {
      sellingPoints: [
        {
          title: "提升搭配效率",
          description: "让耳环、项链、戒指更容易找到，适合每天出门前快速搭配。",
          angle: "早晨通勤前从挑选饰品切入。",
          isPrimary: true,
        },
        {
          title: "适合送礼",
          description: "视觉精致，适合生日、节日、闺蜜礼物等场景。",
          angle: "用礼物开箱和上身效果制造种草感。",
          isPrimary: false,
        },
      ],
      audiences: [
        {
          name: "18-30 岁年轻女性",
          motivation: "想让日常穿搭更精致，也希望饰品好收纳、好搭配。",
          contentAngle: "通勤、约会、拍照前快速搭配。",
          isPrimary: true,
        },
      ],
      openingHooks: [
        {
          hookType: "引起共鸣",
          summary: "开头直接拍项链打结、耳环找不到的瞬间，让出门前总是手忙脚乱的人立刻被打中。",
          stayReason: "精准命中高频困扰和目标人群。",
          targetAudience: "18-30 岁年轻女性",
          sceneHint: "卧室梳妆台",
          videoExpression: "展示项链缠绕或耳环散落，再切到整齐收纳。",
          priority: 1,
        },
      ],
      useCases: [
        {
          scene: "卧室梳妆台",
          shotSuggestion: "自然光下打开收纳盒，手部挑选饰品。",
          localizationNote: commonLocalization,
        },
      ],
    },
    箱包: {
      sellingPoints: [
        {
          title: "容量清晰可见",
          description: "能装下通勤或旅行高频物品，适合展示真实装包过程。",
          angle: "逐件放入手机、钱包、化妆品、雨伞等物品。",
          isPrimary: true,
        },
        {
          title: "轻便好搭配",
          description: "适合通勤、逛街、短途旅行等多场景。",
          angle: "同一个包切换不同穿搭和场景。",
          isPrimary: false,
        },
      ],
      audiences: [
        {
          name: "通勤和旅行用户",
          motivation: "想要一个容量够、好搭配、价格友好的日常包。",
          contentAngle: "从一天出门要带很多东西切入。",
          isPrimary: true,
        },
      ],
      openingHooks: [
        {
          hookType: "引起好奇",
          summary: "先用‘这么小的包到底能装多少’制造反差，让通勤和旅行用户愿意继续看。",
          stayReason: "反差感和容量验证很适合留人。",
          targetAudience: "通勤和旅行用户",
          sceneHint: "真实装包过程",
          videoExpression: "用装包挑战展示容量和分区。",
          priority: 1,
        },
      ],
      useCases: [
        {
          scene: "通勤、逛街、周末短途旅行",
          shotSuggestion: "镜前穿搭、走路手持、桌面装包三类镜头组合。",
          localizationNote: commonLocalization,
        },
      ],
    },
  };

  return presets[category];
}

function ensureCount(userItems, fallbackItems) {
  return userItems.length > 0 ? userItems : fallbackItems;
}

function splitText(text) {
  return text
    .split(/[\n；;。,.，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueByName(items) {
  return uniqueByKey(items, "name");
}

function uniqueByKey(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item[key] || "").trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function renderReview() {
  renderSummary();
  renderPlanStrategies();
  renderEditableCards("sellingPointCards", "sellingPoints", [
    ["title", "卖点标题", "input"],
    ["description", "卖点说明", "textarea", "wide"],
  ]);
  renderCompetitorAnalysis();
}

function renderPlanStrategies() {
  const container = $("#planStrategyCards");
  container.innerHTML = "";

  state.aiAnalysis.planStrategies.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "strategy-card";
    card.dataset.type = "planStrategies";
    card.dataset.index = index;
    card.innerHTML = `
      <div class="strategy-head">
        <div>
          <strong>方案 ${item.planNo}</strong>
          <span>${escapeHtml(item.style)}</span>
        </div>
        <button class="icon-button" type="button" title="删除方案" data-delete-plan="${index}">×</button>
      </div>
      <div class="strategy-fields">
        ${renderStrategyField("style", "风格", item.style)}
        ${renderStrategyField("audience", "目标人群", item.audience)}
        ${renderStrategyField("hookType", "开头切入类型", item.hookType)}
        ${renderStrategyField("openingDetail", "切入画面", item.openingDetail, true)}
        ${renderStrategyField("stayReason", "开头停留逻辑", item.stayReason, true)}
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-delete-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      syncAnalysisFromDom();
      state.aiAnalysis.planStrategies.splice(Number(button.dataset.deletePlan), 1);
      state.aiAnalysis.planStrategies = state.aiAnalysis.planStrategies.map((item, nextIndex) => ({
        ...item,
        planNo: nextIndex + 1,
      }));
      renderReview();
    });
  });
}

function renderStrategyField(key, label, value = "", wide = false) {
  return `
    <div class="mini-field ${wide ? "wide" : ""}">
      <label>${label}</label>
      <textarea data-strategy-field="${key}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function renderSummary() {
  const input = state.productInput;
  $("#inputSummary").innerHTML = [
    ["产品", input.productName],
    ["国家/语言", `${input.targetCountry} / ${input.outputLanguage}`],
    ["视频必呈现点", input.rawCoreSellingPoints || "未填写"],
    ["卖点/促销", input.rawSellingPoints || "未填写"],
    ["参考文案", input.referenceCopies?.length ? `${input.referenceCopies.length} 条` : "未填写"],
    ["方案数量", `${state.aiAnalysis?.planStrategies?.length || input.planCount} 条`],
    ["风格", input.selectedStyles.length ? input.selectedStyles.join("、") : "自动组合"],
    ["产品图片", `${input.productImages.length} 张`],
    ["竞品视频", input.competitorVideos.length ? `${input.competitorVideos.length} 个` : "未上传"],
  ]
    .map(
      ([label, value]) =>
        `<div class="summary-item"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`
    )
    .join("");
}

function renderCopyView() {
  renderCopySummary();
  const container = $("#copyCards");
  container.innerHTML = "";

  $("#manualCopyPanel")?.classList.toggle("hidden", !state.manualCopyMode);
  $("#normalCopyPanel")?.classList.toggle("hidden", state.manualCopyMode);
  $("#generateManualScripts")?.classList.toggle("hidden", !state.manualCopyMode);
  $("#confirmCopy")?.classList.toggle("hidden", state.manualCopyMode);
  $("#regenerateCopy")?.classList.toggle("hidden", state.manualCopyMode);
  $("#syncSelectedCopy")?.classList.toggle("hidden", state.manualCopyMode);
  $("#backToFullFlow")?.classList.toggle("hidden", !state.manualCopyMode);

  state.copyDrafts.forEach((draft, index) => {
    const card = document.createElement("article");
    card.className = "copy-card";
    card.dataset.index = index;
    card.innerHTML = `
      <div class="copy-head">
        <div>
          <strong>方案 ${draft.planNo}｜${escapeHtml(draft.style)}</strong>
          <span>${escapeHtml(draft.audience)} · ${escapeHtml(draft.duration)}</span>
        </div>
        <label class="primary-check">
          <input type="checkbox" data-copy-field="selected" ${draft.selected ? "checked" : ""}>
          保留
        </label>
      </div>
      <div class="copy-grid">
        <div class="mini-field">
          <label>目标语言口播</label>
          <textarea data-copy-field="voiceover">${escapeHtml(draft.voiceover)}</textarea>
        </div>
        <div class="mini-field">
          <div class="field-label-row">
            <label>用户中文微调稿</label>
            <button class="small-button compact-button" type="button" data-sync-copy="${index}">同步到目标语言</button>
          </div>
          <textarea data-copy-field="editedZh">${escapeHtml(draft.editedZh)}</textarea>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-sync-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      syncEditedCopyToVoiceover(Number(button.dataset.syncCopy), button);
    });
  });
}

function renderManualCopySummary() {
  const manual = collectManualCopyInput();
  $("#manualCopySummary").innerHTML = [
    ["模式", "我已有文案，直接生成脚本"],
    ["产品", manual.productName || "未填写"],
    ["国家/语言", `${manual.targetCountry || "未选"} / ${manual.outputLanguage || "未选"}`],
    ["文案来源语言", manual.sourceLanguage || "未选"],
  ]
    .map(
      ([label, value]) =>
        `<div class="summary-item"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`
    )
    .join("");
}

function renderScriptSetup() {
  state.videoScripts = [];
  renderScriptSummary();
  $("#scriptCards").innerHTML = `<div class="empty-state">请选择模型后点击“生成脚本提示词”。</div>`;
}

function renderScriptSummary() {
  const modelName = state.selectedVideoModel === "veo" ? "Veo" : "Sora";
  $("#scriptSummary").innerHTML = [
    ["产品", state.productInput.productName],
    ["保留文案", `${state.selectedCopyDrafts.length} 条`],
    ["当前模型", modelName],
    ["分段规则", modelName === "Veo" ? "每段 10 秒" : "每段 12 秒"],
  ]
    .map(
      ([label, value]) =>
        `<div class="summary-item"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`
    )
    .join("");
}

function renderScriptResults() {
  renderScriptSummary();
  const container = $("#scriptCards");
  container.innerHTML = "";

  state.videoScripts.forEach((script) => {
    script.selected = script.selected ?? true;
    const card = document.createElement("article");
    card.className = "script-card";
    card.innerHTML = `
      <div class="script-head">
        <div>
          <strong>方案 ${script.planNo}｜${escapeHtml(script.style || "")}</strong>
          <span>${escapeHtml(script.model || "")} · 约 ${escapeHtml(script.totalDuration || "")} 秒 · ${script.segments?.length || 0} 段</span>
        </div>
        <div class="script-actions">
          <label class="primary-check compact-check">
            <input type="checkbox" data-script-field="selected" ${script.selected ? "checked" : ""}>
            导出
          </label>
          <button class="small-button" type="button" data-copy-script>复制整条脚本</button>
        </div>
      </div>
      <div class="script-meta">
        <div>
          <label>当地视频标题</label>
          <strong>${escapeHtml(script.videoTitle || "标题待生成")}</strong>
        </div>
        <div>
          <label>Tag 推荐</label>
          <span>${(script.tags || []).map((tag) => `<em>${escapeHtml(tag)}</em>`).join("") || "<em>暂无</em>"}</span>
        </div>
      </div>
      <div class="script-copy-block">
        <div class="mini-field">
          <label>目标语言文案</label>
          <textarea readonly>${escapeHtml(script.voiceover || "")}</textarea>
        </div>
        <div class="mini-field">
          <label>中文文案（用户微调稿）</label>
          <textarea readonly>${escapeHtml(script.editedZh || "")}</textarea>
        </div>
      </div>
      <div class="script-body">
        ${(script.segments || [])
          .map(
            (segment) => `
              <section class="segment-block">
                <div class="segment-head">
                  <strong>第 ${segment.segmentNo} 段 · ${segment.duration}s</strong>
                  <span>${escapeHtml(`参考图 ${segment.referenceCount || 1} 张`)}</span>
                </div>
                <div class="segment-copy">
                  <div><strong>目标语言段文案：</strong>${escapeHtml(segment.segmentVoiceover || "")}</div>
                  <div><strong>中文段文案：</strong>${escapeHtml(segment.segmentEditedZh || "")}</div>
                </div>
                <div class="prompt-grid">
                  <div class="mini-field">
                    <label>参考图 prompt</label>
                    <textarea readonly>${escapeHtml(segment.referencePrompt || "")}</textarea>
                  </div>
                  <div class="mini-field">
                    <label>视频生成 prompt</label>
                    <textarea readonly>${escapeHtml(segment.videoPrompt || "")}</textarea>
                  </div>
                </div>
              </section>
            `
          )
          .join("")}
      </div>
    `;
    card.querySelectorAll("[data-script-field]").forEach((field) => {
      field.addEventListener("change", () => {
        syncVideoScriptsFromDom();
      });
    });
    card.querySelector("[data-copy-script]").addEventListener("click", () => {
      copyText(toScriptText(script));
    });
    container.appendChild(card);
  });
  syncVideoScriptsFromDom();
}

function toScriptText(script) {
  return [
    `方案 ${script.planNo}｜${script.style || ""}`,
    `模型：${script.model}`,
    `总时长：${script.totalDuration}s`,
    `当地视频标题：${script.videoTitle || ""}`,
    `Tag 推荐：${(script.tags || []).join(" ")}`,
    `目标语言文案：${script.voiceover || ""}`,
    `中文文案：${script.editedZh || ""}`,
    "",
    ...(script.segments || []).flatMap((segment) => [
      `第 ${segment.segmentNo} 段｜${segment.duration}s｜参考图 ${segment.referenceCount || 1} 张`,
      "目标语言段文案：",
      segment.segmentVoiceover || "",
      "中文段文案：",
      segment.segmentEditedZh || "",
      "参考图 prompt:",
      segment.referencePrompt || "",
      "视频生成 prompt:",
      segment.videoPrompt || "",
      "",
    ]),
  ].join("\n");
}

const excelTableHeaders = [
  "脚本编号",
  "段落序号",
  "文案编号",
  "中文文案",
  "目标语言文案",
  "sora参考图prompt",
  "sora prompt",
  "veo参考图 prompt",
  "veo参考图",
  "veo prompt",
];

function buildExcelTableRows() {
  syncVideoScriptsFromDom();
  const selectedScripts = state.videoScripts.filter((script) => script.selected);
  if (!selectedScripts.length) return [];

  const isVeo = (state.selectedVideoModel || "").toLowerCase() === "veo";
  const rows = [];

  selectedScripts.forEach((script, scriptIndex) => {
    (script.segments || []).forEach((segment) => {
      const scriptNo = script.planNo || scriptIndex + 1;
      rows.push([
        scriptNo,
        segment.segmentNo || 1,
        scriptNo,
        segment.segmentEditedZh || script.editedZh || "",
        segment.segmentVoiceover || script.voiceover || "",
        isVeo ? "" : segment.referencePrompt || "",
        isVeo ? "" : segment.videoPrompt || "",
        isVeo ? segment.referencePrompt || "" : "",
        "",
        isVeo ? segment.videoPrompt || "" : "",
      ]);
    });
  });

  return rows;
}

function buildExcelHtmlTable(rows) {
  const head = excelTableHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td style="mso-number-format:'\\@'; vertical-align:top; white-space:pre-wrap;">${escapeHtml(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      table { border-collapse: collapse; }
      th, td { border: 1px solid #d9d9d9; padding: 6px; vertical-align: top; white-space: pre-wrap; }
      th { background: #f5f7fa; font-weight: 700; }
    </style>
  </head>
  <body>
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </body>
</html>`;
}

function exportExcelHtmlFile(filename, rows) {
  const html = buildExcelHtmlTable(rows);
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildReadableScriptsText() {
  syncVideoScriptsFromDom();
  const selectedScripts = state.videoScripts.filter((script) => script.selected);
  return selectedScripts.map((script) => toScriptText(script)).join("\n\n");
}

function exportSelectedScriptsAsExcelTable() {
  const rows = buildExcelTableRows();
  if (!rows.length) {
    alert("请先勾选至少 1 条脚本并先生成结果。");
    return;
  }
  const productName = String(state.productInput?.productName || "脚本提示词").replace(/[\\/:*?"<>|]/g, "").slice(0, 24);
  exportExcelHtmlFile(`${productName || "脚本提示词"}-飞书表格版.xls`, rows);
}

async function copySelectedScriptsAsReadableText() {
  const text = buildReadableScriptsText();
  if (!text) {
    alert("请先勾选至少 1 条脚本并先生成结果。");
    return;
  }
  await copyText(text);
  alert("已复制阅读版脚本。");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function renderCopySummary() {
  const input = state.productInput || {};
  const selectedCount = state.copyDrafts.filter((draft) => draft.selected).length || state.copyDrafts.length;
  $("#copySummary").innerHTML = [
    ["产品", input.productName || "未填写"],
    ["国家/语言", `${input.targetCountry || "未选"} / ${input.outputLanguage || "未选"}`],
    ["文案数量", `${state.copyDrafts.length} 条`],
    ["默认保留", `${selectedCount} 条`],
  ]
    .map(
      ([label, value]) =>
        `<div class="summary-item"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`
    )
    .join("");
}

function syncCopyDraftsFromDom() {
  state.copyDrafts = $$(".copy-card").map((card, index) => {
    const draft = { ...state.copyDrafts[index] };
    card.querySelectorAll("[data-copy-field]").forEach((field) => {
      if (field.type === "checkbox") {
        draft[field.dataset.copyField] = field.checked;
      } else {
        draft[field.dataset.copyField] = field.value.trim();
      }
    });
    return draft;
  });
}

function syncVideoScriptsFromDom() {
  const cards = $$(".script-card");
  if (!cards.length || !state.videoScripts.length) return;
  state.videoScripts = cards.map((card, index) => {
    const script = { ...state.videoScripts[index] };
    card.querySelectorAll("[data-script-field]").forEach((field) => {
      if (field.type === "checkbox") {
        script[field.dataset.scriptField] = field.checked;
      } else {
        script[field.dataset.scriptField] = field.value.trim();
      }
    });
    return script;
  });
}

async function exportSelectedScriptsToFeishu() {
  syncVideoScriptsFromDom();
  const selectedScripts = state.videoScripts.filter((script) => script.selected);
  if (!selectedScripts.length) {
    alert("请至少勾选 1 条要导出的脚本。");
    return;
  }
  const config = getStoredFeishuConfig();
  if (!isFeishuConfigComplete(config)) {
    openFeishuConfigDialog({ exportAfterSave: true });
    return;
  }
  const button = $("#exportToFeishu");
  setButtonLoading(button, true, "正在导出飞书...", "导出到飞书");
  try {
    const result = await requestFeishuExport({
      feishu: config,
      productInput: state.productInput,
      aiAnalysis: state.aiAnalysis,
      videoScripts: state.videoScripts,
      selectedIndexes: state.videoScripts
        .map((script, index) => (script.selected ? index : -1))
        .filter((index) => index >= 0),
    });

    if (result.needConfirmUpdate) {
      const ok = window.confirm(result.message || "产品信息表已存在，是否更新？");
      if (!ok) return;
      const confirmed = await requestFeishuExport({
        feishu: config,
        productInput: state.productInput,
        aiAnalysis: state.aiAnalysis,
        videoScripts: state.videoScripts,
        selectedIndexes: state.videoScripts
          .map((script, index) => (script.selected ? index : -1))
          .filter((index) => index >= 0),
        confirmProductUpdate: true,
      });
      alert(`导出完成：产品表 ${confirmed.updatedProduct ? "已更新" : "已新增"}，脚本表新增 ${confirmed.createdCount || 0} 条。`);
      return;
    }

    alert(`导出完成：产品表 ${result.updatedProduct ? "已更新" : "已新增"}，脚本表新增 ${result.createdCount || 0} 条。`);
  } catch (error) {
    console.error(error);
    alert(error.message || "导出飞书失败。");
  } finally {
    setButtonLoading(button, false, "正在导出飞书...", "导出到飞书");
  }
}

async function requestFeishuExport(payload) {
  const response = await fetch("/api/feishu/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "导出飞书失败");
  }
  return data;
}

async function requestFeishuDiagnose(payload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch("/api/feishu/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("飞书连接测试超时（15 秒）。这通常表示飞书接口响应很慢，或服务端请求卡住了。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "飞书连接测试失败");
  }
  return data;
}

function renderEditableCards(containerId, type, fields) {
  const container = $(`#${containerId}`);
  container.innerHTML = "";

  state.aiAnalysis[type].forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "editable-card";
    card.dataset.type = type;
    card.dataset.index = index;
    const label = getCardLabel(type, item, index);
    const primaryToggle =
      "isPrimary" in item
        ? `<label class="primary-check"><input type="checkbox" data-field="isPrimary" ${item.isPrimary ? "checked" : ""}>主项</label>`
        : "";

    card.innerHTML = `
      <div class="card-header">
        <h3>${escapeHtml(label)}</h3>
        <div class="card-tools">
          ${primaryToggle}
          ${type === "openingHooks" ? `<span class="tag">P${item.priority || index + 1}</span>` : ""}
          <button class="icon-button" type="button" title="删除" data-delete="${type}" data-index="${index}">×</button>
        </div>
      </div>
      <div class="card-fields">
        ${fields.map(([key, labelText, fieldType, width]) => renderField(key, labelText, fieldType, width, item[key])).join("")}
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      syncAnalysisFromDom();
      state.aiAnalysis[button.dataset.delete].splice(Number(button.dataset.index), 1);
      renderReview();
    });
  });
}

function openFeishuConfigDialog({ exportAfterSave = false } = {}) {
  const dialog = $("#feishuConfigDialog");
  if (!dialog) return;
  state.pendingFeishuExport = exportAfterSave;
  fillFeishuConfigForm(getStoredFeishuConfig());
  $("#saveFeishuConfig").textContent = exportAfterSave ? "保存并导出" : "保存配置";
  dialog.showModal();
}

function getStoredFeishuConfig() {
  try {
    const raw = window.localStorage.getItem(FEISHU_CONFIG_STORAGE_KEY);
    if (!raw) return { bitableUrl: "" };
    const parsed = JSON.parse(raw);
    return {
      bitableUrl: String(parsed.bitableUrl || "").trim(),
    };
  } catch {
    return { bitableUrl: "" };
  }
}

function saveFeishuConfig(config) {
  window.localStorage.setItem(FEISHU_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function isFeishuConfigComplete(config) {
  return Boolean(config?.bitableUrl);
}

function fillFeishuConfigForm(config) {
  $("#feishuBitableUrl").value = config.bitableUrl || "";
}

function collectFeishuConfigFromForm() {
  const config = {
    bitableUrl: $("#feishuBitableUrl").value.trim(),
  };
  if (!config.bitableUrl) {
    throw new Error("请填写飞书多维表链接。");
  }
  return config;
}

function renderField(key, label, fieldType, width, value = "") {
  const className = width === "wide" ? "mini-field wide" : "mini-field";
  if (fieldType === "textarea") {
    return `<div class="${className}"><label>${label}</label><textarea data-field="${key}">${escapeHtml(value)}</textarea></div>`;
  }
  if (fieldType === "select") {
    return `
      <div class="${className}">
        <label>${label}</label>
        <select data-field="${key}">
          ${[1, 2, 3, 4, 5].map((level) => `<option value="${level}" ${Number(value) === level ? "selected" : ""}>${level}</option>`).join("")}
        </select>
      </div>
    `;
  }
  return `<div class="${className}"><label>${label}</label><input data-field="${key}" value="${escapeHtml(value)}"></div>`;
}

function renderCompetitorAnalysis() {
  const analysis = state.aiAnalysis.competitorAnalysis;
  const hasCompetitor = state.productInput.competitorVideos.length > 0 || state.productInput.competitorNotes;
  $("#competitorStatus").textContent = hasCompetitor ? "已生成拆解" : "未上传竞品";
  $("#competitorVideoAnalysis").innerHTML = state.aiAnalysis.competitorVideoAnalyses.length
    ? state.aiAnalysis.competitorVideoAnalyses
        .map(
          (item) => `
            <div class="video-analysis-row">
              <strong>视频 ${item.index}: ${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.status)}</span>
              <p>${escapeHtml(item.note)}</p>
            </div>
          `
        )
        .join("")
    : "";
  $("#competitorAnalysis").innerHTML = [
    ["hook", "开头 hook"],
    ["sellingExpression", "卖点表达"],
    ["originalCopy", "文案"],
    ["originalCopyZh", "文案中文翻译"],
    ["cta", "CTA"],
  ]
    .map(
      ([key, label]) => `
        <div class="analysis-item">
          <strong>${label}</strong>
          <textarea data-competitor="${key}">${escapeHtml(analysis[key])}</textarea>
        </div>
      `
    )
    .join("");
}

function syncAnalysisFromDom() {
  state.aiAnalysis.planStrategies = $$('[data-type="planStrategies"]').map((card, index) => {
    const item = { planNo: index + 1 };
    card.querySelectorAll("[data-strategy-field]").forEach((field) => {
      item[field.dataset.strategyField] = field.value.trim();
    });
    return item;
  });

  ["sellingPoints"].forEach((type) => {
    state.aiAnalysis[type] = $$(`[data-type="${type}"]`).map((card) => {
      const item = {};
      card.querySelectorAll("[data-field]").forEach((field) => {
        if (field.type === "checkbox") {
          item[field.dataset.field] = field.checked;
        } else if (field.dataset.field === "priority") {
          item[field.dataset.field] = Number(field.value);
        } else {
          item[field.dataset.field] = field.value.trim();
        }
      });
      return item;
    });
  });

  $$("[data-competitor]").forEach((field) => {
    state.aiAnalysis.competitorAnalysis[field.dataset.competitor] = field.value.trim();
  });
}

function createEmptyItem(type) {
  const templates = {
    sellingPoints: {
      title: "新卖点",
      isPrimary: false,
    },
  };
  return templates[type];
}

function getCardLabel(type, item, index) {
  const keys = {
    sellingPoints: "title",
  };
  return item[keys[type]] || `条目 ${index + 1}`;
}

function showReview() {
  inputView.classList.add("hidden");
  copyView.classList.add("hidden");
  scriptView.classList.add("hidden");
  reviewView.classList.remove("hidden");
  $("#stepInput").classList.remove("active");
  $("#stepReview").classList.add("active");
  $("#stepCopy").classList.remove("active");
  $("#stepScript").classList.remove("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showInput() {
  reviewView.classList.add("hidden");
  copyView.classList.add("hidden");
  scriptView.classList.add("hidden");
  inputView.classList.remove("hidden");
  $("#stepReview").classList.remove("active");
  $("#stepCopy").classList.remove("active");
  $("#stepScript").classList.remove("active");
  $("#stepInput").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showCopy() {
  inputView.classList.add("hidden");
  reviewView.classList.add("hidden");
  scriptView.classList.add("hidden");
  copyView.classList.remove("hidden");
  $("#stepInput").classList.remove("active");
  $("#stepReview").classList.remove("active");
  $("#stepCopy").classList.add("active");
  $("#stepScript").classList.remove("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderManualCopySummary();
}

function showScript() {
  inputView.classList.add("hidden");
  reviewView.classList.add("hidden");
  copyView.classList.add("hidden");
  scriptView.classList.remove("hidden");
  $("#stepInput").classList.remove("active");
  $("#stepReview").classList.remove("active");
  $("#stepCopy").classList.remove("active");
  $("#stepScript").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
