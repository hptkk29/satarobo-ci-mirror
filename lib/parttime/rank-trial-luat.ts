// lib/parttime/rank-trial-luat.ts — luật THUẦN của ba thứ có hiệu lực theo ngày (lưới phân công GV · PR4, 24/10/2026):
//   · đề xuất / duyệt Rank (SR.QD.238 §3: QLCS đề xuất, Ban lãnh đạo duyệt);
//   · chứng nhận Trial của giáo viên (§6 + Điều 4: Phòng Đào tạo Hội sở cấp);
//   · chính sách hỗ trợ Trial bật/tắt + mức (công tắc của chủ dự án — KHÔNG phải công tắc tiền Parttime).
// Không DB, không đồng hồ (`homNay` "YYYY-MM-DD" giờ VN truyền vào). Ngày là CHUỖI — so chuỗi được vì định dạng cố định.
// Luật chung của cả ba: KHÔNG HỒI TỐ — mọi thay đổi có hiệu lực từ hôm nay trở đi, không sửa ngày đã qua; ngày đã qua đọc đúng giá trị
// tại ngày đó (đổi Rank tháng 11 không đổi tiền tiết tháng 10).

const ngay = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const thang = (ymd: string) => ymd.slice(0, 7);
const CAN_CU_TOI_THIEU = 10;

// ─── Rank ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lỗi (câu tiếng Việt cho người dùng) hoặc null = hợp lệ. */
export function kiemDeXuatRank(p: {
  currentRank: number;
  proposedRank: number;
  effectiveFrom: string;
  basis: string;
  homNay: string;
  /** Tháng ("YYYY-MM") có kỳ công ĐÃ KHOÁ ở cơ sở đề xuất. */
  kyDaKhoa: ReadonlySet<string>;
  coDeXuatDangCho: boolean;
}): string | null {
  if (!Number.isInteger(p.proposedRank) || p.proposedRank < 1 || p.proposedRank > 4) return "Rank đề xuất phải từ 1 đến 4.";
  if (p.proposedRank === p.currentRank) return "Rank đề xuất phải khác Rank hiện tại.";
  if (p.basis.trim().length < CAN_CU_TOI_THIEU) return `Ghi căn cứ (thâm niên · tỷ lệ tái tục · năng lực), tối thiểu ${CAN_CU_TOI_THIEU} ký tự.`;
  if (p.effectiveFrom < p.homNay) return "Ngày hiệu lực không được trước hôm nay — đổi Rank không hồi tố tiền các tiết đã dạy.";
  if (p.kyDaKhoa.has(thang(p.effectiveFrom))) return `Kỳ công tháng ${thang(p.effectiveFrom)} đã khoá — chọn ngày hiệu lực ở tháng chưa khoá.`;
  if (p.coDeXuatDangCho) return "Giáo viên này đang có một đề xuất Rank đang chờ duyệt — quyết đề xuất đó trước.";
  return null;
}

export function kiemQuyetRank(p: {
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "CANCELLED";
  effectiveFrom: string;
  homNay: string;
  kyDaKhoa: ReadonlySet<string>;
  nguoiQuyet: string;
  nguoiDeXuat: string;
  duyet: boolean;
}): string | null {
  if (p.status !== "PROPOSED") return "Đề xuất này không còn chờ duyệt.";
  if (p.nguoiQuyet === p.nguoiDeXuat) return "Người lập đề xuất không tự duyệt / từ chối đề xuất của mình.";
  if (!p.duyet) return null; // từ chối không đổi giá ⇒ luôn được
  if (p.effectiveFrom < p.homNay) return "Ngày hiệu lực của đề xuất đã trôi qua — từ chối và đề xuất lại với ngày từ hôm nay (không hồi tố).";
  if (p.kyDaKhoa.has(thang(p.effectiveFrom))) return `Kỳ công tháng ${thang(p.effectiveFrom)} đã khoá — từ chối và đề xuất lại.`;
  return null;
}

// ─── Chứng nhận Trial ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type KhoangChungNhan = { effectiveFrom: string; effectiveTo: string | null };

