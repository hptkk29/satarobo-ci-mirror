/**
 * lib/nguon/sua-gia-theo-don.ts — LÕI THUẦN của «chuẩn hoá GIÁ GHI DANH theo đơn đã duyệt và đã đóng đủ — phạm vi SUY TỪ BẰNG CHỨNG» (P7-A, nhóm G1a, 26/10/2026).
 *
 * ── Khác Wave 1 / Wave C-B ở đâu ────────────────────────────────────────────────────────────────────────────
 * Wave 1 khoá cứng 6 mã đơn, Wave C-B khoá cứng 16 mã đơn (bảng hằng trong mã). Lệnh này KHÔNG có bảng mã đơn: mỗi đơn khoá học còn sống được xét bằng một QUY TẮC bằng chứng, đơn nào qua mới vào phạm vi,
 * và phạm vi (kèm giá TRƯỚC / SAU từng ghi danh) được owner KÝ ở bước chạy thử — cổng Wave 1 đòi dòng ký bằng đúng dòng lõi tự dựng lại ở bước ghi, nên một đơn mới đủ điều kiện sau lượt chạy thử làm lệch chữ ký ⇒ không ghi.
 * Phần quyết định GIÁ, kiểm TIỀN, kiểm DANH TÍNH, kiểm bằng chứng giảm là CHÍNH `lapKeHoachWaveCB` (không viết lõi thứ ba): ở đây chỉ DỰNG `MucWaveCB` cho từng đơn rồi hỏi lõi đó.
 *
 * ── Quy tắc dựng `MucWaveCB` từ một đơn ─────────────────────────────────────────────────────────────────────
 *   · đơn KHÔNG thuộc `MA_DON_WAVE_C_B` (Wave C-B đã có lệnh riêng; hai lệnh không được cùng sở hữu một ghi danh);
 *   · đúng 1 dòng và dòng đó là COURSE_ENROLLMENT;
 *   · bằng chứng giảm: ORDER (`Order.discountPercent` + APPROVED) hoặc ITEM (`OrderItem.discounts` đúng 1 bản ghi PHAN_TRAM); % phải thuộc `PHAN_TRAM_CHO_PHEP` (15, 25 — hai mức Wave C đã audit);
 *   · giá niêm yết = `Order.subtotal`; giá ghi danh hiện tại phải là «legacy» MỘT TRONG HAI dạng: niêm yết trần (`listPrice = finalPrice = tuition = subtotal`, không loại giảm, giảm 0) hoặc CẢ NĂM cột NULL
 *     (dạng NULL chỉ qua nếu lõi chứng minh nguồn giá niêm yết: `Course.price` = `Order.subtotal` và `Course.updatedAt` trước thời điểm tạo đơn — cùng điều kiện `ghiListPrice` của Wave C-B);
 *   · mọi điều kiện còn lại (Σ Payment sống = giá đích, RECORDED + CONFIRMED, Σ phân bổ ngân hàng MATCHED = giá đích, ghi danh còn hiệu lực, khoản đã gắn thì gắn đúng ghi danh) do `lapKeHoachWaveCB` kiểm.
 * Đơn trượt BẤT KỲ điều kiện nào ⇒ vào danh sách `loai` kèm mã lý do (KHÔNG nới quy tắc cho qua) và KHÔNG làm dừng cả lô — lô chỉ gồm những đơn mà lõi nói «sạch». Sau đó lô được lập kế hoạch lại MỘT lần như
 * một tổng thể (kể cả kiểm trùng ghi danh) và fail-closed như Wave C-B.
 *
 * ── Danh tính: gắn dòng đơn → ghi danh khi CHỨNG MINH được ──────────────────────────────────────────────────
 * Đơn lập tay trước PR #980 có `Order.studentId` + `OrderItem.studentId` nhưng `OrderItem.enrollmentId` NULL (không nằm trong 18 đơn C-A, vì C-A chỉ lo đơn thiếu `Order.studentId`). Lõi C-B đòi dòng đơn đã trỏ ghi danh.
 * Ở đây dòng đơn được gắn (MỘT cột: `OrderItem.enrollmentId`, NULL → ghi danh) CHỈ KHI đủ BỐN bằng chứng độc lập: (1) `Order.studentId` = `OrderItem.studentId` (khác NULL); (2) học viên đó có ĐÚNG MỘT ghi danh còn hiệu lực
 * cùng khoá (dòng đơn) + cơ sở (đơn); (3) MỌI khoản thu sống đã gắn ghi danh đều trỏ về chính ghi danh đó (ít nhất một khoản); (4) chưa có dòng đơn nào khác trỏ vào ghi danh đó; và nếu cả hai phía có bé (`leadChildId`) thì phải trùng.
 * Không đủ ⇒ KHÔNG gắn, đơn vào danh sách loại để owner/kế toán xem tay. Dòng ký ràng CẢ việc gắn (`GAN_DONG:<id dòng đơn>`).
 *
 * ── Điều lệnh này CỐ Ý không bao giờ chạm (đo bằng quy tắc, không bằng danh sách) ───────────────────────────
 *   · đơn chưa đóng đủ giá đích (nhóm G1b — «đóng full giảm 15%» khoá giá trước khi đủ tiền là quyết định kinh doanh) ⇒ `TIEN_PAYMENT_LECH`;
 *   · đơn mua theo số buổi (dòng đơn thấp hơn niêm yết của khoá nên `Order.subtotal` ≠ `Enrollment.listPrice`) ⇒ `GIA_KHONG_PHAI_LEGACY`;
 *   · ghi danh đã đóng (WITHDREW/TRANSFERRED/CANCELLED) ⇒ không suy được ghi danh / `GHI_DANH_KHONG_HIEU_LUC`; học bổng / chỉnh tay ⇒ `GIA_KHONG_PHAI_LEGACY`; % lạ (kể cả 14% ≠ 15%) ⇒ `PHAN_TRAM_NGOAI_CHINH_SACH`;
 *   · khoản thu bị TỪ CHỐI còn sống trên đơn ⇒ `PAYMENT_KHONG_HOP_LE` (kế toán phải xoá mềm hoặc giải thích trước, lệnh không tự gạt đi).
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { TRANG_THAI_GHI_DANH_LOAI_WAVE_C } from "./wave-c-gan-danh-tinh";
import { docBeTrenDongWaveC, docKhoaTrenDongWaveC, shaDongWaveC } from "./wave-c-chung";
import {
  MA_DON_WAVE_C_B,
  chuoiGiaWaveCB,
  giaDichWaveCB,
  lapKeHoachWaveCB,
  type DongGhiWaveCB,
  type DuLieuWaveCB,
  type GiaGhiDanh,
  type KeHoachWaveCB,
  type MucWaveCB,
  type NguonBangChungWaveCB,
} from "./wave-c-sua-gia-ghi-danh";

export type { DongGhiWaveCB, DuLieuWaveCB, GiaGhiDanh, KeHoachWaveCB, MucWaveCB };

/** Danh tính của lệnh trong cổng ký, audit và dòng ký — KHÁC mọi lệnh khác (workflow riêng ⇒ `SAI_WORKFLOW` nếu dùng chéo artifact). */
export const KHUON_DONG_SUA_GIA_THEO_DON = "sua-gia-theo-don/v1";
export const LY_DO_SUA_GIA_THEO_DON =
  "P7-A: chuẩn hóa giá ghi danh legacy theo đơn đã duyệt và đã đóng đủ (nhóm G1a) — chỉ đổi discountType / discountAmount / finalPrice / tuition (listPrice chỉ đọc, trừ ghi danh có cả năm cột giá NULL); gắn OrderItem.enrollmentId khi chứng minh được";
