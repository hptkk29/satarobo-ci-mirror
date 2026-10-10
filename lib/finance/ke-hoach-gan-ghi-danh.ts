// lib/finance/ke-hoach-gan-ghi-danh.ts — LẬP KẾ HOẠCH gắn ghi danh cho các khoản CHƯA gắn của MỘT đơn.
// THUẦN (GĐ 8b hoá đơn điện tử, PLAN Q-mở 8).
//
// Bọc `chiaKhoanTheoDon` (không sửa nó — đường convert vẫn dùng bản gốc) và thêm bốn luật mà đường
// gắn SAU convert thiếu:
//   1. Dòng gốc đã bị ĐẢO (tách / gỡ gắn ⇒ số RÒNG ≤ 0) và dòng không phải PAYMENT không bao giờ gắn:
//      gắn chúng là cấp phiếu thu cho tiền đã rút lại.
//   2. Bậc "theo học viên" của `chiaKhoanTheoDon` không nhìn khoá học ⇒ bé có ghi danh Sata3 cũ +
//      Sata4 mới bị chia đôi khoản đóng cho Sata4. Dòng đơn của bé khai khoá nào thì chỉ giữ ghi danh
//      của khoá đó.
//   3. Một bé nhận ≥ 2 phần (hai ghi danh cùng khoá — học lại) ⇒ MƠ HỒ: không đoán, bỏ qua và nói ra.
//   4. Đích ngoài phạm vi người bấm (đường thủ công) ⇒ bỏ qua — người gọi truyền `trongTam`, BẮT BUỘC.
//
// Kế hoạch có DẤU (`dauKeHoachGan`): màn xem trước in đúng kế hoạch sẽ chạy, lúc bấm dựng lại trong
// transaction và so dấu — lệch là có gì đó đã đổi giữa lúc xem và lúc bấm ⇒ không chạy gì.

import { createHash } from "node:crypto";
import { chiaKhoanTheoDon, type DongDonCoHocVien, type GhiDanhCuaLead, type PhanChia } from "./chia-khoan-theo-don";

export type MaBoQuaGan =
  | "KHONG_HOC_VIEN"
  | "KHONG_GHI_DANH"
  | "KHONG_KHOP"
  | "MO_HO"
  | "NGOAI_TAM"
  | "PHAI_TACH_DA_KHOA";

export type KhoaHoaDonCuaKhoan = { trangThai: string; so: string };

export type DongKeHoachGan =
  | { paymentId: string; soTien: number; ketQua: "GAN" | "TACH"; phan: PhanChia[] }
  | {
      paymentId: string;
      soTien: number;
      ketQua: "BO_QUA";
      ma: MaBoQuaGan;
      /** Phép chia ĐÃ THỬ (MO_HO / NGOAI_TAM / PHAI_TACH_DA_KHOA) — để màn nói bé nào, mấy phần. */
      phanThu: PhanChia[];
      khoaHoaDon: KhoaHoaDonCuaKhoan | null;
    };

export type KeHoachGan = {
  dong: DongKeHoachGan[];
  /** Có khoản ĐÃ XÁC NHẬN mà chưa gắn — tách tiền là sửa số đã đối soát ⇒ cả kế hoạch dừng. */
  chan: "CO_KHOAN_DA_XAC_NHAN_CHUA_GAN" | null;
};

export type GhiDanhUngVien = GhiDanhCuaLead & { centerId: string | null };

export type KhoanChuaGan = {
  id: string;
  amount: number;
  paymentType: string;
  accountantStatus: string;
  /** Số RÒNG (`soTienRong`) — dòng gốc đã bị đảo ra ≤ 0. */
  rong: number;
};

/**
 * Phép chia chỉ GẮN ghi danh, không đổi số tiền của dòng (một mảnh, đúng số cũ) — khoản đang khoá hoá
 * đơn chỉ được gắn trong ca này. MỘT định nghĩa cho cả đường convert (`payment.ts`) lẫn planner.
 */
export function giuNguyenTien(phan: readonly PhanChia[], soCu: number): boolean {
  return phan.length === 1 && phan[0]!.amount === soCu;
}

