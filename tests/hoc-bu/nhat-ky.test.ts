// tests/hoc-bu/nhat-ky.test.ts — T14: NHẬT KÝ học bù trên Postgres THẬT. Mỗi phép GHI nghiệp vụ để lại MỘT dòng `hoc-bu.<hành động>`, ghi TRONG giao dịch
// của phép ghi (rollback thì không có dòng), kèm người làm, đơn vị tổ chức và — với hành động cần lý do — lý do.
//
// Bài đi một vòng đời đầy đủ rồi đọc lại CHUỖI nhật ký: tạo case → xếp thêm → sửa → gỡ → điểm danh → (case hoàn thành) → sửa điểm danh (đảo) → đánh giá →
// phí → miễn phí → gỡ miễn phí → huỷ case → hoàn thành sau khi kỳ công đã chốt.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { goBeKhoiCase, ghiDanhGiaMuc, goMienPhiBu, huyCase, mienPhiBu, suaCase, suaDiemDanhBe, taoPhiBu, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { getOrCreatePeriod, lockPeriod } from "@/lib/cham-cong/period";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { HANH_DONG, KHOA_HANH_DONG, canLyDo } from "@/lib/hoc-bu/nhat-ky-thuan";
import { vnDateAt } from "@/lib/time/vn";
import { ADMIN, BAI, CS, GV, beCua, diemDanh, don, dung, luc, mucCua, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[NKD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const nk = (entityId: string) =>
  db.auditLog.findMany({ where: { module: "hoc-bu", entityId }, orderBy: [{ createdAt: "asc" }, { action: "asc" }] });
const hanhDong = async (entityId: string) => (await nk(entityId)).map((r) => r.action);
const GHI_CHU_PHAT_SINH = new Set<string>(KHOA_HANH_DONG);

describe.skipIf(!RUN_DB_TESTS)("[NKD] nhật ký học bù — T14", () => {
  beforeEach(() => dung());
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { module: "hoc-bu", actorName: { in: ["Quản trị T14"] } } });
    await don();
  });

  it("[NKD-01] CHUỖI NHẬT KÝ CỦA MỘT CASE: tạo → xếp thêm → sửa → gỡ → điểm danh → hoàn thành → sửa điểm danh (đảo, về NO_SHOW) → đánh giá", async () => {
    const c = await tao([...tatCaA(), needId("B", 6)], { lessonIds: [BAI[5], BAI[6], BAI[7]] });
    await xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("C", 7)] });
    const v0 = (await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).version;
    await suaCase(ADMIN, { caseId: c, phienBan: v0, ymd: "2026-10-16", ten: "Admin T14" });
    await goBeKhoiCase(ADMIN, (await beCua(c, "C")).id);

    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" }, luc(16, 18, 30));
    await diemDanh(c, "B", false, {}, luc(16, 18, 40));
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");

    // Sửa điểm danh A: có mặt → vắng ⇒ mọi bé đều vắng ⇒ case ĐẢO từ COMPLETED về NO_SHOW.
    const a = await beCua(c, "A");
    await suaDiemDanhBe(null, {
      participantId: a.id,
      coMat: false,
      ketQuaMuc: {},
      nhanXetChung: null,
      chiGiaoVien: GV,
      now: luc(16, 19, 0),
      phienBan: a.version,
      lyDo: "Nhập nhầm — bé A không đến",
      ten: "Admin T14",
    });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("NO_SHOW");

    const caseLog = await nk(c);
    const cacHanhDong = caseLog.map((r) => r.action);
    expect(cacHanhDong).toContain("hoc-bu.tao-case");
    expect(cacHanhDong).toContain("hoc-bu.xep-vao-case");
    expect(cacHanhDong).toContain("hoc-bu.sua-case");
    // Hai lần đổi trạng thái: SCHEDULED→COMPLETED rồi COMPLETED→NO_SHOW (đảo).
    const doi = caseLog.filter((r) => r.action === "hoc-bu.doi-trang-thai-case").map((r) => [(r.oldValues as { status: string }).status, (r.newValues as { status: string }).status]);
    expect(doi).toEqual([["SCHEDULED", "COMPLETED"], ["COMPLETED", "NO_SHOW"]]);
    // Gỡ bé C: một dòng ở MỤC (có lý do), và C bị gỡ nên case không đổi trạng thái vì C.
    const muc = await mucCua(c, "C", 7);
    const mucLog = await nk(muc.id);
    expect(mucLog.map((r) => r.action)).toEqual(["hoc-bu.go-muc-khoi-case"]);
    expect(mucLog[0]!.reason).toBe("Gỡ bé khỏi case chưa điểm danh");
    // Điểm danh lần đầu của A và B; sửa của A.
    const aLog = await hanhDong(a.id);
    expect(aLog).toEqual(["hoc-bu.diem-danh-be", "hoc-bu.sua-diem-danh-be"]);
    expect(await hanhDong((await beCua(c, "B")).id)).toEqual(["hoc-bu.diem-danh-be"]);
    // Người làm có TÊN (tra theo id trong giao dịch), đơn vị tổ chức có mặt trên dòng của case.
    const tao1 = caseLog.find((r) => r.action === "hoc-bu.tao-case")!;
    expect(tao1.actorId).toBe(GV);
    expect(tao1.actorName).toBe("GV T07");
    expect((tao1.newValues as { needIds: string[] }).needIds).toHaveLength(4);
  });

  it("[NKD-02] ĐÁNH GIÁ: lưu đánh giá một bài để lại dòng `hoc-bu.danh-gia-muc`", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    const muc = await mucCua(c, "C", 7);
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: muc.id, danhGia: "Tiến bộ rõ", ten: "Admin T14" });
    expect(await hanhDong(muc.id)).toContain("hoc-bu.danh-gia-muc");
  });

  it("[NKD-03] HUỶ CASE để lại `hoc-bu.huy-case` (cũ→mới, số bé bị gỡ) — MỘT dòng cho cả case, không một dòng cho từng mục", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    await huyCase(ADMIN, c);
    const log = await nk(c);
    const huy = log.find((r) => r.action === "hoc-bu.huy-case")!;
    expect(huy.oldValues).toMatchObject({ status: "SCHEDULED" });
    expect(huy.newValues).toMatchObject({ status: "CANCELLED", soBeBiGo: 2 });
  });

  it("[NKD-04] PHÍ: tạo phí → miễn phí → gỡ miễn phí đều có dòng; miễn/gỡ miễn có LÝ DO; tên người duyệt lấy từ tham số", async () => {
    await dung({ A: 0, B: 3, C: 3, D: 3 });
    const { orderId } = await taoPhiBu(ADMIN, needId("A", 5));
    const phi = await nk(needId("A", 5));
    expect(phi.map((r) => r.action)).toEqual(["hoc-bu.tao-phi"]);
    expect(phi[0]!.newValues).toMatchObject({ orderId });
    // Miễn phí dòng KHÁC của cùng bé (dòng 6: chưa có phí).
    await mienPhiBu(ADMIN, { needId: needId("A", 6), lyDo: "BGĐ duyệt miễn phí ngoại lệ", ten: "Quản trị T14" });
    await goMienPhiBu(ADMIN, { needId: needId("A", 6), lyDo: "Người duyệt đổi ý", ten: "Quản trị T14" });
    const mien = await nk(needId("A", 6));
    expect(mien.map((r) => r.action)).toEqual(["hoc-bu.mien-phi", "hoc-bu.go-mien-phi"]);
    expect(mien.map((r) => r.reason)).toEqual(["BGĐ duyệt miễn phí ngoại lệ", "Người duyệt đổi ý"]);
    expect(mien.every((r) => r.actorName === "Quản trị T14")).toBe(true);
  });

  it("[NKD-05] CASE HOÀN THÀNH SAU KHI KỲ CÔNG ĐÃ CHỐT ⇒ dòng `hoc-bu.cong-day-sau-chot-ky` (kỳ KHÔNG bị sửa); case hoàn thành TRƯỚC khi chốt thì không có dòng này", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", true, { 7: "COMPLETED" });
    const kq = await lockPeriod({ centerId: CS, periodKey: "2026-10", actorId: GV, reason: "T14", boQuaBuoiChuaChot: true, now: vnDateAt(2026, 10, 2, 9, 0) });
    expect(kq.ok).toBe(true);
    expect(await hanhDong(c1)).not.toContain("hoc-bu.cong-day-sau-chot-ky");
    const c2 = await tao([needId("B", 6)], { ymd: "2026-10-16" });
    await diemDanh(c2, "B", true, { 6: "COMPLETED" }, luc(16, 18, 30));
    const log = await nk(c2);
    const sau = log.find((r) => r.action === "hoc-bu.cong-day-sau-chot-ky");
    expect(sau, "case hoàn thành sau chốt phải để lại dấu vết").toBeTruthy();
    expect(sau!.newValues).toMatchObject({ ky: "2026-10", status: "COMPLETED" });
    expect(sau!.reason).toContain("đã chốt");
  });

  it("[NKD-05b] kỳ công của tháng đó CÓ hàng nhưng còn MỞ (chưa chốt) ⇒ KHÔNG có dòng 'công dạy sau chốt kỳ' — chỉ kỳ ĐÃ CHỐT mới đáng báo", async () => {
    await getOrCreatePeriod(CS, "2026-10");
    expect((await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId: CS, periodKey: "2026-10" } } })).status).toBe("OPEN");
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect(await hanhDong(c)).toContain("hoc-bu.doi-trang-thai-case");
    expect(await hanhDong(c)).not.toContain("hoc-bu.cong-day-sau-chot-ky");
  });

  it("[NKD-06] ROLLBACK ⇒ KHÔNG có dòng nhật ký: ghi trong giao dịch rồi nổ thì dòng biến mất cùng phép ghi", async () => {
    const c = await tao([needId("C", 7)]);
    const truoc = (await nk(c)).length;
    await expect(
      db.$transaction(async (tx) => {
        await ghiNhatKy(tx, { actorId: GV, entityType: "MakeupCase", entityId: c, action: "hoc-bu.huy-case", newValues: { x: 1 } });
        throw new Error("nổ giữa giao dịch");
      }),
    ).rejects.toThrow("nổ giữa giao dịch");
    expect((await nk(c)).length).toBe(truoc);
  });

  it("[NKD-07] MỌI dòng nhật ký module 'hoc-bu' của vòng đời mang một hành động TRONG DANH SÁCH ĐÓNG, và hành động cần lý do thì có lý do", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    await goBeKhoiCase(ADMIN, (await beCua(c, "A")).id);
    await huyCase(ADMIN, c);
    const ids = [c, ...(await db.makeupCaseStudent.findMany({ where: { caseId: c }, select: { id: true } })).map((m) => m.id)];
    const dong = await db.auditLog.findMany({ where: { module: "hoc-bu", entityId: { in: ids } } });
    expect(dong.length).toBeGreaterThanOrEqual(3); // tạo case · gỡ bé A · huỷ case
    for (const r of dong) {
      expect(GHI_CHU_PHAT_SINH.has(r.action), r.action).toBe(true);
      if (canLyDo(r.action)) expect(r.reason, r.action).toBeTruthy();
    }
    expect(Object.keys(HANH_DONG).length).toBe(KHOA_HANH_DONG.length);
  });
});

const tatCaA = () => [needId("A", 5), needId("A", 6), needId("A", 7)];
