// lib/entitlements/pham-vi-hoc.ts — CHỐT PHẠM VI BÀI của một lần mua (`tinhPhamViHoc`).
//
// THUẦN: không DB, không đồng hồ. BA Phần 4(a) §2.3. Đơn vị đếm là BÀI (một buổi một bài theo
// `Lesson.order` của giáo trình; xem `soBuoiTheoLoTrinh`).
//
// ── CÁI GÌ ĐÃ CHỐT, CÁI GÌ CHỈ LÀ MẶC ĐỊNH ─────────────────────────────────────────────────
// Chính sách chỉ chốt SỐ BUỔI MUA. Bài bắt đầu/kết thúc là SNAPSHOT kỹ thuật tính ra ở đây.
// Các điểm CHƯA có câu trả lời của BLĐ đều là tham số của `CauHinhPhamVi`, không phải hằng:
//   · `catchUpOverCapPolicy` (MT-03b): vượt trần học vượt thì bỏ bài cũ nhất hay bỏ hết
//   · `graceCountsTowardNext` (MT-07): ân hạn trừ vào gói mới (R1) hay là quà (R2)
// Mặc định chỉ để mã chạy được, KHÔNG phải quyết định. Nghĩa II của MT-03a (bài bỏ qua nằm
// NGOÀI phạm vi gói) KHÔNG biểu diễn được với bất biến INV-01/02 nên KHÔNG có ở đây.

/** Phải KHỚP KHÍT enum `PurchaseKind` của schema — lưới `[ENT-ENUM]`. */
export const LOAI_MUA_PHAM_VI = ["FULL", "MILESTONE", "CUSTOM"] as const;
export type LoaiMuaPhamVi = (typeof LOAI_MUA_PHAM_VI)[number];
export type ChinhSachVuotTran = "KEEP_LATEST" | "DROP_ALL";

/** Vì sao các bài đã qua cần được dạy bù. */
export type LoaiBuBai =
  | "NONE" //          không có bài nào đã qua trong phạm vi
  | "LATE_ENTRY" //    vào trễ gói trọn, trong ngưỡng ⇒ học bù miễn phí (QĐ-08)
  | "LATE_ENTRY_NEEDS_DECISION" // vào trễ gói trọn, QUÁ ngưỡng ⇒ QLCS chọn học vượt hoặc chuyển lớp (QĐ-09)
  | "CATCH_UP" //      gói 12/24/36/lẻ, lần đầu: học vượt các bài đã qua của học phần (QĐ-05/06)
  | "LATE_RENEWAL"; // mua tiếp mà lớp đã đi qua một số bài trong lúc chưa đóng (QĐ-21)

export interface CauHinhPhamVi {
  /** Ngưỡng vào trễ với người đóng gói trọn (bài). Mặc định 4 (S3). */
  readonly lateEntryMaxLessons: number;
  /** Trần học vượt cho gói không trọn (bài). Mặc định 6 (S1). */
  readonly catchUpMaxSessions: number;
  /** Số bài một học phần. Mặc định 12. */
  readonly soBaiMotHocPhan: number;
  /** Tổng số bài của giáo trình / gói trọn. Mặc định 48. */
  readonly tongBai: number;
  /** MT-03b — mặc định `KEEP_LATEST`. */
  readonly catchUpOverCapPolicy: ChinhSachVuotTran;
  /** MT-07 — `true` = R1 (ân hạn trừ vào gói mới). Mặc định `true`. */
  readonly graceCountsTowardNext: boolean;
}

export const CAU_HINH_PHAM_VI_MAC_DINH: CauHinhPhamVi = Object.freeze({
  lateEntryMaxLessons: 4,
  catchUpMaxSessions: 6,
  soBaiMotHocPhan: 12,
  tongBai: 48,
  catchUpOverCapPolicy: "KEEP_LATEST",
  graceCountsTowardNext: true,
});

export interface LanMuaTruoc {
  /** Bài cuối của quyền học trước. */
  readonly end: number;
  /** Số buổi ân hạn quyền học trước đã DÙNG (chỉ có nghĩa với R2). */
  readonly graceUsed: number;
}

export interface DauVaoPhamVi {
  readonly loai: LoaiMuaPhamVi;
  readonly soBuoi: number;
  /** Bài KẾ TIẾP lớp sẽ dạy (1 = lớp chưa dạy bài nào). */
  readonly baiKeTiepCuaLop: number;
  readonly truoc?: LanMuaTruoc | null;
  readonly cauHinh?: CauHinhPhamVi;
}

export interface KetQuaPhamVi {
  readonly start: number;
  readonly end: number;
  /** Bài phải dạy lại / dạy bù cho em (đã qua trong phạm vi, không bị bỏ qua). */
  readonly baiCanBu: readonly number[];
  /** Bài nằm trong phạm vi nhưng KHÔNG dạy, không hoàn (xem MM-10). */
  readonly baiBoQua: readonly number[];
  readonly loaiBu: LoaiBuBai;
  /** `true` khi cần QLCS chọn học vượt hay chuyển lớp mới (chỉ gói trọn quá ngưỡng). */
  readonly canQuyetDinhCuaQLCS: boolean;
}

export type MaLoiPhamVi =
  | "DAU_VAO_KHONG_HOP_LE"
  | "LOAI_KHONG_KHOP_SO_BUOI"
  | "PHAM_VI_VUOT_GIAO_TRINH";

export class LoiPhamVi extends Error {
  constructor(
    public readonly ma: MaLoiPhamVi,
    message: string,
  ) {
    super(message);
    this.name = "LoiPhamVi";
  }
}

