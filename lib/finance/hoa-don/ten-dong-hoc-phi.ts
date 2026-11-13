// lib/finance/hoa-don/ten-dong-hoc-phi.ts — dòng hoá đơn «Học phí khoá Sata4 (48 buổi) của <học viên>». THUẦN.
//
// Chủ dự án chốt 08/11/2026 (hoá đơn nháp VIN in «Học phí» / «Lần» trống tên bé):
//   · MỖI dòng KHOÁ HỌC của đơn là MỘT dòng hoá đơn: «Học phí khoá {Sata4} ({48} buổi) của {tên học viên của CHÍNH dòng đó}», đơn vị «Khoá».
//     Đơn một phụ huynh mua cho hai con ⇒ hai dòng, mỗi dòng một con, một khoá, một số buổi.
//   · số buổi = đúng số Sale chọn ở ô «Số buổi mua» khi tạo đơn (`OrderItem.metadata.soBuoi`). KHÔNG có số ⇒ KHÔNG đoán «cả khoá»: giữ cách ghi cũ.
//   · giá: số tiền ĐÃ GỒM THUẾ của từng dòng (tạm tính − giảm); các dòng cộng lại đúng số khoản thu (xem `chiaSoTienTheoDong`).
// MỘT công thức cho bản chờ (nội bộ + hoá đơn VIN/MISA) lẫn phiếu thu chính thức — cùng đi qua `dungPhieuThuData`.

export type DongKhoa = {
  /** Tên gọi ngắn của khoá: «Sata4». */
  tenKhoa: string;
  /** Số buổi khách mua — đúng số Sale chọn khi tạo đơn. */
  soBuoi: number;
  /** Tên học viên CỦA DÒNG đó (`OrderItem.student`); `null` = dòng chưa gắn học viên. */
  tenHocVien: string | null;
  /** Phần tiền của dòng trên đơn, ĐÃ trừ giảm giá (`totalPrice − discountAmount`) — chỉ dùng làm TRỌNG SỐ chia số tiền khoản thu. */
  thanhTienDong: number;
};

export type KhoaCoSoBuoi = { name: string };

/** «Sata3 — Ươm Mầm Tài Năng» → «Sata3»; «Combo — Full Lộ Trình» → «Combo». Không có gạch phân cách ⇒ cả tên. */
export function tenNganKhoa(ten: string): string {
  const dau = ten.trim().split(/\s+[—–-]\s+/)[0]?.trim();
  return dau && dau.length > 0 ? dau : ten.trim();
}

/** «Học phí khoá Sata4 (48 buổi) của Trần Nguyễn Gia Thịnh» — thiếu tên học viên thì bỏ vế «của …». */
export function tenDongHocPhi(k: Pick<DongKhoa, "tenKhoa" | "soBuoi">, tenHocVien: string | null): string {
  const goc = `Học phí khoá ${k.tenKhoa} (${k.soBuoi} buổi)`;
  const hv = tenHocVien?.trim();
  return hv ? `${goc} của ${hv}` : goc;
}

type DongDonKhoa = {
  type: string;
  metadata?: unknown;
  totalPrice?: number;
  discountAmount?: number;
  student?: { name: string } | null;
};

const LOAI_DONG_KHOA = "COURSE_ENROLLMENT";

function docMetadata(m: unknown): { courseId: string | null; soBuoi: number | null } {
  if (typeof m !== "object" || m === null || Array.isArray(m)) return { courseId: null, soBuoi: null };
  const o = m as Record<string, unknown>;
  const courseId = typeof o.courseId === "string" && o.courseId.trim() ? o.courseId.trim() : null;
  const soBuoi = typeof o.soBuoi === "number" && Number.isInteger(o.soBuoi) && o.soBuoi > 0 ? o.soBuoi : null;
  return { courseId, soBuoi };
}

/** Các `courseId` cần tra tên — người gọi nạp MỘT lần cho cả lần thu. */
export function khoaIdCuaCacDong(dong: readonly DongDonKhoa[]): string[] {
  return [...new Set(dong.filter((d) => d.type === LOAI_DONG_KHOA).map((d) => docMetadata(d.metadata).courseId).filter((x): x is string => x !== null))];
}

/**
 * Các dòng khoá của khoản thu — MỘT phần tử cho mỗi dòng khoá học của `dongDon`, cùng thứ tự.
 *   · khoá: `metadata.courseId` → (CHỈ khi khoản có đúng một dòng) khoá của ghi danh (đường convert không ghi metadata);
 *   · số buổi: `metadata.soBuoi` — KHÔNG rơi về `Course.totalSessions` (chủ dự án: «100% phải có buổi», số buổi là số Sale đã chọn).
 * Có dòng KHÔNG phải khoá học, hoặc thiếu khoá / số buổi ở BẤT KỲ dòng nào ⇒ `null` (cả khoản về cách ghi cũ — không in một tờ nửa đúng nửa đoán).
 */
export function suyCacDongKhoa(input: {
  dongDon: readonly DongDonKhoa[];
  khoaTheoId: ReadonlyMap<string, KhoaCoSoBuoi>;
  khoaGhiDanh: KhoaCoSoBuoi | null;
}): DongKhoa[] | null {
  if (input.dongDon.length === 0) return null;
  const ra: DongKhoa[] = [];
  for (const d of input.dongDon) {
    if (d.type !== LOAI_DONG_KHOA) return null;
    const m = docMetadata(d.metadata);
    const khoa = (m.courseId ? input.khoaTheoId.get(m.courseId) : undefined) ?? (input.dongDon.length === 1 ? input.khoaGhiDanh : null);
    if (!khoa || !khoa.name.trim() || m.soBuoi === null) return null;
    ra.push({
      tenKhoa: tenNganKhoa(khoa.name),
      soBuoi: m.soBuoi,
      tenHocVien: d.student?.name?.trim() || null,
      thanhTienDong: Math.max(0, (d.totalPrice ?? 0) - (d.discountAmount ?? 0)),
    });
  }
  return ra;
}

/**
 * Chia `soTien` (số khoản thu, đồng nguyên) cho các dòng theo trọng số. TỔNG LUÔN BẰNG ĐÚNG `soTien` — phần dư chia theo «số dư lớn nhất»,
 * không dồn hết vào dòng cuối. Khoản thu đủ cả đơn ⇒ mỗi dòng đúng bằng phần tiền của dòng. Tổng trọng số 0 ⇒ `null` (không có gì để chia theo).
 */
export function chiaSoTienTheoDong(soTien: number, trongSo: readonly number[]): number[] | null {
  const tong = trongSo.reduce((s, x) => s + Math.max(0, x), 0);
  if (trongSo.length === 0 || tong <= 0) return null;
  const can = Math.max(0, Math.round(soTien));
  const phan = trongSo.map((w, i) => {
    const chinhXac = (can * Math.max(0, w)) / tong;
    return { i, nguyen: Math.floor(chinhXac), du: chinhXac - Math.floor(chinhXac) };
  });
  let thieu = can - phan.reduce((s, p) => s + p.nguyen, 0);
  for (const p of [...phan].sort((a, b) => b.du - a.du || a.i - b.i)) {
    if (thieu <= 0) break;
    p.nguyen += 1;
    thieu -= 1;
  }
  return phan.map((p) => p.nguyen);
}
