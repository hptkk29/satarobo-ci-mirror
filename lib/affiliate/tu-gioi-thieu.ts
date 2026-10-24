// lib/affiliate/tu-gioi-thieu.ts — «TỰ GIỚI THIỆU»: người giới thiệu và khách có phải CÙNG MỘT NGƯỜI không. THUẦN.
//
// Đặc tả Affiliate §51–§52: `allowSelfReferral = false` (mặc định) KHÔNG chỉ so `User.id` — một nhân viên giới thiệu chính SĐT của mình qua form khách, hay
// một phụ huynh dùng email của mình, đều là tự giới thiệu. Vì vậy so theo NHIỀU căn cứ: tài khoản, nhân viên, SĐT chuẩn hoá, email.
//
// Hàm trả CĂN CỨ đã khớp (không chỉ true/false) để màn xem tay nói được «vì sao» và để audit lưu lại; mọi căn cứ đã khớp được liệt kê, không dừng ở căn cứ đầu.
// `allowSelfReferral = true` ⇒ không chặn, nhưng căn cứ vẫn được trả để ghi vào bằng chứng (campaign cho phép ≠ không cần biết).
//
// SĐT so qua `canonicalPhone` (cùng chuẩn của chống trùng lead — `0xxx`/`84xxx`/`+84xxx` quy về một khoá). SĐT KHÔNG chuẩn hoá được (số bàn, chuỗi rác, "N/A") KHÔNG phải căn cứ:
// dùng `phoneKey` (rơi về chuỗi thô) thì hai ô rác giống nhau thành «cùng một người». Email so không phân biệt hoa thường, sau trim.
import { canonicalPhone } from "@/lib/phone";

export type DanhTinhSoSanh = {
  userId?: string | null;
  employeeId?: string | null;
  /** SĐT thô (mọi dạng) — hàm tự chuẩn hoá. */
  phones?: readonly (string | null | undefined)[];
  emails?: readonly (string | null | undefined)[];
};

export type CanCuTuGioiThieu = "TAI_KHOAN" | "NHAN_VIEN" | "SDT" | "EMAIL";

const emailKey = (e: string | null | undefined): string | null => {
  const t = (e ?? "").trim().toLowerCase();
  return t.includes("@") ? t : null;
};

const giao = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/** Các căn cứ cho thấy `doiTac` và `khach` là cùng một người. Rỗng = không thấy dấu hiệu tự giới thiệu. */
export function canCuTuGioiThieu(doiTac: DanhTinhSoSanh, khach: DanhTinhSoSanh): CanCuTuGioiThieu[] {
  const ra: CanCuTuGioiThieu[] = [];
  if (doiTac.userId && khach.userId && doiTac.userId === khach.userId) ra.push("TAI_KHOAN");
  if (doiTac.employeeId && khach.employeeId && doiTac.employeeId === khach.employeeId) ra.push("NHAN_VIEN");

  const sdt = (d: DanhTinhSoSanh) => new Set((d.phones ?? []).map((p) => canonicalPhone(p)).filter((k): k is string => k !== null));
  if (giao(sdt(doiTac), sdt(khach))) ra.push("SDT");

  const em = (d: DanhTinhSoSanh) => new Set((d.emails ?? []).map(emailKey).filter((k): k is string => k !== null));
  if (giao(em(doiTac), em(khach))) ra.push("EMAIL");
  return ra;
}

export type KetQuaTuGioiThieu = { chan: boolean; canCu: readonly CanCuTuGioiThieu[] };

/** `chan` = có căn cứ ∧ campaign KHÔNG cho phép tự giới thiệu. */
export function kiemTuGioiThieu(doiTac: DanhTinhSoSanh, khach: DanhTinhSoSanh, allowSelfReferral: boolean): KetQuaTuGioiThieu {
  const canCu = canCuTuGioiThieu(doiTac, khach);
  return { chan: canCu.length > 0 && !allowSelfReferral, canCu };
}
