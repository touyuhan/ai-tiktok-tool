const {
  getFeishuConfigWithOverrides,
  getTenantAccessToken,
  ensureTableByName,
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

async function main() {
  const bitableUrl = String(process.argv[2] || "").trim();
  if (!bitableUrl) {
    throw new Error("请传入飞书多维表链接。例如：node mock-feishu-export.js 'https://xxx.feishu.cn/base/...' ");
  }

  const config = getFeishuConfigWithOverrides({ bitableUrl });
  const tenantAccessToken = await getTenantAccessToken(config);
  const scriptOnlyMode = process.argv.includes("--script-only");

  const productInput = {
    productName: "多层首饰收纳盒",
    productImages: ["demo-product-1.png", "demo-product-2.png"],
    rawSellingPoints: "分层收纳，透明抽屉，适合小卧室和租房空间；现在有活动，送礼也合适",
    rawCoreSellingPoints: "防止项链打结；快速找到饰品；桌面马上变整齐",
    rawUseCases: "卧室梳妆台、早上通勤前搭配、节日礼物",
    rawAudience: "18-30 岁年轻女性、学生、通勤白领、喜欢饰品但桌面容易乱的人",
    referenceCopies: [
      "桌面乱到每次出门都找不到耳环？这个收纳盒分层很清楚，项链不会缠在一起，透明抽屉一眼就能看到。现在活动价真的很适合入。",
    ],
    targetCountry: "泰国",
    outputLanguage: "泰语",
    planCount: 2,
    selectedStyles: ["UGC 真实测评", "痛点解决"],
    competitorVideos: [],
    competitorNotes: "竞品常用 before/after 对比，前 3 秒展示凌乱桌面，字幕很短，CTA 偏限时折扣。",
  };

  const aiAnalysis = {
    sellingPoints: [
      { title: "防止项链打结", description: "分层设计让项链、耳环、戒指分开摆放，拿取更顺手。", isPrimary: true },
      { title: "快速找到饰品", description: "透明抽屉一眼能看到内容，出门前不用翻找。", isPrimary: true },
      { title: "桌面更整齐", description: "把零散首饰集中收纳，小桌面也能显得清爽。", isPrimary: true },
    ],
    audiences: [
      { name: "年轻女性", motivation: "想要梳妆台整洁又好看。", contentAngle: "从出门前找饰品很麻烦切入。", isPrimary: true },
    ],
    painPoints: [
      { pain: "首饰容易乱、容易缠在一起", emotion: "出门前很急，越找越烦。", videoExpression: "前后对比展示。", priority: 1 },
    ],
    useCases: [
      { scene: "卧室梳妆台", shotSuggestion: "手机近景拍抽屉拉开和拿取动作。", localizationNote: "家庭生活化场景。" },
    ],
    planStrategies: [
      { planNo: 1, style: "UGC 真实测评", audience: "年轻女性", painPoint: "首饰容易乱、容易缠在一起", scene: "卧室梳妆台", angle: "先展示混乱，再给出解决方案。" },
      { planNo: 2, style: "痛点解决", audience: "年轻女性", painPoint: "出门前找不到耳环", scene: "卧室梳妆台", angle: "强调收纳后节省时间。" },
    ],
  };

  const scripts = [
    {
      planNo: 1,
      style: "UGC 真实测评",
      model: "Sora",
      totalDuration: 24,
      audience: "年轻女性",
      painPoint: "首饰容易乱、容易缠在一起",
      voiceover: "Kalau meja solek selalu bersepah sampai rantai pun kusut, kotak simpanan ni memang buat hidup rasa senang.",
      editedZh:
        "如果你的梳妆台总是乱糟糟，项链还老是缠在一起，这个收纳盒真的会让你轻松很多。分层很清楚，耳环、项链、戒指都能分开放，透明抽屉一拉开就能看到。早上出门不用再翻半天，现在有活动，真的很值得直接入。",
      videoTitle: "โต๊ะเครื่องแป้งดูเป็นระเบียบขึ้นทันที",
      tags: ["#收纳好物", "#梳妆台整理", "#TikTokShop"],
      selected: true,
      segments: [
        {
          segmentNo: 1,
          duration: 12,
          referenceMode: "本段使用 1 张拼图参考图，拼入 4 个关键画面。",
          shots: [
            {
              shotNo: 1,
              duration: 3,
              referenceImagePrompt:
                "【参考图编号】Sora-第 1 段-第 1 镜头\n\n【画面主体】梳妆台上首饰散乱摆放，项链缠在一起，旁边放着产品收纳盒，产品外观如参考图所示。\n\n【人物与动作】年轻女性伸手翻找耳环，表情有点着急。\n\n【场景与本土化】普通卧室梳妆台，真实生活感。\n\n【画面风格】真实手机拍摄，TikTok UGC。\n\n【构图】竖屏 9:16，中近景。\n\n【避免】不要改变产品形状和颜色。",
              videoPrompt:
                "【模型】Sora\n\n【段落与镜头】第 1 段，第 1 镜头，时长 3 秒。\n\n【参考图】分镜图 1\n\n【动态内容】镜头展示首饰凌乱，人物翻找耳环。\n\n【镜头运动】手持轻微晃动。\n\n【口播/字幕】Kalau meja solek selalu bersepah sampai rantai pun kusut...\n\n【风格】真实 TikTok UGC。\n\n【约束】保持产品外观一致。",
            },
          ],
        },
      ],
    },
    {
      planNo: 2,
      style: "痛点解决",
      model: "Sora",
      totalDuration: 24,
      audience: "年轻女性",
      painPoint: "出门前找不到耳环",
      voiceover: "Bila semua aksesori dah simpan ikut lapisan, pagi-pagi tak perlu kelam-kabut cari satu-satu lagi.",
      editedZh:
        "当所有饰品都按层放好之后，早上真的不用再慌慌张张一个个找。透明抽屉很好拿，想戴什么一眼就能看到，小小一个却能让桌面立刻整齐很多。现在活动价也很合适，买来自己用或者送人都不错。",
      videoTitle: "หาเครื่องประดับง่ายขึ้นทุกเช้า",
      tags: ["#首饰收纳", "#桌面整理", "#居家好物"],
      selected: true,
      segments: [
        {
          segmentNo: 1,
          duration: 12,
          referenceMode: "本段使用 1 张拼图参考图，拼入 4 个关键画面。",
          shots: [
            {
              shotNo: 1,
              duration: 3,
              referenceImagePrompt:
                "【参考图编号】Sora-第 1 段-第 1 镜头\n\n【画面主体】透明抽屉拉开后能看到耳环、项链、戒指分层摆放，产品外观如参考图所示。\n\n【人物与动作】手部快速拿出耳环，动作利落。\n\n【场景与本土化】卧室梳妆台，真实手机拍摄。\n\n【画面风格】生活化，不像广告大片。\n\n【构图】竖屏 9:16，手部特写。\n\n【避免】不要改变产品包装和颜色。",
              videoPrompt:
                "【模型】Sora\n\n【段落与镜头】第 1 段，第 1 镜头，时长 3 秒。\n\n【参考图】分镜图 1\n\n【动态内容】人物快速拉开抽屉并取出耳环。\n\n【镜头运动】轻微推近。\n\n【口播/字幕】Bila semua aksesori dah simpan ikut lapisan...\n\n【风格】真实 TikTok UGC。\n\n【约束】保持产品外观一致。",
            },
          ],
        },
      ],
    },
  ];

  const scriptTable = await ensureTableByName({
    appToken: config.appToken,
    tenantAccessToken,
    tableId: config.scriptTableId || "",
    preferredTableId: config.linkedTableId || "",
    name: SCRIPT_TABLE_NAME,
    fields: SCRIPT_FIELDS,
  });

  let productTable = null;
  let productRecord = null;
  if (!scriptOnlyMode) {
    productTable = await ensureTableByName({
      appToken: config.appToken,
      tenantAccessToken,
      tableId: config.productTableId || "",
      name: PRODUCT_TABLE_NAME,
      fields: PRODUCT_FIELDS,
    });

    const productName = productInput.productName || "";
    if (productName) {
      productRecord = await findRecordByField({
        appToken: config.appToken,
        tableId: productTable.tableId,
        tenantAccessToken,
        fieldName: "产品名称",
        value: productName,
      });
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
  }

  const createdRecords = [];
  for (const script of scripts) {
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

  console.log("飞书模拟导出完成");
  if (scriptOnlyMode) {
    console.log("产品表：已跳过（script-only 模式）");
  } else {
    console.log(`产品表：${productTable.name} (${productTable.tableId}) ${productRecord ? "已更新" : "已新增"}`);
  }
  console.log(`脚本表：${scriptTable.name} (${scriptTable.tableId}) 新增 ${createdRecords.length} 条`);
  if (createdRecords.length) {
    console.log(`记录 ID：${createdRecords.join(", ")}`);
  }
}

main().catch((error) => {
  console.error("飞书模拟导出失败：");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
