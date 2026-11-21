import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import type { KetQuaPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { FetchLike } from "@/lib/vin-hoadon/http";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { HAN_PHIEN_KY_USB_MS, cungSerial, docChungThuTuXmlDaKy, kiemXmlDaKy, phienConDungDuoc } from "@/lib/vin-hoadon/ky-usb";
import { laKyUsbBat } from "../feature";
import { docTaiKhoanKetNoi } from "../ket-noi/ket-noi-db";
import { canhBaoChungThu } from "../ket-noi/hien-thi";
import { giaiKetNoiChoPhapNhan, layCongUsbChoPhapNhan } from "../ket-noi/cong-theo-phap-nhan";
import { moiTruongKetNoiTuMoiTruongChay } from "../ket-noi/luat";
import { laProductionThat } from "@/lib/security/client-ip";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { ghiLoiKy, hoanTatKy, taoLenhKy, taoLenhKyHeThong, type KetQuaTaoLenh } from "../lenh-ky-db";
import { CAU_TAM_DUNG_KY, kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import { phapNhanMaPhatHanhChoCoSo } from "../ket-noi/phap-nhan-phat-hanh";
import { phamViKeToan } from "../quyen";
import { bamDuLieuCanKy, type BoKy, type KetQuaKy } from "../lenh-ky-bo-ky";
import type { ChinhSachDuyetKy } from "../lenh-ky-trang-thai";
import { CHINH_SACH_KY_NGHIEM_NHAT } from "../lenh-ky-trang-thai";
import { apDungKetQuaKyUsb, docPhieuDaLuuChoKyUsb, giaiLuotGuiChoKyUsb, kiemTraLaiKhongGuiLai, type SauBuoc } from "../phat-hanh-misa";

// lib/finance/hoa-don/ky-usb/ky-usb-lenh.ts — ĐƯỜNG KÝ USB TOKEN (VIN-HOADON) trên LỆNH KÝ có sẵn (Signature Engine S9). Hub/13 §4.
//
// BA BƯỚC, vì phiên ký của VIN (`maphiengiaodich`) chỉ sống 30 phút:
//   1. `taoLenhKyUsb`      — lập lệnh CHO_KY cho một hoá đơn đang chờ phát hành. KHÔNG gọi nhà cung cấp (lệnh có thể nằm qua đêm).
//   2. (duyetVaBatDauKy)   — kế toán bấm «Ký»: CHO_KY → DANG_KY, người bấm là người ký (cổng tách nhiệm vụ của S9 vẫn nguyên).
//   3. `batDauPhienKyUsb`  — lưu NHÁP ở VIN + tải XML chưa ký + mở phiên 30 phút; lưu phiên + XML vào lệnh. Trả XML cho ứng dụng ký.
//   4. `hoanTatKyUsb`      — nhận XML đã ký từ máy kế toán, gửi VIN, áp kết quả bằng CHÍNH máy trạng thái phát hành (apDungKetQua).
//
// ⚠️ Hệ thống KHÔNG giữ PIN / khoá riêng / chứng thư: chữ ký sinh ở máy kế toán. Đường này chỉ chuyển XML và ghi kết quả.
// ⚠️ Chưa-biết ⇒ KHÔNG_RÕ, không bao giờ gửi lại mù: gửi XML đã ký mà không rõ kết quả ⇒ hoá đơn giữ DANG_PHAT_HANH; việc tiếp theo chỉ là TRA CỨU
//    (`kiemTraLaiUsb`), không có đường nào gửi lại.
// ⚠️ Kết quả của nhà cung cấp được ÁP LÊN HOÁ ĐƠN dù lệnh ký có bị đổi trong lúc ký hay không: chữ ký đã tới VIN thì hoá đơn đã phát hành thật.
// ⚠️ Pháp nhân ký USB không bao giờ đi đường HSM (`layCongHsmChoPhapNhan` từ chối) — đường này là đường duy nhất của họ.

export type MaLoiKyUsb =
  | "TAT"
  | "KHONG_THAY"
  | "SAI_TRANG_THAI"
  | "KHONG_PHAI_KY_USB"
  | "KHONG_CO_KET_NOI"
  | "CHUNG_THU"
  | "NHA_CUNG_CAP"
  | "SAI_LENH"
  | "HET_PHIEN"
  | "LENH_KY"
  | "TAM_DUNG"
  | "PHAP_NHAN_KHAC"
  | "NOI_DUNG_DOI"
  | "CHUNG_THU_LECH";

export type LoiKyUsb = { ok: false; ma: MaLoiKyUsb; error: string };
const loi = (ma: MaLoiKyUsb, error: string): LoiKyUsb => ({ ok: false, ma, error });

type TuyChon = { env?: Record<string, string | undefined>; fetchImpl?: FetchLike };

/** Hạn mặc định của lệnh CHO_KY (kế toán ký sáng hôm sau): 12 giờ. Trần của S9 là 24 giờ. */
export const TTL_LENH_KY_USB_PHUT = 12 * 60;

// ── 1. TẠO LỆNH ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mọi điều kiện để LẬP lệnh ký USB cho một hoá đơn — dùng chung cho lệnh lập tay và lệnh hệ thống. Thành công ⇒ hash của phiếu đã lưu. */
async function kiemDieuKienTaoLenh(hoaDonId: string, tc: TuyChon): Promise<{ ok: true; hash: string } | LoiKyUsb> {
  if (!(await laKyUsbBat())) return loi("TAT", "Ký USB token chưa được bật (Cấu hình vận hành).");
  const p = await docPhieuDaLuuChoKyUsb(hoaDonId);
  if (!p) return loi("KHONG_THAY", "Không tìm thấy hoá đơn đang chờ phát hành.");
  if (p.trangThai !== "DANG_PHAT_HANH" || p.soHoaDon) return loi("SAI_TRANG_THAI", "Hoá đơn này không còn ở trạng thái chờ phát hành.");
  if (p.nhaCungCapMa !== "VIN_HOADON" || !p.phapNhanMa) return loi("NHA_CUNG_CAP", "Ký USB hiện chỉ hỗ trợ hoá đơn phát hành qua VIN-HOADON.");
  if ((await kyDangTamDung(p.phapNhanMa)).tamDung) return loi("TAM_DUNG", CAU_TAM_DUNG_KY);
  // Chỉ hỏi CẤU HÌNH nói gì (không giải mã mật khẩu ở bước này — lệnh có thể tạo hàng loạt trước khi ai ký).
  const cauHinh = await giaiKetNoiChoPhapNhan(p.phapNhanMa, { env: tc.env, fetchImpl: tc.fetchImpl });
  if (cauHinh.nguon !== "BANG" || cauHinh.phuongThucKy !== "USB" || cauHinh.nhaCungCap !== "VIN_HOADON") {
    return loi("KHONG_PHAI_KY_USB", cauHinh.nguon === "KHONG" ? cauHinh.lyDo : "Pháp nhân này không cấu hình ký bằng USB token.");
  }
  // Dữ liệu cần ký = phiếu đã lưu (nội dung hoá đơn). Hash — không bao giờ lưu dữ liệu thô vào `duLieuCanKyHash`.
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { misaPhieu: true } });
  return { ok: true, hash: bamDuLieuCanKy(JSON.stringify(hd?.misaPhieu ?? null)) };
}