export const LY_DO_GAN_DONG_THEO_DON = "P7-A: gắn dòng đơn khoá học vào ghi danh đã được chứng minh bằng 4 bằng chứng độc lập (học viên · khoá · cơ sở · khoản thu đã gắn)";
export const HANH_DONG_SUA_GIA_THEO_DON = "CHUAN_HOA_GIA_GHI_DANH_THEO_DON";
export const HANH_DONG_GAN_DONG_THEO_DON = "GAN_DONG_DON_GHI_DANH_THEO_DON";
export const HANH_DONG_SUA_GIA_THEO_DON_LUOT = "CHUAN_HOA_GIA_GHI_DANH_THEO_DON_LUOT_CHAY";
export const ENTITY_LUOT_SUA_GIA_THEO_DON = "SuaGiaTheoDon";

/** Hai mức giảm đã được audit ở PHASE C (15% «đóng full» và 25% chính sách cũ). Mức khác (5%, 10%, 14%…) cần bảng chính sách / quyết định owner — KHÔNG tự sửa. */
export const PHAN_TRAM_CHO_PHEP: readonly number[] = [15, 25];

export const MA_LOAI_SUA_GIA_THEO_DON = {
  THUOC_WAVE_C_B: "THUOC_WAVE_C_B",
  KHONG_PHAI_MOT_DONG_KHOA: "KHONG_PHAI_MOT_DONG_KHOA",
  KHONG_SUY_RA_GHI_DANH: "KHONG_SUY_RA_GHI_DANH",
  KHONG_CO_BANG_CHUNG_GIAM: "KHONG_CO_BANG_CHUNG_GIAM",
  PHAN_TRAM_NGOAI_CHINH_SACH: "PHAN_TRAM_NGOAI_CHINH_SACH",
  GIA_KHONG_PHAI_LEGACY: "GIA_KHONG_PHAI_LEGACY",
  KHONG_XEP_DUOC: "KHONG_XEP_DUOC",
} as const;

