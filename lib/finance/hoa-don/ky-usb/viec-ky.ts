import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { phienConDungDuoc } from "@/lib/vin-hoadon/ky-usb";
import type { FetchLike } from "@/lib/vin-hoadon/http";
import { laKyUsbBat } from "../feature";
import { ghiLoiKy } from "../lenh-ky-db";
import { CAU_TAM_DUNG_KY, kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import type { ChinhSachDuyetKy } from "../lenh-ky-trang-thai";
import { phieuTuJson } from "../phieu-phat-hanh";
import { batDauPhienKyUsb, hoanTatKyUsb, type KetQuaHoanTatUsb, type LoiKyUsb } from "./ky-usb-lenh";

// lib/finance/hoa-don/ky-usb/viec-ky.ts — VIỆC KÝ cho ứng dụng ký Windows (phương án B: ứng dụng tự hỏi máy chủ). Hub/13 §5.
//
// «Ký lô» = kế toán bấm «Ký» một loạt lệnh (CHO_KY → DANG_KY, người bấm là người ký), rồi ứng dụng LẤY VIỆC TỪNG LỆNH MỘT:
//   · phiên ký của VIN chỉ sống 30 phút ⇒ phiên được mở LÚC ỨNG DỤNG LẤY việc đó, không phải lúc bấm. Một lô dài bao nhiêu thì mỗi phiên vẫn mới;
//   · việc đã có phiên còn sống ⇒ trả lại đúng phiên đó (lấy lặp lại không mở phiên thứ hai);
//   · việc mà mở phiên thất bại ⇒ lệnh đóng LOI_KY (kế toán lập lệnh mới) và việc kế tiếp được thử — một lệnh hỏng không chặn cả lô.

export type ViecKy = {
  lenhId: string;
  phapNhanTen: string;
  nguoiMua: string;
  soTien: number;
  xmlChuaKyBase64: string;
  /** Hạn dùng của phiên (ISO). Ứng dụng nên bỏ việc nếu sắp hết. */
  hetHanPhien: string;
};
export type ViecBoQua = { lenhId: string; error: string };
export type KetQuaLayViec = { ok: true; viec: ViecKy | null; conLai: number; boQua: ViecBoQua[] } | LoiKyUsb;

type TuyChon = { env?: Record<string, string | undefined>; fetchImpl?: FetchLike };

const TOI_DA_THU_MOI_LAN = 10;

async function moTaViec(hoaDonId: string): Promise<{ phapNhanTen: string; nguoiMua: string; soTien: number }> {
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { phapNhanTen: true, tongTien: true, misaPhieu: true } });
  const nguoiMua = (() => {
    try {
      const p = phieuTuJson(hd?.misaPhieu);
      return (p.nguoiMua.donVi?.trim() || p.nguoiMua.hoTen?.trim() || "").slice(0, 120);
    } catch {
      return "";
    }
  })();
  return { phapNhanTen: hd?.phapNhanTen ?? "", nguoiMua, soTien: hd?.tongTien ?? 0 };
}

