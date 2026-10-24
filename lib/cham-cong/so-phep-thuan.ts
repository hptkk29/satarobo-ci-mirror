// lib/cham-cong/so-phep-thuan.ts — phần THUẦN của SỔ PHÉP NĂM (P2.1A, 11/10/2026). Không chạm DB.
//
// Sổ phép theo khuôn sổ nghỉ bù (`nghi-bu.ts`): LEDGER theo PHÚT, mỗi dòng một biến động có dấu, số dư
// = Σ minutes trong (người × loại nghỉ × năm phép). Đường ghi + khoá ở `so-phep.ts`.
//
// ⚠️ CHÍNH SÁCH CHƯA CHỐT (Q-6/Q-7, `docs/cham-cong/KE-HOACH-DON-TU-THEO-BA.md`): file này KHÔNG chứa
// con số chính sách nào (12 ngày, +1/tháng, chuyển năm…). Nó chỉ biết cộng trừ và soát chuỗi.

export const LOAI_BUT_TOAN_PHEP = [
  "OPENING",
  "ACCRUAL",
  "CARRY_OVER",
  "LEAVE_USED",
  "LEAVE_REFUND",
  "MANUAL_ADJUSTMENT",
  "EXPIRY",
] as const;
export type LoaiButToanPhep = (typeof LOAI_BUT_TOAN_PHEP)[number];

/** Bút toán nào CHỈ được mang dấu nào. `MANUAL_ADJUSTMENT` hai chiều. */
const DAU: Record<LoaiButToanPhep, "+" | "-" | "±"> = {
  OPENING: "+",
  ACCRUAL: "+",
  CARRY_OVER: "+",
  LEAVE_USED: "-",
  LEAVE_REFUND: "+",
  MANUAL_ADJUSTMENT: "±",
  EXPIRY: "-",
};

/** Kiểm dấu + số nguyên khác 0. Trả câu lỗi, hoặc null nếu hợp lệ. */
export function loiButToan(loai: LoaiButToanPhep, phut: number): string | null {
  if (!Number.isInteger(phut) || phut === 0) return "Số phút phải là số nguyên khác 0";
  const d = DAU[loai];
  if (d === "+" && phut < 0) return `Bút toán ${loai} phải là số dương`;
  if (d === "-" && phut > 0) return `Bút toán ${loai} phải là số âm`;
  return null;
}

/** Năm phép của một ngày `@db.Date` (nửa đêm UTC). Năm dương lịch — Q-2 chưa chốt, đổi ở đúng chỗ này. */
export const namPhep = (ngay: Date): number => ngay.getUTCFullYear();

/**
 * Nghỉ CẢ NGÀY trừ bao nhiêu phút, chia theo năm phép. Chỉ ngày mà ô ca TRƯỚC khi ghi P là ngày LÀM
 * VIỆC mới trừ (ngày nghỉ tuần / đã là ô nghỉ / chưa xếp ca thì không) — "12 ngày LÀM VIỆC", không phải
 * ngày lịch (`SR.QD.200.003`). Ngày chưa xếp ca được ĐẾM RIÊNG để màn duyệt nói ra, không đoán.
 */
export function phutTruCaNgay(
  ngay: readonly { ngay: Date; laNgayLamViec: boolean }[],
  phutMotNgay: number,
): { theoNam: Map<number, number>; soNgayTru: number } {
  const theoNam = new Map<number, number>();
  let soNgayTru = 0;
  for (const n of ngay) {
    if (!n.laNgayLamViec) continue;
    soNgayTru++;
    const y = namPhep(n.ngay);
    theoNam.set(y, (theoNam.get(y) ?? 0) + phutMotNgay);
  }
  return { theoNam, soNgayTru };
}

export type DongSo = {
  id: string;
  userId: string;
  leaveTypeId: string;
  year: number;
  minutes: number;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
};

export type LechSo =
  | { loai: "DUT_CHUOI"; id: string; mongDoi: number; thucTe: number }
  | { loai: "SAI_CONG"; id: string; mongDoi: number; thucTe: number }
  | { loai: "AM"; userId: string; leaveTypeId: string; year: number; soDu: number };

/**
 * ĐỐI SOÁT chuỗi số dư — KHÔNG sửa gì, chỉ báo. Trong từng (người × loại × năm), theo thứ tự ghi:
 *   · `balanceBefore` của dòng phải bằng `balanceAfter` của dòng ngay trước (dòng đầu: 0) — DUT_CHUOI;
 *   · `balanceAfter = balanceBefore + minutes` — SAI_CONG;
 *   · số dư cuối (Σ minutes) âm mà chính sách không cho — AM (chỉ báo khi `choAm = false`).
 * Lệch chuỗi nghĩa là có đường ghi ĐI VÒNG khoá (SQL tay, bản sao dữ liệu…) — xử lý bằng bút toán
 * điều chỉnh có lý do, không bao giờ ghi đè lịch sử.
 */
export function doiSoatChuoi(rows: readonly DongSo[], choAm: boolean): LechSo[] {
  const out: LechSo[] = [];
  const nhom = new Map<string, DongSo[]>();
  for (const r of rows) {
    const k = `${r.userId}|${r.leaveTypeId}|${r.year}`;
    const arr = nhom.get(k) ?? [];
    arr.push(r);
    nhom.set(k, arr);
  }
  for (const arr of nhom.values()) {
    arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    let truoc = 0;
    for (const r of arr) {
      if (r.balanceBefore !== truoc) out.push({ loai: "DUT_CHUOI", id: r.id, mongDoi: truoc, thucTe: r.balanceBefore });
      if (r.balanceAfter !== r.balanceBefore + r.minutes) {
        out.push({ loai: "SAI_CONG", id: r.id, mongDoi: r.balanceBefore + r.minutes, thucTe: r.balanceAfter });
      }
      truoc = r.balanceAfter;
    }
    const tong = arr.reduce((s, r) => s + r.minutes, 0);
    if (!choAm && tong < 0) out.push({ loai: "AM", userId: arr[0]!.userId, leaveTypeId: arr[0]!.leaveTypeId, year: arr[0]!.year, soDu: tong });
  }
  return out;
}

/** Phút ⇒ "1,5 ngày" theo số phút một ngày công đang cấu hình. Âm giữ dấu "−". */
export function nhanNgayPhep(phut: number, phutMotNgay: number): string {
  const ngay = Math.abs(phut) / phutMotNgay;
  const so = (Math.round(ngay * 100) / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  return `${phut < 0 ? "−" : ""}${so} ngày`;
}