export async function taoLenhKyUsb(i: { actor: Actor; ten: string; hoaDonId: string; now: Date; ttlPhut?: number } & TuyChon): Promise<KetQuaTaoLenh | LoiKyUsb> {
  const dk = await kiemDieuKienTaoLenh(i.hoaDonId, i);
  if (!dk.ok) return dk;
  return taoLenhKy({ actor: i.actor, ten: i.ten, hoaDonId: i.hoaDonId, phuongThuc: "USB_TOKEN", duLieuCanKyHash: dk.hash, ttlPhut: i.ttlPhut ?? TTL_LENH_KY_USB_PHUT, now: i.now });
}

/**
 * Lệnh ký USB do HỆ THỐNG tạo (người yêu cầu = SYSTEM) cho hoá đơn do Invoice Engine đã lập. CHỈ bước quét (`quet-tao-lenh.ts`) gọi (lưới `[LK-W7]`).
 * Cùng mọi điều kiện của lệnh lập tay; người KÝ vẫn là một kế toán có quyền ở cơ sở của hoá đơn và được ghi lại (người · lúc · chứng thư).
 */
export async function taoLenhKyUsbHeThong(i: { hoaDonId: string; now: Date; ttlPhut?: number } & TuyChon): Promise<KetQuaTaoLenh | LoiKyUsb> {
  const dk = await kiemDieuKienTaoLenh(i.hoaDonId, i);
  if (!dk.ok) return dk;
  return taoLenhKyHeThong({ hoaDonId: i.hoaDonId, phuongThuc: "USB_TOKEN", duLieuCanKyHash: dk.hash, ttlPhut: i.ttlPhut ?? TTL_LENH_KY_USB_PHUT, now: i.now });
}

