// lib/cham-cong/xac-nhan-cong-thuan.ts — phần THUẦN của XÁC NHẬN CÔNG + KHIẾU NẠI CÔNG (P2.2, 11/10/2026).
//
// VÂN TAY BẢNG CÔNG: nhân sự xác nhận "phiên bản A" của bảng công. Nếu sau đó số liệu đổi thành B (tính lại,
// ghi đè ngày, duyệt đơn chỉnh công…), xác nhận cũ KHÔNG còn đúng — và ta biết điều đó bằng cách so vân tay
// đã lưu với vân tay HIỆN TẠI lúc đọc, thay vì móc vào từng đường ghi (có đường ghi bằng SQL tay, có đường
// tính lại hàng loạt — móc là thể nào cũng sót).
//
// ⚠️ Vân tay CHỈ gồm cột GIÁ TRỊ người lao động nhìn thấy. KHÔNG có `computedAt`/`updatedAt` (lượt tính lại
// trong `lockPeriod` sẽ làm mọi xác nhận "cũ" đúng lúc chốt), KHÔNG có `status`/`periodId` (khoá kỳ đổi
// chúng), KHÔNG có `pairs`/`ruleSnapshot`/`flags` (JSON / chi tiết máy, không ổn định giữa các lượt tính).

/** Các cột của `StaffAttendanceDay` đi vào vân tay — sửa danh sách này là đổi nghĩa của "đã xác nhận". */
export type DongCong = {
  workDate: Date;
  templateCode: string | null;
  dayType: string;
  expectedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  lateApprovedMinutes: number;
  earlyLeaveApprovedMinutes: number;
  otPayableMinutes: number;
  holidayWorkMinutes: number;
  restDayWorkMinutes: number;
  dayCreditEarned: number;
  hourCredit: number;
  leaveUnits: number;
  holidayPaidUnits: number;
  overrideUnits: number | null;
  absenceStatus: string | null;
};

export const COT_VAN_TAY = {
  workDate: true,
  templateCode: true,
  dayType: true,
  expectedMinutes: true,
  workedMinutes: true,
  lateMinutes: true,
  earlyLeaveMinutes: true,
  lateApprovedMinutes: true,
  earlyLeaveApprovedMinutes: true,
  otPayableMinutes: true,
  holidayWorkMinutes: true,
  restDayWorkMinutes: true,
  dayCreditEarned: true,
  hourCredit: true,
  leaveUnits: true,
  holidayPaidUnits: true,
  overrideUnits: true,
  absenceStatus: true,
} as const;

/** Số thực làm tròn 4 chữ số — 0.1 + 0.2 không được làm đổi vân tay. */
export const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Công THỰC của ngày: ghi đè (nếu có) thắng công engine — đúng cách bảng tháng đọc. */
export const congNgay = (d: Pick<DongCong, "overrideUnits" | "dayCreditEarned">) => r4(d.overrideUnits ?? d.dayCreditEarned);

/**
 * Dòng RỖNG: không mã ca, mọi số = 0, không ghi đè, không xác nhận vắng. Engine sinh một dòng cho MỌI
 * ngày của khoảng được tính lại — `lockPeriod` tính lại CẢ THÁNG nên đẻ thêm hàng chục dòng rỗng ngay lúc
 * chốt. Cho chúng vào vân tay là mọi xác nhận "cũ" đúng lúc chốt dù không con số nào đổi (đo 11/10/2026,
 * ca [XN-02]). Dòng rỗng không mang thông tin công ⇒ bỏ khỏi vân tay và ảnh chụp.
 */
export function laDongRong(d: DongCong): boolean {
  return (
    !d.templateCode &&
    d.overrideUnits === null &&
    !d.absenceStatus &&
    d.expectedMinutes === 0 &&
    d.workedMinutes === 0 &&
    d.lateMinutes === 0 &&
    d.earlyLeaveMinutes === 0 &&
    d.lateApprovedMinutes === 0 &&
    d.earlyLeaveApprovedMinutes === 0 &&
    d.otPayableMinutes === 0 &&
    d.holidayWorkMinutes === 0 &&
    d.restDayWorkMinutes === 0 &&
    r4(d.dayCreditEarned) === 0 &&
    r4(d.hourCredit) === 0 &&
    r4(d.leaveUnits) === 0 &&
    r4(d.holidayPaidUnits) === 0
  );
}

export const coNghia = (rows: readonly DongCong[]) =>
  rows.filter((d) => !laDongRong(d)).sort((a, b) => a.workDate.getTime() - b.workDate.getTime());

/** Ảnh chụp lưu cùng xác nhận — để lần xem lại nói được "bạn đã xác nhận X, nay là Y". */
export type AnhChupBangCong = {
  tong: { cong: number; phutLam: number; phutTre: number; phutVeSom: number; ngayPhep: number; phutOT: number };
  ngay: { d: string; ma: string | null; cong: number }[];
};

