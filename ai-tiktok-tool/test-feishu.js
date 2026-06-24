const {
  buildScriptRecordFields,
  createRecord,
  getFeishuConfig,
  getTenantAccessToken,
  listRecords,
  normalizeLegacyRecords,
} = require("./feishu");

async function main() {
  const config = getFeishuConfig();
  if (!config.scriptTableId) {
    throw new Error("读取测试需要 FEISHU_SCRIPT_TABLE_ID。如果只想在网页导出时自动建表，可以不设置这个变量。");
  }

  console.log("1. 获取 tenant_access_token...");
  const tenantAccessToken = await getTenantAccessToken(config);
  console.log("   OK");

  console.log("2. 读取脚本文案表前 5 条...");
  const records = await listRecords({
    appToken: config.appToken,
    tableId: config.scriptTableId,
    tenantAccessToken,
    pageSize: 5,
  });
  console.log(`   OK，共读取 ${records.items?.length || 0} 条`);

  const normalized = normalizeLegacyRecords(records.items || []);
  if (normalized.length) {
    console.log("3. 旧数据兼容读取样例：");
    console.log(JSON.stringify(normalized[0], null, 2).slice(0, 1200));
  } else {
    console.log("3. 当前表暂无记录，跳过旧数据样例。");
  }

  if (process.env.FEISHU_TEST_WRITE !== "1") {
    console.log("4. 跳过写入测试。需要写入时运行：FEISHU_TEST_WRITE=1 npm run test:feishu");
    return;
  }

  console.log("4. 写入一条规范化测试记录...");
  const record = await createRecord({
    appToken: config.appToken,
    tableId: config.scriptTableId,
    tenantAccessToken,
    fields: buildScriptRecordFields(),
  });
  console.log("   OK，record_id:", record?.record_id || record?.id || "unknown");
}

main().catch((error) => {
  console.error("\n飞书模块测试失败：");
  console.error(error.message || error);
  process.exitCode = 1;
});
