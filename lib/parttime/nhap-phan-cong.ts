// lib/parttime/nhap-phan-cong.ts — nhập phân công GV từ Excel (lưới phân công GV · PR5). THUẦN: đọc sheet + xét từng dòng.
// Khuôn tệp: sheet NHAP_PHAN_CONG của file mẫu chủ dự án (SR.QD.238), tiêu đề ở hàng có "ImportKey" (hàng 4), dữ liệu bên dưới.
// Luật (sheet CHECKLIST của file mẫu): import CHỈ được giao/huỷ trực tường minh và gắn TA vào buổi CÓ SẴN. Không tạo Trial/học bù,
// không đổi Rank, không nhập tiền. Đề nghị dạy thay và điều chỉnh quá khứ KHÔNG ghi gì — chúng đi luồng duyệt (đơn từ / sửa công).
// Chạy lại cùng file là vô hại: dòng nào đã đúng trạng thái thì KHONG_DOI.
import * as XLSX from "xlsx";

export const COT = [
  "ImportKey",
  "ThaoTac",
  "CoSoSuDung",
  "Ngay",
  "Ca_SCT",
  "MaGV",
  "EmailThamChieu",
  "VaiTro",
  "SessionId",
  "Truc_YN",
  "GVThayThe_Ma",
  "CoSoGoc_ThamChieu",
  "LyDo",
  "GhiChu",
  "PhienBanKyVong",
  "NguonDoiChieu",
] as const;
export type Cot = (typeof COT)[number];
export type DongNhap = { soDong: number } & Record<Cot, string>;

export const THAO_TAC = ["GAN_TRUC", "HUY_TRUC", "PHAN_CONG_TA", "DE_NGHI_DAY_THAY", "DIEU_CHINH_QUA_KHU"] as const;
export type ThaoTac = (typeof THAO_TAC)[number];

export type MaLoiNhap =
  | "IMPORT_KEY_REQUIRED"
  | "DUPLICATE_IMPORT_KEY"
  | "THAO_TAC_KHONG_HO_TRO"
  | "FORBIDDEN_POLICY_WRITE"
  | "DUPLICATE_SOURCE_OF_TRUTH"
  | "IMPORTED_PAY_AMOUNT"
  | "CENTER_NOT_FOUND"
  | "CROSS_CENTER_RBAC"
  | "INVALID_DATE"
  | "INVALID_SHIFT"
  | "EMPLOYEE_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "NO_EXPLICIT_DUTY"
  | "REASON_REQUIRED"
  | "PAST_REASON_REQUIRED"
  | "NOT_PAST_DATE"
  | "CLOSED_PERIOD_MUTATION"
  | "APPROVAL_REQUIRED"
  | "DUPLICATE_ASSIGNMENT"
  | "CROSS_CENTER_OVERLAP"
  | "STAFFING_OFF"
  | "NOT_TEACHER_IN_SCOPE"
  | "PAST_SESSION";

export type KeHoachGhi =
  | { loai: "GAN_TRUC"; userId: string; centerId: string; ngay: string; shiftCode: string }
  | { loai: "HUY_TRUC"; dutyId: string }
  | { loai: "PHAN_CONG_TA"; userId: string; sourceType: string; sourceId: string };

export type KetQuaDong = {
  soDong: number;
  importKey: string;
  ketQua: "THEM" | "HUY" | "KHONG_DOI" | "CAN_DUYET" | "LOI";
  ma: MaLoiNhap | null;
  thongDiep: string;
  keHoach: KeHoachGhi | null;
};

/** Ngữ cảnh do tầng DB dựng (theo lô) — hàm xét không tự tra gì. */
export type NguCanhNhap = {
  homNay: string;
  /** mã cơ sở (CS1/CS2…) → centerId */
  coSoTheoMa: ReadonlyMap<string, string>;
  /** centerId người nhập được phép phân công (`hr_attendance:assign` theo cơ sở). */
  coSoDuocPhan: ReadonlySet<string>;
  /** centerId đã bật công tắc STAFFING (`congThaoTacParttime`). */
  coSoDaBat: ReadonlySet<string>;
  /** MaGV (Employee.employeeCode) HOẶC email viết thường → GV. */
  gvTheoMa: ReadonlyMap<string, { userId: string; coSoCuaGv: readonly string[] }>;
  buoi: ReadonlyMap<string, { centerId: string; ngay: string; gioBatDau: string; gioKetThuc: string; sourceType: string }>;
  maCa: ReadonlySet<string>;
  /** `${userId}|${ngay}|${ca}` → trực đang sống (MỌI cơ sở — một người không trực hai nơi cùng ca). */
  trucSong: ReadonlyMap<string, { id: string; centerId: string }>;
  /** `${sourceId}|${userId}` — GV đang là TA sống của buổi. */
  taSong: ReadonlySet<string>;
  /** `${centerId}|YYYY-MM` — kỳ công đã khoá. */
  kyDaKhoa: ReadonlySet<string>;
};

