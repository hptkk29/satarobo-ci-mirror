// lib/finance/hoa-don/trang-thai-hoa-don.ts — MỘT DÒNG trên màn hoá đơn vẽ nút gì. THUẦN.
//
// Khuôn `lib/payments/qr-theo-dot.ts`: quyết định ở MỘT chỗ, component chỉ đọc kết quả. Luật 12:
// nút TẮT phải kèm câu lý do nói bằng ngôn ngữ của nguyên nhân — một nút chắc chắn bị từ chối mà
// không nói vì sao là lời hứa suông.
//
// ⚠️ Luật "Điều chỉnh sau GĐ 0" (PLAN §12): chốt hoá đơn KHÔNG phụ thuộc việc xác nhận được khoản
// thu. Đo prod 25/09: 22/31 khoản chờ thiếu ghi danh ⇒ nếu buộc xác nhận được khoản mới chốt được
// hoá đơn thì đa số lần thu kẹt. Khoản chưa xác nhận được và người mua thiếu thông tin chỉ là
// CẢNH BÁO (hoá đơn đã xuất ở MISA rồi — chủ dự án 26/09).

import { maskEmail } from "@/lib/utils";
import type { TrangThaiLanThu } from "./lan-thu";

export type NutTat = { bat: boolean; lyDo?: string };

/**
 * GĐ 8 — lối ra có chủ đích cho lần thu KHÔNG xác nhận thẳng được (kế toán chọn, bắt buộc lý do):
 *   · THEO_SO_DA_THU — lần thu THIẾU mà phụ huynh không trả nốt (Q-mở 1);
 *   · KHONG_TRUNG   — lần thu NGHI TRÙNG mà kế toán đã đối chiếu là KHÔNG trùng (quyết định (2) 27/09).
 * `daChon` = đã ghi lựa chọn đó lên hoá đơn; `cau` = câu hướng dẫn in cho kế toán.
 */
export type NgoaiLeLanThu = { loai: "THEO_SO_DA_THU" | "KHONG_TRUNG"; daChon: boolean; cau: string };

export type HanhDongDong = {
  taiPhieu: boolean;
  taiLen: NutTat;
  xacNhan: NutTat & { nhan?: string };
  khongXuat: boolean;
  ganThem: boolean;
  canhBao: string[];
  /** GĐ 8 — `null` khi lần thu không cần lối ra nào. */
  ngoaiLe: NgoaiLeLanThu | null;
};

/** Nhãn nút Xác nhận — nói đúng việc nút sẽ làm (gửi tới đâu, hay không gửi). */
export function nhanNutXacNhan(input: { emailNhan: string | null; guiEmailKhach: boolean }): string {
  if (!input.guiEmailKhach) return "Xác nhận (không gửi email)";
  if (!input.emailNhan) return "Xác nhận (khách không có email — báo sale gửi Zalo)";
  return `Xác nhận & gửi tới ${maskEmail(input.emailNhan)}`;
}

function tien(n: number): string {
  return `${n.toLocaleString("vi-VN")}đ`;
}

