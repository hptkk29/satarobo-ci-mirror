import "server-only";
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { laKyUsbBat } from "../feature";
import { docPhapNhanKyUsb } from "../ket-noi/ket-noi-db";
import { kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import { timKeToan } from "../nhac-ke-toan-db";
import { dungThongBaoChoKy, type NhomChoKy } from "./nhac-ky-usb";
import { taoLenhKyUsbHeThong } from "./ky-usb-lenh";

// lib/finance/hoa-don/ky-usb/quet-tao-lenh.ts — PHA P5 của cron `hoa-don-misa-doi-soat` (BGĐ 04/11/2026): với pháp nhân KÝ USB,
//   (1) TẠO lệnh chờ ký (người yêu cầu = hệ thống) cho hoá đơn do Invoice Engine đã lập mà chưa có lệnh;
//   (2) báo kế toán (Web Push + chuông, tin GỘP) khi có lệnh chờ, và nhắc lại theo chu kỳ.
//
// Công tắc: `hoaDon.kyUsb` (TẮT mặc định) hỏi ngay đầu — tắt ⇒ trả `null`, KHÔNG chạm bảng nào, phản hồi cron giữ nguyên từng chữ.
// KHÔNG tự bật gì, KHÔNG ký, KHÔNG chạm nhà cung cấp: chỉ ghi `HoaDonLenhKy` (+ AuditLog) và tạo thông báo.
//
// «Bình thường» vs «bất thường»: lệnh hệ thống chỉ cho hoá đơn do runner/nút lập (có bản DANG_PHAT_HANH + phiếu) và KHÔNG có ngoại lệ hoá đơn đang mở. Hoá đơn có ngoại lệ mở,
// hoặc lệnh trước đó đã LOI_KY / HUY (cần người quyết), hoặc đã hết hạn ≥ `TOI_DA_LENH_HET_HAN` lần ⇒ để kế toán tạo lệnh TAY (người yêu cầu = chính họ ⇒ chịu luật tách nhiệm vụ).

export const TRAN_QUET_LENH = 50;
export const TOI_DA_LENH_HET_HAN = 3;

export type KetQuaQuetLenh = {
  quet: number;
  taoMoi: number;
  daCo: number;
  boQuaNgoaiLe: number;
  boQuaCanNguoi: number;
  boQuaTamDung: number;
  loi: number;
  nhacTheoPhapNhan: number;
  daNhac: number;
};

const SONG = ["CHO_KY", "DANG_KY", "DA_KY"];

export async function quetTaoLenhKyHeThong(now: Date): Promise<KetQuaQuetLenh | null> {
  if (!(await laKyUsbBat())) return null;
  const kq: KetQuaQuetLenh = { quet: 0, taoMoi: 0, daCo: 0, boQuaNgoaiLe: 0, boQuaCanNguoi: 0, boQuaTamDung: 0, loi: 0, nhacTheoPhapNhan: 0, daNhac: 0 };
  const usb = await docPhapNhanKyUsb();
  if (usb.size === 0) return kq;

  const ds = await db.hoaDonDienTu.findMany({
    where: { trangThai: "DANG_PHAT_HANH", soHoaDon: null, nhaCungCapMa: "VIN_HOADON", misaGuiLuc: null, phapNhanMa: { in: [...usb] } },
    orderBy: { createdAt: "asc" },
    take: TRAN_QUET_LENH,
    select: { id: true, phapNhanMa: true },
  });
  kq.quet = ds.length;
  if (ds.length > 0) {
    const ids = ds.map((d) => d.id);
    const [lenh, ngoaiLe] = await Promise.all([
      db.hoaDonLenhKy.findMany({ where: { hoaDonId: { in: ids }, phuongThuc: "USB_TOKEN" }, select: { hoaDonId: true, trangThai: true } }),
      db.hoaDonNgoaiLe.findMany({ where: { hoaDonId: { in: ids }, trangThai: { in: ["MO", "DANG_XU_LY"] } }, select: { hoaDonId: true } }),
    ]);
    const coNgoaiLe = new Set(ngoaiLe.map((n) => n.hoaDonId));
    const trangThaiLenh = new Map<string, string[]>();
    for (const l of lenh) trangThaiLenh.set(l.hoaDonId, [...(trangThaiLenh.get(l.hoaDonId) ?? []), l.trangThai]);
    const dung = new Map<string, boolean>();

    for (const d of ds) {
      const tt = trangThaiLenh.get(d.id) ?? [];
      if (tt.some((t) => SONG.includes(t))) {
        kq.daCo += 1;
        continue;
      }
      if (coNgoaiLe.has(d.id)) {
        kq.boQuaNgoaiLe += 1;
        continue;
      }
      if (tt.some((t) => t === "LOI_KY" || t === "HUY") || tt.filter((t) => t === "HET_HAN").length >= TOI_DA_LENH_HET_HAN) {
        kq.boQuaCanNguoi += 1;
        continue;
      }
      const pn = d.phapNhanMa ?? "";
      if (!dung.has(pn)) dung.set(pn, (await kyDangTamDung(pn)).tamDung);
      if (dung.get(pn)) {
        kq.boQuaTamDung += 1;
        continue;
      }
      try {
        const r = await taoLenhKyUsbHeThong({ hoaDonId: d.id, now });
        if (r.ok) kq.taoMoi += 1;
        else if (r.ma === "DA_CO_LENH_SONG") kq.daCo += 1;
        else if (r.ma === "TAM_DUNG") kq.boQuaTamDung += 1;
        else kq.loi += 1;
      } catch {
        // Một hoá đơn hỏng không làm hỏng cả lượt; lần quét sau thử lại.
        kq.loi += 1;
      }
    }
  }

  // ── Báo kế toán: lệnh ĐANG CHỜ KÝ (kể cả lệnh lập tay) còn hạn, gộp theo pháp nhân.
  const cho = await db.hoaDonLenhKy.findMany({
    where: { phuongThuc: "USB_TOKEN", trangThai: "CHO_KY", hetHanLuc: { gt: now } },
    select: { centerId: true, createdAt: true, hoaDon: { select: { phapNhanMa: true, phapNhanTen: true } } },
  });
  const nhom = new Map<string, NhomChoKy & { coSo: Set<string> }>();
  for (const l of cho) {
    const pn = l.hoaDon.phapNhanMa;
    if (!pn) continue;
    const n = nhom.get(pn) ?? { phapNhanMa: pn, phapNhanTen: l.hoaDon.phapNhanTen ?? "", soLenh: 0, cuNhatLuc: l.createdAt, coSoIds: [], coSo: new Set<string>() };
    n.soLenh += 1;
    if (l.createdAt < n.cuNhatLuc) n.cuNhatLuc = l.createdAt;
    n.coSo.add(l.centerId);
    nhom.set(pn, n);
  }
  const nhomDung: NhomChoKy[] = [];
  for (const n of nhom.values()) {
    if ((await kyDangTamDung(n.phapNhanMa)).tamDung) continue; // đang dừng thì không rủ ai ký
    nhomDung.push({ phapNhanMa: n.phapNhanMa, phapNhanTen: n.phapNhanTen, soLenh: n.soLenh, cuNhatLuc: n.cuNhatLuc, coSoIds: [...n.coSo] });
  }
  kq.nhacTheoPhapNhan = nhomDung.length;
  if (nhomDung.length > 0) {
    const tb = dungThongBaoChoKy({ nhom: nhomDung, nguoiNhan: await timKeToan(now), now });
    for (const t of tb) kq.daNhac += await notifyStaff(t);
  }
  return kq;
}

/** Điểm vào của cron: tắt ⇒ `null`; lỗi cấp lượt ⇒ nhãn ngắn, KHÔNG ném (không làm hỏng các pha khác của cron). */
export async function chayKyUsbCuaCron(now: Date): Promise<KetQuaQuetLenh | { loi: string } | null> {
  try {
    return await quetTaoLenhKyHeThong(now);
  } catch (e) {
    const ma = (e as { code?: unknown } | null)?.code;
    return { loi: typeof ma === "string" && /^[A-Z0-9_]{2,12}$/.test(ma) ? ma : e instanceof Error && /^[A-Za-z]{2,40}$/.test(e.name) ? e.name : "LOI" };
  }
}
