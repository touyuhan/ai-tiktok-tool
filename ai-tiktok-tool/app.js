const state = {
  productInput: null,
  aiAnalysis: null,
  copyDrafts: [],
  selectedCopyDrafts: [],
  videoScripts: [],
  selectedVideoModel: "sora",
};

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

$("#targetCountry").addEventListener("change", (event) => {
  const language = countryLanguageMap[event.target.value];
  if (language) $("#outputLanguage").value = language;
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

$("#generateScripts").addEventListener("click", () => {
  runScriptGeneration();
});

$("#closeDialog").addEventListener("click", () => {
  $("#nextStepDialog").close();
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

async function runScriptGeneration() {
  state.selectedVideoModel = $('input[name="videoModel"]:checked')?.value || "sora";
  const button = $("#generateScripts");
  setButtonLoading(button, true, "AI 正在生成脚本...", "生成脚本提示词");
  try {
    state.videoScripts = await requestVideoScripts({
      productInput: state.productInput,
      aiAnalysis: state.aiAnalysis,
      copyDrafts: state.selectedCopyDrafts,
      videoModel: state.selectedVideoModel,
    });
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
  return Array.isArray(data.scripts) && data.scripts.length ? data.scripts : generateMockVideoScripts(payload);
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
      body: JSON.stringify({
        productInput: state.productInput,
        draft,
      }),
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
    painPoints: Array.isArray(analysis?.painPoints) && analysis.painPoints.length ? analysis.painPoints : localFallback.painPoints,
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
  const painPoints = buildPainPoints(defaults.painPoints, category, insightText);

  return {
    sellingPoints,
    audiences,
    painPoints,
    useCases,
    planStrategies: generatePlanStrategies(input, audiences, painPoints, useCases),
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
          sellingExpression: inferSellingExpression(sellingPoints, painPoints),
          originalCopy: input.competitorNotes || "已上传竞品参考，待视频理解模型提取原视频文案。",
          originalCopyZh: input.competitorNotes || "已上传竞品参考，待视频理解模型提取原视频文案并翻译。",
          cta: inferCta(input.competitorNotes),
        }
      : {
          hook: "未上传竞品参考，本次分析基于产品信息和目标市场生成。",
          sellingExpression: "围绕产品卖点、人群痛点和使用场景进行表达。",
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
    return {
      planNo: strategy.planNo,
      style: strategy.style,
      audience: strategy.audience,
      duration: "20-30s",
      hook: `Kalau ${strategy.audience} selalu ada masalah ${strategy.painPoint}, tengok ni.`,
      voiceover: `Kalau ${strategy.audience} selalu rasa ${strategy.painPoint}, produk kecil ni memang kena cuba. Nilai dia banyak: ${valueStackMs}. Sesuai letak dekat ${strategy.scene}, boleh beli beberapa pek untuk tempat berbeza, rasa macam sangat berbaloi untuk harga dia. ${nowReason}`,
      voiceoverZh: `如果${strategy.audience}经常遇到“${strategy.painPoint}”，这个小产品真的可以试。它的值感要讲满：${valueStackZh}。适合${strategy.scene}，还可以买几包放在不同位置，给人感觉这个价格能解决好多小问题。${hasPromo ? "有促销信息就直接带上。" : "现在卖家在做活动，别等太久。"}`,
      editedZh: `如果${strategy.audience}经常遇到“${strategy.painPoint}”，这个小产品真的可以试。它的值感要讲满：${valueStackZh}。适合${strategy.scene}，还可以买几包放在不同位置，给人感觉这个价格能解决好多小问题。${hasPromo ? "有促销信息就直接带上。" : "现在卖家在做活动，别等太久。"}`,
      cta: nowReason,
      selected: true,
    };
  });
}

function generateMockVideoScripts({ productInput, copyDrafts, videoModel }) {
  const modelName = videoModel === "veo" ? "Veo" : "Sora";
  const segmentDuration = videoModel === "veo" ? 10 : 12;
  return copyDrafts.map((draft) => {
    const estimatedDuration = parseDurationSeconds(draft.duration) || 24;
    const segmentCount = Math.max(1, Math.ceil(estimatedDuration / segmentDuration));
    const segments = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const shots = Array.from({ length: videoModel === "veo" ? 3 : 4 }, (_, shotIndex) => {
        const shotNo = shotIndex + 1;
        const refNo = `${modelName}-第 ${segmentIndex + 1} 段-第 ${shotNo} 镜头`;
        return {
          shotNo,
          duration: Math.max(2, Math.round(segmentDuration / (videoModel === "veo" ? 3 : 4))),
          referenceImagePrompt: `【参考图编号】\n${refNo}\n\n【画面主体】\n${productInput.productName} 在真实生活场景中出现，画面信息密度高，同时能看到产品、包装/配件、使用环境和人物动作；产品外观、颜色、形状、包装、图案和细节如产品参考图所示。\n\n【人物与动作】\n真实 TikTok 用户或老板/工厂人员，穿着日常，肤色、发型和五官自然，表情放松，正在展示或使用产品，产品如图所示；如果是工厂/老板视角，老板拿着产品走向镜头，背景工人正在打包或搬纸箱，现场有真实忙碌感。\n\n【场景与本土化】\n普通家庭空间、仓库或工厂打包区，通过衣柜、车内、洗手间、客厅、纸箱堆、包装台、工人动作等细节体现真实场景；产品摆放和使用方式如产品参考图所示。\n\n【画面风格】\n真实手机拍摄、TikTok UGC、自然光、不像广告大片；允许轻微手持晃动、自然杂乱和现场不完美。\n\n【构图】\n竖屏 9:16，中近景或手部特写；可以做拼图/多宫格参考，让包装、使用状态和效果对比同屏出现。\n\n【避免】\n不要夸张香味烟雾，不要产品变形，不要改变产品颜色/形状/包装，不要假 logo，不要欧美豪宅背景。`,
          videoPrompt: `【模型】\n${modelName}\n\n【段落与镜头】\n第 ${segmentIndex + 1} 段，第 ${shotNo} 镜头，时长 ${Math.max(2, Math.round(segmentDuration / (videoModel === "veo" ? 3 : 4)))} 秒。\n\n【参考图】\n分镜图 ${shotNo}，画面和产品如分镜图 ${shotNo} 所示。\n\n【动态内容】\n人物自然展示 ${productInput.productName}，把产品放到真实生活场景中，强化“${draft.audience}”的购买理由。\n\n【镜头运动】\n手持轻微晃动，慢推近，真实第一人称视角。\n\n【口播/字幕】\n${draft.voiceover}\n\n【风格】\n真实 TikTok UGC，本土生活感，手机拍摄。\n\n【约束】\n保持产品形状一致，画质风格接地气，不改变产品，不生成夸张，不加入无关人物，不出现乱码文字。`,
        };
      });
      return {
        segmentNo: segmentIndex + 1,
        duration: segmentDuration,
        referenceMode:
          videoModel === "veo" ? "本段最多 3 张参考图，对应 3 个关键镜头。" : "本段使用 1 张拼图参考图，拼入 3-5 个关键画面。",
        shots,
      };
    });
    return {
      planNo: draft.planNo,
      style: draft.style,
      model: modelName,
      totalDuration: estimatedDuration,
      voiceover: draft.voiceover,
      editedZh: draft.editedZh,
      segments,
    };
  });
}

function parseDurationSeconds(durationText) {
  const matches = String(durationText || "").match(/\d+/g);
  if (!matches?.length) return 0;
  return Number(matches[matches.length - 1]);
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

function buildPainPoints(defaultPainPoints, category, text) {
  const inferred = inferPainPointsFromText(text, category);
  const expanded = expandPainPoints(defaultPainPoints, category);
  return uniqueByKey([...inferred, ...expanded], "pain").slice(0, 8);
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

function inferPainPointsFromText(text, category) {
  const rules = [
    [/打结|缠|找不到|丢|散落/, "东西容易缠在一起或找不到", "出门前着急，越找越乱。", "展示混乱状态，再切到整理后的结果。"],
    [/乱|凌乱|整理|收纳|空间|小户型|租房/, "空间乱、物品多、不好整理", "看起来拥挤，影响心情和效率。", "用 before/after 对比展示变化。"],
    [/容量|装不下|分区|包里|小物/, "东西多但装不下或不好拿", "出门准备麻烦，找东西浪费时间。", "用真实装包过程证明容量和分区。"],
    [/防水|下雨|潮湿|热带/, "天气潮湿或下雨影响使用", "担心产品不耐用、不适合东南亚气候。", "展示雨天、潮湿环境或耐用细节。"],
    [/贵|价格|便宜|优惠|限时|低价/, "想买但担心价格不划算", "需要一个低风险、值得冲动下单的理由。", "突出价格、活动和即时改善。"],
    [/送礼|礼物|生日|节日/, "送礼怕不实用或不好看", "担心对方不喜欢，或者礼物显得敷衍。", "展示包装、上手效果和适用人群。"],
  ];
  const matched = rules
    .filter(([pattern]) => pattern.test(text))
    .map(([, pain, emotion, videoExpression], index) => ({
      pain,
      emotion,
      videoExpression,
      priority: index + 1,
    }));

  if (matched.length > 0) return matched;
  return category === "饰品"
    ? [{ pain: "日常穿搭不够出彩", emotion: "想快速变精致，但不想花太多时间。", videoExpression: "展示搭配前后变化。", priority: 1 }]
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

function inferSellingExpression(sellingPoints, painPoints) {
  return `围绕“${sellingPoints[0]?.title || "核心卖点"}”解决“${painPoints[0]?.pain || "用户痛点"}”，表达要短句化。`;
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

function generatePlanStrategies(input, audiences, painPoints, useCases) {
  const styles = input.selectedStyles.length > 0 ? input.selectedStyles : styleLibrary;
  return Array.from({ length: input.planCount }, (_, index) => {
    const style = styles[index % styles.length];
    const audience = audiences[index % audiences.length];
    const painPoint = painPoints[index % painPoints.length];
    const scene = useCases[index % useCases.length];
    return {
      planNo: index + 1,
      style,
      audience: audience.name,
      painPoint: painPoint.pain,
      scene: scene.scene,
      angle: getStyleAngle(style, painPoint.pain, scene.scene),
    };
  });
}

function getStyleAngle(style, painPoint, scene) {
  const angleMap = {
    "UGC 真实测评": `像真实用户一样先吐槽“${painPoint}”，再展示产品在${scene}里的改善。`,
    开箱种草: `从开箱第一眼和细节质感切入，再自然带到${scene}。`,
    痛点解决: `前 3 秒放大“${painPoint}”，中段用产品给出直接解决。`,
    前后对比: `用 before/after 对比展示${scene}中的变化。`,
    场景演示: `完整演示${scene}中的使用步骤，强调真实生活感。`,
    达人口播: `用达人推荐口吻讲清楚为什么这个产品适合解决“${painPoint}”。`,
    情绪共鸣: `先讲用户情绪，再把产品作为轻松变好的小改变。`,
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
  return angleMap[style] || `围绕${scene}和“${painPoint}”生成短视频方案。`;
}

function expandPainPoints(basePainPoints, category) {
  const extras = {
    家居: [
      {
        pain: "看过很多收纳方法但坚持不下来",
        emotion: "想要简单一点，不想每天花太多时间整理。",
        videoExpression: "展示一秒归位或随手整理，降低使用门槛。",
        priority: 3,
      },
      {
        pain: "家里看起来不够整洁，拍照不好看",
        emotion: "希望花小钱让空间马上变舒服。",
        videoExpression: "从手机镜头里的杂乱空间切到整洁画面。",
        priority: 4,
      },
    ],
    饰品: [
      {
        pain: "每天搭配都像少了一个亮点",
        emotion: "想快速变精致，但不想花太多时间。",
        videoExpression: "展示基础穿搭加上饰品后的变化。",
        priority: 2,
      },
      {
        pain: "想送礼但怕对方用不上",
        emotion: "希望礼物好看、实用、价格不尴尬。",
        videoExpression: "用礼物开箱和上手细节降低送礼风险。",
        priority: 3,
      },
    ],
    箱包: [
      {
        pain: "出门小物太多，包里总是乱",
        emotion: "找东西很烦，通勤和旅行都不方便。",
        videoExpression: "展示包内分区和快速取物。",
        priority: 2,
      },
      {
        pain: "一个包很难同时适合通勤和周末",
        emotion: "不想买太多包，希望一包多用。",
        videoExpression: "切换通勤、逛街、旅行三个场景。",
        priority: 3,
      },
    ],
  };
  return [...basePainPoints, ...(extras[category] || [])];
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
      painPoints: [
        {
          pain: "东西分散、桌面容易乱",
          emotion: "看起来拥挤，找东西浪费时间。",
          videoExpression: "先拍凌乱桌面，再切到产品整理后的画面。",
          priority: 1,
        },
        {
          pain: "空间小但物品多",
          emotion: "想买收纳工具，但又担心占地方。",
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
      painPoints: [
        {
          pain: "饰品容易打结或找不到",
          emotion: "出门前着急，影响搭配心情。",
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
      painPoints: [
        {
          pain: "包看起来小但东西装不下",
          emotion: "出门前反复取舍，很麻烦。",
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
  renderEditableCards("audienceCards", "audiences", [
    ["motivation", "购买动机", "textarea"],
    ["contentAngle", "内容切入点", "textarea"],
  ]);
  renderEditableCards("painPointCards", "painPoints", [
    ["pain", "痛点", "input"],
    ["emotion", "用户情绪", "textarea"],
    ["videoExpression", "视频表达", "textarea", "wide"],
    ["priority", "优先级", "select"],
  ]);
  renderEditableCards("useCaseCards", "useCases", [
    ["scene", "场景", "input"],
    ["shotSuggestion", "适合镜头", "textarea"],
    ["localizationNote", "本土化建议", "textarea"],
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
        ${renderStrategyField("painPoint", "痛点", item.painPoint)}
        ${renderStrategyField("scene", "场景", item.scene)}
        ${renderStrategyField("angle", "切入角度", item.angle, true)}
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
    ["核心卖点", input.rawCoreSellingPoints || "未填写"],
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
    const card = document.createElement("article");
    card.className = "script-card";
    card.innerHTML = `
      <div class="script-head">
        <div>
          <strong>方案 ${script.planNo}｜${escapeHtml(script.style || "")}</strong>
          <span>${escapeHtml(script.model || "")} · 约 ${escapeHtml(script.totalDuration || "")} 秒 · ${script.segments?.length || 0} 段</span>
        </div>
        <button class="small-button" type="button" data-copy-script>复制整条脚本</button>
      </div>
      <div class="script-body">
        ${(script.segments || [])
          .map(
            (segment) => `
              <section class="segment-block">
                <div class="segment-head">
                  <strong>第 ${segment.segmentNo} 段 · ${segment.duration}s</strong>
                  <span>${escapeHtml(segment.referenceMode || "")}</span>
                </div>
                ${(segment.shots || [])
                  .map(
                    (shot) => `
                      <div class="shot-block">
                        <div class="shot-title">镜头 ${shot.shotNo} · ${shot.duration}s</div>
                        <div class="prompt-grid">
                          <div class="mini-field">
                            <label>参考图 prompt</label>
                            <textarea readonly>${escapeHtml(shot.referenceImagePrompt)}</textarea>
                          </div>
                          <div class="mini-field">
                            <label>视频生成 prompt</label>
                            <textarea readonly>${escapeHtml(shot.videoPrompt)}</textarea>
                          </div>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </section>
            `
          )
          .join("")}
      </div>
    `;
    card.querySelector("[data-copy-script]").addEventListener("click", () => {
      copyText(toScriptText(script));
    });
    container.appendChild(card);
  });
}

function toScriptText(script) {
  return [
    `方案 ${script.planNo}｜${script.style || ""}`,
    `模型：${script.model}`,
    `总时长：${script.totalDuration}s`,
    "",
    ...(script.segments || []).flatMap((segment) => [
      `第 ${segment.segmentNo} 段｜${segment.duration}s｜${segment.referenceMode || ""}`,
      ...(segment.shots || []).flatMap((shot) => [
        `镜头 ${shot.shotNo}｜${shot.duration}s`,
        "参考图 prompt:",
        shot.referenceImagePrompt,
        "视频生成 prompt:",
        shot.videoPrompt,
        "",
      ]),
    ]),
  ].join("\n");
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
  const selectedCount = state.copyDrafts.filter((draft) => draft.selected).length || state.copyDrafts.length;
  $("#copySummary").innerHTML = [
    ["产品", state.productInput.productName],
    ["国家/语言", `${state.productInput.targetCountry} / ${state.productInput.outputLanguage}`],
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
          ${type === "painPoints" ? `<span class="tag">P${item.priority || index + 1}</span>` : ""}
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

  ["sellingPoints", "audiences", "painPoints", "useCases"].forEach((type) => {
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
    audiences: {
      motivation: "",
      contentAngle: "",
      isPrimary: false,
    },
    painPoints: {
      pain: "新痛点",
      emotion: "",
      videoExpression: "",
      priority: 3,
    },
    useCases: {
      scene: "新场景",
      shotSuggestion: "",
      localizationNote: "",
    },
  };
  return templates[type];
}

function getCardLabel(type, item, index) {
  if (type === "audiences") return `人群素材 ${index + 1}`;
  const keys = {
    sellingPoints: "title",
    painPoints: "pain",
    useCases: "scene",
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
