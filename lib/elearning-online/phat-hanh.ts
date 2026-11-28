/**
 * E-LEARNING ONLINE — PHÁT HÀNH PHIÊN BẢN: so sánh bản + TÁC ĐỘNG lên học viên theo CHÍNH SÁCH TIẾN ĐỘ (hàm THUẦN; thiết kế QoPhatHanh1–3, V7 §10).
 *
 * Bất biến:
 * 1. Chính sách tiến độ là đầu vào BẮT BUỘC, KHÔNG có mặc định — thiếu ⇒ ném lỗi (`ChinhSachThieuError`), không "giả định giữ tiến độ".
 * 2. Phát hành KHÔNG sửa điểm/bài nộp/đáp án cũ — hàm này chỉ trả "phải học lại"/"phải học mới"; lịch sử nằm ở bảng khác và không bị đụng.
 * 3. CHỨNG NHẬN đã cấp luôn GIỮ NGUYÊN (`matChungNhan` luôn 0) — "chứng nhận đã cấp giữ nguyên".
 * 4. Bài ẨN ở bản mới không tính vào % của bản mới.
 */

export type BaiSoSanh = {
  stableId: string;
  chapterStableId: string;
  title: string;
  kind: string;
  required: boolean;
  hidden: boolean;
  /** Băm nội dung (video/đọc/bài tập): đổi ⇒ coi là SỬA. */
  noiDungHash: string;
  /** Thứ tự TOÀN KHOÁ trong bản của nó. */
  thuTu: number;
};

export type SoSanhPhienBan = {
  them: string[];
  sua: string[];
  an: string[];
  hienLai: string[];
  doiThuTu: string[];
  /** Bài (stableId) có trong bản cũ nhưng BIẾN MẤT hẳn khỏi bản mới (không ẩn) — vẫn xử như ẩn. */
  bien: string[];
};

export function soSanhPhienBan(cu: readonly BaiSoSanh[], moi: readonly BaiSoSanh[]): SoSanhPhienBan {
  const mCu = new Map(cu.map((b) => [b.stableId, b]));
  const mMoi = new Map(moi.map((b) => [b.stableId, b]));
  const them: string[] = [];
  const sua: string[] = [];
  const an: string[] = [];
  const hienLai: string[] = [];
  const bien: string[] = [];
  for (const b of moi) {
    const c = mCu.get(b.stableId);
    if (!c) {
      if (!b.hidden) them.push(b.stableId);
      continue;
    }
    if (!c.hidden && b.hidden) an.push(b.stableId);
    else if (c.hidden && !b.hidden) hienLai.push(b.stableId);
    else if (c.noiDungHash !== b.noiDungHash || c.title !== b.title || c.kind !== b.kind || c.required !== b.required || c.chapterStableId !== b.chapterStableId) sua.push(b.stableId);
  }
  for (const c of cu) if (!mMoi.has(c.stableId)) bien.push(c.stableId);

  // Đổi thứ tự: xếp hạng TƯƠNG ĐỐI của các bài CHUNG (chưa ẩn ở cả hai bản) khác nhau.
  const chung = cu.filter((c) => !c.hidden && mMoi.has(c.stableId) && !mMoi.get(c.stableId)!.hidden);
  const hangCu = new Map([...chung].sort((a, b) => a.thuTu - b.thuTu).map((b, i) => [b.stableId, i]));
  const hangMoi = new Map(
    [...chung]
      .map((c) => mMoi.get(c.stableId)!)
      .sort((a, b) => a.thuTu - b.thuTu)
      .map((b, i) => [b.stableId, i]),
  );
  const doiThuTu = chung.filter((c) => hangCu.get(c.stableId) !== hangMoi.get(c.stableId)).map((c) => c.stableId);
  return { them, sua, an, hienLai, doiThuTu, bien };
}

export type ChinhSachTienDo =
  | { loai: "KEEP_PROGRESS" }
  | { loai: "RELEARN_SELECTED"; baiHocLai: string[] }
  | { loai: "RESET_BY_SCOPE"; chuongStableIds: string[]; entitlementIds?: string[] }
  | { loai: "ADD_NEW_ONLY" };

export class ChinhSachThieuError extends Error {
  constructor(msg = "Chính sách tiến độ là bắt buộc khi phát hành — không có lựa chọn mặc định") {
    super(msg);
    this.name = "ChinhSachThieuError";
  }
}