/** Cùng ngưỡng với `huyTrucAction` — lý do quá ngắn thì không ai đọc lại được. */
const LY_DO_TOI_THIEU = 5;
const coLyDo = (s: string) => s.trim().length >= LY_DO_TOI_THIEU;

const NGAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const laNgayHopLe = (s: string) => {
  if (!NGAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Thao tác ngoài danh mục ⇒ mã của sheet CHECKLIST theo LOẠI dữ liệu nó định chạm (05 · 02 · 11), còn lại là mã chung. */
function maThaoTacCam(maHoa: string, goc: string): [MaLoiNhap, string] {
  if (/RANK|CHUNG_NHAN|CERT/.test(maHoa)) return ["FORBIDDEN_POLICY_WRITE", `"${goc}": Rank và chứng nhận Trial không đổi qua Excel — dùng màn Rank & Đơn giá GV.`];
  if (/TRIAL|HOC_BU|MAKEUP|LOP|SESSION|BUOI/.test(maHoa))
    return ["DUPLICATE_SOURCE_OF_TRUTH", `"${goc}": lớp cố định, Trial và học bù phát sinh từ module nguồn — Excel không tạo/đổi buổi.`];
  if (/TIEN|LUONG|PAY|GIA|THUONG/.test(maHoa)) return ["IMPORTED_PAY_AMOUNT", `"${goc}": không nhập tiền từ Excel — hệ thống tự tính theo SR.QD.238.`];
  return ["THAO_TAC_KHONG_HO_TRO", `Thao tác "${goc}" không có trong danh mục (${THAO_TAC.join(", ")}).`];
}

function loi(d: DongNhap, ma: MaLoiNhap, thongDiep: string): KetQuaDong {
  return { soDong: d.soDong, importKey: d.ImportKey, ketQua: "LOI", ma, thongDiep, keHoach: null };
}

export function xetDongNhap(d: DongNhap, c: NguCanhNhap): KetQuaDong {
  if (!d.ImportKey) return loi(d, "IMPORT_KEY_REQUIRED", "Thiếu ImportKey — mỗi dòng cần một khoá riêng để chạy lại không ghi trùng.");
  const thaoTac = d.ThaoTac.toUpperCase();
  if (!(THAO_TAC as readonly string[]).includes(thaoTac)) return loi(d, ...maThaoTacCam(thaoTac, d.ThaoTac));
  const tt = thaoTac as ThaoTac;

  const centerId = c.coSoTheoMa.get(d.CoSoSuDung.toUpperCase());
  if (!centerId) return loi(d, "CENTER_NOT_FOUND", `Không có cơ sở "${d.CoSoSuDung}".`);
  if (!c.coSoDuocPhan.has(centerId)) return loi(d, "CROSS_CENTER_RBAC", `Bạn không có quyền phân công ở ${d.CoSoSuDung}.`);
  if (!c.coSoDaBat.has(centerId)) return loi(d, "STAFFING_OFF", `Phân công theo buổi chưa bật ở ${d.CoSoSuDung}.`);
  if (!laNgayHopLe(d.Ngay)) return loi(d, "INVALID_DATE", `Ngày "${d.Ngay}" không hợp lệ (cần YYYY-MM-DD).`);
  const ca = d.Ca_SCT.toUpperCase();
  if (!c.maCa.has(ca)) return loi(d, "INVALID_SHIFT", `Ca "${d.Ca_SCT}" không hợp lệ (S / C / T).`);

  const gv = (d.MaGV && c.gvTheoMa.get(d.MaGV)) || (d.EmailThamChieu && c.gvTheoMa.get(d.EmailThamChieu.toLowerCase())) || null;
  if (!gv) return loi(d, "EMPLOYEE_NOT_FOUND", `Không tìm thấy giáo viên "${d.MaGV || d.EmailThamChieu}".`);

  const quaKhu = d.Ngay < c.homNay;
  if (tt === "DIEU_CHINH_QUA_KHU" && !quaKhu) return loi(d, "NOT_PAST_DATE", "Điều chỉnh quá khứ chỉ dùng cho ngày đã qua.");
  if (quaKhu) {
    if (c.kyDaKhoa.has(`${centerId}|${d.Ngay.slice(0, 7)}`)) return loi(d, "CLOSED_PERIOD_MUTATION", `Kỳ công ${d.Ngay.slice(0, 7)} đã khoá — không sửa được.`);
    if (!coLyDo(d.LyDo)) return loi(d, "PAST_REASON_REQUIRED", `Ngày đã qua — bắt buộc ghi lý do (tối thiểu ${LY_DO_TOI_THIEU} ký tự).`);
  }

  const ok = (ketQua: KetQuaDong["ketQua"], ma: MaLoiNhap | null, thongDiep: string, keHoach: KeHoachGhi | null): KetQuaDong => ({
    soDong: d.soDong,
    importKey: d.ImportKey,
    ketQua,
    ma,
    thongDiep,
    keHoach,
  });
  const muon = !gv.coSoCuaGv.includes(centerId) ? " (GV mượn từ cơ sở khác)" : "";

  switch (tt) {
    case "GAN_TRUC": {
      // Trực chỉ đến từ dòng giao trực TƯỜNG MINH — không suy từ mã lưới.
      const truc = d.Truc_YN.toUpperCase();
      const vai = d.VaiTro.toUpperCase();
      if (truc === "NO" || (vai && vai !== "OPS")) return loi(d, "NO_EXPLICIT_DUTY", "Giao trực cần Truc_YN = YES và VaiTro = OPS.");
      const co = c.trucSong.get(`${gv.userId}|${d.Ngay}|${ca}`);
      if (co && co.centerId !== centerId) return loi(d, "CROSS_CENTER_OVERLAP", `GV đã trực ca ${ca} ngày ${d.Ngay} ở cơ sở khác.`);
      if (co) return ok("KHONG_DOI", "DUPLICATE_ASSIGNMENT", "Đã có trực ca này — không đổi.", null);
      return ok("THEM", null, `Giao trực ca ${ca} ngày ${d.Ngay}${muon}.`, { loai: "GAN_TRUC", userId: gv.userId, centerId, ngay: d.Ngay, shiftCode: ca });
    }
    case "HUY_TRUC": {
      if (!coLyDo(d.LyDo)) return loi(d, "REASON_REQUIRED", `Huỷ trực bắt buộc ghi lý do (tối thiểu ${LY_DO_TOI_THIEU} ký tự).`);
      const co = c.trucSong.get(`${gv.userId}|${d.Ngay}|${ca}`);
      if (co && co.centerId !== centerId) return loi(d, "CROSS_CENTER_RBAC", "Trực ca này thuộc cơ sở khác — không huỷ từ đây.");
      if (!co) return ok("KHONG_DOI", "DUPLICATE_ASSIGNMENT", "Không còn trực ca này — không đổi.", null);
      return ok("HUY", null, `Huỷ trực ca ${ca} ngày ${d.Ngay}.`, { loai: "HUY_TRUC", dutyId: co.id });
    }
    case "PHAN_CONG_TA": {
      const b = d.SessionId ? c.buoi.get(d.SessionId) : undefined;
      if (!b || b.centerId !== centerId || b.ngay !== d.Ngay)
        return loi(d, "SESSION_NOT_FOUND", `Không có buổi "${d.SessionId}" ở ${d.CoSoSuDung} ngày ${d.Ngay} — import không tạo buổi mới.`);
      if (quaKhu) return loi(d, "PAST_SESSION", "Buổi đã qua — dùng DIEU_CHINH_QUA_KHU (hoặc “Sửa buổi đã qua” trên màn).");
      // Cùng cổng với `kiemNguoiDuocPhan` của màn: GV của cơ sở buổi hoặc của cơ sở người nhập quản lý (điều chuyển).
      if (!gv.coSoCuaGv.some((x) => x === centerId || c.coSoDuocPhan.has(x)))
        return loi(d, "NOT_TEACHER_IN_SCOPE", "Người này không phải giáo viên của cơ sở bạn quản lý.");
      if (c.taSong.has(`${d.SessionId}|${gv.userId}`)) return ok("KHONG_DOI", "DUPLICATE_ASSIGNMENT", "GV đã là trợ giảng của buổi — không đổi.", null);
      return ok("THEM", null, `Gắn trợ giảng buổi ${b.gioBatDau}–${b.gioKetThuc}${muon}.`, {
        loai: "PHAN_CONG_TA",
        userId: gv.userId,
        sourceType: b.sourceType,
        sourceId: d.SessionId,
      });
    }
    case "DE_NGHI_DAY_THAY":
      // Chủ dự án chốt 24/10/2026: dạy thay CHỈ dựa vào đơn đổi ca / đơn dạy thay của giáo viên — Excel không tạo, không ghi.
      return ok("CAN_DUYET", "APPROVAL_REQUIRED", "Dạy thay lấy từ đơn đổi ca / đơn dạy thay của giáo viên (duyệt ở Đơn từ) — Excel không ghi.", null);
    case "DIEU_CHINH_QUA_KHU":
      return ok("CAN_DUYET", "APPROVAL_REQUIRED", "Điều chỉnh quá khứ phải qua duyệt sửa công — import không ghi.", null);
  }
}

const khoaGhi = (k: KeHoachGhi) =>
  k.loai === "GAN_TRUC" ? `T|${k.userId}|${k.ngay}|${k.shiftCode}` : k.loai === "HUY_TRUC" ? `H|${k.dutyId}` : `TA|${k.sourceId}|${k.userId}`;

/** Xét cả file: ImportKey trùng ⇒ LỖI mọi dòng mang khoá đó; hai dòng cùng một phép ghi ⇒ dòng sau KHONG_DOI. */
export function xetFileNhap(dong: readonly DongNhap[], c: NguCanhNhap): KetQuaDong[] {
  const dem = new Map<string, number>();
  for (const d of dong) if (d.ImportKey) dem.set(d.ImportKey, (dem.get(d.ImportKey) ?? 0) + 1);
  const daGhi = new Set<string>();
  return dong.map((d) => {
    if (d.ImportKey && (dem.get(d.ImportKey) ?? 0) > 1) return loi(d, "DUPLICATE_IMPORT_KEY", `ImportKey "${d.ImportKey}" xuất hiện nhiều lần trong file.`);
    const r = xetDongNhap(d, c);
    if (!r.keHoach) return r;
    const k = khoaGhi(r.keHoach);
    if (daGhi.has(k)) return { ...r, ketQua: "KHONG_DOI", ma: "DUPLICATE_ASSIGNMENT", thongDiep: "Trùng thao tác với một dòng phía trên.", keHoach: null };
    daGhi.add(k);
    return r;
  });
}

const EXCEL_GOC = Date.UTC(1899, 11, 30);
const chuoiO = (v: unknown, cot: Cot): string => {
  if (v == null) return "";
  if (cot === "Ngay" && typeof v === "number") return new Date(EXCEL_GOC + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
};

export type KetQuaDoc = { ok: true; dong: DongNhap[] } | { ok: false; loi: string };

export function docSheetNhap(buf: Uint8Array | ArrayBuffer): KetQuaDoc {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array" });
  } catch {
    return { ok: false, loi: "Không đọc được tệp — cần tệp .xlsx." };
  }
  const ws = wb.Sheets["NHAP_PHAN_CONG"];
  if (!ws) return { ok: false, loi: 'Tệp không có sheet "NHAP_PHAN_CONG" — hãy dùng file mẫu tải từ màn này.' };
  const goc = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r : 0;
  const hang = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: null, raw: true });
  const iTieuDe = hang.findIndex((h, i) => i < 15 && Array.isArray(h) && String(h[0] ?? "").trim() === "ImportKey");
  if (iTieuDe < 0) return { ok: false, loi: 'Không thấy hàng tiêu đề (ô đầu là "ImportKey").' };
  const tieuDe = (hang[iTieuDe] as unknown[]).map((x) => String(x ?? "").trim());
  const lech = COT.find((c, i) => tieuDe[i] !== c);
  if (lech) return { ok: false, loi: `Cột tiêu đề lệch file mẫu ở "${lech}" — đừng thêm/xoá/đổi tên cột.` };

  const dong: DongNhap[] = [];
  hang.slice(iTieuDe + 1).forEach((h, k) => {
    if (!Array.isArray(h) || h.every((x) => x == null || String(x).trim() === "")) return;
    const o = Object.fromEntries(COT.map((c, i) => [c, chuoiO(h[i], c)])) as Record<Cot, string>;
    dong.push({ soDong: goc + iTieuDe + 2 + k, ...o });
  });
  return { ok: true, dong };
}