/** Một đơn bị loại khỏi phạm vi: mã lý do của quy tắc dựng bảng, hoặc mã lỗi của lõi (`MA_LOI_WAVE_C_B`). */
export type DonBiLoai = { code: string; ma: string; chiTiet: string };

/** Ghi danh của học viên trên đơn — để chứng minh «ĐÚNG MỘT ghi danh còn hiệu lực cùng khoá + cơ sở». */
export type GhiDanhCuaHocVien = {
  id: string;
  studentId: string;
  courseId: string | null;
  centerId: string | null;
  status: string;
  deletedAt: Date | null;
  leadChildId: string | null;
  gia: GiaGhiDanh;
};

export type DuLieuTheoDon = DuLieuWaveCB & {
  /** `Order.leadChildId` (bé ghi trên đơn); `null` nếu đơn không ghi. */
  beTrenDon: string | null;
  /** MỌI ghi danh (kể cả đã đóng / đã xoá mềm) của `Order.studentId`; rỗng nếu đơn chưa có học viên. */
  ghiDanhCuaHocVien: readonly GhiDanhCuaHocVien[];
  /** Ghi danh nào đang bị dòng đơn KHÁC (không phải dòng khoá của đơn này) trỏ tới. */
  ghiDanhDaCoDongKhac: readonly string[];
};

const legacy = (list: number): GiaGhiDanh => ({ listPrice: list, discountType: null, discountAmount: 0, tuition: list, finalPrice: list });
const TRONG: GiaGhiDanh = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const giongGia = (a: GiaGhiDanh, b: GiaGhiDanh) =>
  a.listPrice === b.listPrice && a.discountType === b.discountType && a.discountAmount === b.discountAmount && a.tuition === b.tuition && a.finalPrice === b.finalPrice;

function banGhiGiamDonLe(discounts: unknown): Record<string, unknown> | null {
  if (!Array.isArray(discounts)) return null;
  const ban = discounts.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x));
  return ban.length === 1 ? ban[0]! : null;
}

export type LienKetDong = { orderItemId: string; enrollmentId: string };

/**
 * Dòng đơn đã trỏ ghi danh ⇒ không cần gắn (`lienKet = null`, dữ liệu giữ nguyên). Chưa trỏ ⇒ chứng minh bằng 4 bằng chứng (đầu tệp); đủ ⇒ trả dữ liệu ĐÃ GẮN ẢO để lõi C-B xét, kèm `lienKet` cần ghi.
 */