/** Việc ký kế tiếp của người này (lệnh USB đã DANG_KY do CHÍNH họ nhận ký). `viec: null` = hết việc. */
export async function layViecKeTiep(i: { actor: Actor; now: Date } & TuyChon): Promise<KetQuaLayViec> {
  if (!(await laKyUsbBat())) return { ok: false, ma: "TAT", error: "Ký USB token chưa được bật." };
  const lenh = await db.hoaDonLenhKy.findMany({
    where: { phuongThuc: "USB_TOKEN", trangThai: "DANG_KY", nguoiKyId: i.actor.userId },
    orderBy: { createdAt: "asc" },
    take: TOI_DA_THU_MOI_LAN,
    select: { id: true, hoaDonId: true, maPhienNcc: true, phienLayLuc: true, xmlChuaKy: true },
  });
  const tong = await db.hoaDonLenhKy.count({ where: { phuongThuc: "USB_TOKEN", trangThai: "DANG_KY", nguoiKyId: i.actor.userId } });
  const boQua: ViecBoQua[] = [];
  for (const l of lenh) {
    // Pháp nhân TẠM DỪNG KÝ: không giao việc nữa (kể cả việc đã có phiên còn sống — ký xong cũng sẽ bị từ chối ở bước gửi). Lệnh GIỮ NGUYÊN.
    const pn = (await db.hoaDonDienTu.findUnique({ where: { id: l.hoaDonId }, select: { phapNhanMa: true } }))?.phapNhanMa;
    if (pn && (await kyDangTamDung(pn)).tamDung) return { ok: false, ma: "TAM_DUNG", error: CAU_TAM_DUNG_KY };
    let xmlBase64: string;
    let hetHan: Date;
    if (l.maPhienNcc && l.phienLayLuc && l.xmlChuaKy && phienConDungDuoc(l.phienLayLuc, i.now)) {
      xmlBase64 = Buffer.from(l.xmlChuaKy, "utf8").toString("base64");
      hetHan = new Date(l.phienLayLuc.getTime() + 30 * 60 * 1000);
    } else {
      const p = await batDauPhienKyUsb({ actor: i.actor, lenhId: l.id, now: i.now, env: i.env, fetchImpl: i.fetchImpl });
      if (!p.ok) {
        // Pháp nhân TẠM DỪNG KÝ: dừng cả lượt và GIỮ NGUYÊN mọi lệnh (đóng chúng là phá việc đang chờ — bật lại là ký tiếp được).
        if (p.ma === "TAM_DUNG") return { ok: false, ma: "TAM_DUNG", error: p.error };
        // Người này không được ký pháp nhân đó: bỏ qua lệnh (không đóng — lệnh vẫn của người ký đúng), thử lệnh kế.
        if (p.ma === "PHAP_NHAN_KHAC") {
          boQua.push({ lenhId: l.id, error: p.error });
          continue;
        }
        // Không mở được phiên: đóng lệnh này (không để nó chặn cả lô, không lặp vô hạn); kế toán lập lệnh mới.
        await ghiLoiKy({ actor: i.actor, ten: "Ứng dụng ký", lenhId: l.id, maLoi: "KHONG_KET_NOI", now: i.now });
        boQua.push({ lenhId: l.id, error: p.error });
        continue;
      }
      xmlBase64 = p.xmlChuaKyBase64;
      hetHan = p.hetHanPhien;
    }
    const mt = await moTaViec(l.hoaDonId);
    return { ok: true, viec: { lenhId: l.id, ...mt, xmlChuaKyBase64: xmlBase64, hetHanPhien: hetHan.toISOString() }, conLai: Math.max(tong - boQua.length, 0), boQua };
  }
  return { ok: true, viec: null, conLai: Math.max(tong - lenh.length, 0), boQua };
}

/** Mã lỗi ứng dụng được phép báo (ánh xạ vào danh sách cố định của Signature Engine). */
export const MA_LOI_UNG_DUNG = ["NGUOI_DUNG_HUY", "KHONG_KET_NOI", "TU_CHOI", "CHUNG_THU_HET_HAN", "NEM_LOI"] as const;
export type MaLoiUngDung = (typeof MA_LOI_UNG_DUNG)[number];

/** Ứng dụng báo KẾT QUẢ một việc: hoặc XML đã ký, hoặc mã lỗi. Chỉ đúng người đã nhận ký lệnh (cổng ở `hoanTatKyUsb` / `ghiLoiKy`). */
export async function nhanKetQuaViec(
  i: { actor: Actor; ten: string; lenhId: string; now: Date; chinhSach?: ChinhSachDuyetKy } & TuyChon & ({ xmlDaKyBase64: string } | { loi: string }),
): Promise<KetQuaHoanTatUsb | { ok: true; lenhId: string; daGhiLoi: true } | LoiKyUsb> {
  if (!(await laKyUsbBat())) return { ok: false, ma: "TAT", error: "Ký USB token chưa được bật." };
  if ("loi" in i) {
    const ma: MaLoiUngDung = (MA_LOI_UNG_DUNG as readonly string[]).includes(i.loi) ? (i.loi as MaLoiUngDung) : "NEM_LOI";
    const r = await ghiLoiKy({ actor: i.actor, ten: i.ten, lenhId: i.lenhId, maLoi: ma, now: i.now });
    return r.ok ? { ok: true, lenhId: i.lenhId, daGhiLoi: true } : { ok: false, ma: "LENH_KY", error: r.error };
  }
  return hoanTatKyUsb({ actor: i.actor, ten: i.ten, lenhId: i.lenhId, xmlDaKyBase64: i.xmlDaKyBase64, chinhSach: i.chinhSach, now: i.now, env: i.env, fetchImpl: i.fetchImpl });
}
