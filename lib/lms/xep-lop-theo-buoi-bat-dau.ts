// lib/lms/xep-lop-theo-buoi-bat-dau.ts — "học viên bắt đầu học từ buổi S thì xếp được vào lớp đang ở buổi nào". THUẦN: không DB, không mạng.
//
// ── LUẬT, CHỦ DỰ ÁN CHỐT 27/10/2026 (thay `xetXepVaoLop` cho dòng ĐƠN THƯỜNG — cờ phạm vi TẮT) ───────────────────────────────
//   · SALE NHẬP buổi bắt đầu S (đơn dưới đủ khoá). Đơn mua ĐỦ khoá thì S = 1.
//   · Lớp đã qua P buổi ⇒ buổi kế tiếp N = P + 1.
//       N ≤ S  ⇒ lớp CHƯA học tới buổi bé bắt đầu: xếp vào được, bé chờ (nếu N < S) hoặc vào đúng buổi (N = S).
//       N > S  ⇒ bé phải HỌC VƯỢT (học bù) v = N − S buổi để đuổi kịp lớp. v ≤ TRẦN ⇒ SALE xếp được (kèm xin QLCS duyệt);
//                v > TRẦN ⇒ SALE KHÔNG thấy lớp này; QLCS xếp được (lớp thuộc cơ sở mình); Quản trị tối cao xếp được MỌI lớp.
//   · TRẦN do QLCS chỉnh riêng từng cơ sở (`enrollment.catchUpMaxSessions`); hàm này nhận số đã đọc, không biết cài đặt.
//
// Ví dụ (chủ dự án): đóng 48 buổi (S = 1), lớp đã học 6 buổi ⇒ v = 6. Sale điền sẽ học bù trong b = 3 buổi ⇒ trần bù miễn phí của bé
// = 4 (4 học phần) + 3.
//
// ⚠️ Hàm KHÔNG biết SĨ SỐ: lớp đầy không ai thêm được, kể cả Quản trị tối cao — người gọi tự xét (cùng luật `enrollStudent`).

export type VaiXepLop = "SALE" | "QLCS" | "ADMIN";

export type LoaiXet =
  /** Vào ngay, đúng buổi bé bắt đầu. */
  | "binh_thuong"
  /** Lớp chưa tới buổi bé bắt đầu — giữ chỗ, bé chờ. */
  | "cho_toi_luot"
  /** Lớp đã đi qua buổi bé bắt đầu, v ≤ trần — phải học vượt (học bù) v buổi. */
  | "hoc_vuot"
  /** Lớp đi xa hơn trần học vượt — chỉ QLCS / Quản trị tối cao. */
  | "qua_tran"
  /** Không đủ dữ kiện (khoá không khai số buổi, hoặc S vô nghĩa). */
  | "khong_xet";

export type XetTheoBuoiBatDau = {
  loai: LoaiXet;
  /** Sale (vai thường) có chọn được lớp này không (chưa tính sĩ số). */
  saleChonDuoc: boolean;
  /** Buổi bé bắt đầu (S) đã chuẩn hoá; `null` khi `khong_xet`. */
  buoiBatDau: number | null;
  /** Buổi kế tiếp của lớp (N = P + 1). */
  buoiKeTiepCuaLop: number;
  /** Số buổi cần học vượt (v). CHỈ > 0 ở `hoc_vuot` / `qua_tran`. */
  soBuoiCanBu: number;
  /** Số buổi bé phải chờ trước khi tới buổi S. CHỈ > 0 ở `cho_toi_luot`. */
  soBuoiCho: number;
  /** Trần học vượt đã dùng để xét. */
  tran: number;
  /** Câu cho người xếp lớp đọc. Luôn có. */
  cau: string;
};

const soNguyenDuong = (x: unknown): number | null =>
  typeof x === "number" && Number.isInteger(x) && x >= 1 ? x : null;

/**
 * Khoảng S hợp lệ: bé học `mua` buổi liền nhau bắt đầu từ S nên `S + mua − 1 ≤ tổng`. `null` khi khoá không khai số buổi.
 * `soBuoiMua = null` = mua đủ khoá (cùng luật suy với `phamViBuoiDangKy`).
 */
