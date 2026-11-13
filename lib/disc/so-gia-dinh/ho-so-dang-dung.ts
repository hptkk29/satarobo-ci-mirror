/**
 * HỒ SƠ ĐANG DÙNG của một người (doc 18, mục 2.5) — nguồn của thẻ cặp, phân tích cả nhà, kế hoạch.
 *
 *   1. bài TỰ LÀM hợp lệ MỚI NHẤT;
 *   2. chưa từng tự làm ⇒ bài GÓC NHÌN mới nhất (gắn nhãn "qua mắt chủ sổ");
 *   3. bài cũ hơn KHÔNG BAO GIỜ chen lên làm bài đang dùng — kể cả khi bài cũ có điểm "đẹp hơn".
 *
 * "Hợp lệ" = đã được lưu: đường nộp bài chỉ lưu khi `cham()` trả `hopLe: true`, nên bài bị chặn
 * (trả lời phẳng, thiếu câu) không bao giờ có mặt ở đây.
 *
 * Thuần, tất định: bằng thời gian thì xét `id` giảm dần — không phụ thuộc thứ tự mảng đầu vào.
 */
import type { BaiLam, ThanhVien } from "./kieu";

function moiHon(a: BaiLam, b: BaiLam): number {
  const dt = b.createdAt.getTime() - a.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Bài đang dùng của MỘT người từ các bài của người đó. null nếu chưa có bài nào. */
export function hoSoDangDung(baiCuaNguoi: readonly BaiLam[]): BaiLam | null {
  const ds = [...baiCuaNguoi].sort(moiHon);
  return ds.find((b) => b.cachLam === "TU_LAM") ?? ds.find((b) => b.cachLam === "GOC_NHIN") ?? null;
}

/** Bài đang dùng của từng thành viên. Bài "chưa xếp" (thanhVienId null) không thuộc ai nên bị bỏ qua. */
export function hoSoCaNha(
  thanhVien: readonly Pick<ThanhVien, "id">[],
  bai: readonly BaiLam[],
): ReadonlyMap<string, BaiLam | null> {
  const kq = new Map<string, BaiLam | null>();
  for (const tv of thanhVien) {
    kq.set(tv.id, hoSoDangDung(bai.filter((b) => b.thanhVienId === tv.id)));
  }
  return kq;
}

/** Các lần làm của một người, mới nhất trước. */
export function lichSuLanLam(baiCuaNguoi: readonly BaiLam[]): BaiLam[] {
  return [...baiCuaNguoi].sort(moiHon);
}

/**
 * Hai bài có so trực tiếp được không (doc 18, 1.6 + 7.1): cùng `phienBanBoDe` VÀ cùng bộ đề.
 * Đề gốc `1.1` và ngân hàng `nh:nh1` KHÔNG so với nhau; điểm cũ không bao giờ tính lại.
 */
export function soSanhTrucTiep(a: Pick<BaiLam, "phienBanBoDe" | "boDe">, b: Pick<BaiLam, "phienBanBoDe" | "boDe">): boolean {
  return a.phienBanBoDe === b.phienBanBoDe && a.boDe === b.boDe;
}

/**
 * Chênh lệch từng trục giữa bài MỚI và bài ngay TRƯỚC nó của cùng người — chỉ khi so trực tiếp được.
 * Trả null khi lần đầu hoặc khác phiên bản/bộ đề (giao diện nói "khác bộ câu hỏi — chỉ tham khảo").
 */
export function chenhLechVoiLanTruoc(
  lichSuMoiNhatTruoc: readonly BaiLam[],
  chiSo: number,
): { readonly D: number; readonly I: number; readonly S: number; readonly C: number } | null {
  const moi = lichSuMoiNhatTruoc[chiSo];
  const truoc = lichSuMoiNhatTruoc[chiSo + 1];
  if (!moi || !truoc) return null;
  if (!soSanhTrucTiep(moi, truoc)) return null;
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    D: r(moi.diem.D - truoc.diem.D),
    I: r(moi.diem.I - truoc.diem.I),
    S: r(moi.diem.S - truoc.diem.S),
    C: r(moi.diem.C - truoc.diem.C),
  };
}