export function suyLienKetDong(d: DuLieuTheoDon): { du: DuLieuWaveCB; lienKet: LienKetDong | null } | { loai: DonBiLoai } {
  const code = d.don.code;
  const loai = (chiTiet: string) => ({ loai: { code, ma: "KHONG_SUY_RA_GHI_DANH", chiTiet } });
  const dongKhoa = d.don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (d.don.items.length !== 1 || dongKhoa.length !== 1) {
    return { loai: { code, ma: "KHONG_PHAI_MOT_DONG_KHOA", chiTiet: `đơn phải có đúng 1 dòng COURSE_ENROLLMENT (đang ${d.don.items.length} dòng, ${dongKhoa.length} dòng khoá)` } };
  }
  const dong = dongKhoa[0]!;
  if (dong.enrollmentId !== null) return { du: d, lienKet: null };

  // (1) học viên của đơn và của dòng đơn
  if (d.don.studentId === null || dong.studentId === null || d.don.studentId !== dong.studentId) return loai("Order.studentId / OrderItem.studentId thiếu hoặc khác nhau");
  // (2) đúng MỘT ghi danh còn hiệu lực cùng khoá + cơ sở
  const khoa = docKhoaTrenDongWaveC(dong.metadata);
  if (khoa === null) return loai("dòng đơn không ghi khoá học (metadata.courseId)");
  const ungVien = d.ghiDanhCuaHocVien.filter(
    (g) => g.studentId === d.don.studentId && g.deletedAt === null && !(TRANG_THAI_GHI_DANH_LOAI_WAVE_C as readonly string[]).includes(g.status) && g.courseId === khoa && g.centerId !== null && g.centerId === d.don.centerId,
  );
  if (ungVien.length !== 1) return loai(`học viên có ${ungVien.length} ghi danh còn hiệu lực cùng khoá + cơ sở (đòi đúng 1)`);
  const ge = ungVien[0]!;
  // (3) khoản thu sống đã gắn ghi danh nào thì phải CÙNG MỘT ghi danh này, và có ít nhất một khoản đã gắn
  const daGan = d.paymentSong.filter((p) => p.enrollmentId !== null);
  if (daGan.length === 0) return loai("không khoản thu sống nào của đơn đã gắn ghi danh — thiếu bằng chứng độc lập");
  if (daGan.some((p) => p.enrollmentId !== ge.id)) return loai("có khoản thu đã gắn ghi danh KHÁC ghi danh ứng viên");
  // (4) chưa dòng đơn khác nào trỏ vào ghi danh này; bé hai phía (nếu có cả hai) phải trùng
  if (d.ghiDanhDaCoDongKhac.includes(ge.id)) return loai("ghi danh ứng viên đã bị dòng đơn KHÁC trỏ tới");
  const be = docBeTrenDongWaveC(dong.metadata) ?? d.beTrenDon;
  if (be !== null && ge.leadChildId !== null && be !== ge.leadChildId) return loai("bé trên đơn khác bé của ghi danh ứng viên");

  const items = d.don.items.map((i) => (i.id === dong.id ? { ...i, enrollmentId: ge.id } : i));
  return {
    du: {
      ...d,
      don: { ...d.don, items },
      ghiDanh: { id: ge.id, studentId: ge.studentId, courseId: ge.courseId, status: ge.status, centerId: ge.centerId, deletedAt: ge.deletedAt, gia: ge.gia },
    },
    lienKet: { orderItemId: dong.id, enrollmentId: ge.id },
  };
}

