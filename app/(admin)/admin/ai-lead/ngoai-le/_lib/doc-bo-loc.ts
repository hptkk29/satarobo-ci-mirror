// app/(admin)/admin/ai-lead/ngoai-le/_lib/doc-bo-loc.ts — đọc bộ lọc màn «Ngoại lệ» từ URL (`searchParams`). THUẦN. Giá trị lạ ⇒ bỏ (không bao giờ ném, không mở rộng phạm vi).
import type { LocNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le";
import type { LoaiNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le-thuan";

type SP = Record<string, string | string[] | undefined>;
const mot = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

/** Tham số URL ⇄ loại. Giữ tiếng Việt không dấu để đường dẫn đọc được. */
export const LOAI_THEO_URL: ReadonlyMap<string, LoaiNgoaiLe> = new Map<string, LoaiNgoaiLe>([
  ["loi", "SYSTEM_EXCEPTION"],
  ["chua-co-sale", "ASSIGNMENT_PENDING"],
  ["qua-han", "QUA_HAN_SLA"],
]); // Map, không phải object: `?loai=__proto__` không được trả về Object.prototype.
export const URL_THEO_LOAI: Record<LoaiNgoaiLe, string> = {
  SYSTEM_EXCEPTION: "loi",
  ASSIGNMENT_PENDING: "chua-co-sale",
  QUA_HAN_SLA: "qua-han",
};

export function docBoLocNgoaiLe(sp: SP): LocNgoaiLe {
  const loc: LocNgoaiLe = {};
  const loai = LOAI_THEO_URL.get(mot(sp.loai));
  if (loai) loc.loai = loai;
  const page = mot(sp.page).slice(0, 80);
  if (page) loc.pageId = page;
  const cs = mot(sp.cs).slice(0, 64);
  if (cs) loc.coSoId = cs;
  const q = mot(sp.q).slice(0, 40);
  if (q) loc.q = q;
  return loc;
}

export const CO_LOC_NGOAI_LE = (l: LocNgoaiLe): boolean => Object.keys(l).length > 0;

/** Dựng href giữ các bộ lọc khác, chỉ đổi loại (thẻ chọn loại là liên kết thật — không cần JS, bấm lại/F5 vẫn đúng). */
export function hrefTheoLoai(loc: LocNgoaiLe, loai: LoaiNgoaiLe | null): string {
  const p = new URLSearchParams();
  if (loai) p.set("loai", URL_THEO_LOAI[loai]);
  if (loc.pageId) p.set("page", loc.pageId);
  if (loc.coSoId) p.set("cs", loc.coSoId);
  if (loc.q) p.set("q", loc.q);
  const s = p.toString();
  return s ? `/ai-lead/ngoai-le?${s}` : "/ai-lead/ngoai-le";
}