/** Có chứng nhận hiệu lực TẠI ngày `ymd` (gồm hai đầu). */
export function chungNhanHieuLucTai(ds: readonly KhoangChungNhan[], ymd: string): boolean {
  return ds.some((c) => c.effectiveFrom <= ymd && (c.effectiveTo == null || ymd <= c.effectiveTo));
}

/** Thu hồi TỪ ngày `d` ⇒ ngày cuối còn hiệu lực là d − 1 (khuôn khuyến mãi). Thu hồi ngay ngày cấp ⇒ khoảng rỗng. */
export function ngayCuoiKhiThuHoi(d: string): string {
  return ngay(d, -1);
}

export function kiemCapChungNhan(p: { effectiveFrom: string; homNay: string; dangCo: readonly KhoangChungNhan[] }): string | null {
  if (p.effectiveFrom < p.homNay) return "Ngày hiệu lực không được trước hôm nay — chứng nhận không cấp hồi tố cho buổi Trial đã dạy.";
  const chong = p.dangCo.some((c) => c.effectiveTo == null || c.effectiveTo >= p.effectiveFrom);
  if (chong) return "Giáo viên đang có chứng nhận còn hiệu lực (hoặc chưa hết hạn) — thu hồi chứng nhận đó trước khi cấp mới.";
  return null;
}

// ─── Chính sách hỗ trợ Trial ──────────────────────────────────────────────────────────────────────────────────────────────

export type DongChinhSachTrial = {
  id: string;
  /** null = áp toàn hệ thống. */
  centerId: string | null;
  enabled: boolean;
  amountPerStudent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const phu = (d: DongChinhSachTrial, ymd: string) => d.effectiveFrom <= ymd && (d.effectiveTo == null || ymd <= d.effectiveTo);

/**
 * Chính sách áp cho buổi Trial ở cơ sở `centerId` NGÀY `ymd`: dòng riêng của cơ sở thắng dòng chung. Không dòng nào ⇒ null (= chưa bật).
 * Hai dòng CÙNG phạm vi cùng phủ một ngày là cấu hình sai ⇒ NÉM (chọn bừa một dòng là trả nhầm tiền).
 */
export function chinhSachTrialTai(ds: readonly DongChinhSachTrial[], centerId: string, ymd: string): { bat: boolean; mucMoiHocVien: number; dongId: string } | null {
  for (const pham of [centerId, null]) {
    const k = ds.filter((d) => d.centerId === pham && phu(d, ymd));
    if (k.length > 1) throw new Error(`Hai dòng chính sách hỗ trợ Trial cùng phạm vi cùng hiệu lực ngày ${ymd}: ${k.map((x) => x.id).join(", ")}`);
    if (k.length === 1) return { bat: k[0]!.enabled, mucMoiHocVien: k[0]!.amountPerStudent, dongId: k[0]!.id };
  }
  return null;
}

/**
 * Kế hoạch ĐẶT chính sách mới từ ngày `effectiveFrom` ở phạm vi `centerId`: dòng đang mở cùng phạm vi phải đóng ở F − 1. Từ chối khi
 * F trước hôm nay (không hồi tố) hoặc đã có dòng cùng phạm vi bắt đầu từ F trở đi (không ghi đè lịch tương lai âm thầm).
 */
export function keHoachDatChinhSachTrial(p: {
  ds: readonly DongChinhSachTrial[];
  centerId: string | null;
  effectiveFrom: string;
  homNay: string;
}): { ok: true; dong: { id: string; effectiveTo: string }[] } | { ok: false; loi: string } {
  if (p.effectiveFrom < p.homNay) return { ok: false, loi: "Ngày hiệu lực không được trước hôm nay — chính sách không áp hồi tố cho buổi đã qua." };
  const cung = p.ds.filter((d) => d.centerId === p.centerId);
  const sau = cung.find((d) => d.effectiveFrom >= p.effectiveFrom);
  if (sau) return { ok: false, loi: `Đã có một dòng cùng phạm vi bắt đầu ngày ${sau.effectiveFrom} — chọn ngày hiệu lực sau ngày đó.` };
  const dong = cung.filter((d) => d.effectiveTo == null || d.effectiveTo >= p.effectiveFrom).map((d) => ({ id: d.id, effectiveTo: ngay(p.effectiveFrom, -1) }));
  return { ok: true, dong };
}