/**
 * Người này có được KÝ hoá đơn của pháp nhân này không. Kế toán Hội sở (phạm vi ALL) — được. Kế toán cơ sở — CHỈ khi pháp nhân của hoá đơn ĐÚNG là pháp nhân phát hành
 * đang cấu hình của cơ sở họ (một cơ sở có thể được cấu hình phát hành cho pháp nhân khác; kế toán cơ sở đó không có quyền ký chứng thư của pháp nhân ấy).
 */
export async function duocKyChoPhapNhan(actor: Actor, hd: { centerId: string; phapNhanMa: string | null }, now: Date): Promise<boolean> {
  if (!hd.phapNhanMa) return false;
  if (phamViKeToan(actor) === "ALL") return true;
  const cuaCoSo = await phapNhanMaPhatHanhChoCoSo(SYSTEM_ACTOR, hd.centerId, ngayVN(now));
  return cuaCoSo !== null && cuaCoSo === hd.phapNhanMa;
}

// ── 3. BẮT ĐẦU PHIÊN KÝ ───────────────────────────────────────────────────────────────────────────────────────────────────

export type PhienKyUsb = { ok: true; lenhId: string; maPhien: string; xmlChuaKyBase64: string; hetHanPhien: Date };

/** Đọc lệnh USB ở DANG_KY của đúng người ký. */
async function docLenhUsbDangKy(actor: Actor, lenhId: string) {
  const l = await db.hoaDonLenhKy.findUnique({
    where: { id: lenhId },
    select: { id: true, hoaDonId: true, phuongThuc: true, trangThai: true, nguoiKyId: true, maGiaoDich: true, maPhienNcc: true, phienLayLuc: true, xmlChuaKy: true, duLieuCanKyHash: true },
  });
  if (!l) return loi("KHONG_THAY", "Không tìm thấy lệnh ký.");
  if (l.phuongThuc !== "USB_TOKEN") return loi("KHONG_PHAI_KY_USB", "Lệnh này không phải lệnh ký USB.");
  if (l.trangThai !== "DANG_KY") return loi("SAI_TRANG_THAI", "Lệnh ký chưa ở trạng thái đang ký — bấm «Ký» trước.");
  if (l.nguoiKyId !== actor.userId) return loi("SAI_TRANG_THAI", "Chỉ người đã nhận ký lệnh này mới thao tác tiếp được.");
  return l;
}

