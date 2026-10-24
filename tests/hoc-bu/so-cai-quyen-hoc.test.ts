// tests/hoc-bu/so-cai-quyen-hoc.test.ts — HỌC BÙ (case dạy bù) ⇒ SỔ CÁI QUYỀN HỌC, đầu–cuối trên Postgres THẬT (khu vực KV4 "portal-gv").
//
// Chạy:  pnpm test:hoc-bu-db      (vitest.db.config.ts; CI: bước "Run học bù (toàn vẹn) DB tests")
//
// Đi qua `diemDanhBe` / `suaDiemDanhBe` THẬT của case dạy bù (không giả lập `doiKetQuaMuc`), với cờ bật bằng `CenterSetting` thật của một OrgUnit
// gắn vào cơ sở fixture — nên ca này chứng minh cả phép đọc cờ ngoài giao dịch (`docSoCaiChoBe`) chứ không chỉ phần đồng bộ.
//
// Kịch bản của fixture (`_case-nhieu-bai-fixture`): bé A vắng bài 5,6,7 (ABSENT_EXCUSED, cần bù) · B vắng 6,7 · C vắng 7 · D vắng 8, cùng khoá + cơ sở.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { tinhGiaTheoMoc } from "@/lib/pricing/tinh-gia-theo-moc";
import { capQuyenHoc, xepLop, type PhuThuoc } from "@/lib/entitlements/dich-vu";
import { suaDiemDanhBe } from "@/lib/hoc-bu/case-db";
import { ADMIN, CS, HV, KHOA, LOP, NOW, T, beCua, diemDanh, don, dung, needId, tao, tatCa } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[SCQ] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NGUOI = { id: `${T}nguoi-sc`, name: "Người thử sổ cái" };
const BAT: PhuThuoc = { batChoCoSo: async () => true };
const OU = `${T}ou`;
const MA_OU = "T07OUSC";

async function donSoCai() {
  await db.studyEntitlementUsage.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { OR: [{ module: "entitlements", entityType: "StudyEntitlement", entityId: { startsWith: T } }, { actorId: NGUOI.id }] } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: OU } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  clearSettingsCache();
}

