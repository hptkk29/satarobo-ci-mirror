import { LOAI_CHAM_MAY, LOAI_CHAM_TAY, laCauSo } from "@/lib/elearning/exam-grading";
import { SO_LUOT_TOI_THIEU } from "@/lib/elearning/report-r5";

/**
 * P8/QtCauHoi — HIỂN THỊ ngân hàng câu hỏi theo thiết kế 20/11: cây nhánh có đếm, ba tab (Mọi dạng · Máy chấm · Người chấm), "% đúng" theo câu. THUẦN.
 * Không đổi luật nào của kho: chỉ diễn đạt lại `bankPath` (cây theo tiền tố), loại câu (`LOAI_CHAM_*`) và `isCorrect` của các lượt đã chấm.
 */
export const TAB_KHO = ["moi-dang", "may-cham", "nguoi-cham"] as const;
export type TabKho = (typeof TAB_KHO)[number];

export type NhomCham = "may" | "nguoi" | "khac";

/**
 * Máy chấm = trắc nghiệm (`LOAI_CHAM_MAY`) + nhập số (có hàm chấm riêng); người chấm = trả lời ngắn / tự luận (`LOAI_CHAM_TAY`). Các loại còn lại (CHƯA mở vào đề)
 * chỉ nằm ở tab "Mọi dạng" — KHÔNG ép vào máy hay người: chưa ai chấm được chúng.
 */
export function nhomCham(type: string): NhomCham {
  if ((LOAI_CHAM_MAY as readonly string[]).includes(type) || laCauSo(type)) return "may";
  if ((LOAI_CHAM_TAY as readonly string[]).includes(type)) return "nguoi";
  return "khac";
}

export function demTheoTab(ds: readonly { type: string }[]): Record<TabKho, number> {
  let may = 0;
  let nguoi = 0;
  for (const d of ds) {
    const n = nhomCham(d.type);
    if (n === "may") may++;
    else if (n === "nguoi") nguoi++;
  }
  return { "moi-dang": ds.length, "may-cham": may, "nguoi-cham": nguoi };
}

export function locTheoTab<T extends { type: string }>(ds: readonly T[], tab: TabKho): T[] {
  if (tab === "moi-dang") return [...ds];
  const can: NhomCham = tab === "may-cham" ? "may" : "nguoi";
  return ds.filter((d) => nhomCham(d.type) === can);
}

export type NutNhanh = { path: string; nhan: string; dem: number; cap: number };

/** "an-toan-lao-dong" ⇒ "An toan lao dong" (slug không dấu — không khôi phục được dấu). */
export function nhanNhanh(doan: string): string {
  const t = doan.replace(/-/g, " ").trim();
  return t.length === 0 ? doan : t[0]!.toUpperCase() + t.slice(1);
}

/**
 * Cây nhánh từ danh sách `bankPath` (MỖI CÂU MỘT PHẦN TỬ). Mọi tiền tố là một nút (nhánh cha có mặt dù chưa câu nào nằm thẳng ở đó); `dem` = số câu nằm TRONG nhánh
 * (kể cả nhánh con). Sắp theo đường dẫn nên cha đứng trước con. Đường dẫn sai dạng bị bỏ qua (không vỡ cây).
 */
export function dungCayNhanh(bankPaths: readonly string[]): NutNhanh[] {
  const dem = new Map<string, number>();
  for (const bp of bankPaths) {
    if (!/^\/([a-z0-9-]+\/)+$/.test(bp)) continue;
    const doan = bp.split("/").filter(Boolean);
    let duong = "/";
    for (const d of doan) {
      duong += `${d}/`;
      dem.set(duong, (dem.get(duong) ?? 0) + 1);
    }
  }
  return [...dem.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, n]) => {
      const doan = path.split("/").filter(Boolean);
      return { path, nhan: nhanNhanh(doan[doan.length - 1]!), dem: n, cap: doan.length - 1 };
    });
}

export type DungCau = { soLuot: number; soDung: number; tiLe: number | null };

/**
 * % đúng THEO CÂU HỎI trong kho: gộp mọi lần câu đó nằm trong một đề (`TrnExamQuestion`) và đã có lượt chấm xong. `isCorrect` null (chưa chấm) không tính.
 * Dưới `SO_LUOT_TOI_THIEU` lượt ⇒ `tiLe = null` ("—"), cùng ngưỡng với báo cáo Kết quả thi: 1 người làm đúng KHÔNG được in thành "100%".
 */
export function tiLeDungTheoCau(
  traLoi: readonly { examQuestionId: string; isCorrect: boolean | null }[],
  cauCuaDe: ReadonlyMap<string, string>,
): Map<string, DungCau> {
  const tong = new Map<string, { soLuot: number; soDung: number }>();
  for (const a of traLoi) {
    if (a.isCorrect === null) continue;
    const q = cauCuaDe.get(a.examQuestionId);
    if (!q) continue;
    const t = tong.get(q) ?? { soLuot: 0, soDung: 0 };
    t.soLuot += 1;
    if (a.isCorrect) t.soDung += 1;
    tong.set(q, t);
  }
  return new Map(
    [...tong.entries()].map(([q, t]) => [q, { ...t, tiLe: t.soLuot >= SO_LUOT_TOI_THIEU ? Math.round((t.soDung / t.soLuot) * 100) : null }] as const),
  );
}
