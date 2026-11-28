import { phanNhom, soNgayTre, type DongBaoCao, type NhomTuanThu } from "@/lib/elearning/report-compliance";

/**
 * P7 — "NGƯỜI HỌC" (nhân viên): GOM tiến độ theo TỪNG NGƯỜI (đề xuất mới của thiết kế 20/11: `QtNguoiHoc`, `QtNguoiHocChiTiet`). THUẦN — không DB.
 *
 * ⚠️ KHÔNG đặt công thức KPI mới: mọi nhóm trạng thái đi qua `phanNhom` của báo cáo tuân thủ R1 (một nguồn — màn người học và báo cáo R1 không thể
 * nói hai điều khác nhau về cùng một lượt học). Chỉ thêm HAI định nghĩa mà thiết kế cần và R1 chưa có, ghi rõ ở đây để Đào tạo duyệt:
 *   · "ĐANG TRỄ" = lượt CHƯA hoàn thành (không thu hồi, không tạm dừng, không công nhận tương đương, chưa `COMPLETED*`) mà hạn GỐC đã qua.
 *     (R1 `TRE` là "hoàn thành TRỄ" — đã xong; hai khái niệm khác nhau, không được lẫn.)
 *   · "BẮT BUỘC ĐÃ ĐẠT x/y" = trong các lượt BẮT BUỘC còn hiệu lực (không thu hồi, không tạm dừng): y = số lượt, x = số lượt đã hoàn thành
 *     (đúng hạn, trễ, hoặc công nhận tương đương). Công nhận tương đương được tính là ĐẠT nhưng R1 vẫn tách nhãn riêng ở báo cáo.
 */

export type DongNguoiHoc = DongBaoCao & {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  isMandatory: boolean;
  jobTitle: string;
  centerId: string;
  /** Mã cơ sở (CS1, CS2…) hiển thị ở cột "Cơ sở"; rỗng nếu không tra được. BẮT BUỘC khai (luật 7). */
  coSoMa: string;
  dueAt: Date | null;
};

const HOAN_THANH: ReadonlySet<NhomTuanThu> = new Set(["DUNG_HAN", "TRE", "TUONG_DUONG"]);
/** Nhóm "còn nghĩa vụ phải học" — mẫu số của "đang trễ". */
const CON_PHAI_HOC: ReadonlySet<NhomTuanThu> = new Set(["DANG_HOC", "CHUA_HOC"]);

export function dangTre(d: DongBaoCao, now: Date): boolean {
  if (!d.dueAtOriginal) return false;
  if (!CON_PHAI_HOC.has(phanNhom(d))) return false;
  return d.dueAtOriginal.getTime() < now.getTime();
}

/** Lượt này còn nghĩa vụ học (chưa xong, không thu hồi, không tạm dừng, không tương đương). */
export const conPhaiHoc = (d: DongBaoCao): boolean => CON_PHAI_HOC.has(phanNhom(d));

export type TrangThaiLuotHoc = "DAT_DUNG_HAN" | "DAT_TRE" | "TUONG_DUONG" | "DANG_HOC" | "CHUA_BAT_DAU" | "DANG_TRE" | "TAM_DUNG" | "THU_HOI";

/** Nhãn một lượt học cho bảng chi tiết — suy từ `phanNhom` + `dangTre` (không có logic riêng). */
export function trangThaiLuot(d: DongBaoCao, now: Date): TrangThaiLuotHoc {
  const n = phanNhom(d);
  if (n === "THU_HOI") return "THU_HOI";
  if (n === "TAM_DUNG") return "TAM_DUNG";
  if (n === "DUNG_HAN") return "DAT_DUNG_HAN";
  if (n === "TRE") return "DAT_TRE";
  if (n === "TUONG_DUONG") return "TUONG_DUONG";
  if (dangTre(d, now)) return "DANG_TRE";
  return n === "DANG_HOC" ? "DANG_HOC" : "CHUA_BAT_DAU";
}

export type TomTatNguoiHoc = {
  userId: string;
  ten: string;
  ma: string;
  vaiTro: string;
  phong: string | null;
  /** Cơ sở của lượt MỚI NHẤT (mã). */
  coSo: string;
  soLuot: number;
  batBuoc: number;
  batBuocDat: number;
  /** Số lượt BẮT BUỘC còn hiệu lực đang học dở (IN_PROGRESS) — lỗ viền của chuỗi chấm. */
  batBuocDangHoc: number;
  /** Lượt đang trễ NẶNG NHẤT (nhiều ngày nhất) — chữ "An toàn điện · 5 ngày" ở cột "Đang trễ". */
  treNhat: { khoa: string; ngay: number } | null;
  dangTre: number;
  chuaBatDau: number;
  /** Số ngày trễ NHIỀU NHẤT trong các lượt đang trễ (so với hạn gốc); 0 nếu không trễ. */
  treNhieuNhat: number;
  canChuY: boolean;
};

