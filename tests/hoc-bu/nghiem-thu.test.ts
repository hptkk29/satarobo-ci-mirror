// tests/hoc-bu/nghiem-thu.test.ts — NGHIỆM THU ĐẦU-CUỐI của chương trình học bù (GATE FINAL, 08/10/2026), trên Postgres THẬT.
//
// MỘT câu chuyện, đi hết đường — không chia theo tầng. Mỗi tầng đã có test riêng (CNBD · KQBD · PHY · CDB · NKD · TV); thứ chỉ test này chứng minh là
// các tầng NỐI VỚI NHAU: cùng một dữ liệu đi từ buổi vắng → case 3 bài → điểm danh hai tầng → sổ lượt → buổi gốc → cổng phụ huynh → công dạy → nhật ký,
// và checker toàn vẹn T01 (oracle độc lập) sạch ở MỌI chặng.
//
//   A vắng bài 5, 6, 7 (còn 3 lượt)
//     ① một case dạy cả 5+6+7  ⇒ giữ 3 lượt (một HOLD mỗi bài)
//     ② A có mặt: 5 xong, 6 xong, 7 CHƯA xong, mỗi bài một lời đánh giá
//     ③ 5,6 hoàn tất; 7 quay lại chờ bù; sổ lượt: 2 CONSUME + 1 RELEASE
//     ④ buổi gốc VẪN "vắng" nhưng 5,6 hiện "đã bù" kèm đánh giá; 7 còn nợ
//     ⑤ phụ huynh thấy đúng kết quả của con mình
//     ⑥ công dạy: ĐÚNG MỘT buổi cho cả case 3 bài
//     ⑦ nhật ký có đủ chuỗi
//   Rồi bài 7 xếp sang case khác và hoàn tất ⇒ buổi gốc 7 cũng "đã bù"; tổng công 2 buổi.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docKetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi-db";
import { khoaCapBuoi } from "@/lib/hoc-bu/ket-qua-buoi";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { loadBuoiDay } from "@/lib/cham-cong/cong-day-db";
import { docChiTietCaseV2 } from "@/lib/hoc-bu/case-chi-tiet";
import { scopedDb } from "@/lib/db-scope";
import { ADMIN, GV, HV, KHOA, buoiGoc, diemDanh, don, dongAtt, dung, luc, mucCua, need, needId, sach, so, tao, tatCa } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[NT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const TU = new Date(Date.UTC(2026, 9, 1));
const DEN = new Date(Date.UTC(2026, 9, 31));
const buoiCong = async () => (await loadBuoiDay([GV], TU, DEN)).filter((b) => b.source === "MAKEUP");
const cap = (b: 5 | 6 | 7) => ({ sessionId: buoiGoc(b), studentId: HV.A });
const key = (b: 5 | 6 | 7) => khoaCapBuoi(buoiGoc(b), HV.A);
const soBut = async () => {
  const tk = await db.makeupCreditAccount.findUniqueOrThrow({ where: { studentId_courseId: { studentId: HV.A, courseId: KHOA } } });
  const but = await db.makeupCreditEntry.findMany({ where: { accountId: tk.id } });
  const dem = (t: string) => but.filter((e) => e.type === t).length;
  return { HOLD: dem("HOLD"), CONSUME: dem("CONSUME"), RELEASE: dem("RELEASE") };
};

describe.skipIf(!RUN_DB_TESTS)("[NT] nghiệm thu đầu-cuối học bù", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[NT-01] A vắng 5,6,7 → MỘT case 3 bài → 5,6 xong + 7 chưa xong → buổi gốc, phụ huynh, công dạy, nhật ký, sổ lượt nhất quán; rồi bài 7 bù ở case khác", async () => {
    const attTruoc = await Promise.all(([5, 6, 7] as const).map((b) => dongAtt("A", b)));
    expect(attTruoc.map((a) => a.status)).toEqual(["ABSENT_EXCUSED", "ABSENT_EXCUSED", "ABSENT_EXCUSED"]);

    // ① MỘT case dạy cả ba bài; ba lượt bị GIỮ (một HOLD mỗi bài).
    const c1 = await tao(tatCa("A"));
    const ct = (await docChiTietCaseV2(scopedDb(ADMIN), { caseId: c1, chiCuaSale: null }))!;
    expect(ct.boBai).toHaveLength(3);
    expect(ct.be).toHaveLength(1);
    expect(ct.be[0]!.muc).toHaveLength(3);
    expect(await so("A")).toMatchObject({ granted: 3, held: 3, consumed: 0, con: 0 });
    expect(await soBut()).toMatchObject({ HOLD: 3, CONSUME: 0, RELEASE: 0 });
    for (const b of [5, 6, 7] as const) expect((await need("A", b)).status).toBe("SCHEDULED");
    await sach();

    // ② A có mặt: 5 xong · 6 xong · 7 chưa xong, mỗi bài một đánh giá.
    await diemDanh(c1, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });

    // ③ Hai bài hoàn tất, bài 7 quay lại chờ bù; sổ lượt: 2 CONSUME + 1 RELEASE.
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c1 } })).status).toBe("COMPLETED");
    expect((await mucCua(c1, "A", 5)).result).toBe("COMPLETED");
    expect((await mucCua(c1, "A", 6)).result).toBe("COMPLETED");
    expect((await mucCua(c1, "A", 7)).result).toBe("NOT_COMPLETED");
    expect((await need("A", 5)).status).toBe("COMPLETED");
    expect((await need("A", 6)).status).toBe("COMPLETED");
    expect((await need("A", 7)).status).toBe("PENDING");
    expect(await soBut()).toMatchObject({ HOLD: 3, CONSUME: 2, RELEASE: 1 });
    expect(await so("A")).toMatchObject({ granted: 3, held: 0, consumed: 2, con: 1 });
    await sach();

    // ④ Buổi gốc: điểm danh gốc KHÔNG đổi ("vắng có phép"), nhưng 5,6 hiện "đã bù" kèm đánh giá; 7 còn nợ.
    const attSau = await Promise.all(([5, 6, 7] as const).map((b) => dongAtt("A", b)));
    expect(attSau.map((a) => a.status)).toEqual(["ABSENT_EXCUSED", "ABSENT_EXCUSED", "ABSENT_EXCUSED"]);
    const kq = await docKetQuaBuoi(db, [cap(5), cap(6), cap(7)]);
    expect(kq.get(key(5))).toMatchObject({ trangThai: "DA_BU", nhan: "Đã học bù ngày 15/10/2026" });
    expect(kq.get(key(5))!.hienTai!.danhGia).toBe("Đánh giá A5");
    expect(kq.get(key(6))).toMatchObject({ trangThai: "DA_BU" });
    expect(kq.get(key(6))!.hienTai!.danhGia).toBe("Đánh giá A6");
    expect(kq.get(key(7))).toMatchObject({ trangThai: "CHO_XEP", hienTai: null });
    expect(kq.get(key(7))!.lichSu.map((l) => l.loai)).toEqual(["CHUA_XONG"]);
    expect(kq.get(key(7))!.lichSu[0]!.danhGia).toBe("Đánh giá A7");

    // ⑤ Phụ huynh thấy đúng kết quả của CON MÌNH.
    const ph = await getStudentMakeup(HV.A);
    const tat = [...ph.needList, ...ph.history];
    expect(tat.find((m) => m.id === needId("A", 5))!.ketQua.trangThai).toBe("DA_BU");
    expect(tat.find((m) => m.id === needId("A", 6))!.ketQua.hienTai!.danhGia).toBe("Đánh giá A6");
    expect(ph.needList.find((m) => m.id === needId("A", 7))!.ketQua.trangThai).toBe("CHO_XEP");
    expect(ph.doneCount).toBe(2);

    // ⑥ Công dạy: cả case 3 bài là ĐÚNG MỘT buổi (90 phút).
    const cong1 = await buoiCong();
    expect(cong1.map((b) => [b.id, b.minutes])).toEqual([[c1, 90]]);

    // ⑦ Nhật ký có đủ chuỗi: tạo → điểm danh → hoàn thành (kèm đánh giá từng bài).
    const hd = (await db.auditLog.findMany({ where: { module: "hoc-bu", entityId: c1 } })).map((r) => r.action);
    expect(hd).toContain("hoc-bu.tao-case");
    expect(hd).toContain("hoc-bu.doi-trang-thai-case");
    const hdBe = (await db.auditLog.findMany({ where: { module: "hoc-bu", entityType: "MakeupCaseParticipant" } })).map((r) => r.action);
    expect(hdBe).toContain("hoc-bu.diem-danh-be");

    // Bài 7 xếp sang case KHÁC (ngày khác), bù xong ⇒ buổi gốc 7 cũng "đã bù"; sổ lượt dùng nốt; công = 2 buổi.
    const c2 = await tao([needId("A", 7)], { ymd: "2026-10-16" });
    expect(await so("A")).toMatchObject({ held: 1, consumed: 2, con: 0 });
    await sach(luc(16, 17, 0));
    await diemDanh(c2, "A", true, { 7: "COMPLETED" }, luc(16, 18, 30));
    const kq2 = await docKetQuaBuoi(db, [cap(7)]);
    expect(kq2.get(key(7))).toMatchObject({ trangThai: "DA_BU", nhan: "Đã học bù ngày 16/10/2026" });
    expect(kq2.get(key(7))!.hienTai!.danhGia).toBe("Đánh giá A7");
    expect((await need("A", 7)).status).toBe("COMPLETED");
    expect(await so("A")).toMatchObject({ granted: 3, held: 0, consumed: 3, con: 0 });
    expect((await dongAtt("A", 7)).status).toBe("ABSENT_EXCUSED");
    expect((await buoiCong()).map((b) => b.id).sort()).toEqual([c1, c2].sort());
    await sach(luc(16, 18, 45));
  }, 90_000); // một câu chuyện dài, ba lần chạy checker — trần mặc định 5 giây không đủ
});
