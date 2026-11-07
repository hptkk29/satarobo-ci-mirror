/**
 * lib/nguon/gan-danh-tinh-don.ts — LÕI THUẦN của «gắn DANH TÍNH cho 6 đơn sống» (Wave 1, 24/10/2026).
 *
 * ── Việc này làm gì, và KHÔNG làm gì ────────────────────────────────────────────────────────────────────────
 * Sáu đơn sống (`ORD-260831-000001` …) đang giữ doanh thu thật (tiền đã về ngân hàng, đã phân bổ vào đúng đơn) nhưng
 * `Order.studentId`, `OrderItem.studentId` và `OrderItem.enrollmentId` đều NULL. Chủ dự án chốt (24/10/2026, «PHASE A»):
 * mỗi đơn CHỈ được cập nhật ba cột đó. KHÔNG đụng `Payment.enrollmentId`, giá/học phí/giảm giá của `Enrollment`,
 * `Order.totalAmount`, số tiền `Payment`, hoa hồng, `leadId`.
 *
 * Lý do KHÔNG gắn `Payment.enrollmentId` lúc này: công nợ + cổng phụ huynh tính theo `Enrollment.finalPrice` trừ `Payment` đã gắn
 * ghi danh. Năm đơn Sata3 có ghi danh `finalPrice` 10.560.000 trong khi đơn giảm 15% (8.976.000) ⇒ gắn tiền vào là hiện nợ giả
 * 1.584.000; đơn 000006 có ghi danh học bổng `finalPrice` 0 ⇒ hiện đóng thừa 9.792.000. Đó là việc của PHASE B (pricing).
 *
 * ── Luật: MỘT hàm quyết định, FAIL-CLOSED ────────────────────────────────────────────────────────────────────
 * `lapKeHoachGanDanhTinh` nhận dữ liệu đã nạp và trả kế hoạch. MỘT đơn lệch bất kỳ điều kiện nào ⇒ `dung = true` và KHÔNG có dòng ghi
 * nào (cả lô dừng). Hai trạng thái hợp lệ duy nhất của cả lô: «cả 6 đơn chưa gắn» (ghi 6) hoặc «cả 6 đơn đã gắn ĐÚNG» (ghi 0 — chạy lại
 * sau khi ghi). Lô lai (một số đã gắn, một số chưa) là LỆCH: dừng, vì lô chỉ được ghi trong MỘT transaction nên trạng thái đó chỉ có
 * thể do người khác can thiệp.
 *
 * Danh tính được suy từ NHIỀU đường độc lập và PHẢI trùng nhau (không đường nào đứng một mình):
 *   đơn → lead (`Order.leadId`) · đơn → bé (`Order.leadChildId`) · học viên có ĐÚNG MỘT ứng viên (theo lead / bé / SĐT phụ huynh)
 *   · học viên.leadId = đơn.leadId · học viên.leadChildId = đơn.leadChildId · tên bé trên phiếu lead = tên học viên · cùng cơ sở
 *   (đơn · lead · học viên · ghi danh) · ghi danh ACTIVE, còn sống, DUY NHẤT của học viên, cùng bé, cùng KHOÁ HỌC ghi trên dòng đơn
 *   · chưa dòng đơn nào khác trỏ vào ghi danh · tổng `Payment` sống = tổng đơn = tổng phân bổ ngân hàng MATCHED.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs. Tầng DB: `gan-danh-tinh-don-db.ts`.
 */
import { createHash } from "node:crypto";
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

/** PHẠM VI CỨNG của lệnh này: đúng sáu mã đơn chủ dự án chốt (24/10/2026). Script truyền hằng này; không có tham số nào đổi nó. */
export const MA_DON_GAN_DANH_TINH = [
  "ORD-260831-000001",
  "ORD-260908-000003",
  "ORD-260910-000002",
  "ORD-260910-000005",
  "ORD-260910-000006",
  "ORD-260910-000008",
] as const;

export const KHUON_DONG_GAN_DANH_TINH = "gan-danh-tinh-don/v1";

