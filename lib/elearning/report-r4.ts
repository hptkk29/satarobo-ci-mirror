/**
 * EL-17 — BÁO CÁO R4: theo phòng ban / cơ sở.
 *
 * Gộp M2 (hoàn thành có kiểm chứng ĐÚNG HẠN) · M3 (bỏ trắng khi hết hạn) · M5 (nhịp
 * học kịp hạn) theo `TrnEnrollment.snapDepartmentId` + `snapOrgUnitId`.
 *
 * ⚠️ Đọc cột ẢNH CHỤP, không join sống sang `Employee`. Một lần chuyển cơ sở hay đổi
 * phòng ban sẽ viết lại toàn bộ báo cáo của các kỳ TRƯỚC — tức con số tháng 3 đổi vì
 * một việc xảy ra tháng 9. Đó là lý do các cột `snap*` tồn tại.
 */

/** Dưới ngưỡng này thì nhóm bị GỘP — xem `gopNhomNho`. */
export const NGUONG_N_TOI_THIEU = 5;

export const NHAN_NHOM_GOP = "Khối hỗ trợ (gộp)";

export type DongR4 = {
  /** `snapDepartmentId` — `null` nghĩa là CHƯA GÁN, không phải "không có". */
  nhomId: string | null;
  nhanNhom: string;
  /** Lượt có `verifiedAt` và verify TRƯỚC hoặc ĐÚNG `dueAtOriginal`. */
  m2DungHan: number;
  /** Lượt quá hạn mà chưa từng mở bài (ô c của §9.2.1). */
  m3BoTrang: number;
  /** Lượt đang học và đang theo kịp nhịp để xong trước hạn. */
  m5KipNhip: number;
  /** Mẫu số của M5 — lượt ĐANG HỌC còn hạn. `0` ⇒ M5 không đo được kỳ này. */
  m5MauSo: number;
  /** Số LƯỢT ghi danh trong nhóm. Một người có nhiều khoá thì đóng góp nhiều lượt. */
  tong: number;
  /**
   * Số NGƯỜI KHÁC NHAU trong nhóm — đây mới là `n` của ngưỡng ẩn danh.
   *
   * 🔴 Bản đầu lọc ngưỡng bằng `tong` (lượt): một phòng chỉ có MỘT nhân viên học 5 khoá có
   * `tong = 5` nên đứng riêng thành một dòng, tức nêu đích danh một con người trên tài liệu gửi
   * khắp công ty — đúng điều ngưỡng sinh ra để chặn. Đặc tả: nhóm dưới 5 NGƯỜI bị gộp.
   */
  soNguoi: number;
};

export type LuotDeGop = {
  /** BẮT BUỘC (không mặc định): thiếu nó thì không đếm được người, và ngưỡng ẩn danh quay về đếm lượt. */
  userId: string;
  nhomId: string | null;
  verifiedAt: Date | null;
  dueAtOriginal: Date | null;
  dueAt: Date | null;
  startedAt: Date | null;
  status: string;
  progressPercent: number;
  pausedAt: Date | null;
};

/**
 * M2 — hoàn thành CÓ KIỂM CHỨNG và ĐÚNG HẠN.
 *
 * ⚠️ So `verifiedAt` với `dueAtOriginal`, KHÔNG với `dueAt`. `dueAt` nới được (gia
 * hạn, bù SLA); `dueAtOriginal` thì bất biến. Đo bằng hạn đã nới là để một lượt gia
 * hạn ba lần vẫn tính là đúng hạn — chỉ số mất hết ý nghĩa cảnh báo.
 *
 * Không có `dueAtOriginal` (lượt tự nguyện, lượt công nhận tương đương) thì đứng
 * NGOÀI phép đo về hạn — không đúng hạn, không trễ.
 */
export function laDungHan(l: LuotDeGop): boolean {
  if (l.verifiedAt == null || l.dueAtOriginal == null) return false;
  return l.verifiedAt.getTime() <= l.dueAtOriginal.getTime();
}

/**
 * M3 — BỎ TRẮNG khi hết hạn: quá hạn mà chưa từng mở bài nào.
 *
 * ⚠️ Khác "quá hạn". Người mở bài rồi bỏ dở và người chưa mở lần nào là hai vấn đề
 * khác hẳn — một bên là nội dung khó hoặc quá dài, bên kia là họ chưa từng nhận được
 * lời nhắc nào, hoặc không vào được khu học. Gộp lại thì mất luôn đường lần ra.
 */
export function laBoTrang(l: LuotDeGop, now: Date): boolean {
  if (l.pausedAt) return false;
  if (l.verifiedAt != null) return false;
  const han = l.dueAt ?? l.dueAtOriginal;
  if (han == null || han.getTime() > now.getTime()) return false;
  return l.startedAt == null && l.progressPercent === 0;
}

/**
 * M5 — có đang theo KỊP NHỊP để xong trước hạn không.
 *
 * Công thức của §9.2.2 đo bằng giây nội dung đã phủ trong tuần. Ở đây dùng bản xấp xỉ
 * bằng phần trăm tiến độ so với phần thời gian đã trôi qua, và **nói thẳng là xấp xỉ**
 * ngay trên báo cáo — một con số chính xác giả còn tệ hơn một con số kèm chú thích.
 *
 * Chỉ tính cho lượt ĐANG HỌC và CÒN hạn: người đã xong hoặc đã quá hạn thì "kịp nhịp"
 * không còn là câu hỏi có nghĩa.
 */
