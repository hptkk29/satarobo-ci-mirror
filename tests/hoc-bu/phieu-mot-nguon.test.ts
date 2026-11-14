// tests/hoc-bu/phieu-mot-nguon.test.ts — MỘT đánh giá, nhiều nơi đọc (chủ dự án chốt 09/10/2026), trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
// Chốt: đánh giá của buổi học bù là CẤU TRÚC (đánh giá chung + bảng 9 tiêu chí) lưu ở `MakeupCaseStudent` — đó là NGUỒN SỰ THẬT; PDF chỉ là đầu ra.
// Sau khi giáo viên lập phiếu, cả năm nơi phải cùng phản ánh MỘT bản ghi: màn case · buổi GỐC (điểm danh) · cổng phụ huynh · PDF · (và KHÔNG ghi đè nhận xét
// của buổi gốc — `StudentSessionFeedback`). Mỗi ca có đối chứng: sửa phiếu một lần ⇒ cả các nơi đổi theo (không có bản sao nào bị bỏ sót).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { scopedDb } from "@/lib/db-scope";
import { ghiDanhGiaMuc } from "@/lib/hoc-bu/case-db";
import { docChiTietCaseV2 } from "@/lib/hoc-bu/case-chi-tiet";
import { docKetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi-db";
import { gonKetQua, khoaCapBuoi } from "@/lib/hoc-bu/ket-qua-buoi";
import { CHON_PHIEU_MUC, dungPdfPhieuMuc } from "@/lib/hoc-bu/phieu-muc-pdf";
import { dongPhieu } from "@/lib/hoc-bu/phieu-tom-tat";
import { normalizeEvalRatings } from "@/lib/lms/session-eval-rubric";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { ADMIN, GV, HV, buoiGoc, diemDanh, don, dung, mucCua, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[EVAL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

describe.skipIf(!RUN_DB_TESTS)("[EVAL] một đánh giá — case · buổi gốc · cổng phụ huynh · PDF", () => {
  beforeEach(() => dung());
  afterAll(async () => {
    await db.studentSessionFeedback.deleteMany({ where: { studentId: HV.B } });
    await don();
  });

  it("[EVAL-01] lập phiếu ở case ⇒ CÙNG một đánh giá (chữ + bảng 9 tiêu chí) ở màn case, buổi gốc, cổng phụ huynh và đầu vào PDF; sửa một lần ⇒ cả bốn nơi đổi; nhận xét của buổi GỐC không bị đè", async () => {
    // Buổi gốc đã có nhận xét riêng của giáo viên (phiếu buổi học bình thường).
    await db.studentSessionFeedback.deleteMany({ where: { studentId: HV.B } });
    const goc = await db.studentSessionFeedback.create({
      data: { classSessionId: buoiGoc(6), studentId: HV.B, comment: "Nhận xét buổi gốc — KHÔNG được đổi", rubric: { "kt-cu": 5 }, createdById: GV },
    });

    const caseId = await tao([needId("B", 6), needId("B", 7)]);
    await diemDanh(caseId, "B", true, { 6: "COMPLETED", 7: "NOT_COMPLETED" });
    const m6 = await mucCua(caseId, "B", 6);
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m6.id, danhGia: "Hiểu bài tốt", rubric: { "kt-cu": 1, "ky-nang": 2 }, ten: "QL" });

    // 1) Màn case.
    const o = (await docChiTietCaseV2(scopedDb(ADMIN), { caseId, chiCuaSale: null }))!.be[0]!.muc.find((m) => m.id === m6.id)!;
    expect(o.danhGia).toBe("Hiểu bài tốt");
    expect(o.rubric).not.toBeNull();

    // 2) Buổi GỐC (điểm danh) — qua mô hình đọc duy nhất T08.
    const kq = (await docKetQuaBuoi(db, [{ sessionId: buoiGoc(6), studentId: HV.B }])).get(khoaCapBuoi(buoiGoc(6), HV.B))!;
    expect(kq.trangThai).toBe("DA_BU");
    expect(kq.hienTai!.danhGia).toBe("Hiểu bài tốt");
    expect(kq.hienTai!.phieu).toEqual(o.rubric); // cùng bảng 9 tiêu chí đã chuẩn hoá, không phải bản sao tự suy
    expect(gonKetQua(kq)).toMatchObject({ danhGia: "Hiểu bài tốt", coPhieu: true });

    // 3) Cổng phụ huynh.
    const cong = await getStudentMakeup(HV.B);
    const ct = [...cong.needList, ...cong.history].find((m) => m.id === needId("B", 6))!.ketQua.hienTai!;
    expect(ct.danhGia).toBe("Hiểu bài tốt");
    expect(ct.phieu).toEqual(dongPhieu(o.rubric)); // cùng hàng đọc được
    expect(ct.phieu).toHaveLength(9);
    expect(ct.phieu![0]).toMatchObject({ ten: "Kiến thức cũ", muc: 1 });

    // 4) PDF — dựng từ CHÍNH hàng này (không có kho riêng).
    const hang = await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: m6.id }, select: CHON_PHIEU_MUC });
    expect(hang.teacherEvaluation).toBe("Hiểu bài tốt");
    expect(normalizeEvalRatings(hang.evaluationRubric)).toEqual(o.rubric);
    const pdf = await dungPdfPhieuMuc(hang);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

    // 5) Nhận xét của buổi gốc KHÔNG bị ghi đè (đánh giá bù không đè nhận xét gốc).
    const gocSau = await db.studentSessionFeedback.findUniqueOrThrow({ where: { id: goc.id } });
    expect(gocSau.comment).toBe("Nhận xét buổi gốc — KHÔNG được đổi");
    expect(gocSau.rubric).toEqual({ "kt-cu": 5 });
    expect(await db.studentSessionFeedback.count({ where: { studentId: HV.B } })).toBe(1);

    // Đối chứng: sửa phiếu MỘT lần ⇒ buổi gốc + cổng phụ huynh đổi theo (không có bản sao nào bị bỏ sót).
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m6.id, danhGia: "Đã sửa lại", rubric: { "kt-cu": 4 }, ten: "QL" });
    const kq2 = (await docKetQuaBuoi(db, [{ sessionId: buoiGoc(6), studentId: HV.B }])).get(khoaCapBuoi(buoiGoc(6), HV.B))!;
    expect(kq2.hienTai!.danhGia).toBe("Đã sửa lại");
    expect(kq2.hienTai!.phieu!["kt-cu"]).toBe(4);
    const ct2 = [...(await getStudentMakeup(HV.B)).history, ...(await getStudentMakeup(HV.B)).needList].find((m) => m.id === needId("B", 6))!.ketQua.hienTai!;
    expect(ct2.danhGia).toBe("Đã sửa lại");
    expect(ct2.phieu![0]).toMatchObject({ muc: 4 });
  }, 90_000);

  it("[EVAL-02] phiếu CHỈ CÓ CHỮ (chưa chấm bảng) ⇒ buổi gốc và cổng phụ huynh nói thật: có đánh giá chung, KHÔNG bịa bảng 9 tiêu chí", async () => {
    const caseId = await tao([needId("B", 6)]);
    await diemDanh(caseId, "B", true, { 6: "COMPLETED" }); // fixture ghi sẵn chữ qua đường cũ, không có bảng
    const kq = (await docKetQuaBuoi(db, [{ sessionId: buoiGoc(6), studentId: HV.B }])).get(khoaCapBuoi(buoiGoc(6), HV.B))!;
    expect(kq.hienTai!.danhGia).toBeTruthy();
    expect(kq.hienTai!.phieu).toBeNull();
    expect(gonKetQua(kq)!.coPhieu).toBe(false);
    const ct = (await getStudentMakeup(HV.B)).history.find((m) => m.id === needId("B", 6))!.ketQua.hienTai!;
    expect(ct.danhGia).toBeTruthy();
    expect(ct.phieu).toBeNull();
  });
});
