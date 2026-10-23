// tests/hoc-bu/giao-dien.test.ts — T16: các câu ĐỌC mà màn học bù dựa vào, trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
//
// Vì sao cần Postgres: `docChiTietCaseV2` ghép bốn bảng (case · bộ bài · bé · mục) và LỌC mục đã nhả; một `select` thiếu cột hay một `where` sai vẫn trả về
// hình dạng hợp lệ, nên test thuần không nói được gì. Fixture là kịch bản nghiệm thu: A vắng bài 5,6,7 · B vắng 6,7.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { LoiHocBu, ghiDanhGiaMuc, goBeKhoiCase, nangCapCaseTheoYeuCau } from "@/lib/hoc-bu/case-db";
import { CHON_PHIEU_MUC, dungPdfPhieuMuc } from "@/lib/hoc-bu/phieu-muc-pdf";
import { docChiTietCaseV2, docChiTietCaseV2ChoGv } from "@/lib/hoc-bu/case-chi-tiet";
import { docBienLaiLuot } from "@/lib/hoc-bu/bien-lai-luot-db";
import { giaiThichLuot } from "@/lib/hoc-bu/hien-thi-thuan";
import { scopedDb } from "@/lib/db-scope";
import {
  id,
  CS,
  KHOA,
  GV,
  GV2,
  PHONG,
  BAI,
  HV,
  ADMIN,
  ngayDb,
  needId,
  don,
  dung,
  tao,
  tatCa,
  beCua,
  diemDanh,
  mucCua,
  so,
} from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[GDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const sdb = () => scopedDb(ADMIN);

describe.skipIf(!RUN_DB_TESTS)("[GDB] câu đọc của màn học bù — T16", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[GDB-01] case 3 bài, 2 bé: bộ bài theo thứ tự, mục của mỗi bé theo thứ tự bài, đếm đủ, sức chứa lấy từ phòng", async () => {
    const caseId = await tao([...tatCa("A"), needId("B", 6), needId("B", 7)]);
    const c = await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null });
    expect(c).not.toBeNull();
    expect(c!.boBai).toHaveLength(3);
    expect(c!.boBai.map((b) => b.id)).toEqual([BAI[5], BAI[6], BAI[7]]);
    expect(c!.status).toBe("SCHEDULED");
    expect(c!.daNangCap).toBe(true);
    expect(c!.soBe).toBe(2);
    expect(c!.soChoDiemDanh).toBe(2);
    expect(c!.soCoMat).toBe(0);
    expect(c!.teacherId).toBe(GV);
    expect(c!.roomId).toBe(PHONG);
    const phong = await db.room.findUniqueOrThrow({ where: { id: PHONG } });
    expect(c!.sucChua).toBe(phong.capacity);
    const a = c!.be.find((b) => b.studentId === HV.A)!;
    const b = c!.be.find((x) => x.studentId === HV.B)!;
    expect(a.muc.map((m) => m.lessonId)).toEqual([BAI[5], BAI[6], BAI[7]]);
    expect(b.muc.map((m) => m.lessonId)).toEqual([BAI[6], BAI[7]]);
    for (const m of [...a.muc, ...b.muc]) {
      expect(m).toMatchObject({ result: "PLANNED", danhGia: null, cachXep: "LUOT" });
      expect(m.ngayVang).not.toBeNull();
    }
    expect(a.status).toBe("PENDING");
    expect(a.version).toBe(0);
    expect(a.hocVien).toBeTruthy();
  });

  it("[GDB-01b] mục của bé xếp theo thứ tự BÀI của bộ bài, không theo thứ tự tạo mục (vd. gỡ rồi thêm lại bài 5 ⇒ mục bài 5 tạo SAU cùng)", async () => {
    const caseId = await tao(tatCa("A"));
    await db.makeupCaseStudent.updateMany({ where: { caseId, makeupNeedId: needId("A", 5) }, data: { createdAt: new Date(Date.UTC(2035, 0, 1)) } });
    const c = (await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null }))!;
    expect(c.boBai.map((b) => b.id)).toEqual([BAI[5], BAI[6], BAI[7]]);
    expect(c.be[0]!.muc.map((m) => m.lessonId)).toEqual([BAI[5], BAI[6], BAI[7]]);
  });

  it("[GDB-02] sau điểm danh: kết quả TỪNG bài + đánh giá hiện đúng, 'chưa xong' vẫn là mục sống; đếm có mặt / chờ", async () => {
    const caseId = await tao([...tatCa("A"), needId("B", 6), needId("B", 7)]);
    await diemDanh(caseId, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });
    const c = (await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null }))!;
    expect(c.soCoMat).toBe(1);
    expect(c.soChoDiemDanh).toBe(1);
    const a = c.be.find((b) => b.studentId === HV.A)!;
    expect(a.status).toBe("PRESENT");
    expect(a.nhanXetChung).toBe("Con học tốt");
    expect(a.version).toBeGreaterThan(0);
    expect(a.muc.map((m) => [m.lessonId, m.result, m.danhGia])).toEqual([
      [BAI[5], "COMPLETED", "Đánh giá A5"],
      [BAI[6], "COMPLETED", "Đánh giá A6"],
      [BAI[7], "NOT_COMPLETED", "Đánh giá A7"],
    ]);
    // B chưa điểm danh ⇒ mục vẫn PLANNED, không bị ảnh hưởng.
    expect(c.be.find((b) => b.studentId === HV.B)!.muc.every((m) => m.result === "PLANNED")).toBe(true);
  });

  it("[GDB-03] bé vắng buổi bù: mục nhả ra khỏi 'muc' sang 'mucDaNha' — màn không còn cho thao tác lên chúng", async () => {
    const caseId = await tao([needId("B", 6), needId("B", 7)]);
    await diemDanh(caseId, "B", false);
    const b = (await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null }))!.be[0]!;
    expect(b.status).toBe("ABSENT");
    expect(b.muc).toEqual([]);
    expect(b.mucDaNha.map((m) => m.lessonId).sort()).toEqual([BAI[6], BAI[7]].sort());
  });

  it("[GDB-04] gỡ cả bé: trạng thái REMOVED (không tính vào soBe), mục sang 'mucDaNha'", async () => {
    const caseId = await tao([...tatCa("A"), needId("B", 6)]);
    await goBeKhoiCase(ADMIN, (await beCua(caseId, "B")).id);
    const c = (await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null }))!;
    const b = c.be.find((x) => x.studentId === HV.B)!;
    expect(b.status).toBe("REMOVED");
    expect(b.muc).toEqual([]);
    expect(c.soBe).toBe(1);
    expect(c.soChoDiemDanh).toBe(1);
  });

  it("[GDB-05] site GV: chỉ đọc được case MÌNH dạy; giáo viên khác nhận null (như không tồn tại)", async () => {
    const caseId = await tao([needId("B", 6)]);
    expect((await docChiTietCaseV2ChoGv(GV, caseId))?.id).toBe(caseId);
    expect(await docChiTietCaseV2ChoGv(GV2, caseId)).toBeNull();
    expect(await docChiTietCaseV2ChoGv(GV, "khong-co-case-nay")).toBeNull();
  });

  it("[GDB-06] Sale không liên quan: bộ lọc `chiCuaSale` làm case biến mất; không truyền (quản lý) thì thấy", async () => {
    const caseId = await tao([needId("B", 6)]);
    expect(await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: id("sale-khong-lien-quan") })).toBeNull();
    expect((await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null }))?.id).toBe(caseId);
  });

  it("[GDB-07] case đời cũ (chưa có bé tham gia): daNangCap=false; 'Nâng cấp' đổi nó, chạy lại KHÔNG ghi gì và chỉ ghi nhật ký lần đầu", async () => {
    const CASE_CU = id("case-cu-t16");
    await db.makeupCase.create({
      data: { id: CASE_CU, centerId: CS, courseId: KHOA, lessonId: BAI[7], date: ngayDb(15), startTime: "18:00", endTime: "19:30", roomId: PHONG, teacherId: GV, status: "SCHEDULED", createdById: GV },
    });
    await db.makeupNeed.updateMany({ where: { id: needId("C", 7) }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.create({ data: { id: id("sv-t16-c7"), caseId: CASE_CU, makeupNeedId: needId("C", 7), status: "PLACED", dungLuot: true, centerId: CS, addedById: GV } });

    const truoc = (await docChiTietCaseV2(sdb(), { caseId: CASE_CU, chiCuaSale: null }))!;
    expect(truoc.daNangCap).toBe(false);

    expect(await nangCapCaseTheoYeuCau(ADMIN, CASE_CU)).toEqual({ daNangCap: true });
    const sau = (await docChiTietCaseV2(sdb(), { caseId: CASE_CU, chiCuaSale: null }))!;
    expect(sau.daNangCap).toBe(true);
    expect(sau.soBe).toBe(1);
    expect(sau.be[0]!.muc.map((m) => m.lessonId)).toEqual([BAI[7]]);

    expect(await nangCapCaseTheoYeuCau(ADMIN, CASE_CU)).toEqual({ daNangCap: false });
    const nhatKy = await db.auditLog.findMany({ where: { entityType: "MakeupCase", entityId: CASE_CU, action: "hoc-bu.nang-cap-case" } });
    expect(nhatKy).toHaveLength(1);
  });

  it("[GDB-08] nâng cấp case không tồn tại ⇒ báo lỗi của học bù, không ném lỗi thô", async () => {
    await expect(nangCapCaseTheoYeuCau(ADMIN, "khong-co")).rejects.toThrow("Không tìm thấy case dạy bù");
  });

  it("[GDB-09] 'vì sao còn x/y lượt': giải thích từ SỔ THẬT khớp đúng số dư tài khoản (cấp − giữ − dùng)", async () => {
    await tao(tatCa("A")); // giữ 3 lượt
    const bl = await docBienLaiLuot({ studentId: HV.A, courseId: KHOA });
    expect(bl.coSo).toBe(true);
    if (!bl.coSo) return;
    const g = giaiThichLuot(bl.so, bl.bieuGhi);
    expect(g.con).toBe((await so("A")).con);
    expect(g.tomTat).toContain("đang giữ 3");
    expect(g.dong.filter((d) => d.nhan === "Giữ lượt cho buổi đã xếp").length).toBe(3);
    expect(bl.biCat).toBe(false);
  });

  it("[GDB-11] sổ dài hơn trần: chỉ trả các bút toán MỚI NHẤT và nói rõ là bị cắt (không cắt im lặng)", async () => {
    const tk = await db.makeupCreditAccount.findUniqueOrThrow({ where: { studentId_courseId: { studentId: HV.A, courseId: KHOA } } });
    const goc = Date.UTC(2035, 0, 1); // sau mọi bút toán fixture (tạo lúc chạy) — ngày tuyệt đối, không đọc đồng hồ
    await db.makeupCreditEntry.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({ accountId: tk.id, type: "GRANT" as const, grantedDelta: 1, reason: `but-toan-${i}`, idemKey: `GDB11:${i}`, createdAt: new Date(goc + (i + 1) * 60_000) })),
    });
    const bl = await docBienLaiLuot({ studentId: HV.A, courseId: KHOA });
    expect(bl.coSo).toBe(true);
    if (!bl.coSo) return;
    expect(bl.biCat).toBe(true);
    expect(bl.bieuGhi).toHaveLength(60);
    // Mới nhất trước: bút toán thứ 64 (chỉ số lớn nhất) đứng đầu.
    expect(bl.bieuGhi[0]!.reason).toBe("but-toan-64");
  });

  it("[GDB-12] PHIẾU nhận xét một bài: chữ + bảng 9 tiêu chí lưu ở MỤC, đọc lại đúng; chỉ-chữ không đụng bảng; bảng không chữ vẫn là phiếu; rỗng cả hai bị từ chối; giá trị ngoài 1–5 về mức mặc định", async () => {
    const caseId = await tao([needId("B", 6), needId("B", 7)]);
    await diemDanh(caseId, "B", true, { 6: "COMPLETED", 7: "NOT_COMPLETED" });
    const m6 = await mucCua(caseId, "B", 6);
    const m7 = await mucCua(caseId, "B", 7);
    const doc = async () => (await docChiTietCaseV2(sdb(), { caseId, chiCuaSale: null }))!.be[0]!.muc;
    // Sau điểm danh chỉ có chữ do `diemDanh` fixture (đường cũ): chưa có bảng.
    expect((await doc()).find((m) => m.id === m6.id)!.rubric).toBeNull();
    // Lập phiếu: chữ + bảng.
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m6.id, danhGia: "  Hiểu bài tốt  ", rubric: { "ky-nang": 5 }, ten: "QL" });
    const sau = (await doc()).find((m) => m.id === m6.id)!;
    expect(sau.danhGia).toBe("Hiểu bài tốt");
    expect(sau.rubric).not.toBeNull();
    expect(Object.keys(sau.rubric!)).toHaveLength(9); // chuẩn hoá đủ 9 tiêu chí
    expect(Object.values(sau.rubric!).every((v) => v >= 1 && v <= 5)).toBe(true);
    expect(sau.duAn).toBeTruthy(); // tên dự án suy từ bài — in trên phiếu
    // Chỉ chữ (đường cũ, không truyền bảng): KHÔNG xoá bảng đã chấm.
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m6.id, danhGia: "Sửa lại câu chữ", ten: "QL" });
    const chiChu = (await doc()).find((m) => m.id === m6.id)!;
    expect(chiChu.danhGia).toBe("Sửa lại câu chữ");
    expect(chiChu.rubric).toEqual(sau.rubric);
    // Bảng không chữ vẫn là phiếu hợp lệ (đánh giá chung được trống).
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m7.id, danhGia: "   ", rubric: { x: 99 }, ten: "QL" });
    const bangThoi = (await doc()).find((m) => m.id === m7.id)!;
    expect(bangThoi.danhGia).toBeNull();
    expect(bangThoi.rubric).not.toBeNull();
    expect(Object.values(bangThoi.rubric!).every((v) => v === 3)).toBe(true); // 99 ngoài 1–5 ⇒ mức mặc định
    // Rỗng cả chữ lẫn bảng ⇒ từ chối, dữ liệu không đổi.
    await expect(ghiDanhGiaMuc(ADMIN, { caseStudentId: m7.id, danhGia: "  ", ten: "QL" })).rejects.toThrow(LoiHocBu);
    expect((await doc()).find((m) => m.id === m7.id)!.rubric).toEqual(bangThoi.rubric);
    // Nhật ký mang cả bảng cũ → mới.
    const nk = await db.auditLog.findMany({ where: { entityType: "MakeupCaseStudent", entityId: m6.id, action: "hoc-bu.danh-gia-muc" }, orderBy: { createdAt: "asc" } });
    expect(nk).toHaveLength(2);
    expect(JSON.stringify(nk[0]!.newValues)).toContain("rubric");
  });

  it("[GDB-13] PDF phiếu một bài: có phiếu ⇒ PDF thật (%PDF); chưa có phiếu ⇒ 404 và KHÔNG dựng PDF", async () => {
    const caseId = await tao([needId("B", 6)]);
    await diemDanh(caseId, "B", true, { 6: "COMPLETED" });
    const m6 = await mucCua(caseId, "B", 6);
    // Fixture `diemDanh` ghi sẵn chữ "Đánh giá B6" qua đường cũ ⇒ xoá để thử ca CHƯA có phiếu.
    await db.makeupCaseStudent.update({ where: { id: m6.id }, data: { teacherEvaluation: null, evaluationRubric: undefined } });
    const doc = async () => (await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: m6.id }, select: CHON_PHIEU_MUC }));
    const khong = await dungPdfPhieuMuc(await doc());
    expect(khong.status).toBe(404);
    await ghiDanhGiaMuc(ADMIN, { caseStudentId: m6.id, danhGia: "Con học tốt", rubric: { a: 4 }, ten: "QL" });
    const co = await dungPdfPhieuMuc(await doc());
    expect(co.status).toBe(200);
    expect(co.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await co.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(2000);
    // Tên tệp mang đủ ngữ cảnh, không dấu.
    expect(co.headers.get("content-disposition")).toMatch(/NhanXetHocBu_Be_T07_B_/);
  }, 60_000);

  it("[GDB-10] học viên chưa có sổ lượt ⇒ coSo=false (màn nói 'chưa mở sổ'), không bịa số", async () => {
    expect(await docBienLaiLuot({ studentId: "khong-co-hoc-vien", courseId: KHOA })).toEqual({ coSo: false });
  });
});