export function tomTatMotNguoi(ds: readonly DongNguoiHoc[], now: Date): TomTatNguoiHoc {
  const dau = ds[0]!;
  // Hồ sơ mới nhất (danh sách đã xếp mới → cũ) quyết vai trò/phòng hiển thị; ảnh chụp từng lượt vẫn nằm trên từng dòng.
  let batBuoc = 0;
  let batBuocDat = 0;
  let batBuocDangHoc = 0;
  let tre = 0;
  let chua = 0;
  let treNhieuNhat = 0;
  let treNhat: { khoa: string; ngay: number } | null = null;
  for (const d of ds) {
    const n = phanNhom(d);
    const conHieuLuc = n !== "THU_HOI" && n !== "TAM_DUNG";
    if (d.isMandatory && conHieuLuc) {
      batBuoc++;
      if (HOAN_THANH.has(n)) batBuocDat++;
      else if (n === "DANG_HOC") batBuocDangHoc++;
    }
    if (dangTre(d, now)) {
      tre++;
      const ngay = soNgayTre(d, now) ?? 0;
      treNhieuNhat = Math.max(treNhieuNhat, ngay);
      if (!treNhat || ngay > treNhat.ngay) treNhat = { khoa: d.courseTitle, ngay };
    }
    if (n === "CHUA_HOC") chua++;
  }
  return {
    userId: dau.userId,
    ten: dau.fullName,
    ma: dau.employeeCode,
    vaiTro: dau.jobTitle,
    phong: dau.departmentName,
    coSo: dau.coSoMa,
    soLuot: ds.length,
    batBuoc,
    batBuocDat,
    batBuocDangHoc,
    treNhat,
    dangTre: tre,
    chuaBatDau: chua,
    treNhieuNhat,
    canChuY: tre > 0,
  };
}

/** Gom theo người. Sắp: CẦN CHÚ Ý trước (trễ nhiều ngày nhất trước), rồi theo tên. Đầu vào phải xếp MỚI → CŨ. */
export function gomTheoNguoi(ds: readonly DongNguoiHoc[], now: Date): TomTatNguoiHoc[] {
  const nhom = new Map<string, DongNguoiHoc[]>();
  for (const d of ds) {
    const a = nhom.get(d.userId);
    if (a) a.push(d);
    else nhom.set(d.userId, [d]);
  }
  return [...nhom.values()]
    .map((x) => tomTatMotNguoi(x, now))
    .sort((a, b) => Number(b.canChuY) - Number(a.canChuY) || b.treNhieuNhat - a.treNhieuNhat || a.ten.localeCompare(b.ten, "vi"));
}

/** Lọc theo ô tìm (tên hoặc mã nhân viên, không phân biệt hoa/thường/dấu) và cờ "cần chú ý". */
export const boDau = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
export function locNguoiHoc(ds: readonly TomTatNguoiHoc[], opts: { q?: string; chiCanChuY?: boolean; coSo?: string; vaiTro?: string }): TomTatNguoiHoc[] {
  const q = boDau((opts.q ?? "").trim());
  return ds.filter(
    (x) =>
      (!opts.chiCanChuY || x.canChuY) &&
      (!opts.coSo || x.coSo === opts.coSo) &&
      (!opts.vaiTro || x.vaiTro === opts.vaiTro) &&
      (q === "" || boDau(x.ten).includes(q) || boDau(x.ma).includes(q)),
  );
}

/** Giá trị riêng biệt của một cột (cho ô chọn lọc) — sắp theo tiếng Việt, bỏ rỗng. */
export function giaTriRiengBiet(ds: readonly TomTatNguoiHoc[], cot: "coSo" | "vaiTro"): string[] {
  return [...new Set(ds.map((x) => x[cot]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
}

/** Chữ ở cột "Đang trễ": khoá trễ nặng nhất + số ngày; không trễ thì "—" (hoặc "Chưa bắt đầu" khi người đó chưa mở lượt nào). */
export function chuDangTre(t: Pick<TomTatNguoiHoc, "treNhat" | "dangTre" | "soLuot" | "chuaBatDau">): { chu: string; sac: "danger" | "warning" | "muted" } {
  if (t.treNhat) return { chu: t.dangTre > 1 ? `${t.treNhat.khoa} · ${t.treNhat.ngay} ngày (+${t.dangTre - 1} khoá)` : `${t.treNhat.khoa} · ${t.treNhat.ngay} ngày`, sac: "danger" };
  if (t.soLuot > 0 && t.chuaBatDau === t.soLuot) return { chu: "Chưa bắt đầu", sac: "warning" };
  return { chu: "—", sac: "muted" };
}

/** Chữ viết tắt cho avatar: chữ đầu của HAI TỪ CUỐI của tên — "Phạm Thu Trang" ⇒ "TT", "Lý Ngọc Hân" ⇒ "NH" (đúng thiết kế). */
export function chuVietTat(ten: string): string {
  const w = ten.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "?";
  if (w.length === 1) return w[0]!.slice(0, 2).toUpperCase();
  return (w[w.length - 2]![0]! + w[w.length - 1]![0]!).toUpperCase();
}

/** Bảng xuất Excel: một dòng/người. Cột cố định; KHÔNG có số điện thoại/email. */
export const COT_XUAT_NGUOI_HOC = ["Mã NV", "Họ tên", "Vai trò", "Phòng", "Cơ sở", "Số lượt giao", "Bắt buộc", "Bắt buộc đã đạt", "Đang trễ (lượt)", "Trễ nhiều nhất (ngày)", "Khoá trễ nhất", "Chưa bắt đầu"] as const;
export function dongXuatNguoiHoc(t: TomTatNguoiHoc): (string | number)[] {
  return [t.ma, t.ten, t.vaiTro, t.phong ?? "", t.coSo, t.soLuot, t.batBuoc, t.batBuocDat, t.dangTre, t.treNhieuNhat, t.treNhat?.khoa ?? "", t.chuaBatDau];
}

export const NHAN_TRANG_THAI_LUOT: Record<TrangThaiLuotHoc, string> = {
  DAT_DUNG_HAN: "Đạt · đúng hạn",
  DAT_TRE: "Đạt · trễ",
  TUONG_DUONG: "Công nhận tương đương",
  DANG_HOC: "Đang học",
  CHUA_BAT_DAU: "Chưa bắt đầu",
  DANG_TRE: "Đang trễ",
  TAM_DUNG: "Tạm dừng đồng hồ",
  THU_HOI: "Đã thu hồi",
};
