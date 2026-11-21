// tests/hoc-bu/tach-bu-vuot.test.ts — [TBV-*] TÁCH HỌC BÙ / HỌC VƯỢT ở mức case (17/11/2026), Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Dùng chung fixture T07 (bé A vắng bài 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8). "Học vượt" = dòng cần bù có `sourceType = ORDER_CONVERSION`; các ca lật nguồn của vài dòng
// rồi chạy ĐẦU-CUỐI `taoCaseVaXep` / `xepVaoCaseCoSan` / `docDanhSachCase`. Mỗi ca tự dựng lại (`dung`) ⇒ xanh khi chạy một mình (luật 18).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { LoiHocBu, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { docDanhSachCase } from "@/lib/hoc-bu/case-doc";
import { docDanhSachCanBu } from "@/lib/hoc-bu/danh-sach-db";
import { ADMIN, BAI, CS, don, dung, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[TBV] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const lat = (...ids: string[]) => db.makeupNeed.updateMany({ where: { id: { in: ids } }, data: { sourceType: "ORDER_CONVERSION" } });
const caseCua = (caseId: string) => db.makeupCase.findUniqueOrThrow({ where: { id: caseId }, select: { sessionCategoryId: true } });
const catId = async (code: "BU" | "VUOT") => (await db.sessionCategory.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;

// Danh mục phân loại buổi thường do seed chấm công tạo; DB test có thể chưa có ⇒ tạo nếu thiếu, và CHỈ dọn những dòng do bộ này tạo.
const daTao: string[] = [];
async function bayDanhMuc() {
  for (const [code, name] of [["BU", "Học bù"], ["VUOT", "Học vượt"]] as const) {
    const co = await db.sessionCategory.findUnique({ where: { code }, select: { id: true } });
    if (!co) daTao.push((await db.sessionCategory.create({ data: { code, name, isActive: true, countsTowardQuota: true } })).id);
    else await db.sessionCategory.update({ where: { code }, data: { isActive: true } });
  }
}

describe.skipIf(!RUN_DB_TESTS)("[TBV] tách học bù / học vượt — Postgres thật", () => {
  beforeAll(bayDanhMuc);
  beforeEach(async () => {
    await dung();
    await bayDanhMuc();
  });
  afterAll(async () => {
    await don();
    if (daTao.length) await db.sessionCategory.deleteMany({ where: { id: { in: daTao } } });
  });

  it("[TBV-00] FIXTURE: mọi dòng của fixture là học BÙ (ABSENCE) — nếu không, các ca dưới xanh vì không có gì để tách", async () => {
    const { dong } = await docDanhSachCanBu(scopedDb(ADMIN), { trang: 1, soDong: 50, chiCuaSale: null });
    expect(dong).toHaveLength(7); // A: 5,6,7 · B: 6,7 · C: 7 · D: 8
    expect(dong.every((d) => d.loai === "BU")).toBe(true);
  });

  it("[TBV-01] case TOÀN bù ⇒ phân loại buổi BU; case TOÀN vượt ⇒ VUOT", async () => {
    const bu = await tao([needId("C", 7)]);
    expect((await caseCua(bu)).sessionCategoryId).toBe(await catId("BU"));
    await lat(needId("A", 6), needId("B", 6));
    const vuot = await tao([needId("A", 6), needId("B", 6)], { ymd: "2026-10-16" });
    expect((await caseCua(vuot)).sessionCategoryId).toBe(await catId("VUOT"));
  });

  it("[TBV-02] TRỘN vượt + bù trong MỘT lần xếp ⇒ từ chối, nói rõ bé nào là loại nào; không case nào được tạo, các dòng vẫn chờ bù", async () => {
    await lat(needId("B", 7));
    const loi = await bat(tao([needId("A", 7), needId("B", 7)]));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toMatch(/Không xếp chung học vượt và học bù/);
    expect((loi as Error).message).toContain("Bé T07 B");
    expect(await db.makeupCase.count({ where: { centerId: CS } })).toBe(0);
    expect(await db.makeupNeed.count({ where: { id: { in: [needId("A", 7), needId("B", 7)] }, status: "PENDING" } })).toBe(2);
  });

  it("[TBV-03] GOM tự động không kéo dòng KHÁC LOẠI của cùng bé vào case: A vượt bài 6, A vẫn còn dòng bù bài 7 ⇒ tạo case bộ bài 6+7 chỉ mang dòng vượt, dòng bù bài 7 ở LẠI danh sách cần bù", async () => {
    await lat(needId("A", 6));
    const caseId = await tao([needId("A", 6)], { lessonIds: [BAI[6], BAI[7]] });
    expect((await caseCua(caseId)).sessionCategoryId).toBe(await catId("VUOT"));
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 7) } })).status).toBe("PENDING"); // không bị gom
  });

  it("[TBV-03b] đối chứng dương của TBV-03: dòng bài 7 của A CŨNG là vượt ⇒ được gom theo vào case như trước (gom không bị tắt, chỉ lọc theo loại)", async () => {
    await lat(needId("A", 6), needId("A", 7));
    const caseId = await tao([needId("A", 6)], { lessonIds: [BAI[6], BAI[7]] });
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 7) } })).status).toBe("SCHEDULED");
    expect(await db.makeupCaseStudent.count({ where: { caseId } })).toBe(2);
  });

  it("[TBV-04] XẾP THÊM vào case có sẵn: bé khác loại bị từ chối, bé cùng loại vào được", async () => {
    await lat(needId("A", 6), needId("B", 6));
    const caseVuot = await tao([needId("A", 6)], { lessonIds: [BAI[6], BAI[7]] });
    // C vắng bài 7 là bù ⇒ KHÔNG vào case vượt
    const loi = await bat(xepVaoCaseCoSan(ADMIN, { caseId: caseVuot, needIds: [needId("C", 7)], coQuyenDuyet: true }));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toMatch(/HỌC VƯỢT/);
    expect(await db.makeupCaseStudent.count({ where: { caseId: caseVuot, makeupNeedId: needId("C", 7) } })).toBe(0);
    // B vượt bài 6 ⇒ vào được
    expect((await xepVaoCaseCoSan(ADMIN, { caseId: caseVuot, needIds: [needId("B", 6)], coQuyenDuyet: true })).choDuyet).toBe(false);
    expect(await db.makeupCaseStudent.count({ where: { caseId: caseVuot, makeupNeedId: needId("B", 6) } })).toBe(1);
    // chiều ngược: case BÙ không nhận bé vượt
    await lat(needId("C", 7));
    const caseBu = await tao([needId("D", 8)], { ymd: "2026-10-16", lessonIds: [BAI[8], BAI[7]] });
    const loi2 = await bat(xepVaoCaseCoSan(ADMIN, { caseId: caseBu, needIds: [needId("C", 7)], coQuyenDuyet: true }));
    expect(loi2).toBeInstanceOf(LoiHocBu);
    expect((loi2 as Error).message).toMatch(/HỌC BÙ/);
  });

  it("[TBV-05] danh mục VUOT bị TẮT ⇒ case vượt rơi về BU (không để trống: trống = học chính thức, đổi cách tính công dạy)", async () => {
    await db.sessionCategory.update({ where: { code: "VUOT" }, data: { isActive: false } });
    await lat(needId("A", 6));
    const caseId = await tao([needId("A", 6)]);
    expect((await caseCua(caseId)).sessionCategoryId).toBe(await catId("BU"));
  });

  it("[TBV-06] DANH SÁCH: dòng cần bù + case mang `loai`; bộ lọc Loại chia đúng hai phía (không dòng nào lọt cả hai, không dòng nào mất)", async () => {
    await lat(needId("A", 6), needId("B", 6));
    await tao([needId("A", 6), needId("B", 6)], { ymd: "2026-10-16" });
    await tao([needId("C", 7)]);
    const sdb = scopedDb(ADMIN);
    const tatCa = await docDanhSachCase(sdb, { trang: 1, soDong: 20, chiCuaSale: null, trangThai: "SCHEDULED" });
    expect(tatCa.dong.map((c) => c.loai).sort()).toEqual(["BU", "VUOT"]);
    const vuot = await docDanhSachCase(sdb, { trang: 1, soDong: 20, chiCuaSale: null, trangThai: "SCHEDULED", loai: "VUOT" });
    const bu = await docDanhSachCase(sdb, { trang: 1, soDong: 20, chiCuaSale: null, trangThai: "SCHEDULED", loai: "BU" });
    expect(vuot.dong.map((c) => c.loai)).toEqual(["VUOT"]);
    expect(bu.dong.map((c) => c.loai)).toEqual(["BU"]);

    // Dòng cần bù: A6/B6 đã vào case nên không còn chờ; lật thêm D8 làm vượt để có cả hai phía ở bảng Cần bù.
    await lat(needId("D", 8));
    const cb = await docDanhSachCanBu(sdb, { trang: 1, soDong: 50, chiCuaSale: null });
    const vCb = await docDanhSachCanBu(sdb, { trang: 1, soDong: 50, chiCuaSale: null, loai: "VUOT" });
    const bCb = await docDanhSachCanBu(sdb, { trang: 1, soDong: 50, chiCuaSale: null, loai: "BU" });
    expect(vCb.dong.every((d) => d.loai === "VUOT") && vCb.dong.length > 0).toBe(true);
    expect(bCb.dong.every((d) => d.loai === "BU") && bCb.dong.length > 0).toBe(true);
    expect(vCb.tong + bCb.tong).toBe(cb.tong);
  });
});