export const MA_LOI_GAN_DANH_TINH = {
  THIEU_DON: "THIEU_DON",
  DON_DA_XOA: "DON_DA_XOA",
  DON_KHONG_PHAI_KHOA_HOC: "DON_KHONG_PHAI_KHOA_HOC",
  SO_DONG_KHONG_DUNG: "SO_DONG_KHONG_DUNG",
  TRANG_THAI_GAN_LECH: "TRANG_THAI_GAN_LECH",
  LO_HON_HOP: "LO_HON_HOP",
  THIEU_LEAD: "THIEU_LEAD",
  LEAD_KHONG_HOP_LE: "LEAD_KHONG_HOP_LE",
  THIEU_BE: "THIEU_BE",
  BE_KHONG_THUOC_LEAD: "BE_KHONG_THUOC_LEAD",
  KHONG_CO_HOC_VIEN: "KHONG_CO_HOC_VIEN",
  NHIEU_HOC_VIEN: "NHIEU_HOC_VIEN",
  HOC_VIEN_LECH_LEAD: "HOC_VIEN_LECH_LEAD",
  HOC_VIEN_LECH_BE: "HOC_VIEN_LECH_BE",
  HOC_VIEN_LECH_TEN: "HOC_VIEN_LECH_TEN",
  HOC_VIEN_LECH_CO_SO: "HOC_VIEN_LECH_CO_SO",
  KHONG_CO_GHI_DANH: "KHONG_CO_GHI_DANH",
  NHIEU_GHI_DANH: "NHIEU_GHI_DANH",
  GHI_DANH_KHONG_ACTIVE: "GHI_DANH_KHONG_ACTIVE",
  THIEU_KHOA_TREN_DONG: "THIEU_KHOA_TREN_DONG",
  GHI_DANH_LECH_KHOA: "GHI_DANH_LECH_KHOA",
  GHI_DANH_LECH_BE: "GHI_DANH_LECH_BE",
  GHI_DANH_LECH_CO_SO: "GHI_DANH_LECH_CO_SO",
  GHI_DANH_DA_BI_DUNG: "GHI_DANH_DA_BI_DUNG",
  KHONG_CO_PAYMENT: "KHONG_CO_PAYMENT",
  TIEN_PAYMENT_LECH: "TIEN_PAYMENT_LECH",
  TIEN_PHAN_BO_LECH: "TIEN_PHAN_BO_LECH",
  TRUNG_DICH: "TRUNG_DICH",
} as const;
export type MaLoiGanDanhTinh = (typeof MA_LOI_GAN_DANH_TINH)[keyof typeof MA_LOI_GAN_DANH_TINH];

export type LoiGanDanhTinh = { code: string; ma: MaLoiGanDanhTinh; chiTiet: string };

export type DongDonNap = {
  id: string;
  type: string;
  studentId: string | null;
  enrollmentId: string | null;
  /** `OrderItem.metadata` — thuần đọc `courseId` (khoá học ghi lúc tạo đơn). */
  metadata: unknown;
};

export type DonNap = {
  id: string;
  code: string;
  type: string;
  deletedAt: Date | null;
  studentId: string | null;
  leadId: string | null;
  leadChildId: string | null;
  centerId: string | null;
  totalAmount: number;
  items: readonly DongDonNap[];
};

export type HocVienUngVien = {
  id: string;
  name: string;
  leadId: string | null;
  leadChildId: string | null;
  centerId: string | null;
};

export type GhiDanhNap = {
  id: string;
  studentId: string;
  courseId: string | null;
  status: string;
  leadChildId: string | null;
  centerId: string | null;
};

export type DuLieuMotDon = {
  don: DonNap;
  lead: { id: string; centerId: string | null; deletedAt: Date | null } | null;
  be: { id: string; leadId: string; fullName: string } | null;
  /** Học viên CÒN SỐNG khớp đơn qua lead / bé / SĐT phụ huynh — gom theo id (một học viên khớp bằng hai đường vẫn là MỘT ứng viên). */
  hocVienUngVien: readonly HocVienUngVien[];
  /** Ghi danh CÒN SỐNG của mọi ứng viên trên. */
  ghiDanhUngVien: readonly GhiDanhNap[];
  /** Mọi dòng đơn (đơn nào, kể cả đơn đã xoá) đang trỏ `enrollmentId` vào một ghi danh ứng viên. */
  dongTroVaoGhiDanh: readonly { orderItemId: string; orderId: string; enrollmentId: string }[];
  soPaymentSong: number;
  tongPaymentSong: number;
  /** Σ phân bổ ngân hàng ĐÃ KHỚP (MATCHED) vào các phiếu thu của đơn. */
  tongPhanBoNganHang: number;
};

