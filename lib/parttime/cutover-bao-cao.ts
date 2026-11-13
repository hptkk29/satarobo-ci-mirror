// lib/parttime/cutover-bao-cao.ts — báo cáo XEM TRƯỚC cutover tách theo MỐC NGÀY (THUẦN, không DB, không đồng hồ).
//
// Vì sao (20/10/2026): phạm vi chuyển đổi CS2 bắt đầu 15/10/2026 trong khi công cụ chạy ngày 20/10 — người duyệt cần thấy RIÊNG
// phần BỔ SUNG cho các buổi đã qua (trước mốc) và phần từ mốc trở đi, kèm cùng một bộ đếm cho cả hai. Mọi phán đoán vẫn là của
// `phanLoaiCutover` (`cutover.ts`) — tệp này chỉ ĐẾM lại kết quả đã phân loại, không phân loại lần hai.
//
// Buổi đã qua: công cụ không nhập (đối soát lịch sử riêng) — không có nhóm "đã dạy" nào được sinh ra ở đây.
import type { KetQuaCutover } from "./cutover";

export type DemCutover = {
  soBuoi: number;
  /** Ngày sớm nhất / muộn nhất có buổi ("YYYY-MM-DD"); null khi rỗng. */
  tuNgay: string | null;
  denNgay: string | null;
  /** Số phân công SẼ NHẬP theo vai. */
  seNhapGvChinh: number;
  seNhapTroGiang: number;
  /** Buổi nhập được (READY_TO_IMPORT + PENDING_ACCEPTANCE còn vai thiếu). */
  buoiCoNhap: number;
  /** Không có GV đứng chính mặc định (hoặc GV mặc định đã từ chối) — QLCS phải phân. */
  thieuGv: number;
  /** Nhãn MISSING_TA — lớp cần TA theo quy định mà lớp chưa có TA. */
  thieuTa: number;
  /** Nhãn NON_STANDARD_DURATION — thời lượng dạy không quy đổi được tiết (chờ chính sách). */
  thoiLuongKhongChuan: number;
  /** Nhãn AMBIGUOUS_SHIFT — khung có mặt không nằm trọn một ca. */
  caMoHo: number;
  /** Đã có phân công (không nhập lại): REVIEW (lệch mặc định) · PENDING_ACCEPTANCE · ACCEPTED. */
  daCoPhanCong: { review: number; choNhan: number; daNhan: number };
  /** INVALID (không nhập được) + lý do. */
  loi: number;
  lyDoLoi: Record<string, number>;
  /** Cùng lớp × ngày × giờ xuất hiện > 1 buổi (dữ liệu lịch trùng) — số buổi nằm trong nhóm trùng. */
  trungLich: number;
};

function dem(ds: readonly KetQuaCutover[]): DemCutover {
  const ngay = ds.map((k) => k.ngay).sort();
  const lyDoLoi: Record<string, number> = {};
  for (const k of ds) if (k.nhom === "INVALID") for (const l of k.lyDo) lyDoLoi[l] = (lyDoLoi[l] ?? 0) + 1;
  const khoa = new Map<string, number>();
  for (const k of ds) {
    const key = `${k.classCode ?? "?"}|${k.ngay}|${k.gio ?? "?"}`;
    khoa.set(key, (khoa.get(key) ?? 0) + 1);
  }
  const co = (n: KetQuaCutover["nhan"][number]) => ds.filter((k) => k.nhan.includes(n)).length;
  const nhom = (n: KetQuaCutover["nhom"]) => ds.filter((k) => k.nhom === n).length;
  return {
    soBuoi: ds.length,
    tuNgay: ngay[0] ?? null,
    denNgay: ngay[ngay.length - 1] ?? null,
    seNhapGvChinh: ds.reduce((s, k) => s + k.seNhap.filter((x) => x.role === "MAIN_TEACHER").length, 0),
    seNhapTroGiang: ds.reduce((s, k) => s + k.seNhap.filter((x) => x.role === "TEACHING_ASSISTANT").length, 0),
    buoiCoNhap: ds.filter((k) => k.seNhap.length > 0).length,
    thieuGv: nhom("MISSING_MAIN"),
    thieuTa: co("MISSING_TA"),
    thoiLuongKhongChuan: co("NON_STANDARD_DURATION"),
    caMoHo: co("AMBIGUOUS_SHIFT"),
    daCoPhanCong: { review: nhom("REVIEW"), choNhan: nhom("PENDING_ACCEPTANCE"), daNhan: nhom("ACCEPTED") },
    loi: nhom("INVALID"),
    lyDoLoi,
    trungLich: [...khoa.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0),
  };
}

/** Tách theo `moc` ("YYYY-MM-DD", thường là HÔM NAY giờ VN): buổi `ngay < moc` là phần BỔ SUNG đã qua, `ngay >= moc` là từ mốc. */
export function baoCaoTheoMoc(ds: readonly KetQuaCutover[], moc: string): { moc: string; truocMoc: DemCutover; tuMoc: DemCutover; tong: DemCutover } {
  return {
    moc,
    truocMoc: dem(ds.filter((k) => k.ngay < moc)),
    tuMoc: dem(ds.filter((k) => k.ngay >= moc)),
    tong: dem(ds),
  };
}

/** Một dòng log cho người đọc workflow. */
export function dongBaoCao(nhan: string, d: DemCutover): string {
  const khoang = d.tuNgay ? `${d.tuNgay}…${d.denNgay}` : "—";
  return (
    `${nhan}: ${d.soBuoi} buổi (${khoang}) · sẽ nhập GV chính ${d.seNhapGvChinh} · TA ${d.seNhapTroGiang} (${d.buoiCoNhap} buổi)` +
    ` · thiếu GV ${d.thieuGv} · thiếu TA ${d.thieuTa} · thời lượng không chuẩn ${d.thoiLuongKhongChuan} · ca mơ hồ ${d.caMoHo}` +
    ` · đã có phân công: lệch ${d.daCoPhanCong.review}/chờ nhận ${d.daCoPhanCong.choNhan}/đã nhận ${d.daCoPhanCong.daNhan}` +
    ` · trùng lịch ${d.trungLich} · lỗi ${d.loi}${d.loi ? ` ${JSON.stringify(d.lyDoLoi)}` : ""}`
  );
}