/** Dựng `MucWaveCB` của MỘT đơn (đã gắn dòng) từ bằng chứng; hoặc lý do loại. Chưa kiểm tiền / danh tính (việc của lõi). */
export function dungMucTuDon(d: DuLieuWaveCB): { muc: MucWaveCB } | { loai: DonBiLoai } {
  const code = d.don.code;
  const loai = (ma: string, chiTiet: string) => ({ loai: { code, ma, chiTiet } });
  const dongKhoa = d.don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (d.don.items.length !== 1 || dongKhoa.length !== 1 || d.ghiDanh === null) {
    return loai("KHONG_PHAI_MOT_DONG_KHOA", `đơn phải có đúng 1 dòng COURSE_ENROLLMENT đã trỏ ghi danh (đang ${d.don.items.length} dòng, ${dongKhoa.length} dòng khoá, ghi danh ${d.ghiDanh === null ? "chưa trỏ" : "có"})`);
  }
  const dong = dongKhoa[0]!;

  // bằng chứng giảm giá: ORDER ưu tiên (đã duyệt), không có thì ITEM có cấu trúc.
  let nguon: NguonBangChungWaveCB;
  let phanTram: number;
  if (d.don.discountApprovalStatus === "APPROVED" && d.don.discountPercent !== null) {
    nguon = "ORDER";
    phanTram = d.don.discountPercent;
  } else {
    const b = banGhiGiamDonLe(dong.discounts);
    if (b === null || b.kieu !== "PHAN_TRAM" || typeof b.phanTram !== "number") {
      return loai("KHONG_CO_BANG_CHUNG_GIAM", "không có giảm giá ORDER đã APPROVED, cũng không có đúng 1 bản ghi OrderItem.discounts kiểu PHAN_TRAM");
    }
    nguon = "ITEM";
    phanTram = b.phanTram;
  }
  if (!PHAN_TRAM_CHO_PHEP.includes(phanTram)) {
    return loai("PHAN_TRAM_NGOAI_CHINH_SACH", `mức giảm ${phanTram}% không thuộc {${PHAN_TRAM_CHO_PHEP.join(", ")}}% đã audit — giảm có điều kiện hoặc số liệu tự mâu thuẫn cần owner quyết, không tự sửa`);
  }

  const niemYet = d.don.subtotal;
  const hienTai = d.ghiDanh.gia;
  const dich = giaDichWaveCB(niemYet, phanTram);
  let truoc: GiaGhiDanh;
  let ghiListPrice = false;
  if (giongGia(hienTai, legacy(niemYet))) truoc = legacy(niemYet);
  else if (giongGia(hienTai, TRONG)) {
    truoc = TRONG;
    ghiListPrice = true;
  } else if (giongGia(hienTai, dich)) {
    // đã ở giá đích: để lõi xếp vào DA_SUA (idempotent).
    truoc = legacy(niemYet);
  } else {
    return loai("GIA_KHONG_PHAI_LEGACY", `giá ghi danh hiện tại không phải niêm yết trần ${niemYet}, không phải cả năm cột NULL, và không phải giá đích — học bổng / chỉnh tay / mua theo số buổi, không tự sửa`);
  }
  // `tongDon` là giá đích TÍNH từ niêm yết + %, KHÔNG đọc từ đơn: để lõi so với `Order.totalAmount` (TONG_DON_LECH). Đọc từ đơn sẽ làm phép so thành tautology.
  if (dich.finalPrice === null) return loai("GIA_KHONG_PHAI_LEGACY", "không tính được giá đích");
  return { muc: { listPrice: niemYet, phanTram, nguon, tongDon: dich.finalPrice, truoc, ...(ghiListPrice ? { ghiListPrice: true as const } : {}) } };
}

export type DongSuaGiaTheoDon = DongGhiWaveCB & {
  /** Dòng đơn cần gắn vào ghi danh (`OrderItem.enrollmentId` NULL → ghi danh); `null` = dòng đơn đã trỏ sẵn. */
  gan: LienKetDong | null;
};

export type KetQuaDungBang = {
  /** Phạm vi suy được: chỉ đơn mà lõi nói sạch và ghi danh còn ở giá legacy. */
  bang: Record<string, MucWaveCB>;
  /** Dữ liệu (đã gắn ảo nếu cần) của đúng các đơn trong `bang`. */
  du: readonly DuLieuWaveCB[];
  /** `code → dòng đơn cần gắn` (chỉ đơn cần gắn). */
  gan: Record<string, LienKetDong>;
  /** Đơn đã ở giá đích (chạy lại) — báo cáo, KHÔNG nằm trong phạm vi ghi. */
  daDung: readonly string[];
  loai: readonly DonBiLoai[];
};

/**
 * Duyệt MỌI đơn ứng viên: đơn nào qua quy tắc dựng bảng VÀ qua lõi (lập kế hoạch riêng từng đơn, 0 lỗi) thì vào `bang` (nếu ghi danh còn legacy) hoặc `daDung`.
 * Không đơn nào làm dừng cả lô ở bước này; fail-closed của cả lô là ở `lapKeHoachSuaGiaTheoDon`.
 */