export function hanhDongChoDong(input: {
  lanThu: {
    trangThai: TrangThaiLanThu;
    thieu: number;
    nhanDot: string | null;
    canhBao: readonly string[];
    /** GĐ 8 — lý do nghi trùng (`LanThu.nghiTrungVi`); câu hướng dẫn nêu đúng bằng chứng. */
    nghiTrungVi: readonly ("DON_CO_CHUYEN_KHOAN" | "CHUA_KHOP_CUNG_SO")[];
  };
  /** Hoá đơn NHÁP đang giữ lần thu này (đã tải tệp), `null` nếu chưa tải gì. */
  hoaDonNhap: {
    coTepPdf: boolean;
    kyHieu: string | null;
    soHoaDon: string | null;
    ngayPhatHanh: Date | null;
  } | null;
  /** `payments:confirm` trên ĐÚNG cơ sở của đơn (đã giải — PLAN §9). */
  coQuyen: boolean;
  /** Kho tệp hoá đơn đã cấu hình (bucket riêng). */
  khoOk: boolean;
  emailNhan: string | null;
  guiEmailKhach: boolean;
  /** `thieuChoHoaDon(...).chan` — CHỈ cảnh báo. */
  thieuNguoiMua: readonly string[];
  /** Câu mô tả từng khoản không xác nhận được (thiếu ghi danh, tự ghi — AC5) — CHỈ cảnh báo. */
  khoanChuaXacNhanDuoc: readonly string[];
  /** Kế toán đã xác nhận "không trùng" (kèm lý do, ghi audit ở action). */
  boQuaNghiTrung: boolean;
  /** Kế toán đã chọn "xuất theo số đã thu" cho lần thu THIẾU (kèm lý do). */
  xuatTheoSoDaThu: boolean;
  /**
   * GĐ 8 — đơn đã huỷ / đã hoàn tiền. BẮT BUỘC: `chotHoaDon` từ chối đơn huỷ (DON_DA_HUY), nên mọi
   * nút ngoài "Không xuất" trên đơn huỷ đều là lời hứa suông (luật 12) — xét TRƯỚC đợt huỷ và kho.
   */
  donDaHuy: boolean;
  /**
   * 29/09 (Q1b) — `lyDoHoanChanXacNhan(yeuCauHoan của đơn)`: đơn có yêu cầu hoàn CHỜ / ĐÃ DUYỆT / ĐÃ CHI ⇒ nút
   * Xác nhận tắt với đúng câu mà `chotHoaDon` ném (cùng một hàm). Người gọi chỉ truyền cho dòng CHƯA
   * chốt (hàng chờ / nháp). BẮT BUỘC (luật 7).
   */
  hoanChan: string | null;
}): HanhDongDong {
  const canhBao = [
    ...input.lanThu.canhBao,
    ...(input.hoanChan ? [input.hoanChan] : []),
    ...input.khoanChuaXacNhanDuoc,
    ...(input.thieuNguoiMua.length > 0
      ? [`Hồ sơ trên hệ thống còn thiếu: ${input.thieuNguoiMua.join(", ")} — không chặn, hoá đơn đã xuất ở MISA`]
      : []),
  ];

  if (!input.coQuyen) {
    const lyDo = "Cần quyền payments:confirm tại cơ sở của đơn — hỏi Quản trị hệ thống";
    return {
      taiPhieu: false,
      taiLen: { bat: false, lyDo },
      xacNhan: { bat: false, lyDo },
      khongXuat: false,
      ganThem: false,
      canhBao,
      ngoaiLe: null,
    };
  }

  const { trangThai, thieu, nhanDot } = input.lanThu;
  const ganThem = trangThai === "THIEU";

  if (input.donDaHuy) {
    const lyDo = input.hoaDonNhap
      ? "Đơn đã huỷ / đã hoàn tiền — không xác nhận hoá đơn được: gỡ bản nháp rồi chọn 'Không xuất'"
      : "Đơn đã huỷ / đã hoàn tiền — không xuất hoá đơn cho lần thu này: chọn 'Không xuất' (hoặc 'Đã xuất ngoài hệ thống')";
    return { taiPhieu: true, taiLen: { bat: false, lyDo }, xacNhan: { bat: false, lyDo }, khongXuat: true, ganThem: false, canhBao, ngoaiLe: null };
  }

  if (trangThai === "DOT_HUY") {
    const lyDo = "Đợt của lần thu này đã bị huỷ — chọn 'Không xuất' hoặc xử lý hoàn tiền";
    return { taiPhieu: true, taiLen: { bat: false, lyDo }, xacNhan: { bat: false, lyDo }, khongXuat: true, ganThem: false, canhBao, ngoaiLe: null };
  }

  // GĐ 8 — lối ra có chủ đích: tính MỘT lần, dùng cho cả câu tắt nút lẫn khối trên màn.
  const vi = input.lanThu.nghiTrungVi;
  const bangChung = [
    vi.includes("DON_CO_CHUYEN_KHOAN") && "cùng đơn có khoản chuyển khoản",
    vi.includes("CHUA_KHOP_CUNG_SO") && "có giao dịch chưa khớp cùng số tiền",
  ].filter(Boolean).join(" và ");
  const ngoaiLe: NgoaiLeLanThu | null =
    trangThai === "NGHI_TRUNG"
      ? {
          loai: "KHONG_TRUNG",
          daChon: input.boQuaNghiTrung,
          cau: input.hoaDonNhap
            ? `Khoản khai tay có thể trùng tiền đã về (${bangChung || "nghi trùng"}). Đã đối chiếu là KHÔNG trùng ⇒ bấm "Không trùng — vẫn xuất" và ghi lý do (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự). Trùng ⇒ gỡ bản nháp rồi từ chối khoản khai tay ở màn Thanh toán.`
            : `Khoản khai tay có thể trùng tiền đã về (${bangChung || "nghi trùng"}). Trùng ⇒ từ chối khoản khai tay ở màn Thanh toán. Không trùng ⇒ tải hoá đơn lên rồi bấm "Không trùng — vẫn xuất" (lý do ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự).`,
        }
      : trangThai === "THIEU"
        ? {
            loai: "THEO_SO_DA_THU",
            daChon: input.xuatTheoSoDaThu,
            cau: `Thiếu ${tien(thieu)} so với ${nhanDot ?? "đợt"}. Chờ phụ huynh chuyển nốt, hoặc tick "Xuất theo số đã thu" khi tải hoá đơn lên (lý do ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự).`,
          }
        : null;

  const taiLen: NutTat = input.khoOk
    ? { bat: true }
    : { bat: false, lyDo: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  const tat = (lyDo: string): HanhDongDong => ({
    taiPhieu: true,
    taiLen,
    xacNhan: { bat: false, lyDo },
    khongXuat: true,
    ganThem,
    canhBao,
    ngoaiLe,
  });

  if (!input.khoOk) return tat(taiLen.lyDo!);
  if (ngoaiLe && !ngoaiLe.daChon) return tat(ngoaiLe.cau);
  const nhap = input.hoaDonNhap;
  if (!nhap || !nhap.coTepPdf) return tat("Chưa tải tệp PDF hoá đơn lên");
  const thieuO = [
    !nhap.kyHieu && "ký hiệu",
    !nhap.soHoaDon && "số hoá đơn",
    !nhap.ngayPhatHanh && "ngày phát hành",
  ].filter(Boolean);
  if (thieuO.length > 0) return tat(`Còn thiếu ${thieuO.join(", ")}`);
  // Q1b — xét SAU các ô còn thiếu: tờ chưa đủ thì việc trước mắt là điền cho đủ (câu hoàn vẫn nằm ở
  // cảnh báo); đủ rồi thì đây là thứ duy nhất còn chặn — và `chotHoaDon` chặn đúng câu này.
  if (input.hoanChan) return tat(input.hoanChan);

  return {
    taiPhieu: true,
    taiLen,
    xacNhan: { bat: true, nhan: nhanNutXacNhan(input) },
    khongXuat: true,
    ganThem,
    canhBao,
    ngoaiLe,
  };
}

/**
 * Độ dài tối thiểu của lý do cho BA thao tác GĐ 8 — huỷ hoá đơn, "không trùng — vẫn xuất", "xuất theo
 * số đã thu". MỘT hằng cho cả ba (thiết kế 27/09: ba bản đề xuất lệch 5 và 10). DB chỉ chặn rỗng; độ
 * dài ở đây. Lý do "Khác…" của "Không xuất" (GĐ 4) giữ luật cũ 5 ký tự.
 */
export const TOI_THIEU_LY_DO_HOA_DON = 10;

/**
 * Nút "Huỷ hoá đơn" (quyết định (1) 27/09): CHỈ bản ĐÃ XÁC NHẬN. Bản nháp có "Gỡ bản nháp", bản không
 * xuất có "Gỡ dấu" — hai đường đó đã có từ GĐ 4. Không quyền ⇒ tắt KÈM lý do (luật 12); trạng thái khác
 * ⇒ tắt KHÔNG lý do (không có gì để huỷ, không vẽ nút).
 */
/**
 * GĐ 8 bước 11 — nút "Gửi lại email" / "Gửi email cho khách" của hoá đơn ĐÃ XÁC NHẬN. Thứ tự kiểm là
 * thứ tự nguyên nhân: không phải bản đã xác nhận → thiếu quyền → kho chưa sống (tệp đính kèm ký từ
 * kho) → còn lượt đang chạy (gửi lúc này là gửi đôi) → không có email nào để gửi → sáng.
 * `dangChay` do người gọi tính bằng `luotDangChay` — cùng luật nhãn trạng thái (`[TTE-02]`).
 */
export function hanhDongGuiLai(input: {
  trangThaiHoaDon: string | null;
  coQuyen: boolean;
  khoOk: boolean;
  dangChay: boolean;
  coLuot: boolean;
  emailNhan: string | null;
  emailDon: string | null;
}): NutTat & { nhan: string } {
  const nhan = input.coLuot ? "Gửi lại email" : "Gửi email cho khách";
  const tat = (lyDo: string) => ({ bat: false, lyDo, nhan });
  if (input.trangThaiHoaDon !== "DA_XAC_NHAN") return tat("Chỉ gửi được hoá đơn đã xác nhận");
  if (!input.coQuyen) return tat("Cần quyền payments:confirm tại cơ sở của đơn — hỏi Quản trị hệ thống");
  if (!input.khoOk) return tat("Kho lưu hoá đơn chưa cấu hình — báo người vận hành");
  if (input.dangChay) return tat("Lượt gửi trước còn đang chạy — đợi kết quả rồi hãy gửi lại");
  if (!input.emailNhan?.trim() && !input.emailDon?.trim()) {
    return tat("Khách chưa có email — cập nhật email nhận hoá đơn trên đơn trước");
  }
  return { bat: true, nhan };
}

export function nutHuyHoaDon(input: { trangThaiHoaDon: string | null; coQuyen: boolean }): NutTat {
  if (input.trangThaiHoaDon !== "DA_XAC_NHAN") return { bat: false };
  if (!input.coQuyen) {
    return { bat: false, lyDo: "Cần quyền payments:confirm tại cơ sở của đơn — hỏi Quản trị hệ thống" };
  }
  return { bat: true };
}