export type HocVienDangHoc = { entitlementId: string; daXong: ReadonlySet<string>; daCoChungNhan: boolean };

export type TacDongMotHocVien = {
  entitlementId: string;
  /** Bài đã xong ở bản cũ nay phải học lại. */
  phaiHocLai: string[];
  /** Bài mới (bắt buộc, hiển thị) chưa có trong tiến độ của người này. */
  phaiHocMoi: string[];
  truoc: { xong: number; tong: number };
  sau: { xong: number; tong: number };
};

export type TacDongTong = {
  soHocVien: number;
  soBiAnhHuong: number;
  /** Số người PHẢI HỌC LẠI ít nhất một bài đã xong (không tính người chỉ có bài mới). */
  soPhaiHocLai: number;
  /** Luôn 0 — chứng nhận đã cấp giữ nguyên. */
  matChungNhan: number;
  chiTiet: TacDongMotHocVien[];
};

/**
 * Tác động của việc phát hành `moi` thay `cu` lên các học viên đang có quyền, theo `chinhSach`.
 * `chinhSach` thiếu/không hợp lệ ⇒ ném `ChinhSachThieuError`.
 */
export function tinhTacDong(input: { cu: readonly BaiSoSanh[]; moi: readonly BaiSoSanh[]; hocVien: readonly HocVienDangHoc[]; chinhSach: ChinhSachTienDo | null | undefined }): TacDongTong {
  const cs = input.chinhSach;
  if (!cs || !["KEEP_PROGRESS", "RELEARN_SELECTED", "RESET_BY_SCOPE", "ADD_NEW_ONLY"].includes(cs.loai)) throw new ChinhSachThieuError();

  const ss = soSanhPhienBan(input.cu, input.moi);
  const batBuocMoi = input.moi.filter((b) => !b.hidden && b.required && b.kind !== "FINAL_EXAM");
  const idBatBuocMoi = new Set(batBuocMoi.map((b) => b.stableId));
  const batBuocCu = input.cu.filter((b) => !b.hidden && b.required && b.kind !== "FINAL_EXAM");
  const bai = new Map(input.moi.map((b) => [b.stableId, b]));
  const baiSuaTrongPhamVi = new Set<string>();
  if (cs.loai === "RELEARN_SELECTED") for (const s of cs.baiHocLai) if (ss.sua.includes(s)) baiSuaTrongPhamVi.add(s);

  const chiTiet = input.hocVien.map((hv): TacDongMotHocVien => {
    const phaiHocLai = new Set<string>();
    if (cs.loai === "RELEARN_SELECTED") {
      for (const s of baiSuaTrongPhamVi) if (hv.daXong.has(s)) phaiHocLai.add(s);
    } else if (cs.loai === "RESET_BY_SCOPE") {
      const trongNhom = !cs.entitlementIds || cs.entitlementIds.includes(hv.entitlementId);
      if (trongNhom) {
        const chuong = new Set(cs.chuongStableIds);
        for (const s of hv.daXong) {
          const b = bai.get(s);
          if (b && !b.hidden && chuong.has(b.chapterStableId)) phaiHocLai.add(s);
        }
      }
    }
    // Bài mới bắt buộc hiển thị mà người này chưa xong ⇒ phải học mới (mọi chính sách đều thêm bài mới vào cuối tiến độ).
    const phaiHocMoi = ss.them.filter((s) => idBatBuocMoi.has(s) && !hv.daXong.has(s));
    const xongSau = batBuocMoi.filter((b) => hv.daXong.has(b.stableId) && !phaiHocLai.has(b.stableId)).length;
    return {
      entitlementId: hv.entitlementId,
      phaiHocLai: [...phaiHocLai],
      phaiHocMoi,
      truoc: { xong: batBuocCu.filter((b) => hv.daXong.has(b.stableId)).length, tong: batBuocCu.length },
      sau: { xong: xongSau, tong: batBuocMoi.length },
    };
  });

  return {
    soHocVien: chiTiet.length,
    soBiAnhHuong: chiTiet.filter((c) => c.phaiHocLai.length > 0 || c.phaiHocMoi.length > 0).length,
    soPhaiHocLai: chiTiet.filter((c) => c.phaiHocLai.length > 0).length,
    matChungNhan: 0,
    chiTiet,
  };
}
