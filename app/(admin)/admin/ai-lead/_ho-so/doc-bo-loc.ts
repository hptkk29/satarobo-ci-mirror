// app/(admin)/admin/ai-lead/_ho-so/doc-bo-loc.ts — đọc bộ lọc từ URL (`searchParams`). THUẦN. Giá trị lạ ⇒ bỏ (không bao giờ ném, không mở rộng phạm vi).
import type { AiLeadDraftState } from "@prisma/client";
import type { LocDanhSach } from "@/lib/ai-lead/dich-vu/duyet";

const TRANG_THAI = new Set<string>([
  "COLLECTING", "PENDING_INFO", "WAITING_QLCS", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED", "REJECTED", "EXPIRED", "SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING",
]);

type SP = Record<string, string | string[] | undefined>;
const mot = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export function docBoLoc(sp: SP): LocDanhSach {
  const tt = mot(sp.tt);
  const nx = mot(sp.nx);
  const loc: LocDanhSach = {};
  if (tt === "tat-ca" || TRANG_THAI.has(tt)) loc.trangThai = tt as "tat-ca" | AiLeadDraftState;
  const page = mot(sp.page).slice(0, 80);
  if (page) loc.pageId = page;
  const cs = mot(sp.cs).slice(0, 64);
  if (cs) loc.coSoId = cs;
  if (nx) loc.nguoiXuLy = nx.slice(0, 64);
  if (mot(sp.han) === "1") loc.quaHanSla = true;
  const q = mot(sp.q).slice(0, 80);
  if (q) loc.q = q;
  return loc;
}

/** Ngược của `docBoLoc`: bộ lọc → chuỗi truy vấn (không có dấu `?`). Dùng cho nút «Tải lại» để GIỮ bộ lọc đang xem. `docBoLoc(parse(queryTuLoc(l)))` ≡ `l`. */
export function queryTuLoc(l: LocDanhSach): string {
  const p = new URLSearchParams();
  if (l.trangThai) p.set("tt", l.trangThai);
  if (l.pageId) p.set("page", l.pageId);
  if (l.coSoId) p.set("cs", l.coSoId);
  if (l.nguoiXuLy) p.set("nx", l.nguoiXuLy);

  if (l.quaHanSla) p.set("han", "1");
  if (l.q) p.set("q", l.q);
  return p.toString();
}

export const CO_LOC = (l: LocDanhSach): boolean => Object.keys(l).length > 0;