/**
 * Nội dung hoá đơn (phiếu đã lưu) có còn y như lúc LẬP LỆNH không — so băm với `duLieuCanKyHash` của lệnh. Lệch ⇒ đóng lệnh (LOI_KY / NOI_DUNG_DOI) và KHÔNG gửi gì:
 * số tiền · người mua · dòng hàng đã bị đổi sau khi có lệnh thì người ký đang ký thứ khác với thứ hệ thống đã duyệt.
 */
async function chanNeuNoiDungDoi(i: { actor: Actor; lenhId: string; hoaDonId: string; hashLuc: string; now: Date }): Promise<LoiKyUsb | null> {
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: i.hoaDonId }, select: { misaPhieu: true } });
  if (bamDuLieuCanKy(JSON.stringify(hd?.misaPhieu ?? null)) === i.hashLuc) return null;
  await ghiLoiKy({ actor: i.actor, ten: "Hệ thống kiểm tra nội dung", lenhId: i.lenhId, maLoi: "NOI_DUNG_DOI", now: i.now });
  return loi("NOI_DUNG_DOI", "Nội dung hoá đơn đã thay đổi sau khi lập lệnh ký — lệnh đã đóng, chưa gửi gì. Tạo lệnh ký mới nếu hoá đơn vẫn đúng.");
}

/**
 * Lưu NHÁP ở VIN (an toàn khi lặp: cùng refId ⇒ cùng magiaodich) + tải XML chưa ký + mở phiên, rồi LƯU phiên vào lệnh. Chỉ nhận lệnh DANG_KY của đúng người ký.
 * Từ chối khi chứng thư đã hết hạn / chưa khai hạn: ký bằng chứng thư hết hạn chỉ sinh ra hoá đơn bị VIN từ chối.
 */
export async function batDauPhienKyUsb(i: { actor: Actor; lenhId: string; now: Date } & TuyChon): Promise<PhienKyUsb | LoiKyUsb> {
  if (!(await laKyUsbBat())) return loi("TAT", "Ký USB token chưa được bật (Cấu hình vận hành).");
  const l = await docLenhUsbDangKy(i.actor, i.lenhId);
  if ("ok" in l) return l;
  const p = await docPhieuDaLuuChoKyUsb(l.hoaDonId);
  if (!p || p.trangThai !== "DANG_PHAT_HANH" || p.soHoaDon) return loi("SAI_TRANG_THAI", "Hoá đơn không còn ở trạng thái chờ phát hành.");
  if (p.nhaCungCapMa !== "VIN_HOADON" || !p.phapNhanMa) return loi("NHA_CUNG_CAP", "Ký USB hiện chỉ hỗ trợ hoá đơn phát hành qua VIN-HOADON.");
  // Cổng «GUI»: pháp nhân tạm dừng ký ⇒ dừng, lệnh GIỮ NGUYÊN (không đóng) — bật lại là ký tiếp được.
  const cong = await layCongUsbChoPhapNhan(p.phapNhanMa, "GUI", { env: i.env, fetchImpl: i.fetchImpl });
  if (!cong.ok) return cong.tamDung ? loi("TAM_DUNG", cong.lyDo) : loi("KHONG_CO_KET_NOI", cong.lyDo);
  if (!(await duocKyChoPhapNhan(i.actor, { centerId: p.centerId, phapNhanMa: p.phapNhanMa }, i.now))) {
    return loi("PHAP_NHAN_KHAC", "Bạn không có quyền ký hoá đơn của pháp nhân này — chỉ kế toán Hội sở, hoặc kế toán của cơ sở đang phát hành cho pháp nhân này.");
  }
  const doi = await chanNeuNoiDungDoi({ actor: i.actor, lenhId: l.id, hoaDonId: l.hoaDonId, hashLuc: l.duLieuCanKyHash, now: i.now });
  if (doi) return doi;

  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat(i.env ?? process.env));
  const tk = await docTaiKhoanKetNoi(p.phapNhanMa, moiTruong, i.env);
  const hetHan = tk.hang?.chungThuHetHan ?? null;
  const cb = canhBaoChungThu(hetHan, ngayVN(i.now));
  if (!tk.hang?.chungThuSerial) return loi("CHUNG_THU", "Chưa khai số serial chứng thư số ở «Kết nối & ký» — cần để kiểm chứng thư dùng ký có đúng của pháp nhân này.");
  if (!hetHan) return loi("CHUNG_THU", "Chưa khai hạn chứng thư số ở «Kết nối & ký» — khai trước khi ký.");
  if (cb?.muc === "danger") return loi("CHUNG_THU", cb.cau);

  // Lưu nháp: KHÔNG_RÕ / TU_CHOI không được gọi tiếp. TU_CHOI chắc chắn ⇒ áp lên hoá đơn (LOI_PHAT_HANH) để kế toán thấy.
  const nhap = await cong.cong.kyUsb.luuNhap(p.phieu);
  if (nhap.loai !== "DA_LUU") {
    if (nhap.loai === "TU_CHOI") await apDungKetQuaKyUsb({ hoaDonId: l.hoaDonId, kq: { loai: "TU_CHOI", ma: nhap.ma, thongDiep: nhap.thongDiep }, cong: cong.cong, now: i.now, nguoiGoiId: i.actor.userId });
    return loi("NHA_CUNG_CAP", nhap.thongDiep);
  }
  const tai = await cong.cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: p.phieu.mstNguoiBan, refId: p.refId, maGiaoDich: nhap.maGiaoDich });
  if (tai.loai !== "OK") return loi("NHA_CUNG_CAP", tai.thongDiep);

  const xml = Buffer.from(tai.xmlBase64, "base64").toString("utf8");
  const luu = await db.hoaDonLenhKy.updateMany({
    where: { id: l.id, trangThai: "DANG_KY", nguoiKyId: i.actor.userId },
    data: { maPhienNcc: tai.maPhien, phienLayLuc: i.now, xmlChuaKy: xml, maGiaoDich: nhap.maGiaoDich },
  });
  if (luu.count !== 1) return loi("SAI_TRANG_THAI", "Lệnh ký vừa được người khác xử lý — tải lại.");
  return { ok: true, lenhId: l.id, maPhien: tai.maPhien, xmlChuaKyBase64: tai.xmlBase64, hetHanPhien: new Date(i.now.getTime() + HAN_PHIEN_KY_USB_MS) };
}

