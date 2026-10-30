// @vitest-environment node
/**
 * AI LEAD — `taoLeadTuHoSo` trên POSTGRES THẬT với `ingestIntakeLead` THẬT (không mock): lead được tạo ở đâu, mang gì, và gọi lặp/song song thì ra mấy lead.
 *
 * ⚠️ Tự SKIP khi không có Postgres test (cổng `RUN_DB_TESTS`). Thấy SKIP trong log nghĩa là CHƯA KIỂM ĐƯỢC GÌ, không phải «xanh».
 * Chạy: `ALLOW_DB_RESET=1` qua `vitest.db.config.ts`, trên DB `satarobo_test*` / `ci_test*` (KHÔNG BAO GIỜ `satarobo_local`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, assertTenDbTest } from "../_helpers/db-gate";
import { actorQlcs } from "../../lib/ai-lead/dich-vu/ho-tro-test-duyet";
import { MA_NGUON, P, PAGE, db, donDep, dungNen, taoHoSo, taoHoiThoai, PHONE_NOI_DIA, type Nen } from "./_nen-c";

const CO_BANG = RUN_DB_TESTS && (await db.aiLeadDraft.count().then(() => true).catch(() => false));
if (!CO_BANG) console.warn("[ai-lead tao-lead] SKIP: không có Postgres test hoặc chưa có bảng AiLead* (chạy prisma migrate deploy trên DB test).");

describe.skipIf(!CO_BANG)("[ATLD] taoLeadTuHoSo — DB thật", () => {
  let nen: Nen;
  beforeAll(() => {
    assertTenDbTest();
  });
  beforeEach(async () => {
    nen = await dungNen();
  }, 60_000);
  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  async function goi(draftId: string, centerIds: string[] = [nen.centerA]) {
    const { taoLeadTuHoSo } = await import("../../lib/ai-lead/dich-vu/tao-lead");
    return taoLeadTuHoSo(draftId, { actor: actorQlcs("u-qlcs-test", centerIds), tu: "STAFF", tenNguoi: "QL Test" });
  }

  // ── Cổng NGUỒN: lead chính thức KHÔNG được rơi UNKNOWN/không-nguồn; thiếu cấu hình ⇒ hồ sơ ở Ngoại lệ, không mất khách ─────────────────────────────────────────────────
  const dat = (key: string, valueJson: unknown) => db.systemSetting.update({ where: { key }, data: { valueJson: valueJson as never } }).then(async () => (await import("@/lib/settings/service")).clearSettingsCache());
  const PHA: [string, () => Promise<unknown>][] = [
    ["cờ nguon.enabled TẮT (mặc định của hệ thống)", () => dat("nguon.enabled", false)],
    ["cờ nguon.pageMapping TẮT", () => dat("nguon.pageMapping", false)],
    ["Page chưa có trong danh mục Page CRM (FacebookPageMapping)", () => db.facebookPageMapping.deleteMany({ where: { pageId: PAGE } })],
    ["Page chưa được gán nhóm nguồn (bảng nguồn theo Page rỗng)", () => dat("nguon.bangNguonTheoPage", {})],
    ["nhóm nguồn đã ngừng (INACTIVE)", () => db.leadSourceGroup.update({ where: { code: MA_NGUON }, data: { status: "INACTIVE" } })],
    ["nhóm nguồn chưa tới ngày hiệu lực", () => db.leadSourceGroup.update({ where: { code: MA_NGUON }, data: { effectiveFrom: new Date(Date.now() + 30 * 86_400_000) } })],
    ["nhóm nguồn đã hết hiệu lực (effectiveTo trong quá khứ)", () => db.leadSourceGroup.update({ where: { code: MA_NGUON }, data: { effectiveTo: new Date(Date.now() - 86_400_000) } })],
  ];
  it.each(PHA)("[ATLD-NG-01] %s ⇒ KHÔNG tạo lead, không ghi nguồn; hồ sơ → SYSTEM_EXCEPTION/NGUON_CHUA_CAU_HINH (có audit); khách không mất", async (_ten, pha) => {
    const hs = await taoHoSo(nen, { id: `${P}ng01`, convId: await taoHoiThoai(nen, "ng01") });
    await pha();
    const { clearSettingsCache } = await import("@/lib/settings/service");
    clearSettingsCache();
    const kq = await goi(hs.id);
    expect(kq).toMatchObject({ ok: false, lyDo: "NGUON_CHUA_CAU_HINH" });
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
    expect(await db.leadAttribution.count({ where: { lead: { eventId: `ailead:${hs.id}` } } })).toBe(0);
    const sau = await db.aiLeadDraft.findUniqueOrThrow({ where: { id: hs.id } });
    expect(sau).toMatchObject({ state: "SYSTEM_EXCEPTION", resultNote: "NGUON_CHUA_CAU_HINH", leadId: null });
    expect(await db.auditLog.count({ where: { entityId: hs.id, action: "SYSTEM_EXCEPTION" } })).toBe(1);
  });

  it("[ATLD-NG-02] đối chứng dương + KHÔNG MẤT KHÁCH: cấu hình thiếu ⇒ Ngoại lệ; Owner cấu hình xong ⇒ thử lại ⇒ đúng MỘT lead, nguồn = nhóm Marketing HO qua PAGE_MAPPING (không UNKNOWN)", async () => {
    const hs = await taoHoSo(nen, { id: `${P}ng02`, convId: await taoHoiThoai(nen, "ng02") });
    await dat("nguon.bangNguonTheoPage", {});
    expect(await goi(hs.id)).toMatchObject({ ok: false, lyDo: "NGUON_CHUA_CAU_HINH" });
    // Màn Cấu hình (MKT-02) nói ĐÚNG cùng sự thật với cổng: trước khi cấu hình Page này «chưa sẵn sàng», sau khi cấu hình «sẵn sàng» với đúng nhóm.
    const { docCauHinh } = await import("../../lib/ai-lead/dich-vu/cau-hinh");
    await db.aiLeadAgentPage.upsert({ where: { agentId_pageId: { agentId: nen.agentId, pageId: PAGE } }, update: {}, create: { agentId: nen.agentId, pageId: PAGE, state: "ENABLED" } });
    const nguonCuaPage = async () => (await docCauHinh(new Date())).agents.find((x) => x.id === nen.agentId)?.pages.find((x) => x.pageId === PAGE)?.nguon;
    expect(await nguonCuaPage()).toMatchObject({ san: false });
    await dat("nguon.bangNguonTheoPage", { [PAGE]: { groupCode: MA_NGUON } }); // Owner cấu hình xong
    expect(await nguonCuaPage()).toEqual({ san: true, groupCode: MA_NGUON });
    const kq = await goi(hs.id);
    expect(kq.ok).toBe(true);
    const lead = await db.lead.findUniqueOrThrow({ where: { eventId: `ailead:${hs.id}` } });
    const attr = await db.leadAttribution.findFirstOrThrow({ where: { leadId: lead.id }, include: { group: true } });
    expect(attr.group.code).toBe(MA_NGUON);
    expect(attr.matchedRule).toBe("PAGE_MAPPING");
    expect(attr.group.code).not.toBe("UNKNOWN");
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(1);
  });

  it("[ATLD-NG-03] thiếu cấu hình ⇒ báo người sửa được (sources:manage ∪ ai-leads:configure) MỘT thông báo cho nhiều hồ sơ cùng Page cùng ngày; thân tin không PII", async () => {
    await dat("nguon.enabled", false);
    const h1 = await taoHoSo(nen, { id: `${P}ng03a`, convId: await taoHoiThoai(nen, "ng03a") });
    const h2 = await taoHoSo(nen, { id: `${P}ng03b`, convId: await taoHoiThoai(nen, "ng03b"), phone: PHONE_NOI_DIA[1] });
    await goi(h1.id);
    await goi(h2.id);
    const tb = await db.staffNotification.findMany({ where: { dedupeKey: { startsWith: `ai_lead.nguon:${PAGE}:` } } });
    const khoa = new Set(tb.map((t) => t.dedupeKey));
    expect(khoa.size).toBeLessThanOrEqual(1); // 0 nếu DB test không có ai giữ hai quyền — không bao giờ nhiều hơn một khoá
    for (const t of tb) expect(`${t.title} ${t.body}`).not.toMatch(/Nguyễn|0900|84900/);
  });

  it("[ATLD-01] hồ sơ đủ điều kiện ⇒ ĐÚNG MỘT lead mang tên FB, SĐT canonical, cơ sở đã kiểm, kênh messenger-ai, không người nhập", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d01` });
    const kq = await goi(hs.id);
    expect(kq.ok).toBe(true);
    const lead = await db.lead.findUnique({ where: { eventId: `ailead:${hs.id}` } });
    expect(lead).not.toBeNull();
    expect(lead).toMatchObject({
      parentName: "Nguyễn Thị Lan",
      phone: `84${PHONE_NOI_DIA[0].slice(1)}`,
      centerId: nen.centerA,
      source: "messenger-ai",
      consentMarketing: true,
      createdById: null, // người bấm Duyệt KHÔNG thành «người nhập» (D12)
    });
    expect(lead!.note ?? "").toContain("AI Messenger");
    expect(lead!.note ?? "").not.toContain("mid.");
    expect(lead!.facebookUrl).toBeNull();
    expect(await db.leadChild.count({ where: { leadId: lead!.id } })).toBe(0);
    // hồ sơ: không có Sale trong cơ sở test ⇒ lead chưa có chủ ⇒ ASSIGNMENT_PENDING; hoặc COMPLETED nếu hệ thống chia được chủ. Cả hai đều mang leadId.
    const sau = await db.aiLeadDraft.findUnique({ where: { id: hs.id } });
    expect(["ASSIGNMENT_PENDING", "COMPLETED"]).toContain(sau!.state);
    expect(sau!.leadId).toBe(lead!.id);
    expect(sau!.version).toBe(hs.version + 1);
    expect(sau!.state === "COMPLETED" ? lead!.assignedToId !== null : lead!.assignedToId === null).toBe(true);
    const au = await db.auditLog.findMany({ where: { entityId: hs.id, action: "CREATE_LEAD" } });
    expect(au).toHaveLength(1);
  });

  it("[ATLD-02] consentMarketing = false khi khách không đồng ý (hoặc thiếu mid)", async () => {
    const a = await taoHoSo(nen, { id: `${P}d02a`, consentAllowed: false, consentMid: null });
    const b = await taoHoSo(nen, { id: `${P}d02b`, consentAllowed: true, consentMid: null, phone: PHONE_NOI_DIA[1], convId: await taoHoiThoai(nen, "02b") });
    await goi(a.id);
    await goi(b.id);
    expect((await db.lead.findUnique({ where: { eventId: `ailead:${a.id}` } }))!.consentMarketing).toBe(false);
    expect((await db.lead.findUnique({ where: { eventId: `ailead:${b.id}` } }))!.consentMarketing).toBe(false);
  });

  it("[ATLD-03] gọi lặp cùng draftId ⇒ cùng lead, không đẻ thêm", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d03` });
    const k1 = await goi(hs.id);
    const k2 = await goi(hs.id);
    expect(k1.ok && k2.ok).toBe(true);
    if (k1.ok && k2.ok) expect(k2.leadId).toBe(k1.leadId);
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(1);
  });

  it("[ATLD-04] 6 lượt SONG SONG cùng draftId ⇒ vẫn ĐÚNG MỘT lead, mọi lượt trả cùng leadId", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d04` });
    const kq = await Promise.all(Array.from({ length: 6 }, () => goi(hs.id)));
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(1);
    const lead = await db.lead.findUnique({ where: { eventId: `ailead:${hs.id}` } });
    for (const k of kq) {
      // mỗi lượt hoặc thành công cùng leadId, hoặc báo xung đột có kèm đúng id lead — KHÔNG lượt nào được tạo lead khác
      if (k.ok) expect(k.leadId).toBe(lead!.id);
      else expect(k.chiTiet ?? "").toContain(lead!.id);
    }
    expect(kq.filter((k) => k.ok).length).toBeGreaterThanOrEqual(1);
  });

  it("[ATLD-05] thiếu điều kiện (tên FB do khách tự gõ) ⇒ KHÔNG tạo lead, hồ sơ giữ nguyên", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d05`, fbNameSource: "CUSTOMER_STATED" });
    const kq = await goi(hs.id);
    expect(kq).toMatchObject({ ok: false, lyDo: "THIEU_DIEU_KIEN" });
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
    const sau = await db.aiLeadDraft.findUnique({ where: { id: hs.id } });
    expect(sau).toMatchObject({ state: "READY_FOR_REVIEW", leadId: null, version: hs.version });
  });

  it("[ATLD-06] cơ sở bị tắt «nhận khách» sau khi hồ sơ đã sẵn sàng ⇒ revalidate chặn, KHÔNG có lead", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d06` });
    await db.aiLeadCampusPublication.updateMany({ where: { pageId: `${P}PAGE1`, campusCenterId: nen.centerA }, data: { acceptingLeads: false } });
    const kq = await goi(hs.id);
    expect(kq).toEqual({ ok: false, lyDo: "CO_SO_KHONG_HOP_LE", chiTiet: "CO_SO_NGUNG_NHAN_KHACH" });
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
  });

  it("[ATLD-07] QLCS cơ sở B gọi thẳng taoLeadTuHoSo cho hồ sơ cơ sở A ⇒ NGOAI_PHAM_VI, không lead", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d07` });
    const kq = await goi(hs.id, [nen.centerB]);
    expect(kq).toEqual({ ok: false, lyDo: "NGOAI_PHAM_VI" });
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
  });

  it("[ATLD-09] tạo TỰ ĐỘNG khi cài đặt mặc định (ai.autoCreateEnabled = tắt) ⇒ bị từ chối, KHÔNG lead, hồ sơ không đổi; duyệt tay vẫn được", async () => {
    const hs = await taoHoSo(nen, { id: `${P}d09` });
    const { taoLeadTuHoSo } = await import("../../lib/ai-lead/dich-vu/tao-lead");
    expect(await taoLeadTuHoSo(hs.id, { tu: "AUTO" })).toEqual({ ok: false, lyDo: "TU_DONG_TAT" });
    expect(await db.lead.count({ where: { eventId: `ailead:${hs.id}` } })).toBe(0);
    expect(await db.aiLeadDraft.findUniqueOrThrow({ where: { id: hs.id } })).toMatchObject({ state: "READY_FOR_REVIEW", version: hs.version, leadId: null });
    expect((await goi(hs.id)).ok).toBe(true);
  });

  it("[ATLD-08] SĐT trùng lead đang mở ⇒ hồ sơ gắn vào lead cũ (không đẻ lead thứ hai), vẫn xong", async () => {
    const hs1 = await taoHoSo(nen, { id: `${P}d08a` });
    const hs2 = await taoHoSo(nen, { id: `${P}d08b`, convId: await taoHoiThoai(nen, "08b") });
    const k1 = await goi(hs1.id);
    const k2 = await goi(hs2.id);
    expect(k1.ok && k2.ok).toBe(true);
    if (k1.ok && k2.ok) {
      expect(k2.leadId).toBe(k1.leadId);
      expect(k2.duplicate).toBe(true);
    }
    expect(await db.lead.count({ where: { phone: `84${PHONE_NOI_DIA[0].slice(1)}`, deletedAt: null } })).toBe(1);
  });
});
