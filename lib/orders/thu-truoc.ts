// lib/orders/thu-truoc.ts — "THU TRƯỚC" (CỌC) TRÊN ĐƠN: luật THUẦN, máy chủ và màn hình cùng gọi.
//
// ── QUYẾT ĐỊNH [chủ dự án, 30/10/2026, trong chat] ─────────────────────────────────────────────────────────────
// Ngày 20/10 khối "Kế hoạch thanh toán" bị gỡ khỏi mọi đơn (`ke-hoach-da-bo.ts`) và ô "Thu cọc trước" đi theo nó — việc
// gỡ cọc là HỆ QUẢ do phiên làm suy ra, chủ dự án chưa từng nói. Phát hiện 30/10 khi chuẩn bị đưa luồng lên main: chủ dự án
// hỏi "sao mất phần cọc tiền của KH ở thanh toán" và chọn *làm lại cách thu cọc* (giữ nguyên việc bỏ kế hoạch chia đợt).
//
// Cọc mới KHÔNG phải kế hoạch: một nút "Thu trước" trên trang đơn, nhập một số tiền, hệ thống tách đơn thành HAI phiếu thu
// — phiếu "cọc" đúng số đó (xuất QR như mọi phiếu) và phiếu "còn lại" — để khách quét QR đóng trước. Không chia nhiều đợt,
// không form kế hoạch. Lõi kế hoạch bắt buộc đợt chưa thu có hạn, nên cọc đến hạn hôm nay còn phần còn lại có hạn (mặc định +30 ngày,
// người dùng chọn được); quá hạn thì cron nhắc nợ nhắc như mọi đợt. Phần còn lại vẫn đóng bằng mọi cách đóng tiền như cũ.
//
// ── ĐƠN THEO PHẠM VI HỌC VẪN THU TRƯỚC ĐƯỢC [chủ dự án, 01/11/2026, trong chat: "đơn theo phạm vi buổi học vẫn cho phép thu cọc"] ───────
// Bản đầu (30/10) chặn đơn SCOPE theo cổng D (13/10: đơn SCOPE không chia kế hoạch nhiều đợt). Cọc KHÔNG phải kế hoạch chia đợt nên
// không còn chặn ở đây; cổng D vẫn nguyên cho mọi đường khác — `thu-truoc-ghi.ts` là chỗ DUY NHẤT truyền `choPhepDonPhamVi` cho lõi.
//
// ── CHỈ KHI ĐƠN CÒN "SẠCH" ─────────────────────────────────────────────────────────────────────────────────────
// Tách phiếu thu toàn đơn thành hai phiếu là phép ghi đụng tiền. Chỉ cho khi chưa có gì để làm hỏng: chưa có kế hoạch / đợt
// nào, chưa nhận đồng nào. Đơn đã nhận một phần thì "thu một phần" đi đường ghi nhận khoản như hôm nay — không tách lại phiếu
// dưới chân khoản đã thu (đó chính là lỗ mà cổng R-02 / A6 của lõi kế hoạch được dựng để chặn).
//
// Vì sao một chỗ thuần: cùng một câu hỏi "đơn này thu trước được không, vì sao không" cho cả nút (ẩn / hiện / nói lý do)
// và máy chủ (cổng thật). Hai bản chép tay là hai bản sẵn sàng lệch nhau (luật 12).

import { TRANG_THAI_DON_KHONG_NHAN_TIEN } from "@/lib/payments/don-nhan-tien";
import { parseVnYmd, vnAddDays, vnStartOfDay } from "@/lib/time/vn";

/** Hạn mặc định của phần còn lại khi người dùng không chọn: 30 ngày kể từ hôm nay (lịch VN). */
export const SO_NGAY_HAN_CON_LAI_MAC_DINH = 30;

export type DauVaoThuTruoc = {
  /** Số tiền khách đóng trước (đồng). `unknown` vì đi qua ranh giới client → server. */
  soTien: unknown;
  /**
   * Hạn đóng phần CÒN LẠI, "YYYY-MM-DD" (lịch VN). `unknown` vì đi qua ranh giới client → server; trống ⇒ mặc định +30 ngày.
   * Lõi kế hoạch BẮT BUỘC mọi đợt chưa thu có hạn (không hạn thì cron nhắc nợ không nhắc được ai) nên hạn không bỏ được.
   */
  hanConLai?: unknown;
  /** Thời điểm hiện tại — truyền vào để luật thuần không đọc đồng hồ (luật 19). */
  homNay: Date;
  /** `Order.totalAmount` (đồng). */
  tongDon: number;
  trangThaiDon: string;
  /** Đơn phí học bù — đóng MỘT lần qua phiếu toàn đơn. */
  laDonPhiHocBu: boolean;
  /** Số dòng `OrderInstallment` đã có (kế hoạch cũ). */
  soKeHoachCu: number;
  /** Số phiếu thu đang sống KHÁC phiếu "thu toàn đơn" (đợt theo đơn hoặc theo con, trạng thái ≠ VOID). */
  soPhieuDotDangSong: number;
  /** Tổng tiền đã vào sổ của đơn (Σ phân bổ + Σ khoản đã ghi) — chưa nhận đồng nào thì 0. */
  tongDaNhan: number;
};