function khoang(tu: number, den: number): number[] {
  const ra: number[] = [];
  for (let i = tu; i <= den; i++) ra.push(i);
  return ra;
}

const laNguyenDuong = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1;

/** Loại mua suy từ số buổi — dùng khi người gọi chưa biết `PurchaseKind`. */
export function suyLoaiMua(soBuoi: number, cauHinh: CauHinhPhamVi = CAU_HINH_PHAM_VI_MAC_DINH): LoaiMuaPhamVi {
  if (soBuoi === cauHinh.tongBai) return "FULL";
  return soBuoi % cauHinh.soBaiMotHocPhan === 0 ? "MILESTONE" : "CUSTOM";
}

export function tinhPhamViHoc(vao: DauVaoPhamVi): KetQuaPhamVi {
  const ch = vao.cauHinh ?? CAU_HINH_PHAM_VI_MAC_DINH;
  const { soBuoi, baiKeTiepCuaLop: N } = vao;
  if (!laNguyenDuong(soBuoi) || !laNguyenDuong(N)) {
    throw new LoiPhamVi("DAU_VAO_KHONG_HOP_LE", "Số buổi và bài kế tiếp của lớp phải là số nguyên từ 1.");
  }
  if (vao.truoc && (!laNguyenDuong(vao.truoc.end) || !Number.isInteger(vao.truoc.graceUsed) || vao.truoc.graceUsed < 0)) {
    throw new LoiPhamVi("DAU_VAO_KHONG_HOP_LE", "Lần mua trước không hợp lệ.");
  }
  if ((vao.loai === "FULL") !== (soBuoi === ch.tongBai)) {
    throw new LoiPhamVi("LOAI_KHONG_KHOP_SO_BUOI", "Loại mua FULL chỉ đi với đúng gói trọn.");
  }
  if (soBuoi > ch.tongBai) {
    throw new LoiPhamVi("DAU_VAO_KHONG_HOP_LE", "Số buổi vượt tổng số bài của giáo trình.");
  }

  // ── MUA TIẾP: nối vào bài cuối của lần trước (QĐ-21) ────────────────────────────────────
  if (vao.truoc) {
    const start = vao.truoc.end + 1 + (ch.graceCountsTowardNext ? 0 : vao.truoc.graceUsed);
    const end = start + soBuoi - 1;
    if (end > ch.tongBai) {
      throw new LoiPhamVi("PHAM_VI_VUOT_GIAO_TRINH", `Phạm vi ${start}–${end} vượt giáo trình ${ch.tongBai} bài.`);
    }
    const baiCanBu = N > start ? khoang(start, Math.min(N - 1, end)) : [];
    return {
      start,
      end,
      baiCanBu,
      baiBoQua: [],
      loaiBu: baiCanBu.length > 0 ? "LATE_RENEWAL" : "NONE",
      canQuyetDinhCuaQLCS: false,
    };
  }

  // ── GÓI TRỌN, lần đầu ─────────────────────────────────────────────────────────────────
  if (vao.loai === "FULL") {
    const daQua = khoang(1, Math.min(N - 1, ch.tongBai));
    if (daQua.length === 0) {
      return { start: 1, end: ch.tongBai, baiCanBu: [], baiBoQua: [], loaiBu: "NONE", canQuyetDinhCuaQLCS: false };
    }
    // Mọi bài đã qua đều được dạy (QĐ-10) và KHÔNG áp trần học vượt.
    const quaNguong = daQua.length > ch.lateEntryMaxLessons;
    return {
      start: 1,
      end: ch.tongBai,
      baiCanBu: daQua,
      baiBoQua: [],
      loaiBu: quaNguong ? "LATE_ENTRY_NEEDS_DECISION" : "LATE_ENTRY",
      canQuyetDinhCuaQLCS: quaNguong,
    };
  }

  // ── GÓI 12/24/36/LẺ, lần đầu: bắt đầu ở ĐẦU HỌC PHẦN chứa bài kế tiếp (MT-03a nghĩa I) ───
  const start = Math.floor((N - 1) / ch.soBaiMotHocPhan) * ch.soBaiMotHocPhan + 1;
  const end = start + soBuoi - 1;
  if (end > ch.tongBai) {
    throw new LoiPhamVi("PHAM_VI_VUOT_GIAO_TRINH", `Phạm vi ${start}–${end} vượt giáo trình ${ch.tongBai} bài.`);
  }
  const daQua = N > start ? khoang(start, Math.min(N - 1, end)) : [];
  if (daQua.length <= ch.catchUpMaxSessions) {
    return {
      start,
      end,
      baiCanBu: daQua,
      baiBoQua: [],
      loaiBu: daQua.length > 0 ? "CATCH_UP" : "NONE",
      canQuyetDinhCuaQLCS: false,
    };
  }
  // Vượt trần học vượt (QĐ-06): theo chính sách MT-03b.
  if (ch.catchUpOverCapPolicy === "DROP_ALL") {
    return { start, end, baiCanBu: [], baiBoQua: daQua, loaiBu: "NONE", canQuyetDinhCuaQLCS: false };
  }
  const giu = daQua.slice(daQua.length - ch.catchUpMaxSessions);
  const bo = daQua.slice(0, daQua.length - ch.catchUpMaxSessions);
  return {
    start,
    end,
    baiCanBu: giu,
    baiBoQua: bo,
    loaiBu: giu.length > 0 ? "CATCH_UP" : "NONE",
    canQuyetDinhCuaQLCS: false,
  };
}