export function trongMauSoM5(l: LuotDeGop, now: Date): boolean {
  if (l.pausedAt) return false;
  if (l.verifiedAt != null) return false;
  const han = l.dueAt ?? l.dueAtOriginal;
  return han != null && han.getTime() > now.getTime();
}

export function laKipNhip(l: LuotDeGop, now: Date, batDauMacDinh: Date): boolean {
  if (!trongMauSoM5(l, now)) return false;
  const han = (l.dueAt ?? l.dueAtOriginal)!;
  const batDau = l.startedAt ?? batDauMacDinh;
  const tong = han.getTime() - batDau.getTime();
  if (tong <= 0) return false;
  const daTroi = Math.min(1, Math.max(0, (now.getTime() - batDau.getTime()) / tong));
  return l.progressPercent / 100 >= daTroi;
}

export function gomTheoNhom(
  ds: readonly LuotDeGop[],
  nhanCua: (id: string | null) => string,
  now: Date,
  batDauMacDinh: Date,
): DongR4[] {
  const bang = new Map<string, DongR4>();
  const nguoiCua = new Map<string, Set<string>>();
  for (const l of ds) {
    const k = l.nhomId ?? "__CHUA_GAN__";
    let d = bang.get(k);
    if (!d) {
      d = {
        nhomId: l.nhomId,
        nhanNhom: nhanCua(l.nhomId),
        m2DungHan: 0,
        m3BoTrang: 0,
        m5KipNhip: 0,
        m5MauSo: 0,
        tong: 0,
        soNguoi: 0,
      };
      bang.set(k, d);
      nguoiCua.set(k, new Set());
    }
    d.tong += 1;
    nguoiCua.get(k)!.add(l.userId);
    if (laDungHan(l)) d.m2DungHan += 1;
    if (laBoTrang(l, now)) d.m3BoTrang += 1;
    if (trongMauSoM5(l, now)) {
      d.m5MauSo += 1;
      if (laKipNhip(l, now, batDauMacDinh)) d.m5KipNhip += 1;
    }
  }
  for (const [k, d] of bang) d.soNguoi = nguoiCua.get(k)!.size;
  return [...bang.values()].sort((a, b) => b.tong - a.tong);
}

/**
 * 🔴 GỘP NHÓM NHỎ — ngưỡng n tối thiểu, và nó KHÔNG phải chuyện thẩm mỹ.
 *
 * Số đo prod 20/08/2026: 15 người / 6 phòng ban — `DAO_TAO` 4 · `BAN_GIAM_DOC` 4 ·
 * `KINH_DOANH` 4 · **`MARKETING` 1 · `KE_TOAN` 1 · `IT` 1**. Ba phòng cuối mỗi phòng
 * ĐÚNG MỘT NGƯỜI.
 *
 * Một dòng báo cáo "phòng Marketing: 0% đúng hạn" ở quy mô ấy là một câu về ĐÍCH DANH
 * một con người, in trên một tài liệu gửi khắp công ty — và nó đi vòng qua mọi lời hứa
 * ẩn danh mà hệ thống đưa ra ở chỗ khác. Ngưỡng này là thứ giữ lời hứa đó.
 *
 * ⚠️ Gộp chứ KHÔNG bỏ: người của các nhóm nhỏ vẫn nằm trong tổng. Bỏ đi là làm mẫu số
 * hụt mà không ai biết hụt bao nhiêu.
 */
export function gopNhomNho(
  ds: readonly DongR4[],
  nguong: number = NGUONG_N_TOI_THIEU,
): DongR4[] {
  // Đếm NGƯỜI, không đếm lượt — xem `DongR4.soNguoi`.
  const du = ds.filter((d) => d.soNguoi >= nguong);
  const nho = ds.filter((d) => d.soNguoi < nguong);
  if (nho.length === 0) return [...du];

  const gop: DongR4 = {
    nhomId: null,
    nhanNhom: `${NHAN_NHOM_GOP} — ${nho.length} nhóm dưới ${nguong} người`,
    m2DungHan: nho.reduce((s, d) => s + d.m2DungHan, 0),
    m3BoTrang: nho.reduce((s, d) => s + d.m3BoTrang, 0),
    m5KipNhip: nho.reduce((s, d) => s + d.m5KipNhip, 0),
    m5MauSo: nho.reduce((s, d) => s + d.m5MauSo, 0),
    tong: nho.reduce((s, d) => s + d.tong, 0),
    // Cộng dồn: một người có lượt ở hai nhóm nhỏ (ảnh chụp phòng ban đổi theo thời điểm giao) bị đếm hai
    // lần — chỉ làm n LỚN HƠN thực tế một chút ở dòng GỘP, không bao giờ làm lộ một nhóm riêng.
    soNguoi: nho.reduce((s, d) => s + d.soNguoi, 0),
  };
  return [...du, gop];
}

/** Tỉ lệ phần trăm — `null` khi mẫu số 0, KHÔNG phải 0%. */
export function tiLe(tu: number, mau: number): number | null {
  return mau > 0 ? Math.round((tu / mau) * 100) : null;
}

export const R4_COLUMNS = [
  "Nhóm",
  "Số lượt",
  "M2 đúng hạn",
  "M2 %",
  "M3 bỏ trắng",
  "M3 %",
  "M5 kịp nhịp",
  "M5 mẫu số",
  "M5 %",
] as const;