export function anhChupBangCong(rows: readonly DongCong[]): AnhChupBangCong {
  const sx = coNghia(rows);
  const tong = { cong: 0, phutLam: 0, phutTre: 0, phutVeSom: 0, ngayPhep: 0, phutOT: 0 };
  for (const d of sx) {
    tong.cong = r4(tong.cong + congNgay(d));
    tong.phutLam += d.workedMinutes;
    tong.phutTre += d.lateMinutes;
    tong.phutVeSom += d.earlyLeaveMinutes;
    tong.ngayPhep = r4(tong.ngayPhep + d.leaveUnits);
    tong.phutOT += d.otPayableMinutes;
  }
  return { tong, ngay: sx.map((d) => ({ d: ymd(d.workDate), ma: d.templateCode, cong: congNgay(d) })) };
}

/** Những ngày có công / mã ca khác giữa ảnh đã xác nhận và hiện tại (ngày thêm/bớt cũng tính). */
export function ngayKhacNhau(cu: AnhChupBangCong, moi: AnhChupBangCong): { d: string; truoc: string; sau: string }[] {
  const nhan = (x: { ma: string | null; cong: number } | undefined) => (x ? `${x.ma ?? "—"} · ${x.cong}` : "không có");
  const a = new Map(cu.ngay.map((x) => [x.d, x]));
  const b = new Map(moi.ngay.map((x) => [x.d, x]));
  const out: { d: string; truoc: string; sau: string }[] = [];
  for (const d of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(d);
    const y = b.get(d);
    if (x?.ma !== y?.ma || x?.cong !== y?.cong) out.push({ d, truoc: nhan(x), sau: nhan(y) });
  }
  return out;
}

// ─── Trạng thái xác nhận (suy ra lúc đọc) ──────────────────────────────────────────────────────

export type TrangThaiXacNhan = "CHUA_XAC_NHAN" | "DA_XAC_NHAN" | "CAN_XAC_NHAN_LAI" | "HR_XAC_NHAN_THAY";

export function trangThaiXacNhan(
  xacNhan: { status: string; snapshotHash: string | null } | null,
  vanTayHienTai: string,
): TrangThaiXacNhan {
  if (!xacNhan || xacNhan.status === "PENDING" || !xacNhan.snapshotHash) return "CHUA_XAC_NHAN";
  if (xacNhan.snapshotHash !== vanTayHienTai) return "CAN_XAC_NHAN_LAI";
  return xacNhan.status === "OVERRIDDEN" ? "HR_XAC_NHAN_THAY" : "DA_XAC_NHAN";
}

// ─── Khiếu nại: trạng thái + chuyển trạng thái ────────────────────────────────────────────────

/**
 * P2.6 — người ở trạng thái này có được MỜI xác nhận kỳ không. Chỉ hai trạng thái còn việc phải làm; người đã
 * xác nhận / được xác nhận thay không nhận lời mời (mời họ là chuông rác).
 */
export const canMoiXacNhan = (t: TrangThaiXacNhan): boolean => t === "CHUA_XAC_NHAN" || t === "CAN_XAC_NHAN_LAI";

export const TRANG_THAI_KHIEU_NAI = ["OPEN", "IN_REVIEW", "WAITING_EMPLOYEE", "RESOLVED", "REJECTED", "CLOSED"] as const;
export type TrangThaiKhieuNai = (typeof TRANG_THAI_KHIEU_NAI)[number];

/** Còn "đang mở" — MỌI trạng thái chưa có kết luận đều chặn khoá kỳ (chỉ OPEN thì đẩy sang chờ NV là lách). */
export const KHIEU_NAI_DANG_MO: readonly TrangThaiKhieuNai[] = ["OPEN", "IN_REVIEW", "WAITING_EMPLOYEE"];

export const LOAI_KHIEU_NAI = [
  "MISSING_CHECKIN",
  "MISSING_CHECKOUT",
  "WRONG_SHIFT",
  "WRONG_LEAVE",
  "WRONG_OT",
  "WRONG_WORKING_MINUTES",
  "WRONG_LATE_EARLY",
  "OTHER",
] as const;
export type LoaiKhieuNai = (typeof LOAI_KHIEU_NAI)[number];

export const NHAN_LOAI_KHIEU_NAI: Record<LoaiKhieuNai, string> = {
  MISSING_CHECKIN: "Thiếu giờ vào",
  MISSING_CHECKOUT: "Thiếu giờ ra",
  WRONG_SHIFT: "Sai ca",
  WRONG_LEAVE: "Sai ngày nghỉ / phép",
  WRONG_OT: "Sai tăng ca",
  WRONG_WORKING_MINUTES: "Sai số giờ làm",
  WRONG_LATE_EARLY: "Sai đi muộn / về sớm",
  OTHER: "Khác",
};

