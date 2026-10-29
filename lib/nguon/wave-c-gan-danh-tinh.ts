/**
 * lib/nguon/wave-c-gan-danh-tinh.ts — LÕI THUẦN của «PHASE C-A · gắn DANH TÍNH cho 18 đơn khoá học legacy» (26/10/2026).
 *
 * ── Việc này làm gì, và KHÔNG làm gì ────────────────────────────────────────────────────────────────────────
 * Audit C0 (25/10/2026, owner chấp nhận) tìm ra 18 đơn khoá học sống mà `convert` cũ đã bỏ quên danh tính: `Order.studentId`, `OrderItem.studentId`, `OrderItem.enrollmentId` NULL
 * (một đơn đã gắn dòng đơn, chỉ thiếu `Order.studentId`). PR #971 chặn lỗi ở đường GHI; lệnh này dọn phần ĐÃ SINH RA.
 * CHỈ BA CỘT: `Order.studentId` · `OrderItem.studentId` · `OrderItem.enrollmentId` (chỉ khi đang NULL hoặc đã đúng). KHÔNG giá, KHÔNG `Payment`, KHÔNG Receipt, KHÔNG hoa hồng,
 * KHÔNG `leadId` / nguồn. Giá là C-B, liên kết khoản thu là C-C — mỗi việc một lệnh, một chữ ký owner.
 *
 * ── Bằng chứng danh tính: KHOÁ BÉ (`leadChildId`), mọi đường phải trùng nhau ───────────────────────────────────
 * Khoá bé = `metadata.leadChildId` của dòng đơn, nếu không có thì `Order.leadChildId`; có cả hai mà khác nhau ⇒ dừng. Bé phải thuộc lead của đơn (cùng cơ sở).
 * Học viên = ĐÚNG MỘT `Student` còn sống có `leadChildId` = khoá bé (cùng lead, cùng cơ sở). Ghi danh = ĐÚNG MỘT ghi danh còn hiệu lực của học viên đó, cùng KHOÁ HỌC ghi trên dòng đơn,
 * cùng cơ sở với đơn (trạng thái không phải CANCELLED / WITHDREW / TRANSFERRED). Trạng thái «chưa gắn» đòi thêm `Enrollment.leadChildId` = khoá bé. Ghi danh chưa dòng đơn nào khác trỏ vào.
 * Phép dò theo SĐT phụ huynh KHÔNG được dùng: anh chị em cùng số điện thoại là nguồn gắn nhầm (PHASE A đã phải chặn «nhiều học viên»).
 *
 * ── Hai trạng thái xuất phát được phép (bảng cứng khai từng đơn, lệch ⇒ dừng) ────────────────────────────────
 *   · CHUA_GAN     — cả ba cột NULL ⇒ ghi 3 cột.
 *   · DONG_DA_GAN  — dòng đơn đã trỏ ĐÚNG học viên + ghi danh (do đường khác gắn trước), chỉ thiếu `Order.studentId` ⇒ ghi 1 cột. Dòng đơn đã trỏ SAI ⇒ dừng, không sửa.
 *   Sau khi ghi (hoặc chạy lại): cả ba cột đúng ⇒ «ĐÃ GẮN» ⇒ 0 dòng ghi.
 *
 * ── Fail-closed ─────────────────────────────────────────────────────────────────────────────────────────────
 * MỘT đơn lệch bất kỳ điều kiện nào ⇒ `dung = true`, KHÔNG dòng ghi nào (cả lô dừng). Lô lai (một số đã gắn đúng, số khác chưa) ⇒ dừng. Hai đơn cùng ghi danh ⇒ dừng.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env. Tầng DB: `wave-c-gan-danh-tinh-db.ts`.
 */
import { docBeTrenDongWaveC, docKhoaTrenDongWaveC, shaDongWaveC } from "./wave-c-chung";

