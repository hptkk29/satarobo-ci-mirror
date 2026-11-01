/**
 * lib/nguon/gan-dong-don-theo-khoan.ts — LÕI THUẦN của «gắn DÒNG ĐƠN ↔ GHI DANH theo khoản thu đã gắn» (01/11/2026).
 *
 * ── Việc này làm gì, và KHÔNG làm gì ────────────────────────────────────────────────────�
 * Đơn nhập tay / nhập bù (backfill) đã có `Order.studentId` đúng và MỌI `Payment` sống đã trỏ `orderItemId` = dòng đơn + `enrollmentId` = ghi danh, nhưng chính dòng đơn
 * (`OrderItem`) thì `studentId` và `enrollmentId` còn NULL. Lệnh này điền hai cột đó cho đúng các dòng đơn trong PHẠM VI CỨNG, và CHỈ khi đang NULL.
 * KHÔNG đụng `Payment`, `Receipt`, giá/học phí/giảm giá của ghi danh, tổng đơn, trạng thái đơn, công nợ, hoa hồng, `leadId`; KHÔNG tạo `PaymentRequest`.
 *
 * ── Khác `gan-danh-tinh-don.ts` (Wave 1) ở đâu — và vì sao không dùng lại nó ───────────────────────────────
 * Lõi Wave 1 đòi «Payment chưa gắn ghi danh», «tổng phân bổ ngân hàng MATCHED = tổng đơn», đơn có `leadId`/`leadChildId`. Đơn nhập tay thì ngược cả ba: khoản thu ĐÃ gắn ghi danh,
 * KHÔNG có phân bổ ngân hàng, và có đơn không có lead/bé. Ở đây bằng chứng danh tính là CHÍNH các khoản thu đã gắn (đường tiền thật), đối chiếu độc lập với `Order.studentId`:
 *   đơn (COURSE, sống, đúng tổng) → `Order.studentId` = học viên ghim → ĐÚNG MỘT dòng đơn COURSE_ENROLLMENT (id ghim) → MỌI `Payment` sống của đơn trỏ dòng đó + ghi danh ghim
 *   → Σ Payment = tổng đơn → ghi danh ghim ACTIVE, còn sống, thuộc học viên ghim, cùng cơ sở với đơn → học viên có ĐÚNG MỘT ghi danh sống → tên dòng đơn khớp tiền tố tên khoá của ghi danh
 *   → không dòng đơn nào NGOÀI phạm vi đang trỏ vào ghi danh đó.
 * Mọi mã định danh (đơn · dòng đơn · học viên · ghi danh) được GHIM trong phạm vi: owner ký đúng những id này, script không suy id nào ngoài bằng chứng nêu trên.
 *
 * ── Luật: MỘT hàm quyết định, FAIL-CLOSED ──────────────────────────────────────────────────�
 * MỘT mục lệch bất kỳ điều kiện nào ⇒ `dung = true`, KHÔNG dòng ghi nào (cả lô dừng). Hai trạng thái hợp lệ duy nhất của cả lô: «mọi dòng chưa gắn» (ghi N) hoặc «mọi dòng đã gắn ĐÚNG»
 * (ghi 0 — chạy lại). Lô lai là LỆCH: dừng. Dòng đã trỏ SAI (khác id ghim) ⇒ dừng, không sửa.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env. Tầng DB: `gan-dong-don-theo-khoan-db.ts`.
 */
import { createHash } from "node:crypto";
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

/** MỘT mục phạm vi cứng. Mọi id đều được owner nhìn thấy trong đầu ra để ký. Không tên/SĐT/email. */
export type MucPhamVi = {
  code: string;
  orderItemId: string;
  studentId: string;
  enrollmentId: string;
  /** `Order.totalAmount` đã đối soát — điều kiện «chưa trôi», KHÔNG phải định danh. */
  tongDon: number;
};

/**
 * PHẠM VI CỨNG của lệnh (chủ dự án chốt 01/11/2026, case học viên CS1 đã đối soát: 4.000.000 + 3.920.000 = 7.920.000, còn 2.640.000).
 * Script truyền hằng này; không có tham số nào đổi, thêm hay bớt mục.
 */
export const PHAM_VI_GAN_DONG_THEO_KHOAN: readonly MucPhamVi[] = [
  { code: "ORD-260913-000015", orderItemId: "cmu0719xw003093kabld53267", studentId: "cmtvcgkao000l3z6d7fdf1w7d", enrollmentId: "cmtvcgkay000n3z6dn3zmlqer", tongDon: 4_000_000 },
  { code: "ORD-261023-000005", orderItemId: "c02f18b3884a1de1ef0311ff5", studentId: "cmtvcgkao000l3z6d7fdf1w7d", enrollmentId: "cmtvcgkay000n3z6dn3zmlqer", tongDon: 3_920_000 },
];

