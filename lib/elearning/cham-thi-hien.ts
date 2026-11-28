import { boDau } from "@/lib/elearning/nguoi-hoc";
import type { CauDeCham, DongHangCho } from "@/lib/elearning/exam-grading-queue";

/**
 * P8/QtChamThi — HIỂN THỊ hàng chờ chấm bài THI TỰ LUẬN theo thiết kế (master-detail). THUẦN. Không đổi luật chấm: chỉ diễn đạt lại
 * `soNgayCho` (đã tính ở `napHangCho`), tìm kiếm, chọn lượt kế tiếp sau khi chốt và tóm tắt phần máy đã chấm.
 */
export const TAB_CHAM_THI = ["nhan-vien", "hoc-vien-online"] as const;
export type TabChamThi = (typeof TAB_CHAM_THI)[number];

export type NhanCho = { chu: string; sac: "danger" | "warning" | "muted" };

/** Cùng ngưỡng với màn cũ: chờ ≥ 3 ngày là đỏ (hạn chót cứng của người khác). Thiết kế: "chờ 2 ngày". */
export function nhanCho(soNgayCho: number | null): NhanCho {
  if (soNgayCho === null) return { chu: "chưa rõ mốc nộp", sac: "muted" };
  if (soNgayCho === 0) return { chu: "nộp hôm nay", sac: "muted" };
  if (soNgayCho >= 3) return { chu: `chờ ${soNgayCho} ngày`, sac: "danger" };
  if (soNgayCho >= 2) return { chu: `chờ ${soNgayCho} ngày`, sac: "warning" };
  return { chu: `chờ ${soNgayCho} ngày`, sac: "muted" };
}

/** Tìm theo tên người học hoặc tên đề (không phân biệt hoa/thường/dấu). Rỗng ⇒ giữ nguyên thứ tự (chờ lâu nhất trước). */
export function locHangThi<T extends Pick<DongHangCho, "tenNguoiHoc" | "tenDe">>(ds: readonly T[], q: string | undefined): T[] {
  const k = boDau((q ?? "").trim());
  return k === "" ? [...ds] : ds.filter((d) => boDau(d.tenNguoiHoc).includes(k) || boDau(d.tenDe).includes(k));
}

/** Lượt để mở SAU KHI chốt `idHienTai`: lượt liền sau trong danh sách đang hiện, không có thì liền trước, hết ⇒ null. */
export function idThiKeTiep(ds: readonly { attemptId: string }[], idHienTai: string): string | null {
  const i = ds.findIndex((d) => d.attemptId === idHienTai);
  if (i < 0) return ds[0]?.attemptId ?? null;
  return ds[i + 1]?.attemptId ?? ds[i - 1]?.attemptId ?? null;
}

export type TomTatMay = { soCauMay: number; soDung: number; diemMay: number; soCauTay: number };

/**
 * Phần máy đã chấm của một lượt (thiết kế: "Phần máy chấm: 9/10 câu đúng — 9 điểm. Còn 2 câu tự luận").
 * Đã có điểm ⇒ máy chấm; "đúng" = đạt điểm tối đa của câu. Chưa có điểm ⇒ còn phải chấm tay (kể cả câu máy không đọc nổi).
 */
export function tomTatMayCham(cacCau: readonly Pick<CauDeCham, "daCoDiem" | "score" | "points">[]): TomTatMay {
  let soCauMay = 0;
  let soDung = 0;
  let diemMay = 0;
  let soCauTay = 0;
  for (const c of cacCau) {
    if (!c.daCoDiem) {
      soCauTay++;
      continue;
    }
    soCauMay++;
    const d = c.score ?? 0;
    diemMay += d;
    if (d >= c.points) soDung++;
  }
  return { soCauMay, soDung, diemMay, soCauTay };
}

export function cauTomTatMay(t: TomTatMay): string {
  const may = t.soCauMay === 0 ? "Không có câu nào máy tự chấm" : `Phần máy chấm: ${t.soDung}/${t.soCauMay} câu đúng — ${t.diemMay} điểm`;
  return `${may}. Còn ${t.soCauTay} câu cần chấm tay.`;
}