export const KHUON_DONG_WAVE_C_A = "wave-c-gan-danh-tinh/v1";
export const LY_DO_WAVE_C_A = "PHASE C-A: gắn danh tính cho đơn khoá học legacy — chỉ đổi Order.studentId / OrderItem.studentId / OrderItem.enrollmentId, không đổi giá / khoản thu / hoa hồng";
export const HANH_DONG_WAVE_C_A = "GAN_DANH_TINH_DON_WAVE_C";
export const HANH_DONG_WAVE_C_A_LUOT = "GAN_DANH_TINH_DON_WAVE_C_LUOT_CHAY";
export const TRANG_THAI_GHI_DANH_LOAI_WAVE_C = ["CANCELLED", "WITHDREW", "TRANSFERRED"] as const;

export type TruocWaveCA = "CHUA_GAN" | "DONG_DA_GAN";
export type MucWaveCA = {
  /** `Order.totalAmount` đã audit — điều kiện «chưa trôi». KHÔNG phải định danh. */
  tongDon: number;
  /** Trạng thái liên kết đã audit của đơn. */
  truoc: TruocWaveCA;
};

/**
 * PHẠM VI CỨNG: đúng 18 mã đơn (nhóm A + B + C của audit C0, 25/10/2026). KHÔNG id học viên / ghi danh / khoản thu / mã giao dịch ở đây (gương CI công khai):
 * mọi định danh thật được ĐỌC TỪ DB lúc chạy và in vào dòng ký (artifact riêng tư của owner). Không có tham số dòng lệnh / ô workflow đổi bảng này (lưới `[WCA-W*]`).
 * Thứ tự = thứ tự báo cáo/ghi.
 */
export const BANG_WAVE_C_A: Readonly<Record<string, MucWaveCA>> = {
  "ORD-260908-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-260908-000002": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-260910-000004": { tongDon: 8_640_000, truoc: "CHUA_GAN" },
  "ORD-260910-000007": { tongDon: 11_424_000, truoc: "CHUA_GAN" },
  "ORD-260910-000009": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-260911-000001": { tongDon: 11_424_000, truoc: "CHUA_GAN" },
  "ORD-260912-000001": { tongDon: 9_792_000, truoc: "CHUA_GAN" },
  "ORD-260912-000002": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-260913-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-260920-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-260921-000001": { tongDon: 10_560_000, truoc: "CHUA_GAN" },
  "ORD-260928-000001": { tongDon: 10_560_000, truoc: "CHUA_GAN" },
  "ORD-260929-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-261001-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-261004-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-261013-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  "ORD-261016-000001": { tongDon: 8_976_000, truoc: "CHUA_GAN" },
  // Dòng đơn đã được đường khác gắn đúng học viên + ghi danh; chỉ thiếu Order.studentId ⇒ ghi MỘT cột.
  "ORD-261017-000001": { tongDon: 8_976_000, truoc: "DONG_DA_GAN" },
};
export const MA_DON_WAVE_C_A: readonly string[] = Object.keys(BANG_WAVE_C_A);