export const KHUON_DONG_GAN_DONG_THEO_KHOAN = "gan-dong-don-theo-khoan/v1";
export const HANH_DONG_GAN_DONG_THEO_KHOAN = "GAN_DONG_DON_THEO_KHOAN";
export const HANH_DONG_GAN_DONG_THEO_KHOAN_LUOT = "GAN_DONG_DON_THEO_KHOAN_LUOT_CHAY";

export const MA_LOI_GAN_DONG = {
  THIEU_DON: "THIEU_DON",
  DON_NGOAI_PHAM_VI: "DON_NGOAI_PHAM_VI",
  DON_DA_XOA: "DON_DA_XOA",
  DON_KHONG_PHAI_KHOA_HOC: "DON_KHONG_PHAI_KHOA_HOC",
  TRANG_THAI_DON_LECH: "TRANG_THAI_DON_LECH",
  TONG_DON_LECH: "TONG_DON_LECH",
  SO_DONG_KHONG_DUNG: "SO_DONG_KHONG_DUNG",
  DONG_KHAC_ID_GHIM: "DONG_KHAC_ID_GHIM",
  HOC_VIEN_DON_LECH: "HOC_VIEN_DON_LECH",
  HOC_VIEN_KHONG_HOP_LE: "HOC_VIEN_KHONG_HOP_LE",
  GHI_DANH_KHONG_HOP_LE: "GHI_DANH_KHONG_HOP_LE",
  GHI_DANH_KHONG_ACTIVE: "GHI_DANH_KHONG_ACTIVE",
  GHI_DANH_LECH_HOC_VIEN: "GHI_DANH_LECH_HOC_VIEN",
  GHI_DANH_LECH_CO_SO: "GHI_DANH_LECH_CO_SO",
  NHIEU_GHI_DANH: "NHIEU_GHI_DANH",
  TEN_KHOA_LECH: "TEN_KHOA_LECH",
  KHONG_CO_PAYMENT: "KHONG_CO_PAYMENT",
  PAYMENT_KHONG_GAN_DONG: "PAYMENT_KHONG_GAN_DONG",
  PAYMENT_KHONG_GAN_GHI_DANH: "PAYMENT_KHONG_GAN_GHI_DANH",
  TIEN_PAYMENT_LECH: "TIEN_PAYMENT_LECH",
  DONG_TRO_NGOAI_PHAM_VI: "DONG_TRO_NGOAI_PHAM_VI",
  TRANG_THAI_DONG_LECH: "TRANG_THAI_DONG_LECH",
  LO_HON_HOP: "LO_HON_HOP",
} as const;
export type MaLoiGanDong = (typeof MA_LOI_GAN_DONG)[keyof typeof MA_LOI_GAN_DONG];
export type LoiGanDong = { code: string; ma: MaLoiGanDong; chiTiet: string };

export type DonNap = {
  id: string;
  code: string;
  type: string;
  status: string;
  deletedAt: Date | null;
  studentId: string | null;
  centerId: string | null;
  totalAmount: number;
  items: readonly { id: string; type: string; studentId: string | null; enrollmentId: string | null; itemName: string }[];
};

export type KhoanNap = { id: string; orderItemId: string | null; enrollmentId: string | null; amount: number };

export type DuLieuMotMuc = {
  don: DonNap;
  /** `Payment` SỐNG của đơn (chưa xoá mềm, kế toán chưa từ chối). */
  khoan: readonly KhoanNap[];
  hocVien: { id: string; deletedAt: Date | null; centerId: string | null } | null;
  ghiDanh: { id: string; studentId: string; status: string; centerId: string | null; deletedAt: Date | null; tenKhoa: string | null } | null;
  /** Số ghi danh CÒN SỐNG của học viên ghim. */
  soGhiDanhSong: number;
  /** MỌI dòng đơn (đơn nào, kể cả đơn đã xoá) đang trỏ `enrollmentId` = ghi danh ghim. */
  dongTroVaoGhiDanh: readonly { orderItemId: string; orderId: string }[];
};