// ── 4. HOÀN TẤT ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaHoanTatUsb = { ok: true; lenhId: string; sauBuoc: SauBuoc } | LoiKyUsb;

/**
 * Nhận XML đã ký, gửi VIN, áp kết quả. Hoàn tất lệnh ký qua `hoanTatKy` (cổng S9: quyền cơ sở · đúng người ký · còn hạn · tách nhiệm vụ) với MỘT bộ ký
 * "một lần" đóng quanh phiên này. Kết quả nhà cung cấp luôn được áp lên hoá đơn (xem đầu tệp).
 */
export async function hoanTatKyUsb(
  i: { actor: Actor; ten: string; lenhId: string; xmlDaKyBase64: string; chinhSach?: ChinhSachDuyetKy; now: Date } & TuyChon,
): Promise<KetQuaHoanTatUsb> {
  if (!(await laKyUsbBat())) return loi("TAT", "Ký USB token chưa được bật (Cấu hình vận hành).");
  const l = await docLenhUsbDangKy(i.actor, i.lenhId);
  if ("ok" in l) return l;
  if (!l.maPhienNcc || !l.phienLayLuc || !l.xmlChuaKy || !l.maGiaoDich) return loi("SAI_LENH", "Lệnh chưa có phiên ký — bắt đầu phiên ký trước.");
  if (!phienConDungDuoc(l.phienLayLuc, i.now)) {
    // Phiên sắp/đã hết: gửi XML bây giờ chỉ bị VIN từ chối. Đóng lệnh để kế toán tạo phiên mới.
    await ghiLoiKy({ actor: i.actor, ten: i.ten, lenhId: l.id, maLoi: "QUA_THOI_GIAN", now: i.now });
    return loi("HET_PHIEN", "Phiên ký đã hết hạn (VIN chỉ giữ 30 phút) — bắt đầu lại.");
  }
  const p = await docPhieuDaLuuChoKyUsb(l.hoaDonId);
  if (!p?.phapNhanMa || p.trangThai !== "DANG_PHAT_HANH" || p.soHoaDon) return loi("SAI_TRANG_THAI", "Hoá đơn không còn ở trạng thái chờ phát hành.");
  const phapNhanMa = p.phapNhanMa;
  const cong = await layCongUsbChoPhapNhan(phapNhanMa, "GUI", { env: i.env, fetchImpl: i.fetchImpl });
  if (!cong.ok) return cong.tamDung ? loi("TAM_DUNG", cong.lyDo) : loi("KHONG_CO_KET_NOI", cong.lyDo);
  if (!(await duocKyChoPhapNhan(i.actor, { centerId: p.centerId, phapNhanMa }, i.now))) {
    return loi("PHAP_NHAN_KHAC", "Bạn không có quyền ký hoá đơn của pháp nhân này — chỉ kế toán Hội sở, hoặc kế toán của cơ sở đang phát hành cho pháp nhân này.");
  }
  const doi = await chanNeuNoiDungDoi({ actor: i.actor, lenhId: l.id, hoaDonId: l.hoaDonId, hashLuc: l.duLieuCanKyHash, now: i.now });
  if (doi) return doi;
  const xmlChuaKyBase64 = Buffer.from(l.xmlChuaKy, "utf8").toString("base64");
  // XML đã ký hỏng (chưa có chữ ký, sai nội dung, không phải XML) là lỗi Ở MÁY KÝ, không phải lỗi nhà cung cấp: đóng lệnh, KHÔNG đụng hoá đơn, KHÔNG gửi.
  const loiXml = kiemXmlDaKy(xmlChuaKyBase64, i.xmlDaKyBase64);
  if (loiXml) {
    await ghiLoiKy({ actor: i.actor, ten: i.ten, lenhId: l.id, maLoi: "PHAN_HOI_KHONG_HOP_LE", now: i.now });
    return loi("SAI_LENH", loiXml);
  }
  // Chứng thư THỰC TẾ dùng để ký (đọc từ chữ ký trong XML) phải là chứng thư đã khai cho pháp nhân này — không dùng nhầm chứng thư HO / CS1 / CS2.
  const ct = docChungThuTuXmlDaKy(i.xmlDaKyBase64);
  const tk = await docTaiKhoanKetNoi(phapNhanMa, moiTruongKetNoiTuMoiTruongChay(laProductionThat(i.env ?? process.env)), i.env);
  if (!ct || !tk.hang?.chungThuSerial || !cungSerial(ct.serial, tk.hang.chungThuSerial)) {
    await ghiLoiKy({ actor: i.actor, ten: i.ten, lenhId: l.id, maLoi: "CHUNG_THU_LECH", now: i.now });
    return loi("CHUNG_THU_LECH", "Chứng thư dùng để ký không khớp chứng thư đã khai cho pháp nhân này (hoặc XML không mang chứng thư đọc được) — chưa gửi gì, lệnh đã đóng.");
  }
  if (ct.hetHan < ngayVN(i.now)) {
    await ghiLoiKy({ actor: i.actor, ten: i.ten, lenhId: l.id, maLoi: "CHUNG_THU_HET_HAN", now: i.now });
    return loi("CHUNG_THU", "Chứng thư dùng để ký đã hết hạn — chưa gửi gì, lệnh đã đóng.");
  }
  const maGiaoDich = l.maGiaoDich;
  const maPhien = l.maPhienNcc;
  let ketQuaNcc: KetQuaPhatHanh | null = null;
  const boKy: BoKy = {
    nangLuc: { providerSupports: "CO", adapterImplements: true, ghiChu: "[?] Đường ký USB VIN — chưa đo trên máy chủ VIN thật (hub/13 §8)" },
    async ky(): Promise<KetQuaKy> {
      // Hỏi tạm dừng LẠI ngay trước khi chạm nhà cung cấp (Quản trị tối cao có thể vừa bấm dừng giữa lúc kế toán ký): dừng ⇒ không gửi, lệnh đóng LOI_KY / TAM_DUNG.
      if ((await kyDangTamDung(phapNhanMa)).tamDung) return { ok: false, ma: "TAM_DUNG", thongDiepNgan: "tam-dung" };
      // Giành lượt gửi NGAY trước khi chạm nhà cung cấp: người khác đã xử lý ⇒ dừng, không gửi.
      if (!(await giaiLuotGuiChoKyUsb(l.hoaDonId, i.now))) return { ok: false, ma: "TU_CHOI", thongDiepNgan: "da-xu-ly" };
      const kq = await cong.cong.kyUsb.guiXmlDaKy({ phieu: p.phieu, maGiaoDich, maPhien, xmlChuaKyBase64, xmlDaKyBase64: i.xmlDaKyBase64 });
      ketQuaNcc = kq;
      if (kq.loai === "DA_PHAT_HANH") return { ok: true, maGiaoDich: kq.maTraCuu, chungThuHetHan: ct.hetHan, chungThuSerial: ct.serial };
      return { ok: false, ma: kq.loai === "TU_CHOI" ? "TU_CHOI" : "KHONG_RO", thongDiepNgan: "ncc" };
    },
  };
  const ky = await hoanTatKy({ actor: i.actor, ten: i.ten, lenhId: l.id, boKy, chinhSach: i.chinhSach ?? CHINH_SACH_KY_NGHIEM_NHAT, now: i.now });

  // Kết quả của nhà cung cấp luôn được áp lên hoá đơn (kể cả khi lệnh bị đổi trong lúc ký): chữ ký đã tới VIN thì hoá đơn đã phát hành thật.
  const sauBuoc = ketQuaNcc ? await apDungKetQuaKyUsb({ hoaDonId: l.hoaDonId, kq: ketQuaNcc, cong: cong.cong, now: i.now, nguoiGoiId: i.actor.userId }) : null;
  if (!ky.ok && !ketQuaNcc) return loi("LENH_KY", ky.error);
  return { ok: true, lenhId: l.id, sauBuoc: sauBuoc ?? { trangThai: "KHONG_CON" } };
}