export function khoangBuoiBatDau(p: {
  tongSoBuoiKhoa: number | null;
  soBuoiMua: number | null;
}): { min: number; max: number; macDinh: number; muaDuKhoa: boolean } | null {
  const tong = soNguyenDuong(p.tongSoBuoiKhoa);
  if (tong === null) return null;
  const mua = p.soBuoiMua === null ? tong : soNguyenDuong(p.soBuoiMua);
  if (mua === null || mua > tong) return null;
  const max = tong - mua + 1;
  // Mặc định: "học các buổi cuối" — nếp cũ của màn chuyển đổi (S = tổng − mua + 1). Sale đổi được trong [1, max].
  return { min: 1, max, macDinh: max, muaDuKhoa: mua === tong };
}

/**
 * Khoảng buổi bắt đầu Sale được chọn của MỘT DÒNG ĐƠN; `null` = không có ô.
 * · Dòng thường: như `khoangBuoiBatDau`.
 * · Dòng theo PHẠM VI HỌC (cờ bật) [28/10/2026]: mua KHÔNG trọn ⇒ có ô (Sale chọn, quyền học nhận); mua trọn ⇒ không ô (quyền học tự chốt như cũ);
 *   khoá không đúng `GIAO_TRINH_PHAM_VI` bài ⇒ không ô (phạm vi S..S+mua−1 có thể vượt `tongBai` của quyền học mà màn này không biết).
 */
export const GIAO_TRINH_PHAM_VI = 48;
export function khoangBuoiChoDong(
  laPhamVi: boolean,
  tongSoBuoiKhoa: number | null,
  soBuoiMua: number | null,
): { min: number; max: number; macDinh: number; muaDuKhoa: boolean } | null {
  const k = khoangBuoiBatDau({ tongSoBuoiKhoa, soBuoiMua });
  if (!laPhamVi) return k;
  if (!k || k.muaDuKhoa || tongSoBuoiKhoa !== GIAO_TRINH_PHAM_VI) return null;
  return k;
}

/**
 * Trần học vượt HIỆU LỰC của một khoá [28/10/2026]: mức riêng của khoá (`Course.catchUpMaxSessions`) nếu có, không thì mức chung của cơ sở
 * (`enrollment.catchUpMaxSessions`, QLCS chỉnh). Mức khoá THẮNG khi đã đặt. Cả hai tham số BẮT BUỘC (luật 7): quên truyền mức khoá là mọi khoá rơi về mức cơ sở mà không lỗi nào báo.
 */
export function tranHocVuotCuaKhoa(mucKhoa: number | null, mucCoSo: number): number {
  return mucKhoa !== null && Number.isInteger(mucKhoa) && mucKhoa >= 0 ? mucKhoa : mucCoSo;
}

/** `null` = hợp lệ; chuỗi = lý do từ chối. Máy chủ và form cùng gọi. */
export function kiemBuoiBatDau(
  p: { tongSoBuoiKhoa: number | null; soBuoiMua: number | null },
  buoiBatDau: unknown,
): string | null {
  const k = khoangBuoiBatDau(p);
  if (!k) return null; // khoá không khai số buổi: không có gì để so (fail-open, cùng `xetXepVaoLop`)
  const s = soNguyenDuong(buoiBatDau);
  if (s === null) return "Buổi bắt đầu phải là số nguyên từ 1";
  if (s < k.min || s > k.max) {
    return k.min === k.max
      ? `Học viên mua đủ khoá nên bắt đầu từ buổi ${k.min}`
      : `Buổi bắt đầu phải từ ${k.min} đến ${k.max} (mua ${(p.soBuoiMua ?? p.tongSoBuoiKhoa)!} buổi trên khoá ${p.tongSoBuoiKhoa} buổi)`;
  }
  return null;
}