export const MA_LOI_WAVE_C_A = {
  THIEU_DON: "THIEU_DON",
  KHONG_CO_MUC_TIEU: "KHONG_CO_MUC_TIEU",
  DON_DA_XOA: "DON_DA_XOA",
  DON_KHONG_PHAI_KHOA_HOC: "DON_KHONG_PHAI_KHOA_HOC",
  SO_DONG_KHONG_DUNG: "SO_DONG_KHONG_DUNG",
  TONG_DON_LECH: "TONG_DON_LECH",
  THIEU_LEAD: "THIEU_LEAD",
  LEAD_KHONG_HOP_LE: "LEAD_KHONG_HOP_LE",
  THIEU_BE: "THIEU_BE",
  XUNG_DOT_BE: "XUNG_DOT_BE",
  BE_KHONG_THUOC_LEAD: "BE_KHONG_THUOC_LEAD",
  KHONG_CO_HOC_VIEN: "KHONG_CO_HOC_VIEN",
  NHIEU_HOC_VIEN: "NHIEU_HOC_VIEN",
  HOC_VIEN_LECH_LEAD: "HOC_VIEN_LECH_LEAD",
  HOC_VIEN_LECH_CO_SO: "HOC_VIEN_LECH_CO_SO",
  THIEU_KHOA_TREN_DONG: "THIEU_KHOA_TREN_DONG",
  KHONG_CO_GHI_DANH: "KHONG_CO_GHI_DANH",
  NHIEU_GHI_DANH: "NHIEU_GHI_DANH",
  GHI_DANH_LECH_BE: "GHI_DANH_LECH_BE",
  GHI_DANH_DA_BI_DUNG: "GHI_DANH_DA_BI_DUNG",
  DONG_DON_TRO_SAI: "DONG_DON_TRO_SAI",
  TRANG_THAI_GAN_LECH: "TRANG_THAI_GAN_LECH",
  TRUOC_LECH_BANG: "TRUOC_LECH_BANG",
  TRUNG_GHI_DANH: "TRUNG_GHI_DANH",
  LO_HON_HOP: "LO_HON_HOP",
} as const;
export type MaLoiWaveCA = (typeof MA_LOI_WAVE_C_A)[keyof typeof MA_LOI_WAVE_C_A];
export type LoiWaveCA = { code: string; ma: MaLoiWaveCA; chiTiet: string };

export type DongDonWaveCA = { id: string; type: string; studentId: string | null; enrollmentId: string | null; metadata: unknown };

export type DuLieuWaveCA = {
  don: {
    id: string;
    code: string;
    type: string;
    deletedAt: Date | null;
    studentId: string | null;
    leadId: string | null;
    leadChildId: string | null;
    centerId: string | null;
    totalAmount: number;
    items: readonly DongDonWaveCA[];
  };
  lead: { id: string; centerId: string | null; deletedAt: Date | null } | null;
  /** Bé (LeadChild) có id = khoá bé suy ra của đơn. */
  be: { id: string; leadId: string } | null;
  /** Học viên CÒN SỐNG có `leadChildId` = khoá bé. */
  hocVien: readonly { id: string; leadId: string | null; leadChildId: string | null; centerId: string | null }[];
  /** Ghi danh CÒN SỐNG của các học viên trên. */
  ghiDanh: readonly { id: string; studentId: string; courseId: string | null; status: string; leadChildId: string | null; centerId: string | null }[];
  /** Mọi dòng đơn (đơn nào, kể cả đã xoá) đang trỏ `enrollmentId` vào một ghi danh ở trên. */
  dongTroVaoGhiDanh: readonly { orderItemId: string; orderId: string; enrollmentId: string }[];
};

export type CheGhiWaveCA = "3COT" | "1COT";
export type TrangThaiWaveCA = "CHUA_GAN" | "DONG_DA_GAN" | "DA_GAN" | "LECH";

export type DongGhiWaveCA = {
  orderId: string;
  code: string;
  orderItemId: string;
  studentId: string;
  enrollmentId: string;
  che: CheGhiWaveCA;
};

export type MucKeHoachWaveCA = {
  code: string;
  trangThai: TrangThaiWaveCA;
  /** Ánh xạ suy ra (có cả khi đã gắn, để báo cáo); `null` nếu chưa suy ra được. */
  anhXa: { orderId: string; orderItemId: string; studentId: string; enrollmentId: string } | null;
  loi: readonly LoiWaveCA[];
};

