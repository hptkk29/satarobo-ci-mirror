// lib/portal/hv-dieu-huong.ts — Cổng học sinh: chuẩn hoá đường dẫn + mục đang mở + nhãn. THUẦN (không DB) để test được.

export type MucHv = "homnay" | "lich" | "hanhtrinh" | "baitap" | "sanpham" | "danhgia" | "thongbao" | "them" | "thoat" | "khac";

const GOC = "/portal/hoc-sinh";

/**
 * Trên host hocvien.* middleware REWRITE "/x" → /portal/x nhưng URL trình duyệt giữ nguyên ⇒ `usePathname()` trả "/hoc-sinh/lich"
 * (thiếu tiền tố /portal). Chuẩn hoá trước khi so, nếu không không mục nào sáng.
 */
export function chuanHoaDuongDan(pathname: string): string {
  const p = pathname === "/" ? "/portal" : pathname.startsWith("/portal") ? pathname : `/portal${pathname}`;
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/**
 * Hai màn của BA MẸ nằm dưới `/portal/hoc-sinh/` (nhóm route `(ba-me)`): «Cho con vào» và «Mã thoát». Chúng là màn của PHỤ HUYNH
 * (chưa vào chế độ học sinh) nên phải vẽ trong vỏ phụ huynh — không phải vỏ học sinh cũ mà mọi đường dẫn `/portal/hoc-sinh/*` khác dùng.
 * Danh sách này phải khớp thư mục `app/(portal)/portal/hoc-sinh/(ba-me)/` (lưới `[HVK-04]` canh).
 */
export const NHANH_BA_ME_TRONG_HOC_SINH = [`${GOC}/vao`, `${GOC}/ma`] as const;

/** Đường dẫn có phải màn của ba mẹ nằm dưới /portal/hoc-sinh không (khớp theo ĐOẠN; chuẩn hoá tiền tố /portal trước). */
export function laManBaMeTrongHocSinh(pathname: string): boolean {
  const p = chuanHoaDuongDan(pathname.split(/[?#]/)[0] ?? "");
  return NHANH_BA_ME_TRONG_HOC_SINH.some((n) => p === n || p.startsWith(`${n}/`));
}

const BANG: { tien: string; muc: MucHv }[] = [
  { tien: `${GOC}/lich`, muc: "lich" },
  { tien: `${GOC}/buoi-hoc`, muc: "lich" },
  { tien: `${GOC}/hanh-trinh`, muc: "hanhtrinh" },
  { tien: `${GOC}/bai-tap`, muc: "baitap" },
  { tien: `${GOC}/bai-thi`, muc: "baitap" },
  { tien: `${GOC}/san-pham`, muc: "sanpham" },
  { tien: `${GOC}/danh-gia-gv`, muc: "danhgia" },
  { tien: `${GOC}/thong-bao`, muc: "thongbao" },
  { tien: `${GOC}/them`, muc: "them" },
  { tien: `${GOC}/thoat`, muc: "thoat" },
];

/** Mục của Cổng học sinh mà đường dẫn thuộc về; `homnay` chỉ khi KHỚP CHÍNH XÁC trang gốc. */
export function mucDangMo(pathname: string): MucHv {
  const p = chuanHoaDuongDan(pathname);
  if (p === GOC) return "homnay";
  for (const b of BANG) if (p === b.tien || p.startsWith(`${b.tien}/`)) return b.muc;
  return "khac";
}

const TIEU_DE: Record<MucHv, string> = {
  homnay: "Hôm nay",
  lich: "Lịch học",
  hanhtrinh: "Hành trình & huy hiệu",
  baitap: "Bài tập & bài thi",
  sanpham: "Sản phẩm & tính cách",
  danhgia: "Đánh giá thầy cô",
  thongbao: "Tin mới cho em",
  them: "Thêm",
  thoat: "",
  khac: "Cổng học sinh",
};

/** Tiêu đề trên thanh trên của điện thoại (theo các board M-HV-*). */
export function tieuDeThanhTren(muc: MucHv): string {
  return TIEU_DE[muc];
}

/** 1260 ⇒ "1.260" (dấu chấm hàng nghìn kiểu VN, KHÔNG phụ thuộc ICU của máy chạy). */
export function dinhDangSoCoin(n: number): string {
  const so = Math.trunc(Number.isFinite(n) ? n : 0);
  const dau = so < 0 ? "-" : "";
  return dau + String(Math.abs(so)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Tên rút gọn cho avatar: hai chữ cuối (Nguyễn Bảo An ⇒ "BA"); tên một chữ ⇒ một chữ. */
export function chuVietTat(ten: string): string {
  const w = ten
    .trim()
    .split(/\s+/)
    .filter((x) => /\p{L}/u.test(x[0] ?? ""));
  const hai = w.slice(-2).map((x) => x[0] ?? "");
  return (hai.join("") || "HS").toLocaleUpperCase("vi");
}

/** Màu avatar ổn định theo id con (ba màu của bảng thiết kế). */
export function mauAvatarTheoId(id: string): 0 | 1 | 2 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 3) as 0 | 1 | 2;
}

/**
 * Xưng hô với giáo viên. Hệ thống KHÔNG lưu giới tính giáo viên ở nơi cổng học sinh đọc được (artifact viết "thầy"/"cô" theo
 * mẫu), nên đoán theo tên là đoán sai thẳng vào mặt em nhỏ. Dùng cách gọi trung tính, đúng với mọi lớp.
 */
export const XUNG_GV = "thầy cô";
export const XUNG_GV_HOA = "Thầy cô";

/** Tên gọi thân mật: hai chữ cuối ("Nguyễn Bảo An" ⇒ "Bảo An"); tên 1–2 chữ giữ nguyên. */
export function tenGoi(ten: string): string {
  const w = ten.trim().split(/\s+/).filter(Boolean);
  return w.length <= 2 ? w.join(" ") : w.slice(-2).join(" ");
}