export function xetTheoBuoiBatDau(d: {
  tongSoBuoiKhoa: number | null;
  soBuoiMua: number | null;
  /** S người dùng nhập; `null` ⇒ dùng mặc định của khoảng. */
  buoiBatDau: number | null;
  /** Buổi lớp đã QUA NGÀY (P) — `demBuoiDaQua`. */
  soBuoiDaQua: number;
  /** Trần học vượt của cơ sở (`enrollment.catchUpMaxSessions`). */
  tran: number;
}): XetTheoBuoiBatDau {
  const khong = (cau: string): XetTheoBuoiBatDau => ({
    loai: "khong_xet",
    saleChonDuoc: true,
    buoiBatDau: null,
    buoiKeTiepCuaLop: 1,
    soBuoiCanBu: 0,
    soBuoiCho: 0,
    tran: Math.max(0, Math.floor(d.tran) || 0),
    cau,
  });
  const k = khoangBuoiBatDau(d);
  if (!k) return khong("Khoá chưa khai số buổi — không xét được tiến độ lớp.");
  const S = d.buoiBatDau === null ? k.macDinh : soNguyenDuong(d.buoiBatDau);
  if (S === null || S < k.min || S > k.max) return khong("Buổi bắt đầu chưa hợp lệ — sửa ô \"Bắt đầu từ buổi\".");

  const P = Number.isInteger(d.soBuoiDaQua) && d.soBuoiDaQua > 0 ? d.soBuoiDaQua : 0;
  const N = P + 1;
  const tran = Math.max(0, Math.floor(d.tran) || 0);
  const co = { buoiBatDau: S, buoiKeTiepCuaLop: N, tran };

  if (N <= S) {
    const cho = S - N;
    return {
      loai: cho === 0 ? "binh_thuong" : "cho_toi_luot",
      saleChonDuoc: true,
      ...co,
      soBuoiCanBu: 0,
      soBuoiCho: cho,
      cau:
        cho === 0
          ? `Lớp đang ở buổi ${N} — đúng buổi bé bắt đầu. Xếp vào bình thường.`
          : `Bé bắt đầu từ buổi ${S}; lớp mới ở buổi ${N}. Xếp vào để giữ chỗ — bé chờ ${cho} buổi rồi mới vào học.`,
    };
  }

  const v = N - S;
  if (v <= tran) {
    return {
      loai: "hoc_vuot",
      saleChonDuoc: true,
      ...co,
      soBuoiCanBu: v,
      soBuoiCho: 0,
      cau: `Bé bắt đầu từ buổi ${S}, lớp đã tới buổi ${N} — bé phải HỌC VƯỢT ${v} buổi để đuổi kịp lớp. Cần QLCS duyệt số buổi học bù.`,
    };
  }
  return {
    loai: "qua_tran",
    saleChonDuoc: false,
    ...co,
    soBuoiCanBu: v,
    soBuoiCho: 0,
    cau: `Bé bắt đầu từ buổi ${S}, lớp đã tới buổi ${N} — phải học vượt ${v} buổi, quá trần ${tran} buổi của cơ sở. Chỉ Quản lý cơ sở / Quản trị tối cao xếp được.`,
  };
}

/** Vai này THẤY lớp đó trong danh sách chọn không. Sale không thấy lớp không xếp được; QLCS và Quản trị tối cao thấy hết. */
export function vaiThayLop(vai: VaiXepLop, x: XetTheoBuoiBatDau): boolean {
  return vai === "SALE" ? x.saleChonDuoc : true;
}

/** Vai này CHỌN được lớp đó không (chưa tính sĩ số). Quy tắc hôm nay trùng `vaiThayLop`; tách hàm để đổi một bên không kéo bên kia. */
export function vaiChonDuoc(vai: VaiXepLop, x: XetTheoBuoiBatDau): boolean {
  return vaiThayLop(vai, x);
}

/** Lớp này đòi sale khai học vượt (tích + số buổi bù) không. */
export function canKhaiHocVuot(x: XetTheoBuoiBatDau): boolean {
  return x.soBuoiCanBu > 0;
}

/** `null` = hợp lệ. `b` = số buổi học bù sale cam kết với phụ huynh (rút ngắn vì một buổi có thể dạy nhiều bài): 1 ≤ b ≤ v. */
export function kiemSoBuoiBu(v: number, b: unknown): string | null {
  if (typeof b !== "number" || !Number.isInteger(b) || b < 1) return "Nhập số buổi học bù (số nguyên từ 1)";
  if (b > v) return `Số buổi học bù tối đa ${v} (bằng số buổi bé phải học vượt)`;
  return null;
}

/** Người này tự duyệt được yêu cầu học vượt của chính mình không: QLCS và Quản trị tối cao có, Sale không. */
export function tuDuyetHocVuot(vai: VaiXepLop): boolean {
  return vai !== "SALE";
}