/** Khiếu nại có chặn khoá kỳ không: mọi loại đụng tới con số công, trừ "Khác". */
export const laKhieuNaiNghiemTrong = (loai: LoaiKhieuNai) => loai !== "OTHER";

export type HanhDongNV = "TRA_LOI" | "RUT" | "DONG_Y" | "KHIEU_NAI_TIEP";
export type HanhDongQL = "NHAN_XU_LY" | "HOI_LAI" | "GIAI_QUYET" | "TU_CHOI";
export type HanhDongKhieuNai = HanhDongNV | HanhDongQL;

const BANG: Record<HanhDongKhieuNai, { vai: "NV" | "QL"; tu: readonly TrangThaiKhieuNai[]; den: TrangThaiKhieuNai; canGhiChu: boolean }> = {
  // Nhân sự
  TRA_LOI: { vai: "NV", tu: ["WAITING_EMPLOYEE"], den: "IN_REVIEW", canGhiChu: true },
  RUT: { vai: "NV", tu: ["OPEN", "IN_REVIEW", "WAITING_EMPLOYEE"], den: "CLOSED", canGhiChu: false },
  DONG_Y: { vai: "NV", tu: ["RESOLVED", "REJECTED"], den: "CLOSED", canGhiChu: false },
  KHIEU_NAI_TIEP: { vai: "NV", tu: ["RESOLVED", "REJECTED"], den: "OPEN", canGhiChu: true },
  // Quản lý / nhân sự công ty
  NHAN_XU_LY: { vai: "QL", tu: ["OPEN"], den: "IN_REVIEW", canGhiChu: false },
  HOI_LAI: { vai: "QL", tu: ["OPEN", "IN_REVIEW"], den: "WAITING_EMPLOYEE", canGhiChu: true },
  GIAI_QUYET: { vai: "QL", tu: ["OPEN", "IN_REVIEW", "WAITING_EMPLOYEE"], den: "RESOLVED", canGhiChu: true },
  TU_CHOI: { vai: "QL", tu: ["OPEN", "IN_REVIEW", "WAITING_EMPLOYEE"], den: "REJECTED", canGhiChu: true },
};

export const NHAN_HANH_DONG: Record<HanhDongKhieuNai, string> = {
  TRA_LOI: "Trả lời",
  RUT: "Rút khiếu nại",
  DONG_Y: "Đồng ý kết quả",
  KHIEU_NAI_TIEP: "Khiếu nại tiếp",
  NHAN_XU_LY: "Nhận xử lý",
  HOI_LAI: "Hỏi lại nhân sự",
  GIAI_QUYET: "Đã giải quyết",
  TU_CHOI: "Từ chối",
};

export type KetQuaChuyen = { ok: true; den: TrangThaiKhieuNai } | { ok: false; error: string };

/** Một bảng chuyển trạng thái cho mọi nơi gọi — server action, màn hình (nút nào hiện), test. */
export function chuyenKhieuNai(input: {
  hienTai: TrangThaiKhieuNai;
  hanhDong: HanhDongKhieuNai;
  vai: "NV" | "QL";
  ghiChu: string;
}): KetQuaChuyen {
  const q = BANG[input.hanhDong];
  if (q.vai !== input.vai) return { ok: false, error: "Bạn không làm được thao tác này với khiếu nại" };
  if (!q.tu.includes(input.hienTai)) return { ok: false, error: `Khiếu nại đang ở trạng thái không cho thao tác “${NHAN_HANH_DONG[input.hanhDong]}”` };
  if (q.canGhiChu && input.ghiChu.trim().length < 5) return { ok: false, error: "Ghi nội dung (tối thiểu 5 ký tự)" };
  return { ok: true, den: q.den };
}

/** Các nút hợp lệ cho (vai × trạng thái) — màn hình vẽ đúng những nút server sẽ nhận (luật 12). */
export const hanhDongHopLe = (vai: "NV" | "QL", hienTai: TrangThaiKhieuNai): HanhDongKhieuNai[] =>
  (Object.keys(BANG) as HanhDongKhieuNai[]).filter((h) => BANG[h].vai === vai && BANG[h].tu.includes(hienTai));

export const canGhiChu = (h: HanhDongKhieuNai) => BANG[h].canGhiChu;

/** Câu chặn khoá kỳ khi còn khiếu nại nghiêm trọng đang mở. `null` = cho qua. */
export function chanKhoaKyViKhieuNai(soDangMo: number, periodKey: string): string | null {
  if (soDangMo <= 0) return null;
  return (
    `Kỳ ${periodKey} còn ${soDangMo} khiếu nại công chưa có kết luận — xử lý xong (giải quyết / từ chối) rồi chốt kỳ. ` +
    "Cần chốt ngay thì cấp Hội sở dùng đường vượt kèm lý do."
  );
}
