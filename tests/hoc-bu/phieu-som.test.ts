// tests/hoc-bu/phieu-som.test.ts — HB-PHIEU-SOM [13/10/2026]: nút "Nhận xét" ở Học bù hiện NGAY, không đợi điểm danh.
//
// Chủ dự án (đồng bộ với lớp chính): "thừa ô nhận xét chung, còn nút nhận xét thì cho hiện ra luôn, không hiện sau điểm danh nữa".
// Nút hiện sớm chỉ trung thực nếu MÁY CHỦ cho lưu — và ba hệ quả phải đúng, mà test thuần không chứng minh được:
//   1. phiếu lưu khi mục còn PLANNED không bị lượt ĐIỂM DANH sau đó ghi đè (trước đây điểm danh ghi `teacherEvaluation = null`);
//   2. phụ huynh KHÔNG thấy phiếu nháp của buổi chưa có kết quả;
//   3. mục đã gỡ (bé vắng / bị gỡ) thì không nhận xét được.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
// Fixture: A vắng 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8 (`_case-nhieu-bai-fixture.ts`).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { diemDanhBe, ghiDanhGiaMuc, suaDiemDanhBe } from "@/lib/hoc-bu/case-db";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { DEFAULT_EVAL_LEVEL, EVAL_CRITERIA } from "@/lib/lms/session-eval-rubric";
import { ADMIN, GV, HV, NOW, beCua, don, dung, lyDoLoi, mucCua, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[PSOM] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const RUBRIC = Object.fromEntries(EVAL_CRITERIA.map((c) => [c.id, DEFAULT_EVAL_LEVEL + 1]));
const luuPhieu = (caseStudentId: string, danhGia: string, rubric?: Record<string, number>) =>
  ghiDanhGiaMuc(null, { caseStudentId, danhGia, ...(rubric ? { rubric } : {}), chiGiaoVien: GV, ten: "GV", now: NOW });
const muc = (id: string) => db.makeupCaseStudent.findUniqueOrThrow({ where: { id } });
const coMat = async (caseId: string, mucId: string, ketQua: "COMPLETED" | "NOT_COMPLETED", danhGia: string | null) =>
  diemDanhBe(null, { participantId: (await beCua(caseId, "C")).id, coMat: true, ketQuaMuc: { [mucId]: { ketQua, danhGia } }, nhanXetChung: null, chiGiaoVien: GV, now: NOW });
const thayPH = async (b: "C") => [...(await getStudentMakeup(HV[b])).needList, ...(await getStudentMakeup(HV[b])).history].find((m) => m.id === needId(b, 7))!;

describe.skipIf(!RUN_DB_TESTS)("[PSOM] phiếu nhận xét lưu được TRƯỚC điểm danh", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[PSOM-01] mục còn PLANNED vẫn lưu được phiếu (chữ + bảng 9 tiêu chí); kết quả mục và dòng cần bù không đổi", async () => {
    const c = await tao([needId("C", 7)]);
    const m = await mucCua(c, "C", 7);
    await luuPhieu(m.id, "Phiếu viết sớm", RUBRIC);
    expect(await muc(m.id)).toMatchObject({ result: "PLANNED", teacherEvaluation: "Phiếu viết sớm", evaluatedById: GV });
    expect((await muc(m.id)).evaluationRubric).toEqual(RUBRIC);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("C", 7) } })).status).toBe("SCHEDULED");
  });

  it("[PSOM-02] ĐIỂM DANH sau đó (gửi đánh giá rỗng hoặc null) KHÔNG xoá phiếu đã lưu; gửi chữ mới thì ghi đè như cũ", async () => {
    const c = await tao([needId("C", 7)]);
    const m = await mucCua(c, "C", 7);
    await luuPhieu(m.id, "Phiếu viết sớm", RUBRIC);
    await coMat(c, m.id, "COMPLETED", null);
    expect(await muc(m.id)).toMatchObject({ result: "COMPLETED", teacherEvaluation: "Phiếu viết sớm" });
    expect((await muc(m.id)).evaluationRubric).toEqual(RUBRIC);
    // Đảo kết quả bằng sửa điểm danh, đánh giá rỗng ("   ") ⇒ vẫn giữ.
    const be = await beCua(c, "C");
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: true, ketQuaMuc: { [m.id]: { ketQua: "NOT_COMPLETED", danhGia: "   " } }, nhanXetChung: null, phienBan: be.version, lyDo: "Chọn nhầm kết quả", now: NOW, ten: "QL" });
    expect(await muc(m.id)).toMatchObject({ result: "NOT_COMPLETED", teacherEvaluation: "Phiếu viết sớm" });
    // Có chữ mới ⇒ ghi đè (hành vi cũ giữ nguyên).
    const be2 = await beCua(c, "C");
    await suaDiemDanhBe(ADMIN, { participantId: be2.id, coMat: true, ketQuaMuc: { [m.id]: { ketQua: "COMPLETED", danhGia: "Chữ mới" } }, nhanXetChung: null, phienBan: be2.version, lyDo: "Sửa lại cho đúng", now: NOW, ten: "QL" });
    expect(await muc(m.id)).toMatchObject({ result: "COMPLETED", teacherEvaluation: "Chữ mới" });
  });

  it("[PSOM-03] bé VẮNG buổi bù ⇒ mục bị gỡ (RELEASED) ⇒ không nhận xét được nữa, và câu từ chối nói đúng lý do", async () => {
    const c = await tao([needId("C", 7)]);
    const m = await mucCua(c, "C", 7);
    await luuPhieu(m.id, "Phiếu viết sớm");
    await diemDanhBe(null, { participantId: (await beCua(c, "C")).id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, chiGiaoVien: GV, now: NOW });
    expect((await muc(m.id)).result).toBe("RELEASED");
    expect(await lyDoLoi(luuPhieu(m.id, "Viết thêm sau khi vắng"))).toContain("đã được gỡ");
  });

  it("[PSOM-04] phụ huynh KHÔNG thấy phiếu nháp khi mục chưa có kết quả; có kết quả rồi mới thấy (đối chứng dương)", async () => {
    const c = await tao([needId("C", 7)]);
    const m = await mucCua(c, "C", 7);
    await luuPhieu(m.id, "Phiếu nháp không được lộ", RUBRIC);
    const truoc = await thayPH("C");
    expect(JSON.stringify(truoc)).not.toContain("Phiếu nháp không được lộ");
    expect(truoc.ketQua.hienTai?.danhGia ?? null).toBeNull();
    expect(truoc.ketQua.hienTai?.phieu ?? null).toBeNull();
    await coMat(c, m.id, "COMPLETED", null);
    const sau = await thayPH("C");
    expect(sau.ketQua.hienTai?.danhGia).toBe("Phiếu nháp không được lộ");
    expect(sau.ketQua.hienTai?.phieu).not.toBeNull();
  });
});
