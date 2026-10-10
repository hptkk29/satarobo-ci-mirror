// tests/hoc-bu/cong-day-bu.test.ts — T12: CÔNG DẠY BÙ trên Postgres THẬT.
//
// Luật thuần đã có ở `lib/cham-cong/buoi-bu-ky.test.ts` và `lib/hoc-bu/toan-ven.test.ts` ([TV-93*]). Ở đây chứng minh ĐƯỜNG ĐI THẬT:
// `loadBuoiDay` (công dạy) + `buildPeriodSummary`/`lockPeriod` (bản chốt kỳ) + checker, chạy trên case sinh bằng service học bù.
//   · COMPLETED và NO_SHOW (giáo viên có mặt dạy) có công; CANCELLED / SCHEDULED không;
//   · MỘT case = MỘT buổi công, thời lượng = giờ kết − giờ bắt đầu, bất kể 1 hay 3 bài, 1 hay 3 bé;
//   · `HB_CHINH` đi theo danh mục (`countsInPeriod` do danh mục quyết, không do mã học bù);
//   · bản chốt kỳ chứa buổi bù (kể cả của giáo viên không có dòng công); `teachingSessions` không đổi nghĩa;
//   · kỳ đã chốt KHÔNG bị sửa khi case hoàn thành sau chốt — checker TV-93 báo, người quyết.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { diemDanhBe, huyCase } from "@/lib/hoc-bu/case-db";
import { loadBuoiDay } from "@/lib/cham-cong/cong-day-db";
import { congDayCuaNguoi, type LoaiCongDay } from "@/lib/cham-cong/cong-day";
import { TEACHING_CREDIT_CATALOG } from "@/lib/cham-cong/catalog";
import { buildPeriodSummary, getOrCreatePeriod, lockPeriod, type PeriodSummary } from "@/lib/cham-cong/period";
import { vnDateAt } from "@/lib/time/vn";
import { ADMIN, CS, GV, GV2, beCua, diemDanh, don, dung, kiem, ketQua, luc, needId, tao, tatCa } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[CDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const TU = new Date(Date.UTC(2026, 9, 1));
const DEN = new Date(Date.UTC(2026, 9, 31));
const KY = "2026-10";
const SAU_KY = vnDateAt(2026, 10, 2, 9, 0); // 02/11/2026 — kỳ 10/2026 đã kết thúc

/** Danh mục lấy từ CATALOG gốc — `HB_CHINH` đúng như BLĐ khai (countsInPeriod: false). */
function danhMuc(batTinhVaoKy = false): LoaiCongDay[] {
  return TEACHING_CREDIT_CATALOG.map((l) => ({
    code: l.code,
    name: l.name,
    source: l.source,
    role: l.role,
    basis: l.basis,
    factor: l.factor,
    countsInPeriod: l.code === "HB_CHINH" ? batTinhVaoKy || l.countsInPeriod : l.countsInPeriod,
    isActive: true,
    categoryCode: null,
  }));
}

const buoiBu = async (gv: string) => (await loadBuoiDay([gv], TU, DEN)).filter((b) => b.source === "MAKEUP");
const lock = (now = SAU_KY) => lockPeriod({ centerId: CS, periodKey: KY, actorId: GV, reason: "T12 test", boQuaBuoiChuaChot: true, now });
const tv93 = async () => (await kiem()).filter((f) => f.luat === "TV-93");

describe.skipIf(!RUN_DB_TESTS)("[CDB] công dạy bù — T12", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[CDB-01] case SCHEDULED chưa có công; điểm danh có mặt ⇒ COMPLETED ⇒ ĐÚNG MỘT buổi MAKEUP (MAIN, 90 phút) của giáo viên", async () => {
    const c = await tao([needId("C", 7)]);
    expect(await buoiBu(GV)).toEqual([]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    const b = await buoiBu(GV);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ id: c, source: "MAKEUP", userId: GV, role: "MAIN", ymd: "2026-10-15", minutes: 90 });
    // Giáo viên khác không có công.
    expect(await buoiBu(GV2)).toEqual([]);
  });

  it("[CDB-02] 3 bài × 3 bé trong MỘT case ⇒ vẫn MỘT buổi công, 90 phút — bằng case 1 bài 1 bé", async () => {
    const lon = await tao([...tatCa("A"), ...tatCa("B"), needId("C", 7)]);
    await diemDanh(lon, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "COMPLETED" });
    await diemDanh(lon, "B", true, { 6: "COMPLETED", 7: "NOT_COMPLETED" });
    await diemDanh(lon, "C", false);
    const nho = await tao([needId("D", 8)], { ymd: "2026-10-16" });
    await diemDanh(nho, "D", true, { 8: "COMPLETED" }, luc(16, 18, 30));
    const b = await buoiBu(GV);
    expect(b.map((x) => [x.id, x.minutes]).sort()).toEqual([[lon, 90], [nho, 90]].sort());
    const cong = congDayCuaNguoi(b, danhMuc(true));
    // Hai case = hai buổi; số bài (3 vs 1) và số bé (3 vs 1) không làm đổi số buổi hay số phút.
    expect(cong.tongBuoi).toBe(2);
    expect(cong.dong.find((d) => d.code === "HB_CHINH")).toMatchObject({ buoi: 2, cong: 2 });
  });

  it("[CDB-03] mọi bé vắng ⇒ case NO_SHOW ⇒ giáo viên VẪN có công (đã có mặt dạy); case COMPLETED nay chuyển NO_SHOW cũng giữ công", async () => {
    const c = await tao([needId("C", 7), needId("B", 7)]);
    await diemDanh(c, "C", false);
    expect(await buoiBu(GV)).toEqual([]); // còn bé chờ điểm danh ⇒ case vẫn SCHEDULED
    await diemDanh(c, "B", false);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("NO_SHOW");
    expect((await buoiBu(GV)).map((x) => x.id)).toEqual([c]);
  });

  it("[CDB-04] case CANCELLED (huỷ trước giờ / hết bé) KHÔNG có công", async () => {
    const c1 = await tao([needId("C", 7)]);
    await huyCase(ADMIN, c1);
    const c2 = await tao([needId("B", 6)], { ymd: "2026-10-16" });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c1 } })).status).toBe("CANCELLED");
    expect(await buoiBu(GV)).toEqual([]);
    expect(c2).toBeTruthy();
  });

  it("[CDB-05] thời lượng = giờ kết − giờ bắt đầu của CASE (không lấy giờ lớp, không nhân số bài)", async () => {
    const c = await tao([...tatCa("A")]);
    await db.makeupCase.update({ where: { id: c }, data: { startTime: "17:00", endTime: "19:00" } });
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "COMPLETED" }, luc(15, 17, 30));
    const b = await buoiBu(GV);
    expect(b).toHaveLength(1);
    expect(b[0]!.minutes).toBe(120);
  });

  it("[CDB-06] HB_CHINH đi theo DANH MỤC: mặc định countsInPeriod=false ⇒ liệt kê mà không vào tổng; bật lên thì vào tổng", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    const b = await buoiBu(GV);
    const mac = congDayCuaNguoi(b, danhMuc(false));
    expect(mac.tongBuoi).toBe(1);
    expect(mac.tongCong).toBe(0);
    expect(mac.dong.find((d) => d.code === "HB_CHINH")).toMatchObject({ buoi: 1, tinhVaoKy: false });
    const bat = congDayCuaNguoi(b, danhMuc(true));
    expect(bat.tongCong).toBe(1);
  });

  it("[CDB-07] BẢN CHỐT chứa buổi bù: giáo viên có dòng công có makeupSessions/makeupMinutes; giáo viên CHỈ dạy bù (không ca, không lượt quét) vẫn nằm trong buoiBu; teachingSessions không đổi nghĩa", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", true, { 7: "COMPLETED" });
    const c2 = await tao([needId("B", 6)], { ymd: "2026-10-16", teacherId: GV2 });
    await db.shiftAssignment.deleteMany({ where: { userId: GV2 } }); // GV2: không còn dòng nào ⇒ không có hàng công
    await diemDanhBe(null, {
      participantId: (await beCua(c2, "B")).id,
      coMat: true,
      ketQuaMuc: await ketQua(c2, "B", { 6: "COMPLETED" }),
      nhanXetChung: null,
      chiGiaoVien: GV2,
      now: luc(16, 18, 30),
    });
    const s = await buildPeriodSummary(CS, KY);
    expect(s.buoiBu?.map((x) => [x.caseId, x.teacherId, x.phut, x.status]).sort()).toEqual(
      [[c1, GV, 90, "COMPLETED"], [c2, GV2, 90, "COMPLETED"]].sort(),
    );
    expect(s.totals.makeupSessions).toBe(2);
    const hang = s.rows.find((r) => r.userId === GV)!;
    expect(hang).toMatchObject({ makeupSessions: 1, makeupMinutes: 90 });
    expect(hang.teachingSessions).toBe(0); // buổi bù KHÔNG lẫn vào số buổi lớp
    expect(s.rows.some((r) => r.userId === GV2)).toBe(false);
  });

  it("[CDB-08] kỳ ĐÃ CHỐT: bản chốt ghi buổi bù; case hoàn thành SAU chốt KHÔNG sửa bản chốt / ngày công đã khoá — TV-93 báo, người quyết", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", true, { 7: "COMPLETED" });
    const r = await lock();
    expect(r.ok).toBe(true);
    const ky = await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId: CS, periodKey: KY } } });
    expect(ky.status).toBe("LOCKED");
    const luu = ky.summaryJson as unknown as PeriodSummary;
    expect(luu.buoiBu?.map((x) => x.caseId)).toEqual([c1]);
    expect(await tv93()).toEqual([]); // bản chốt khớp case đã dạy

    // Case thứ hai hoàn thành SAU khi chốt.
    const c2 = await tao([needId("B", 6)], { ymd: "2026-10-16" });
    await diemDanh(c2, "B", true, { 6: "COMPLETED" }, luc(16, 18, 30));
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c2 } })).status).toBe("COMPLETED");
    const sau = await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId: CS, periodKey: KY } } });
    expect(sau.status).toBe("LOCKED");
    expect(sau.summaryJson).toEqual(ky.summaryJson); // KHÔNG sửa trực tiếp
    const f = await tv93();
    expect(f.map((x) => [x.id, x.nghiemTrong, x.lienQuan?.loai])).toEqual([[c2, "HIGH", "NGOAI_BAN_CHOT"]]);
  });

  it("[CDB-09] bản chốt CŨ (không có trường buoiBu) ⇒ TV-93 MEDIUM 'không đối chiếu được', không nói là sót công", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", true, { 7: "COMPLETED" });
    expect((await lock()).ok).toBe(true);
    await db.$executeRaw`UPDATE "AttendancePeriod" SET "summaryJson" = "summaryJson"::jsonb - 'buoiBu' WHERE "centerId" = ${CS}`;
    const f = await tv93();
    expect(f.map((x) => [x.id, x.nghiemTrong, x.lienQuan?.loai])).toEqual([[c1, "MEDIUM", "BAN_CHOT_TRUOC_T12"]]);
  });

  it("[CDB-10] case đã nằm trong bản chốt rồi bị sửa điểm danh về vắng hết (COMPLETED→NO_SHOW) ⇒ vẫn có công, nhưng bản chốt lệch trạng thái ⇒ TV-93 DOI_SAU_CHOT", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", true, { 7: "COMPLETED" });
    expect((await lock()).ok).toBe(true);
    await db.makeupCase.update({ where: { id: c1 }, data: { status: "NO_SHOW" } });
    const f = await tv93();
    expect(f.map((x) => [x.id, x.lienQuan?.loai])).toEqual([[c1, "DOI_SAU_CHOT"]]);
  });

  it("[CDB-11] kỳ CHƯA chốt (có hàng kỳ trạng thái OPEN): TV-93 im — chưa có bản chốt để lệch — dù có case đã dạy", async () => {
    const c1 = await tao([needId("C", 7)]);
    await diemDanh(c1, "C", true, { 7: "COMPLETED" });
    await getOrCreatePeriod(CS, KY);
    expect((await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId: CS, periodKey: KY } } })).status).toBe("OPEN");
    expect(await tv93()).toEqual([]);
  });

  it("[CDB-12] case rơi NGOÀI tháng (30/09, 02/11) không lọt vào bản chốt tháng 10 — cửa sổ kỳ là đúng tháng của kỳ", async () => {
    const a = await tao([needId("C", 7)]);
    await diemDanh(a, "C", true, { 7: "COMPLETED" });
    const b = await tao([needId("B", 6)], { ymd: "2026-10-16" });
    await diemDanh(b, "B", true, { 6: "COMPLETED" }, luc(16, 18, 30));
    await db.makeupCase.update({ where: { id: a }, data: { date: new Date(Date.UTC(2026, 8, 30)) } });
    await db.makeupCase.update({ where: { id: b }, data: { date: new Date(Date.UTC(2026, 10, 2)) } });
    const s = await buildPeriodSummary(CS, KY);
    expect(s.buoiBu).toEqual([]);
    expect(s.totals.makeupSessions).toBe(0);
  });
});