export function dungBangTuBangChung(du: readonly DuLieuTheoDon[]): KetQuaDungBang {
  const bang: Record<string, MucWaveCB> = {};
  const duBang: DuLieuWaveCB[] = [];
  const gan: Record<string, LienKetDong> = {};
  const daDung: string[] = [];
  const loai: DonBiLoai[] = [];
  for (const d of [...du].sort((a, b) => (a.don.code < b.don.code ? -1 : 1))) {
    const code = d.don.code;
    if ((MA_DON_WAVE_C_B as readonly string[]).includes(code)) {
      loai.push({ code, ma: "THUOC_WAVE_C_B", chiTiet: "đơn nằm trong phạm vi Wave C-B (lệnh riêng) — không cùng sở hữu một ghi danh" });
      continue;
    }
    const s = suyLienKetDong(d);
    if ("loai" in s) {
      loai.push(s.loai);
      continue;
    }
    const r = dungMucTuDon(s.du);
    if ("loai" in r) {
      loai.push(r.loai);
      continue;
    }
    const kh = lapKeHoachWaveCB({ bang: { [code]: r.muc }, du: [s.du] });
    if (kh.loi.length > 0) {
      for (const l of kh.loi) loai.push({ code, ma: l.ma, chiTiet: l.chiTiet });
      continue;
    }
    const m = kh.muc[0]!;
    if (m.trangThai === "CHUA_SUA") {
      bang[code] = r.muc;
      duBang.push(s.du);
      if (s.lienKet !== null) gan[code] = s.lienKet;
    } else if (m.trangThai === "DA_SUA") daDung.push(code);
    else loai.push({ code, ma: "KHONG_XEP_DUOC", chiTiet: "lõi không xếp được vào CHUA_SUA / DA_SUA" });
  }
  return { bang, du: duBang, gan, daDung, loai };
}

/** MỘT dòng/ghi danh: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Ràng giá TRƯỚC, giá SAU, và việc gắn dòng đơn. Không chứa tên/SĐT/email. */
export function dongDauRaSuaGiaTheoDon(ghi: readonly DongSuaGiaTheoDon[]): string[] {
  return ghi.map((g) =>
    [
      KHUON_DONG_SUA_GIA_THEO_DON,
      g.orderId,
      g.code,
      g.enrollmentId,
      chuoiGiaWaveCB(g.truoc),
      chuoiGiaWaveCB(g.sau),
      g.ghiListPrice ? "GHI_LIST" : "CHI_DOC_LIST",
      g.gan === null ? "DONG_DA_TRO" : `GAN_DONG:${g.gan.orderItemId}`,
    ].join("|"),
  );
}

export type KeHoachSuaGiaTheoDon = {
  ketQuaBang: KetQuaDungBang;
  /** Kế hoạch của lõi Wave C-B trên đúng phạm vi suy được (chứa kiểm trùng ghi danh + nợ). */
  keHoach: KeHoachWaveCB;
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  ghi: readonly DongSuaGiaTheoDon[];
  dongDauRa: readonly string[];
  /** sha256 các dòng ký — `PLAN_SHA`. */
  sha: string;
};

/** Cả quy trình thuần: dựng bảng từ bằng chứng rồi lập kế hoạch cho cả lô bằng lõi Wave C-B. `du` PHẢI là dữ liệu của mọi đơn khoá học còn sống (ứng viên). */
export function lapKeHoachSuaGiaTheoDon(du: readonly DuLieuTheoDon[]): KeHoachSuaGiaTheoDon {
  const ketQuaBang = dungBangTuBangChung(du);
  const keHoach = lapKeHoachWaveCB({ bang: ketQuaBang.bang, du: ketQuaBang.du });
  const ghi: DongSuaGiaTheoDon[] = keHoach.ghi.map((g) => ({ ...g, gan: ketQuaBang.gan[g.code] ?? null }));
  const dongDauRa = dongDauRaSuaGiaTheoDon(ghi);
  return { ketQuaBang, keHoach, dung: keHoach.dung, ghi, dongDauRa, sha: shaDongWaveC(dongDauRa) };
}