export function lapKeHoachGanGhiDanh(input: {
  /** Khoản ĐÃ GHI NHẬN, `enrollmentId` trống, của CẢ đơn. */
  khoan: readonly KhoanChuaGan[];
  dongDon: readonly DongDonCoHocVien[];
  ghiDanh: readonly GhiDanhUngVien[];
  /** Đơn có ít nhất một học viên liên quan (dòng đơn / đơn / SĐT phụ huynh). */
  coHocVien: boolean;
  /** Khoản đang nằm trong hoá đơn còn hiệu lực (`khoanDaKhoaHoaDon`). */
  daKhoa: ReadonlyMap<string, KhoaHoaDonCuaKhoan>;
  /**
   * Ghi danh ở cơ sở này có nằm trong phạm vi người bấm không. BẮT BUỘC, không mặc định (luật 7):
   * đường tự động truyền `() => true` CÓ CHỦ ĐÍCH, đường thủ công truyền phạm vi kế toán thật.
   */
  trongTam: (enrollmentCenterId: string | null) => boolean;
}): KeHoachGan {
  const khoan = input.khoan.filter((k) => k.paymentType === "PAYMENT" && k.amount > 0 && k.rong > 0);
  // So bằng `===` (không gõ literal điều kiện đọc — lưới `truc-a`): đây là CỔNG CHẶN, không phải
  // định nghĩa "đã xác nhận" để cộng tiền.
  const chan = khoan.some((k) => k.accountantStatus === "CONFIRMED") ? ("CO_KHOAN_DA_XAC_NHAN_CHUA_GAN" as const) : null;

  // Luật 2 — dòng đơn của một bé khai khoá nào thì chỉ giữ ghi danh của khoá đó (cho bé ấy).
  const khoaCuaHocVien = new Map<string, Set<string>>();
  for (const d of input.dongDon) {
    const hv = d.studentId?.trim();
    const kh = d.courseId?.trim();
    if (!hv || !kh) continue;
    const s = khoaCuaHocVien.get(hv) ?? new Set<string>();
    s.add(kh);
    khoaCuaHocVien.set(hv, s);
  }
  const ghiDanh = input.ghiDanh.filter((g) => {
    const khoa = khoaCuaHocVien.get(g.studentId);
    return !khoa || !g.courseId || khoa.has(g.courseId);
  });
  const theoId = new Map(input.ghiDanh.map((g) => [g.enrollmentId, g]));

  const dong: DongKeHoachGan[] = khoan.map((k) => {
    const khoaHoaDon = input.daKhoa.get(k.id) ?? null;
    const boQua = (ma: MaBoQuaGan, phanThu: PhanChia[] = []): DongKeHoachGan => ({
      paymentId: k.id,
      soTien: k.amount,
      ketQua: "BO_QUA",
      ma,
      phanThu,
      khoaHoaDon,
    });
    if (input.ghiDanh.length === 0) return boQua(input.coHocVien ? "KHONG_GHI_DANH" : "KHONG_HOC_VIEN");

    const { phan, duongLui } = chiaKhoanTheoDon(k.amount, input.dongDon, ghiDanh);
    // Đường lui (chia cho MỌI ghi danh theo giá) chỉ đúng lúc convert — ở đây là gắn bừa.
    if (duongLui || phan.length === 0) return boQua("KHONG_KHOP");

    const soPhanCuaBe = new Map<string, number>();
    for (const p of phan) {
      const hv = theoId.get(p.enrollmentId)?.studentId ?? "";
      soPhanCuaBe.set(hv, (soPhanCuaBe.get(hv) ?? 0) + 1);
    }
    if ([...soPhanCuaBe.values()].some((n) => n >= 2)) return boQua("MO_HO", phan);
    if (phan.some((p) => !input.trongTam(theoId.get(p.enrollmentId)?.centerId ?? null))) return boQua("NGOAI_TAM", phan);
    if (khoaHoaDon && !giuNguyenTien(phan, k.amount)) return boQua("PHAI_TACH_DA_KHOA", phan);

    return { paymentId: k.id, soTien: k.amount, ketQua: phan.length === 1 ? "GAN" : "TACH", phan };
  });

  return { dong, chan };
}

/**
 * Dấu của kế hoạch — CHỈ các dòng sẽ ghi (GAN / TACH), sắp theo khoản rồi theo ghi danh. Dòng bỏ qua
 * và thứ tự đầu vào không đổi dấu: chúng không đổi thứ sẽ được ghi.
 */
export function dauKeHoachGan(kh: KeHoachGan): string {
  const chuoi = kh.dong
    .filter((d): d is Extract<DongKeHoachGan, { ketQua: "GAN" | "TACH" }> => d.ketQua !== "BO_QUA")
    .map((d) => {
      const phan = [...d.phan]
        .sort((a, b) => a.enrollmentId.localeCompare(b.enrollmentId))
        .map((p) => `${p.enrollmentId}:${p.amount}`)
        .join(",");
      return `${d.paymentId}|${d.soTien}|${phan}`;
    })
    .sort()
    .join(";");
  return createHash("sha256").update(`${kh.chan ?? ""}#${chuoi}`).digest("hex");
}