export type DongGanDanhTinh = {
  orderId: string;
  code: string;
  orderItemId: string;
  studentId: string;
  enrollmentId: string;
};

export type TrangThaiDon = "CHUA_GAN" | "DA_GAN" | "LECH";

export type MucKeHoachDon = {
  code: string;
  trangThai: TrangThaiDon;
  /** Ánh xạ đã suy ra (có cả khi đã gắn, để báo cáo) — `null` nếu chưa suy ra được. */
  anhXa: DongGanDanhTinh | null;
  loi: readonly LoiGanDanhTinh[];
};

export type KeHoachGanDanhTinh = {
  muc: readonly MucKeHoachDon[];
  loi: readonly LoiGanDanhTinh[];
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  /** Dòng ghi theo thứ tự mã đơn — rỗng khi dừng, hoặc khi cả lô đã gắn đúng. */
  ghi: readonly DongGanDanhTinh[];
  /** `true` ⇒ cả 6 đã gắn ĐÚNG; chạy lại ghi 0 dòng. */
  daGanHet: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

const chuanTen = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** `metadata.courseId` của dòng đơn; không có / không phải chuỗi ⇒ `null`. */
export function docKhoaTrenDong(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).courseId;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** MỘT dòng/đơn: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm, nên hai bên không thể lệch. Không chứa tên/SĐT/email. */
export function dongDauRaGanDanhTinh(ghi: readonly DongGanDanhTinh[]): string[] {
  return ghi.map((g) => [KHUON_DONG_GAN_DANH_TINH, g.orderId, g.code, g.orderItemId, g.studentId, g.enrollmentId].join("|"));
}

export const shaKeHoachGanDanhTinh = (dong: readonly string[]) => createHash("sha256").update(dong.join("\n"), "utf8").digest("hex");

const loi = (code: string, ma: MaLoiGanDanhTinh, chiTiet: string): LoiGanDanhTinh => ({ code, ma, chiTiet });

/** Kiểm MỘT đơn. Trả mục kế hoạch; mọi điều kiện sai đều là một `loi` (không dừng ở lỗi đầu — báo hết để owner sửa một lượt). */
function kiemMotDon(d: DuLieuMotDon): MucKeHoachDon {
  const { don } = d;
  const code = don.code;
  const l: LoiGanDanhTinh[] = [];
  const them = (ma: MaLoiGanDanhTinh, chiTiet: string) => l.push(loi(code, ma, chiTiet));

  if (don.deletedAt !== null) them("DON_DA_XOA", "đơn đã bị xoá mềm");
  if (don.type !== "COURSE") them("DON_KHONG_PHAI_KHOA_HOC", `loại đơn «${don.type}» ≠ COURSE`);

  const dongKhoa = don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (don.items.length !== 1 || dongKhoa.length !== 1) {
    them("SO_DONG_KHONG_DUNG", `đơn phải có ĐÚNG 1 dòng và dòng đó là COURSE_ENROLLMENT (đang có ${don.items.length} dòng, ${dongKhoa.length} dòng COURSE_ENROLLMENT)`);
  }
  const dong = dongKhoa.length === 1 ? dongKhoa[0]! : null;

  // ── lead + bé ──
  if (don.leadId === null) them("THIEU_LEAD", "Order.leadId NULL");
  else if (d.lead === null || d.lead.id !== don.leadId) them("THIEU_LEAD", "không đọc được lead của đơn");
  else {
    if (d.lead.deletedAt !== null) them("LEAD_KHONG_HOP_LE", "lead đã xoá mềm");
    if (d.lead.centerId === null || d.lead.centerId !== don.centerId) them("LEAD_KHONG_HOP_LE", `lead khác cơ sở với đơn (${d.lead.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
  }
  if (don.leadChildId === null) them("THIEU_BE", "Order.leadChildId NULL");
  else if (d.be === null || d.be.id !== don.leadChildId) them("THIEU_BE", "không đọc được bé (LeadChild) của đơn");
  else if (d.be.leadId !== don.leadId) them("BE_KHONG_THUOC_LEAD", "bé trên đơn không thuộc lead của đơn");

  // ── học viên: ĐÚNG MỘT ứng viên, và nó phải khớp bằng mọi đường ──
  const ung = d.hocVienUngVien;
  let hv: HocVienUngVien | null = null;
  if (ung.length === 0) them("KHONG_CO_HOC_VIEN", "không có học viên nào khớp (lead / bé / SĐT phụ huynh)");
  else if (ung.length > 1) them("NHIEU_HOC_VIEN", `${ung.length} học viên cùng khớp: ${ung.map((u) => u.id).join(", ")} — không đoán`);
  else {
    hv = ung[0]!;
    if (hv.leadId !== don.leadId) them("HOC_VIEN_LECH_LEAD", "Student.leadId ≠ Order.leadId");
    if (hv.leadChildId !== don.leadChildId) them("HOC_VIEN_LECH_BE", "Student.leadChildId ≠ Order.leadChildId");
    if (hv.centerId === null || hv.centerId !== don.centerId) them("HOC_VIEN_LECH_CO_SO", `học viên khác cơ sở với đơn (${hv.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
    if (d.be !== null && chuanTen(d.be.fullName) !== chuanTen(hv.name)) them("HOC_VIEN_LECH_TEN", "tên học viên ≠ tên bé trên phiếu lead");
  }

  // ── ghi danh: ĐÚNG MỘT còn sống của học viên, ACTIVE, cùng bé, cùng cơ sở, cùng KHOÁ ghi trên dòng đơn ──
  let gd: GhiDanhNap | null = null;
  if (hv !== null) {
    const cuaHv = d.ghiDanhUngVien.filter((e) => e.studentId === hv!.id);
    if (cuaHv.length === 0) them("KHONG_CO_GHI_DANH", "học viên chưa có ghi danh còn sống");
    else if (cuaHv.length > 1) them("NHIEU_GHI_DANH", `học viên có ${cuaHv.length} ghi danh còn sống — không đoán`);
    else {
      gd = cuaHv[0]!;
      if (gd.status !== "ACTIVE") them("GHI_DANH_KHONG_ACTIVE", `ghi danh ở trạng thái «${gd.status}»`);
      if (gd.leadChildId !== don.leadChildId) them("GHI_DANH_LECH_BE", "Enrollment.leadChildId ≠ Order.leadChildId");
      if (gd.centerId === null || gd.centerId !== don.centerId) them("GHI_DANH_LECH_CO_SO", `ghi danh khác cơ sở với đơn (${gd.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
      const khoaDong = dong === null ? null : docKhoaTrenDong(dong.metadata);
      if (khoaDong === null) them("THIEU_KHOA_TREN_DONG", "dòng đơn không ghi courseId — không đối chiếu được khoá");
      else if (gd.courseId !== khoaDong) them("GHI_DANH_LECH_KHOA", `ghi danh khoá ${gd.courseId ?? "NULL"} ≠ khoá trên dòng đơn ${khoaDong}`);
      const biDung = d.dongTroVaoGhiDanh.filter((x) => x.enrollmentId === gd!.id && x.orderItemId !== dong?.id);
      if (biDung.length > 0) them("GHI_DANH_DA_BI_DUNG", `ghi danh đã có ${biDung.length} dòng đơn khác trỏ vào (${biDung.map((x) => x.orderItemId).join(", ")})`);
    }
  }

  // ── tiền: Payment sống = tổng đơn = phân bổ ngân hàng MATCHED ──
  if (d.soPaymentSong === 0) them("KHONG_CO_PAYMENT", "đơn không có Payment sống");
  if (d.tongPaymentSong !== don.totalAmount) them("TIEN_PAYMENT_LECH", `Σ Payment sống ${d.tongPaymentSong} ≠ tổng đơn ${don.totalAmount}`);
  if (d.tongPhanBoNganHang !== don.totalAmount) them("TIEN_PHAN_BO_LECH", `Σ phân bổ ngân hàng ${d.tongPhanBoNganHang} ≠ tổng đơn ${don.totalAmount}`);

  // ── trạng thái gắn hiện tại ──
  let trangThai: TrangThaiDon = "LECH";
  const anhXa: DongGanDanhTinh | null =
    dong !== null && hv !== null && gd !== null ? { orderId: don.id, code, orderItemId: dong.id, studentId: hv.id, enrollmentId: gd.id } : null;
  if (dong !== null) {
    const chua = don.studentId === null && dong.studentId === null && dong.enrollmentId === null;
    if (chua) trangThai = "CHUA_GAN";
    else if (anhXa !== null && don.studentId === anhXa.studentId && dong.studentId === anhXa.studentId && dong.enrollmentId === anhXa.enrollmentId) trangThai = "DA_GAN";
    else them("TRANG_THAI_GAN_LECH", `liên kết hiện tại không phải «chưa gắn» cũng không phải «đã gắn đúng» (Order.studentId=${don.studentId ?? "NULL"}, dòng.studentId=${dong.studentId ?? "NULL"}, dòng.enrollmentId=${dong.enrollmentId ?? "NULL"})`);
  }
  return { code, trangThai: l.length > 0 ? "LECH" : trangThai, anhXa, loi: l };
}

/**
 * Lập kế hoạch cho cả lô. `maDon` là phạm vi CỨNG (thứ tự = thứ tự báo cáo/ghi). Mọi mã phải có đúng một đơn trong dữ liệu.
 * Fail-closed: bất kỳ lỗi nào (của một đơn hay của cả lô) ⇒ `dung` và `ghi = []`.
 */
export function lapKeHoachGanDanhTinh(input: { maDon: readonly string[]; du: readonly DuLieuMotDon[] }): KeHoachGanDanhTinh {
  const loiLo: LoiGanDanhTinh[] = [];
  const muc: MucKeHoachDon[] = [];
  for (const code of input.maDon) {
    const cac = input.du.filter((x) => x.don.code === code);
    if (cac.length !== 1) {
      loiLo.push(loi(code, "THIEU_DON", cac.length === 0 ? "không có đơn mang mã này" : `${cac.length} đơn cùng mã`));
      muc.push({ code, trangThai: "LECH", anhXa: null, loi: [loi(code, "THIEU_DON", `đọc được ${cac.length} đơn`)] });
      continue;
    }
    const m = kiemMotDon(cac[0]!);
    muc.push(m);
  }
  // Dữ liệu thừa ngoài phạm vi: bất thường của người gọi (không được nạp thêm đơn) ⇒ dừng.
  for (const x of input.du) if (!input.maDon.includes(x.don.code)) loiLo.push(loi(x.don.code, "THIEU_DON", "đơn nằm NGOÀI phạm vi cứng"));

  // Hai đơn cùng đích (cùng học viên hoặc cùng ghi danh) — dù từng đơn sạch.
  const anhXa = muc.flatMap((m) => (m.anhXa ? [m.anhXa] : []));
  for (const k of ["studentId", "enrollmentId"] as const) {
    const dem = new Map<string, string[]>();
    for (const a of anhXa) dem.set(a[k], [...(dem.get(a[k]) ?? []), a.code]);
    for (const [id, codes] of dem) if (codes.length > 1) loiLo.push(loi(codes.join(","), "TRUNG_DICH", `${k} ${id} là đích của ${codes.length} đơn`));
  }

  const loiTungDon = muc.flatMap((m) => m.loi);
  const chua = muc.filter((m) => m.trangThai === "CHUA_GAN").length;
  const da = muc.filter((m) => m.trangThai === "DA_GAN").length;
  if (loiTungDon.length === 0 && loiLo.length === 0 && chua > 0 && da > 0) {
    loiLo.push(loi(input.maDon.join(","), "LO_HON_HOP", `${chua} đơn chưa gắn + ${da} đơn đã gắn — lô lai, không ghi`));
  }

  const tatCaLoi = [...loiTungDon, ...loiLo];
  const dung = tatCaLoi.length > 0;
  const ghi = dung ? [] : muc.filter((m) => m.trangThai === "CHUA_GAN").map((m) => m.anhXa!);
  const dongDauRa = dongDauRaGanDanhTinh(ghi);
  return {
    muc,
    loi: tatCaLoi,
    dung,
    ghi,
    daGanHet: !dung && muc.length > 0 && da === muc.length,
    dongDauRa,
    sha: shaKeHoachGanDanhTinh(dongDauRa),
  };
}

/** Cổng số duyệt `--expect=<N>`: N = số ĐƠN sẽ ghi. Trả `null` nếu qua; ngược lại câu lỗi. */
export function quyetDinhGhiGanDanhTinh(i: { soDuyet: number | null; keHoach: KeHoachGanDanhTinh; ghiDuoc: boolean | null }): string | null {
  if (i.soDuyet === null) return "--ghi đòi --expect=<N> (số đơn SẼ GHI của lượt chạy thử đã được duyệt).";
  if (Number.isNaN(i.soDuyet)) return "--expect phải là số nguyên không dấu (chỉ chữ số thập phân).";
  if (i.keHoach.dung) return `Kế hoạch DỪNG (${i.keHoach.loi.length} lỗi) — không ghi gì: ${i.keHoach.loi.map((x) => `${x.code}:${x.ma}`).join(" · ")}`;
  if (i.ghiDuoc !== true) return i.ghiDuoc === false ? "User kết nối không có quyền UPDATE trên Order — không ghi." : "Không kiểm được quyền UPDATE trên Order — không ghi.";
  if (i.soDuyet !== i.keHoach.ghi.length) return `Số duyệt ${i.soDuyet} ≠ kế hoạch lúc chạy ${i.keHoach.ghi.length} — không ghi.`;
  return null;
}

/** Bộ phân tích `--expect=` chặt: chỉ chữ số thập phân thuần; sai khuôn ⇒ `NaN` (KHÔNG `Number()`: '' / 0x2 / 1e1 không được thành số). */
export function phanTichSoDuyetGanDanhTinh(argv: readonly string[]): number | null {
  const a = argv.find((x) => x.startsWith("--expect="));
  if (a === undefined) return null;
  const raw = a.slice("--expect=".length);
  if (!/^[0-9]+$/.test(raw)) return Number.NaN;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

// ─── Bản ghi audit MỨC LƯỢT CHẠY (khuôn `noi-don-audit.ts`) ──────────────────────────────────────────────

export const HANH_DONG_GAN_DANH_TINH = "GAN_DANH_TINH_DON";
export const HANH_DONG_GAN_DANH_TINH_LUOT = "GAN_DANH_TINH_DON_LUOT_CHAY";

export type LuotChayGanDanhTinh = { batDauLuc: Date; nguonChay: NguonChayDiTru };

export const khoaLuotChayGanDanhTinh = (n: NguonChayDiTru) => `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;

export function dungBanGhiLuotGanDanhTinh(i: { luot: LuotChayGanDanhTinh; soDuyet: number; keHoach: KeHoachGanDanhTinh; daGhi: number }): Record<string, unknown> {
  if (!(i.luot.batDauLuc instanceof Date) || Number.isNaN(i.luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotGanDanhTinh: batDauLuc phải là mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
  }
  const n = i.luot.nguonChay;
  return {
    cheDo: "APPLY",
    dryRun: false,
    batDauLuc: i.luot.batDauLuc.toISOString(),
    expectedCount: i.soDuyet,
    soKeHoach: i.keHoach.ghi.length,
    actualCount: i.daGhi,
    khop: i.daGhi === i.soDuyet,
    keHoachSha: i.keHoach.sha,
    donDaGan: i.keHoach.ghi.map((g) => g.code),
    nguonChay: { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt },
  };
}