// ── KIỂM TRA LẠI (không gửi lại) & HUỶ ──────────────────────────────────────────────────────────────────────────────────────

/** Tra cứu hoá đơn ký USB theo refId đã lưu — dùng sau KHÔNG_RÕ. KHÔNG BAO GIỜ gửi lại. */
export async function kiemTraLaiUsb(i: { hoaDonId: string; now: Date; nguoiGoiId: string | null } & TuyChon): Promise<SauBuoc | LoiKyUsb> {
  const p = await docPhieuDaLuuChoKyUsb(i.hoaDonId);
  if (!p?.phapNhanMa) return loi("KHONG_THAY", "Không tìm thấy hoá đơn.");
  // «TRA_CUU»: kiểm lại kết quả của thứ ĐÃ gửi không bị chặn khi pháp nhân tạm dừng ký (cần biết hoá đơn đã gửi trước lúc dừng nay ra sao).
  const cong = await layCongUsbChoPhapNhan(p.phapNhanMa, "TRA_CUU", { env: i.env, fetchImpl: i.fetchImpl });
  if (!cong.ok) return loi("KHONG_CO_KET_NOI", cong.lyDo);
  return kiemTraLaiKhongGuiLai({ hoaDonId: i.hoaDonId, cong: cong.cong, now: i.now, nguoiGoiId: i.nguoiGoiId });
}