export type KeHoachWaveCA = {
  muc: readonly MucKeHoachWaveCA[];
  loi: readonly LoiWaveCA[];
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  ghi: readonly DongGhiWaveCA[];
  /** Cả lô đã gắn ĐÚNG ⇒ chạy lại ghi 0 dòng. */
  daGanHet: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

const loi = (code: string, ma: MaLoiWaveCA, chiTiet: string): LoiWaveCA => ({ code, ma, chiTiet });

/**
 * Khoá bé của một đơn: `metadata.leadChildId` của dòng đơn, không có thì `Order.leadChildId`. Có cả hai mà KHÁC nhau ⇒ `xungDot`.
 * Tầng DB dùng CHÍNH hàm này để biết nạp học viên nào (một nguồn, không hai cách đọc).
 */
export function khoaBeCuaDon(leadChildIdDon: string | null, metadataDong: unknown): { khoa: string | null; xungDot: boolean } {
  const trenDong = docBeTrenDongWaveC(metadataDong);
  if (trenDong !== null && leadChildIdDon !== null && trenDong !== leadChildIdDon) return { khoa: null, xungDot: true };
  return { khoa: trenDong ?? leadChildIdDon, xungDot: false };
}

/** MỘT dòng/đơn: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Ràng cả CHẾ ĐỘ ghi (3 cột / 1 cột). Không chứa tên/SĐT/email. */
export function dongDauRaWaveCA(ghi: readonly DongGhiWaveCA[]): string[] {
  return ghi.map((g) => [KHUON_DONG_WAVE_C_A, g.orderId, g.code, g.orderItemId, g.studentId, g.enrollmentId, g.che].join("|"));
}

function kiemMotDon(d: DuLieuWaveCA, muc: MucWaveCA): MucKeHoachWaveCA {
  const { don } = d;
  const code = don.code;
  const l: LoiWaveCA[] = [];
  const them = (ma: MaLoiWaveCA, chiTiet: string) => l.push(loi(code, ma, chiTiet));

  // ── đơn ──
  if (don.deletedAt !== null) them("DON_DA_XOA", "đơn đã bị xoá mềm");
  if (don.type !== "COURSE") them("DON_KHONG_PHAI_KHOA_HOC", `loại đơn «${don.type}» ≠ COURSE`);
  const dongKhoa = don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (don.items.length !== 1 || dongKhoa.length !== 1) {
    them("SO_DONG_KHONG_DUNG", `đơn phải có ĐÚNG 1 dòng và dòng đó là COURSE_ENROLLMENT (đang có ${don.items.length} dòng, ${dongKhoa.length} dòng COURSE_ENROLLMENT)`);
  }
  const dong = dongKhoa.length === 1 ? dongKhoa[0]! : null;
  if (don.totalAmount !== muc.tongDon) them("TONG_DON_LECH", `Order.totalAmount ${don.totalAmount} ≠ ${muc.tongDon} đã audit (đơn đã trôi)`);

  // ── lead ──
  if (don.leadId === null) them("THIEU_LEAD", "Order.leadId NULL");
  else if (d.lead === null || d.lead.id !== don.leadId) them("THIEU_LEAD", "không đọc được lead của đơn");
  else {
    if (d.lead.deletedAt !== null) them("LEAD_KHONG_HOP_LE", "lead đã xoá mềm");
    if (d.lead.centerId === null || d.lead.centerId !== don.centerId) them("LEAD_KHONG_HOP_LE", `lead khác cơ sở với đơn (${d.lead.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
  }

  // ── khoá bé ──
  const kb = khoaBeCuaDon(don.leadChildId, dong?.metadata);
  const ck = kb.khoa;
  if (kb.xungDot) them("XUNG_DOT_BE", "metadata.leadChildId của dòng đơn ≠ Order.leadChildId");
  else if (ck === null) them("THIEU_BE", "đơn không có khoá bé (metadata.leadChildId lẫn Order.leadChildId đều trống)");
  else if (d.be === null || d.be.id !== ck) them("THIEU_BE", "không đọc được bé (LeadChild) của đơn");
  else if (d.be.leadId !== don.leadId) them("BE_KHONG_THUOC_LEAD", "bé trên đơn không thuộc lead của đơn");

  // ── học viên: ĐÚNG MỘT, theo khoá bé ──
  let hv: DuLieuWaveCA["hocVien"][number] | null = null;
  if (ck !== null && !kb.xungDot) {
    if (d.hocVien.length === 0) them("KHONG_CO_HOC_VIEN", "không có học viên còn sống nào mang khoá bé này");
    else if (d.hocVien.length > 1) them("NHIEU_HOC_VIEN", `${d.hocVien.length} học viên cùng khoá bé: ${d.hocVien.map((u) => u.id).join(", ")} — không đoán`);
    else {
      hv = d.hocVien[0]!;
      if (hv.leadId !== don.leadId) them("HOC_VIEN_LECH_LEAD", "Student.leadId ≠ Order.leadId");
      if (hv.centerId === null || hv.centerId !== don.centerId) them("HOC_VIEN_LECH_CO_SO", `học viên khác cơ sở với đơn (${hv.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
    }
  }

  // ── ghi danh: ĐÚNG MỘT còn hiệu lực của học viên đó, cùng khoá + cơ sở ──
  let gd: DuLieuWaveCA["ghiDanh"][number] | null = null;
  const khoa = dong === null ? null : docKhoaTrenDongWaveC(dong.metadata);
  if (hv !== null) {
    if (khoa === null) them("THIEU_KHOA_TREN_DONG", "dòng đơn không ghi courseId — không đối chiếu được khoá");
    else {
      const ung = d.ghiDanh.filter(
        (e) => e.studentId === hv!.id && e.courseId === khoa && e.centerId === don.centerId && !(TRANG_THAI_GHI_DANH_LOAI_WAVE_C as readonly string[]).includes(e.status),
      );
      if (ung.length === 0) them("KHONG_CO_GHI_DANH", "học viên không có ghi danh còn hiệu lực cùng khoá + cùng cơ sở với đơn");
      else if (ung.length > 1) them("NHIEU_GHI_DANH", `học viên có ${ung.length} ghi danh còn hiệu lực cùng khoá + cơ sở — không đoán`);
      else gd = ung[0]!;
    }
  }

  // ── dòng đơn / ghi danh: không đè, không dùng chung ──
  if (gd !== null && dong !== null) {
    const biDung = d.dongTroVaoGhiDanh.filter((x) => x.enrollmentId === gd!.id && x.orderItemId !== dong.id);
    if (biDung.length > 0) them("GHI_DANH_DA_BI_DUNG", `ghi danh đã có ${biDung.length} dòng đơn khác trỏ vào`);
  }

  // ── trạng thái liên kết hiện tại ──
  let trangThai: TrangThaiWaveCA = "LECH";
  const anhXa = dong !== null && hv !== null && gd !== null ? { orderId: don.id, orderItemId: dong.id, studentId: hv.id, enrollmentId: gd.id } : null;
  if (dong !== null && hv !== null && gd !== null && anhXa !== null) {
    const chua = don.studentId === null && dong.studentId === null && dong.enrollmentId === null;
    const dongDa = don.studentId === null && dong.studentId === anhXa.studentId && dong.enrollmentId === anhXa.enrollmentId;
    const daGan = don.studentId === anhXa.studentId && dong.studentId === anhXa.studentId && dong.enrollmentId === anhXa.enrollmentId;
    if (daGan) trangThai = "DA_GAN";
    else if (chua) trangThai = "CHUA_GAN";
    else if (dongDa) trangThai = "DONG_DA_GAN";
    else if ((dong.studentId !== null && dong.studentId !== anhXa.studentId) || (dong.enrollmentId !== null && dong.enrollmentId !== anhXa.enrollmentId)) {
      them("DONG_DON_TRO_SAI", "dòng đơn đã trỏ vào học viên / ghi danh KHÁC với kết quả suy từ khoá bé — không sửa, không đè");
    } else {
      them("TRANG_THAI_GAN_LECH", `liên kết hiện tại không phải «chưa gắn», «dòng đơn đã gắn đúng» hay «đã gắn đúng» (Order.studentId=${don.studentId ?? "NULL"}, dòng.studentId=${dong.studentId ?? "NULL"}, dòng.enrollmentId=${dong.enrollmentId ?? "NULL"})`);
    }
    if ((trangThai === "CHUA_GAN" || trangThai === "DONG_DA_GAN") && trangThai !== muc.truoc) {
      them("TRUOC_LECH_BANG", `trạng thái liên kết hiện tại «${trangThai}» ≠ «${muc.truoc}» đã audit (đơn đã trôi)`);
    }
    if (trangThai === "CHUA_GAN" && gd.leadChildId !== ck) them("GHI_DANH_LECH_BE", "trạng thái «chưa gắn» đòi Enrollment.leadChildId = khoá bé của đơn");
  }
  return { code, trangThai: l.length > 0 ? "LECH" : trangThai, anhXa, loi: l };
}

/**
 * Lập kế hoạch cho cả lô. `bang` là phạm vi CỨNG (thứ tự = thứ tự báo cáo/ghi). Mọi mã phải có đúng một đơn trong dữ liệu.
 * Fail-closed: bất kỳ lỗi nào (của một đơn hay của cả lô) ⇒ `dung` và `ghi = []`.
 */
export function lapKeHoachWaveCA(input: { bang: Readonly<Record<string, MucWaveCA>>; du: readonly DuLieuWaveCA[] }): KeHoachWaveCA {
  const loiLo: LoiWaveCA[] = [];
  const muc: MucKeHoachWaveCA[] = [];
  const ma = Object.keys(input.bang);
  for (const code of ma) {
    const cac = input.du.filter((x) => x.don.code === code);
    if (cac.length !== 1) {
      loiLo.push(loi(code, "THIEU_DON", cac.length === 0 ? "không có đơn mang mã này" : `${cac.length} đơn cùng mã`));
      muc.push({ code, trangThai: "LECH", anhXa: null, loi: [loi(code, "THIEU_DON", `đọc được ${cac.length} đơn`)] });
      continue;
    }
    muc.push(kiemMotDon(cac[0]!, input.bang[code]!));
  }
  for (const x of input.du) if (!(x.don.code in input.bang)) loiLo.push(loi(x.don.code, "KHONG_CO_MUC_TIEU", "đơn nằm NGOÀI phạm vi cứng"));

  // Hai đơn cùng ghi danh — dù từng đơn sạch.
  const dem = new Map<string, string[]>();
  for (const m of muc) if (m.anhXa) dem.set(m.anhXa.enrollmentId, [...(dem.get(m.anhXa.enrollmentId) ?? []), m.code]);
  for (const [id, codes] of dem) if (codes.length > 1) loiLo.push(loi(codes.join(","), "TRUNG_GHI_DANH", `ghi danh ${id} là đích của ${codes.length} đơn`));

  const loiTungDon = muc.flatMap((m) => m.loi);
  const cacDaGan = muc.filter((m) => m.trangThai === "DA_GAN").length;
  const cacChuaXong = muc.filter((m) => m.trangThai === "CHUA_GAN" || m.trangThai === "DONG_DA_GAN").length;
  if (loiTungDon.length === 0 && loiLo.length === 0 && cacDaGan > 0 && cacChuaXong > 0) {
    loiLo.push(loi(ma.join(","), "LO_HON_HOP", `${cacChuaXong} đơn chưa gắn xong + ${cacDaGan} đơn đã gắn đúng — lô lai, không ghi`));
  }
  const tatCaLoi = [...loiTungDon, ...loiLo];
  const dung = tatCaLoi.length > 0;
  const ghi: DongGhiWaveCA[] = dung
    ? []
    : muc
        .filter((m) => m.trangThai === "CHUA_GAN" || m.trangThai === "DONG_DA_GAN")
        .map((m) => ({ ...m.anhXa!, code: m.code, che: (m.trangThai === "CHUA_GAN" ? "3COT" : "1COT") as CheGhiWaveCA }));
  const dongDauRa = dongDauRaWaveCA(ghi);
  return { muc, loi: tatCaLoi, dung, ghi, daGanHet: !dung && muc.length > 0 && cacDaGan === muc.length, dongDauRa, sha: shaDongWaveC(dongDauRa) };
}
