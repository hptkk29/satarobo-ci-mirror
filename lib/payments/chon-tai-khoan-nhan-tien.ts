// chon-tai-khoan-nhan-tien.ts — MỘT chỗ quyết định "mã QR của đơn này trỏ vào tài khoản nào".
//
// File THUẦN (không DB, không `server-only`): để test Vitest chạy không cần Postgres và để
// banner cảnh báo ở màn Phương thức thanh toán dùng CÙNG phép đếm với đường dựng QR.
//
// ───────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI — SỰ CỐ TÁI HIỆN 19/10/2026 (test.satarobo.vn, salecs2)
//
// Hai cơ sở là HAI PHÁP NHÂN (CS1 STEM Robotics & AI · CS2 New Vision). Cả hai phương thức
// `BANK_CS1` và `BANK_CS2` được khai là "Dùng chung" (centerId = NULL). Hệ quả đo thật:
//   (1) Sale CS2 thấy CẢ HAI trong ô "Phương thức thanh toán" và chọn "Chuyển khoản — CS1"
//       cho một đơn của CS2 — máy chủ nhận (phương thức dùng chung thì cơ sở nào cũng dùng
//       được: `methodServesCenter`). QR dựng ra trỏ vào tài khoản `26…041` của pháp nhân CS1.
//       TIỀN CỦA CS2 VỀ TÀI KHOẢN CS1.
//   (2) Đơn không chọn phương thức (mọi đơn convert lead) → bước "phương thức chuyển khoản
//       dùng chung" của bản cũ lấy dòng ĐẦU theo `displayOrder` — hai dòng cùng `displayOrder`
//       0 thì Postgres trả dòng nào cũng được. Tức là TÀI KHOẢN CỦA PHÁP NHÂN NÀO hiện ra là
//       ngẫu nhiên.
//
// Cổng gác ghi (`methodServesCenter` ở 5 Server Action) ĐÚNG khi phương thức có `centerId`.
// Cái hở là: hệ thống không có cách nào biết hai tài khoản "dùng chung" thuộc hai pháp nhân
// khác nhau, nên nó đoán — và đoán sai trên TIỀN thì không ai thấy cho tới khi đối soát.
//
// LUẬT NAY (hai vế, cả hai đều FAIL-CLOSED):
//   A. Phương thức đã chọn trên đơn chỉ được dùng khi nó PHỤC VỤ cơ sở của đơn
//      (`methodServesCenter`). Dòng cũ chọn phương thức của cơ sở khác → bỏ qua, rơi xuống B.
//   B. Không có phương thức riêng của cơ sở mà có ≥ 2 tài khoản dùng chung KHÁC NHAU →
//      KHÔNG ĐOÁN: trả `MO_HO`, người gọi không dựng QR. Thà báo "chưa dựng được QR" còn hơn
//      cho khách chuyển tiền vào nhầm pháp nhân.
// Một tài khoản dùng chung duy nhất (hoặc nhiều dòng trỏ CÙNG một tài khoản) vẫn dùng bình
// thường — đó là mô hình một pháp nhân.
// ───────────────────────────────────────────────────────────────────────────────

import { methodServesCenter } from "./method-scope";

/** Ba cột tài khoản trên một dòng `PaymentMethod` (loại chuyển khoản). */
export type TaiKhoanMethod = {
  /** null = DÙNG CHUNG mọi cơ sở. */
  centerId: string | null;
  bankBin: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
};

/** Trùng cấu trúc `PaymentConfig` của `vietqr.ts` — khai lại để file này không import server-only. */
export type TaiKhoanNhanTien = {
  bankBin: string;
  accountNumber: string;
  accountName: string;
};

export type KetQuaChonTaiKhoan =
  | {
      loai: "DA_CHON" | "CUA_CO_SO" | "DUNG_CHUNG";
      cfg: TaiKhoanNhanTien;
      /** Phương thức đã chọn trên đơn bị BỎ QUA vì thuộc cơ sở khác (dữ liệu cũ) — để nhật ký/test thấy. */
      boQuaDaChon: boolean;
    }
  | {
      loai: "MO_HO";
      /** Số tài khoản dùng chung KHÁC NHAU khiến không chọn được. */
      soTaiKhoan: number;
      boQuaDaChon: boolean;
    }
  | { loai: "KHONG_CO"; boQuaDaChon: boolean };