export type KetQuaThuTruoc =
  | { ok: true; soTien: number; conLai: number; dots: { amount: number; daThu: false; dueDate: Date }[] }
  | { ok: false; loi: string };

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

export const LY_DO_KHONG_THU_TRUOC = {
  trangThai: "Đơn này không còn nhận tiền (nháp / đã huỷ / đã hoàn) nên không thu trước được.",
  phiHocBu: "Đơn phí học bù đóng một lần, không thu trước.",
  coKeHoach: "Đơn đã có kế hoạch / đợt thu cũ — thu thêm bằng đợt hiện có hoặc ghi nhận khoản.",
  daNhanTien:
    "Đơn đã nhận tiền. Khoản thu thêm ghi ở «Ghi nhận khoản» — không tách lại phiếu thu dưới chân khoản đã nhận.",
} as const;

/**
 * Lý do KHÔNG thu trước được ở cấp ĐƠN (chưa xét số tiền). `null` = được. Nút dùng hàm này để ẩn / nói lý do.
 * Thứ tự là thứ tự câu nói có ích nhất cho người đọc: trạng thái đơn trước, rồi loại đơn, rồi tình trạng tiền.
 */
export function lyDoKhongThuTruocDuoc(v: Omit<DauVaoThuTruoc, "soTien" | "hanConLai" | "homNay">): string | null {
  if ((TRANG_THAI_DON_KHONG_NHAN_TIEN as readonly string[]).includes(v.trangThaiDon)) return LY_DO_KHONG_THU_TRUOC.trangThai;
  if (v.laDonPhiHocBu) return LY_DO_KHONG_THU_TRUOC.phiHocBu;
  if (v.soKeHoachCu > 0 || v.soPhieuDotDangSong > 0) return LY_DO_KHONG_THU_TRUOC.coKeHoach;
  if (v.tongDaNhan > 0) return LY_DO_KHONG_THU_TRUOC.daNhanTien;
  if (!Number.isInteger(v.tongDon) || v.tongDon < 2) return "Đơn quá nhỏ để tách phiếu thu trước.";
  return null;
}

/**
 * Cổng thật: đơn thu trước được không VÀ số tiền hợp lệ không. Thành công ⇒ trả hai đợt để GHI
 * (`recordInstallmentPlan` nhận đúng hình dạng này).
 */
export function kiemThuTruoc(v: DauVaoThuTruoc): KetQuaThuTruoc {
  const lyDo = lyDoKhongThuTruocDuoc(v);
  if (lyDo) return { ok: false, loi: lyDo };

  const x = v.soTien;
  if (typeof x !== "number" || !Number.isFinite(x) || !Number.isInteger(x)) {
    return { ok: false, loi: "Số tiền thu trước phải là số nguyên (đồng)." };
  }
  if (x <= 0) return { ok: false, loi: "Số tiền thu trước phải lớn hơn 0." };
  if (x >= v.tongDon) {
    return {
      ok: false,
      loi: `Thu trước phải NHỎ HƠN tổng đơn (${tien(v.tongDon)}). Muốn thu đủ thì xuất QR phiếu thu toàn đơn.`,
    };
  }
  const conLai = v.tongDon - x;
  // Cọc đến hạn NGAY hôm nay (khách đang quét QR); phần còn lại theo hạn người dùng chọn, mặc định +30 ngày.
  const homNay0 = vnStartOfDay(v.homNay);
  let hanCon: Date;
  if (v.hanConLai === undefined || v.hanConLai === null || v.hanConLai === "") {
    hanCon = vnAddDays(homNay0, SO_NGAY_HAN_CON_LAI_MAC_DINH);
  } else {
    const p = typeof v.hanConLai === "string" ? parseVnYmd(v.hanConLai) : null;
    if (!p) return { ok: false, loi: "Hạn đóng phần còn lại không hợp lệ." };
    if (p.getTime() < homNay0.getTime()) return { ok: false, loi: "Hạn đóng phần còn lại không được ở quá khứ." };
    hanCon = p;
  }
  return {
    ok: true,
    soTien: x,
    conLai,
    dots: [
      { amount: x, daThu: false, dueDate: homNay0 },
      { amount: conLai, daThu: false, dueDate: hanCon },
    ],
  };
}
