// lib/hoc-bu/nhac-db.ts — QUÉT THEO GIỜ của thông báo học bù (T13, 08/10/2026): nhắc lịch, quá giờ chưa điểm danh, giáo viên không còn ca.
// Luật (cửa sổ, khoá, nội dung) ở `thong-bao-thuan.ts`; file này chỉ chọn case cần xét rồi PHÁT SỰ KIỆN — handler lo phần gửi.
//
// Nhận `now` từ ngoài (luật 19: không đọc đồng hồ thật trong phần có điều kiện thời gian). Idempotent: cron chạy lại / chạy trùng không nhân đôi tin
// vì khoá sự kiện gắn với case + ngày (nhắc), case (quá hạn), case + giáo viên + ngày (giáo viên không còn ca).
import "server-only";
import { db } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { publishEvent } from "@/lib/events/publish";
import { layCaCuaNhieuNguoi } from "@/lib/trial/gv-kha-dung-db";
import { caPhuTronKhungGio } from "@/lib/trial/gv-kha-dung";
import { vnYmd } from "@/lib/time/vn";
import { daQuaHan, gioCase, gvKhongConCaBu, khoaSuKien, SU_KIEN, trongCuaSoNhac } from "@/lib/hoc-bu/thong-bao-thuan";

/** Trần số case xét mỗi lượt. Chạm trần thì báo ra (`chamTran`) chứ không cắt im lặng. */
const TRAN_CASE = 500;

export type KetQuaNhac = { xet: number; nhac: number; quaHan: number; gvKhongConCa: number; chamTran: boolean };

export async function chayNhacHocBu(p: { now: Date }): Promise<KetQuaNhac> {
  const homQua = new Date(p.now.getTime() - 86_400_000);
  const baNgaySau = new Date(p.now.getTime() + 3 * 86_400_000);
  // `date` là cột @db.Date (nửa đêm UTC của ngày VN) — so theo ngày VN.
  const tu = new Date(`${vnYmd(homQua)}T00:00:00.000Z`);
  const den = new Date(`${vnYmd(baNgaySau)}T00:00:00.000Z`);

  const cases = await db.makeupCase.findMany({
    where: { status: "SCHEDULED", date: { gte: tu, lte: den }, participants: { some: { attendanceStatus: "PENDING" } } },
    select: { id: true, centerId: true, date: true, startTime: true, endTime: true, teacherId: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: TRAN_CASE + 1,
  });
  const chamTran = cases.length > TRAN_CASE;
  const xet = cases.slice(0, TRAN_CASE);

  const kq: KetQuaNhac = { xet: xet.length, nhac: 0, quaHan: 0, gvKhongConCa: 0, chamTran };
  const sapToi: typeof xet = [];

  for (const c of xet) {
    const ymd = c.date.toISOString().slice(0, 10);
    const { batDau, ketThuc } = gioCase({ ymd, startTime: c.startTime, endTime: c.endTime });
    if (trongCuaSoNhac(p.now, batDau)) {
      await publishEvent(SU_KIEN.CASE_NHAC, { caseId: c.id, ymd }, { dedupeKey: khoaSuKien.caseNhac(c.id, ymd) });
      kq.nhac++;
    }
    if (daQuaHan(p.now, ketThuc)) {
      await publishEvent(SU_KIEN.QUA_HAN, { caseId: c.id }, { dedupeKey: khoaSuKien.quaHan(c.id) });
      kq.quaHan++;
    }
    if (batDau.getTime() > p.now.getTime()) sapToi.push(c);
  }

  // Giáo viên còn ca? Một câu đọc lưới cho MỖI NGÀY (mọi giáo viên của ngày đó), không một câu cho mỗi case.
  const theoNgay = new Map<string, typeof sapToi>();
  for (const c of sapToi) {
    const ymd = c.date.toISOString().slice(0, 10);
    theoNgay.set(ymd, [...(theoNgay.get(ymd) ?? []), c]);
  }
  for (const [ymd, ds] of [...theoNgay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lich = await layCaCuaNhieuNguoi(SYSTEM_ACTOR, [...new Set(ds.map((c) => c.teacherId))], new Date(`${ymd}T00:00:00.000Z`));
    for (const c of ds) {
      const ca = lich.theoNguoi[c.teacherId] ?? null;
      const phu = caPhuTronKhungGio({ ca, khung: { startTime: c.startTime, endTime: c.endTime }, luoiDaSinh: lich.luoiDaSinh, coTrongLuoi: lich.coTrongLuoi.has(c.teacherId) });
      if (!gvKhongConCaBu({ ketQuaPhu: phu, caCenterId: ca?.centerId, centerId: c.centerId })) continue;
      await publishEvent(
        SU_KIEN.GV_KHONG_CON_CA,
        { caseId: c.id, teacherId: c.teacherId, ymd },
        { dedupeKey: khoaSuKien.gvKhongConCa(c.id, c.teacherId, ymd) },
      );
      kq.gvKhongConCa++;
    }
  }
  return kq;
}