/** Ba mảnh đủ → cấu hình; thiếu một mảnh → null (không dựng QR hỏng). */
export function taiKhoanTuMethod(m: Pick<TaiKhoanMethod, "bankBin" | "bankAccountNumber" | "bankAccountName">): TaiKhoanNhanTien | null {
  if (!m.bankBin || !m.bankAccountNumber || !m.bankAccountName) return null;
  return { bankBin: m.bankBin, accountNumber: m.bankAccountNumber, accountName: m.bankAccountName };
}

const khoaTaiKhoan = (t: TaiKhoanNhanTien): string => `${t.bankBin.trim()}|${t.accountNumber.replace(/\s+/g, "")}`;

/** Các tài khoản dùng chung KHÁC NHAU (theo BIN + số), giữ thứ tự gặp đầu tiên. */
export function taiKhoanDungChungKhacNhau(
  methods: readonly TaiKhoanMethod[],
): TaiKhoanNhanTien[] {
  const seen = new Set<string>();
  const out: TaiKhoanNhanTien[] = [];
  for (const m of methods) {
    if (m.centerId !== null) continue;
    const t = taiKhoanTuMethod(m);
    if (!t) continue;
    const k = khoaTaiKhoan(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Chọn tài khoản nhận tiền cho một đơn.
 *
 * @param daChon      phương thức ĐÃ CHỌN trên đơn nếu nó là chuyển khoản; null nếu chưa chọn / không phải CK.
 * @param ungVien     mọi phương thức chuyển khoản ĐANG BẬT có centerId ∈ {cơ sở của đơn, null},
 *                    đã sắp: của cơ sở trước, rồi theo `displayOrder` tăng dần.
 */
export function chonTaiKhoanNhanTien(input: {
  orderCenterId: string | null | undefined;
  daChon: TaiKhoanMethod | null;
  ungVien: readonly TaiKhoanMethod[];
}): KetQuaChonTaiKhoan {
  const { orderCenterId, daChon, ungVien } = input;

  // A. phương thức đã chọn — chỉ khi nó phục vụ cơ sở của đơn.
  let boQuaDaChon = false;
  if (daChon) {
    if (methodServesCenter(daChon, orderCenterId)) {
      const cfg = taiKhoanTuMethod(daChon);
      if (cfg) return { loai: "DA_CHON", cfg, boQuaDaChon: false };
    } else {
      boQuaDaChon = true;
    }
  }

  // B1. phương thức chuyển khoản CỦA CHÍNH cơ sở đơn (đã sắp displayOrder).
  if (orderCenterId) {
    for (const m of ungVien) {
      if (m.centerId !== orderCenterId) continue;
      const cfg = taiKhoanTuMethod(m);
      if (cfg) return { loai: "CUA_CO_SO", cfg, boQuaDaChon };
    }
  }

  // B2. dùng chung — chỉ khi KHÔNG mơ hồ.
  const chung = taiKhoanDungChungKhacNhau(ungVien);
  if (chung.length === 1) return { loai: "DUNG_CHUNG", cfg: chung[0]!, boQuaDaChon };
  if (chung.length > 1) return { loai: "MO_HO", soTaiKhoan: chung.length, boQuaDaChon };
  return { loai: "KHONG_CO", boQuaDaChon };
}

/**
 * Cho banner ở màn Phương thức thanh toán: có ≥ 2 tài khoản dùng chung khác nhau đang BẬT không.
 * `isActive` do người gọi lọc trước — hàm này chỉ đếm.
 */
export function coTaiKhoanChungMoHo(methods: readonly TaiKhoanMethod[]): boolean {
  return taiKhoanDungChungKhacNhau(methods).length > 1;
}

/** Câu nói với người dùng khi `MO_HO` — dùng chung cho banner và (nếu cần) thông báo tại chỗ. */
export const CAU_TAI_KHOAN_CHUNG_MO_HO =
  "Đang có từ 2 tài khoản ngân hàng khác nhau được khai là «Dùng chung». Hệ thống không biết tài khoản nào thuộc pháp nhân nào nên KHÔNG dựng mã QR cho đơn chưa chọn phương thức. Sửa từng phương thức chuyển khoản, đặt «Cơ sở áp dụng» đúng cơ sở sở hữu tài khoản đó.";