export type TrangThaiMuc = "CHUA_GAN" | "DA_GAN" | "LECH";
export type DongGanDong = { orderId: string; code: string; orderItemId: string; studentId: string; enrollmentId: string };
export type MucKeHoach = { code: string; trangThai: TrangThaiMuc; dong: DongGanDong | null; loi: readonly LoiGanDong[] };

export type KeHoachGanDong = {
  muc: readonly MucKeHoach[];
  loi: readonly LoiGanDong[];
  dung: boolean;
  ghi: readonly DongGanDong[];
  daGanHet: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

/** Gọn tên để so: NFC, chữ thường, bỏ mọi ký tự không phải chữ/số («Sata 3» → «sata3»; «Sata3 — Ươm Mầm Tài Năng» → «sata3ươmmầmtàinăng»). */
const gonTen = (s: string) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Tên dòng đơn («Sata 3») KHỚP tên khoá của ghi danh («Sata3 — Ươm Mầm Tài Năng») khi tên khoá BẮT ĐẦU bằng tên dòng đơn và ký tự kế tiếp không phải chữ số
 * (để «Sata 3» không khớp «Sata 30»). Đây là đối chứng PHỤ — danh tính đã được ghim bằng id và bằng đường khoản thu; đo trên dữ liệu thật 01/11/2026
 * cho thấy tên dòng đơn KHÔNG bằng tên khoá, nên so bằng nhau sẽ chặn oan.
 */
export function khopTenKhoa(tenDong: string, tenKhoa: string): boolean {
  const a = gonTen(tenDong);
  const b = gonTen(tenKhoa);
  if (a.length < 4 || !b.startsWith(a)) return false;
  return !/\p{N}/u.test(b.charAt(a.length));
}

/** MỘT dòng/mục: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Không chứa tên/SĐT/email. */
export function dongDauRaGanDong(ghi: readonly DongGanDong[]): string[] {
  return ghi.map((g) => [KHUON_DONG_GAN_DONG_THEO_KHOAN, g.orderId, g.code, g.orderItemId, g.studentId, g.enrollmentId].join("|"));
}

export const shaKeHoachGanDong = (dong: readonly string[]) => createHash("sha256").update(dong.join("\n"), "utf8").digest("hex");

const loi = (code: string, ma: MaLoiGanDong, chiTiet: string): LoiGanDong => ({ code, ma, chiTiet });
const TRANG_THAI_DON_HOP_LE = ["CONFIRMED", "COMPLETED"] as const;

/** Kiểm MỘT mục. Báo hết lỗi một lượt (không dừng ở lỗi đầu). */
function kiemMotMuc(pv: MucPhamVi, d: DuLieuMotMuc): MucKeHoach {
  const { don } = d;
  const l: LoiGanDong[] = [];
  const them = (ma: MaLoiGanDong, chiTiet: string) => l.push(loi(pv.code, ma, chiTiet));

  if (don.deletedAt !== null) them("DON_DA_XOA", "đơn đã bị xoá mềm");
  if (don.type !== "COURSE") them("DON_KHONG_PHAI_KHOA_HOC", `loại đơn «${don.type}» ≠ COURSE`);
  if (!(TRANG_THAI_DON_HOP_LE as readonly string[]).includes(don.status)) them("TRANG_THAI_DON_LECH", `trạng thái đơn «${don.status}» ngoài ${TRANG_THAI_DON_HOP_LE.join("/")}`);
  if (don.totalAmount !== pv.tongDon) them("TONG_DON_LECH", `tổng đơn ${don.totalAmount} ≠ ${pv.tongDon} đã đối soát`);
  if (don.studentId !== pv.studentId) them("HOC_VIEN_DON_LECH", `Order.studentId ${don.studentId ?? "NULL"} ≠ học viên ghim ${pv.studentId}`);

  // ── dòng đơn ──
  if (don.items.length !== 1) them("SO_DONG_KHONG_DUNG", `đơn phải có ĐÚNG 1 dòng (đang có ${don.items.length})`);
  const dong = don.items.length === 1 ? don.items[0]! : null;
  if (dong !== null) {
    if (dong.id !== pv.orderItemId) them("DONG_KHAC_ID_GHIM", `dòng đơn ${dong.id} ≠ id ghim ${pv.orderItemId}`);
    if (dong.type !== "COURSE_ENROLLMENT") them("SO_DONG_KHONG_DUNG", `dòng đơn loại «${dong.type}» ≠ COURSE_ENROLLMENT`);
  }

  // ── học viên + ghi danh ──
  if (d.hocVien === null || d.hocVien.id !== pv.studentId || d.hocVien.deletedAt !== null) them("HOC_VIEN_KHONG_HOP_LE", "học viên ghim không tồn tại hoặc đã xoá mềm");
  const g = d.ghiDanh;
  if (g === null || g.id !== pv.enrollmentId || g.deletedAt !== null) them("GHI_DANH_KHONG_HOP_LE", "ghi danh ghim không tồn tại hoặc đã xoá mềm");
  else {
    if (g.status !== "ACTIVE") them("GHI_DANH_KHONG_ACTIVE", `ghi danh trạng thái «${g.status}» ≠ ACTIVE`);
    if (g.studentId !== pv.studentId) them("GHI_DANH_LECH_HOC_VIEN", `ghi danh thuộc học viên ${g.studentId} ≠ ${pv.studentId}`);
    if (g.centerId === null || don.centerId === null || g.centerId !== don.centerId) them("GHI_DANH_LECH_CO_SO", `cơ sở ghi danh ${g.centerId ?? "NULL"} ≠ cơ sở đơn ${don.centerId ?? "NULL"}`);
    if (dong !== null && (g.tenKhoa === null || !khopTenKhoa(dong.itemName, g.tenKhoa))) {
      them("TEN_KHOA_LECH", `tên dòng đơn «${dong.itemName}» không khớp tên khoá của ghi danh (đối chứng thứ hai ngoài khoản thu)`);
    }
  }
  if (d.soGhiDanhSong !== 1) them("NHIEU_GHI_DANH", `học viên có ${d.soGhiDanhSong} ghi danh sống (cần ĐÚNG 1 — nếu không, ghi danh «đúng» là phỏng đoán)`);

  // ── khoản thu: đường tiền thật ──
  if (d.khoan.length === 0) them("KHONG_CO_PAYMENT", "đơn không có khoản thu sống nào — không có bằng chứng liên kết");
  for (const k of d.khoan) {
    if (k.orderItemId !== pv.orderItemId) them("PAYMENT_KHONG_GAN_DONG", `khoản ${k.id} trỏ dòng đơn ${k.orderItemId ?? "NULL"} ≠ ${pv.orderItemId}`);
    if (k.enrollmentId !== pv.enrollmentId) them("PAYMENT_KHONG_GAN_GHI_DANH", `khoản ${k.id} trỏ ghi danh ${k.enrollmentId ?? "NULL"} ≠ ${pv.enrollmentId}`);
  }
  const tongKhoan = d.khoan.reduce((s, k) => s + k.amount, 0);
  if (d.khoan.length > 0 && tongKhoan !== don.totalAmount) them("TIEN_PAYMENT_LECH", `Σ khoản thu sống ${tongKhoan} ≠ tổng đơn ${don.totalAmount}`);

  // ── không dòng đơn NGOÀI phạm vi trỏ vào ghi danh này ──
  // (các dòng TRONG phạm vi cùng trỏ một ghi danh là CÓ CHỦ ĐÍCH — nhiều đợt học phí của cùng một ghi danh.)
  // Việc đối chiếu với tập id ghim của CẢ lô nằm ở `lapKeHoachGanDong` (cần thấy mọi mục).

  // ── trạng thái dòng ──
  let trangThai: TrangThaiMuc = "LECH";
  if (dong !== null) {
    if (dong.studentId === null && dong.enrollmentId === null) trangThai = "CHUA_GAN";
    else if (dong.studentId === pv.studentId && dong.enrollmentId === pv.enrollmentId) trangThai = "DA_GAN";
    else them("TRANG_THAI_DONG_LECH", `dòng đơn đang trỏ học viên ${dong.studentId ?? "NULL"} / ghi danh ${dong.enrollmentId ?? "NULL"} — chỉ chấp nhận «cả hai NULL» hoặc «đúng id ghim»; không sửa dòng đã trỏ SAI`);
  }
  const anh: DongGanDong = { orderId: don.id, code: pv.code, orderItemId: pv.orderItemId, studentId: pv.studentId, enrollmentId: pv.enrollmentId };
  return { code: pv.code, trangThai: l.length > 0 ? "LECH" : trangThai, dong: l.length > 0 ? null : anh, loi: l };
}

export function lapKeHoachGanDong(input: { phamVi: readonly MucPhamVi[]; du: readonly DuLieuMotMuc[] }): KeHoachGanDong {
  const loiLo: LoiGanDong[] = [];
  const muc: MucKeHoach[] = [];
  const idGhim = new Set(input.phamVi.map((p) => p.orderItemId));

  for (const pv of input.phamVi) {
    const cac = input.du.filter((x) => x.don.code === pv.code);
    if (cac.length !== 1) {
      const l = loi(pv.code, "THIEU_DON", cac.length === 0 ? "không có đơn mang mã này" : `${cac.length} đơn cùng mã`);
      loiLo.push(l);
      muc.push({ code: pv.code, trangThai: "LECH", dong: null, loi: [l] });
      continue;
    }
    const m = kiemMotMuc(pv, cac[0]!);
    // Dòng đơn NGOÀI phạm vi cùng trỏ vào ghi danh ghim ⇒ gắn thêm sẽ làm ghi danh nằm dưới nhiều đơn không được duyệt.
    const la = cac[0]!.dongTroVaoGhiDanh.filter((x) => !idGhim.has(x.orderItemId));
    const them = la.map((x) => loi(pv.code, "DONG_TRO_NGOAI_PHAM_VI", `dòng đơn ${x.orderItemId} (đơn ${x.orderId}) ngoài phạm vi đang trỏ vào ghi danh ghim`));
    muc.push(them.length > 0 ? { code: m.code, trangThai: "LECH", dong: null, loi: [...m.loi, ...them] } : m);
  }
  // Dữ liệu thừa ngoài phạm vi: người gọi không được nạp thêm mục ⇒ dừng.
  for (const x of input.du) if (!input.phamVi.some((p) => p.code === x.don.code)) loiLo.push(loi(x.don.code, "DON_NGOAI_PHAM_VI", "đơn nằm NGOÀI phạm vi cứng"));

  const loiTungMuc = muc.flatMap((m) => m.loi);
  const chua = muc.filter((m) => m.trangThai === "CHUA_GAN").length;
  const da = muc.filter((m) => m.trangThai === "DA_GAN").length;
  if (loiTungMuc.length === 0 && loiLo.length === 0 && chua > 0 && da > 0) {
    loiLo.push(loi(input.phamVi.map((p) => p.code).join(","), "LO_HON_HOP", `${chua} dòng chưa gắn + ${da} dòng đã gắn — lô lai, không ghi`));
  }

  const tatCaLoi = [...loiTungMuc, ...loiLo];
  const dung = tatCaLoi.length > 0;
  const ghi = dung ? [] : muc.filter((m) => m.trangThai === "CHUA_GAN").map((m) => m.dong!);
  const dongDauRa = dongDauRaGanDong(ghi);
  return {
    muc,
    loi: tatCaLoi,
    dung,
    ghi,
    daGanHet: !dung && muc.length > 0 && da === muc.length,
    dongDauRa,
    sha: shaKeHoachGanDong(dongDauRa),
  };
}

/** Cổng số duyệt `--expect=<N>`: N = số DÒNG ĐƠN sẽ ghi. Trả `null` nếu qua; ngược lại câu lỗi. */
export function quyetDinhGhiGanDong(i: { soDuyet: number | null; keHoach: KeHoachGanDong; ghiDuoc: boolean | null }): string | null {
  if (i.soDuyet === null) return "--ghi đòi --expect=<N> (số dòng đơn SẼ GHI của lượt chạy thử đã được duyệt).";
  if (Number.isNaN(i.soDuyet)) return "--expect phải là số nguyên không dấu (chỉ chữ số thập phân).";
  if (i.keHoach.dung) return `Kế hoạch DỪNG (${i.keHoach.loi.length} lỗi) — không ghi gì: ${i.keHoach.loi.map((x) => `${x.code}:${x.ma}`).join(" · ")}`;
  if (i.ghiDuoc !== true) return i.ghiDuoc === false ? "User kết nối không có quyền UPDATE trên OrderItem — không ghi." : "Không kiểm được quyền UPDATE trên OrderItem — không ghi.";
  if (i.soDuyet !== i.keHoach.ghi.length) return `Số duyệt ${i.soDuyet} ≠ kế hoạch lúc chạy ${i.keHoach.ghi.length} — không ghi.`;
  return null;
}

export type LuotChayGanDong = { batDauLuc: Date; nguonChay: NguonChayDiTru };
export const khoaLuotChayGanDong = (n: NguonChayDiTru) => `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;

export function dungBanGhiLuotGanDong(i: { luot: LuotChayGanDong; soDuyet: number; keHoach: KeHoachGanDong; daGhi: number }): Record<string, unknown> {
  if (!(i.luot.batDauLuc instanceof Date) || Number.isNaN(i.luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotGanDong: batDauLuc phải là mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
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