async function datCo(bat: boolean) {
  await db.centerSetting.upsert({
    where: { orgUnitId_key: { orgUnitId: OU, key: KHOA_CONG_TAC_PHAM_VI } },
    create: { orgUnitId: OU, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
    update: { valueJson: bat },
  });
  clearSettingsCache();
}

let dem = 0;
/** Quyền học 12 buổi của một bé, phạm vi 1..12 (khoá fixture có 12 bài; bài vắng 5..8 nằm trong phạm vi). */
async function quyenHocCua(studentId: string) {
  const k = ++dem;
  const { quyenHoc } = await capQuyenHoc(
    {
      studentId,
      courseId: KHOA,
      orderId: `${T}don-sc-${k}`,
      orderItemId: `${T}dong-sc-${k}`,
      centerId: CS,
      gia: tinhGiaTheoMoc({ gia48: 10_560_000, soBuoi: 12, thuTuCon: 1 }),
      pricingSnapshot: { gia48: 10_560_000 },
      actor: NGUOI,
    },
    BAT,
  );
  return (await xepLop({ entitlementId: quyenHoc.id, enrollmentId: `${T}gd-sc-${k}`, classId: LOP, baiKeTiepCuaLop: 1, actor: NGUOI, now: NOW }, BAT)).quyenHoc;
}

const dong = (entitlementId: string) => db.studyEntitlementUsage.findMany({ where: { entitlementId }, orderBy: { lessonOrder: "asc" } });
const dongSong = async (entitlementId: string) => (await dong(entitlementId)).filter((d) => d.voidedAt === null);
const consumed = async (id: string) => (await db.studyEntitlement.findUniqueOrThrow({ where: { id } })).consumedSessions;

describe.skipIf(!RUN_DB_TESTS)("[SCQ] học bù ⇒ sổ cái quyền học (đi qua diemDanhBe / suaDiemDanhBe thật)", () => {
  beforeEach(async () => {
    await donSoCai();
    await dung();
    await db.orgUnit.create({ data: { id: OU, code: MA_OU, name: "OrgUnit T07 sổ cái", type: "CENTER", centerId: CS } });
    await datCo(true);
  });
  afterAll(async () => {
    await donSoCai();
    await don();
  });

  it("[SCQ-01] bé học xong bài 5, 6 và chưa xong bài 7 ⇒ MỖI bài xong một dòng sổ cái nguồn MAKEUP, bài chưa xong không có; consumedSessions = 2", async () => {
    const e = await quyenHocCua(HV.A);
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });
    expect((await dongSong(e.id)).map((d) => [d.lessonOrder, d.source])).toEqual([[5, "MAKEUP"], [6, "MAKEUP"]]);
    expect(await consumed(e.id)).toBe(2);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: e.id, action: "CONSUME" } })).toBe(2);
  });

  it("[SCQ-02] SỬA điểm danh buổi bù có mặt → vắng ⇒ các dòng MAKEUP bị huỷ (đảo được), consumedSessions về 0; sửa lại → ghi lại ĐÚNG hai dòng, không dòng thứ ba", async () => {
    const e = await quyenHocCua(HV.A);
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });
    const be = await beCua(c, "A");
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, phienBan: be.version, lyDo: "Giáo viên bấm nhầm, bé thực ra vắng", now: NOW, ten: "QL" });
    expect(await dongSong(e.id)).toHaveLength(0);
    expect(await consumed(e.id)).toBe(0);
    expect((await dong(e.id)).every((d) => d.voidedAt !== null)).toBe(true);

    // Vắng → có mặt: các mục đã nhả được hồi sinh thành mục MỚI, bài 5/6 xong trở lại.
    const be2 = await beCua(c, "A");
    const cu = await db.makeupCaseStudent.findMany({ where: { participantId: be.id, result: "RELEASED" } });
    const kq: Record<string, { ketQua: "COMPLETED" | "NOT_COMPLETED"; danhGia: string | null }> = {};
    for (const m of cu) kq[m.id] = { ketQua: m.makeupNeedId === needId("A", 7) ? "NOT_COMPLETED" : "COMPLETED", danhGia: null };
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: true, ketQuaMuc: kq, nhanXetChung: null, phienBan: be2.version, lyDo: "Bé có tới, giáo viên chọn nhầm", now: NOW, ten: "QL" });
    expect((await dongSong(e.id)).map((d) => d.lessonOrder)).toEqual([5, 6]);
    expect((await dong(e.id)).length, "bật lại dòng cũ, không chèn dòng thứ hai cho cùng bài").toBe(2);
    expect(await consumed(e.id)).toBe(2);
  });

  it("[SCQ-03] CỜ TẮT cho cơ sở ⇒ học bù xong KHÔNG ghi sổ cái nào (điểm danh buổi bù vẫn hoàn tất như thường)", async () => {
    await datCo(false);
    const e = await quyenHocCua(HV.A);
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "COMPLETED" });
    expect(await dong(e.id)).toHaveLength(0);
    expect(await consumed(e.id)).toBe(0);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } })).status).toBe("COMPLETED");
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
  });

  it("[SCQ-04] bé KHÔNG có quyền học (học viên cũ) học bù xong ⇒ không lỗi, không dòng sổ cái, case vẫn chốt", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect(await db.studyEntitlementUsage.count({ where: { studentId: HV.C } })).toBe(0);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
  });

  it("[SCQ-05] bé VẮNG buổi bù ⇒ không dòng sổ cái (mục chuyển PLANNED → RELEASED không đổi bằng chứng)", async () => {
    const e = await quyenHocCua(HV.B);
    const c = await tao(tatCa("B"));
    await diemDanh(c, "B", false);
    expect(await dong(e.id)).toHaveLength(0);
  });

  it("[SCQ-06] bài đã bù xong rồi học viên vẫn ĐÁNH VẮNG ở buổi gốc: dòng MAKEUP là của bài ấy, sửa điểm danh buổi bù có mặt → vắng huỷ NÓ (bằng chứng duy nhất)", async () => {
    const e = await quyenHocCua(HV.C);
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect((await dongSong(e.id)).map((d) => [d.lessonOrder, d.source])).toEqual([[7, "MAKEUP"]]);
    const att = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: `${T}s7`, studentId: HV.C } } });
    expect(att.status, "điểm danh GỐC giữ nguyên vắng (HB-13)").toBe("ABSENT_EXCUSED");
    const be = await beCua(c, "C");
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, phienBan: be.version, lyDo: "Bé thực ra vắng buổi bù", now: NOW, ten: "QL" });
    expect(await dongSong(e.id)).toHaveLength(0);
  });

  it("[SCQ-07] quyền học thuộc CƠ SỞ KHÁC cơ sở của dòng cần bù: không ném, case vẫn chốt, sổ cái không đụng", async () => {
    const e = await quyenHocCua(HV.A);
    await db.studyEntitlement.update({ where: { id: e.id }, data: { centerId: `${T}cs-khac` } });
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "COMPLETED" });
    expect(await dong(e.id)).toHaveLength(0);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
  });
});
