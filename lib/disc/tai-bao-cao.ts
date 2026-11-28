/**
 * Tải báo cáo lần đầu bằng TOKEN (cấp một lần ở `luuKetQuaDisc`). THUẦN theo cổng `TaiStore`.
 *
 * Token = bí mật mang (bearer) 192 bit, chỉ lưu HASH, sống `HAN_TOKEN_TAI_PHUT` phút, gắn với MỘT bài.
 * Mọi lỗi (không có, sai, hết hạn, bài đã xoá/hết hạn) cùng một mã `TOKEN_KHONG_HOP_LE` — không oracle.
 * Không đơn-dùng (tải JSON rồi mở HTML để in trong cùng hạn 30 phút), NHƯNG chết ngay khi bài được NHẬN (CLAIMED, F-11):
 * từ lúc đó bài thuộc tài khoản chủ, bearer cũ không còn là cách đọc. Token chỉ đi qua THÂN POST (không bao giờ ở URL).
 * Muốn đọc lâu dài phải nhận bài.
 *
 * ⚠️ Báo cáo dựng từ `DiscSubject.result` (điểm bốn nhóm D-I-S-C; MỘT nguồn lưu). KHÔNG có nội dung diễn giải DISC gốc
 * (chưa có giấy phép — audit P0 §B1). Khi engine hợp pháp vào repo, phần diễn giải được thêm ở đây.
 */
import { safeEqual } from "@/lib/security/safe-equal";
import { chuanHoaTen } from "./ho-so";
import { bam, ketQuaNguoiSchema } from "./luu";

export type BanTai = {
  downloadTokenHash: string | null;
  downloadTokenExpires: Date | null;
  claimStatus: string;
  deletedAt: Date | null;
  createdAt: Date;
  engineVersion: string;
  /** `result` = DiscSubject.result — MỘT nguồn lưu kết quả (không còn reportSnapshot). */
  subjects: Array<{ role: "PARENT" | "STUDENT"; fullName: string; birthYear: number; grade: string | null; observedByAdult: boolean; result: unknown }>;
};

export type TaiStore = {
  /** Tra theo HASH của token. Không trả bài đã xoá hay không có token. */
  timTheoHashToken: (hash: string) => Promise<BanTai | null>;
};

export type BaoCaoNguoi = {
  vaiTro: "PHU_HUYNH" | "HOC_SINH";
  hoTen: string;
  namSinh: number;
  bacHoc: string | null;
  nguoiLonQuanSat: boolean;
  diem: { D: number; I: number; S: number; C: number };
  maBoDe: string;
  phienBanBoDe: string;
};

export type BaoCao = { taoLuc: string; engineVersion: string; nguoi: BaoCaoNguoi[] };

export type KetQuaTai = { ok: true; baoCao: BaoCao } | { ok: false; loi: "TOKEN_KHONG_HOP_LE" };

const TU_CHOI: KetQuaTai = { ok: false, loi: "TOKEN_KHONG_HOP_LE" };

export function dungBaoCao(b: BanTai): BaoCao | null {
  const sPh = b.subjects.find((s) => s.role === "PARENT");
  const sHs = b.subjects.find((s) => s.role === "STUDENT");
  if (!sPh || !sHs) return null;
  const ph = ketQuaNguoiSchema.safeParse(sPh.result);
  const hs = ketQuaNguoiSchema.safeParse(sHs.result);
  if (!ph.success || !hs.success) return null;
  const nguoi = (s: NonNullable<typeof sPh>, k: typeof ph.data, vai: BaoCaoNguoi["vaiTro"]): BaoCaoNguoi => ({
    vaiTro: vai,
    hoTen: chuanHoaTen(s.fullName), // bài cũ có thể còn ký tự điều khiển/bidi từ trước khi có vệ sinh tên (S-09)
    namSinh: s.birthYear,
    bacHoc: s.grade,
    nguoiLonQuanSat: s.observedByAdult,
    diem: k.diem,
    maBoDe: k.maBoDe,
    phienBanBoDe: k.phienBanBoDe,
  });
  return { taoLuc: b.createdAt.toISOString(), engineVersion: b.engineVersion, nguoi: [nguoi(sPh, ph.data, "PHU_HUYNH"), nguoi(sHs, hs.data, "HOC_SINH")] };
}

export async function taiBaoCao(p: { token: unknown; store: TaiStore; now: Date }): Promise<KetQuaTai> {
  if (typeof p.token !== "string" || p.token.length < 20 || p.token.length > 128) return TU_CHOI;
  const hash = bam(p.token);
  const b = await p.store.timTheoHashToken(hash);
  if (!b || !b.downloadTokenHash || !b.downloadTokenExpires) return TU_CHOI;
  // Hằng thời gian: tra bảng bằng hash đã lộ thông tin theo chỉ mục; so lại ở đây để KHÔNG tin hợp đồng store.
  if (!safeEqual(b.downloadTokenHash, hash)) return TU_CHOI;
  if (b.downloadTokenExpires.getTime() <= p.now.getTime()) return TU_CHOI;
  if (b.deletedAt || b.claimStatus !== "PENDING_CLAIM") return TU_CHOI; // CLAIMED/EXPIRED/REVOKED (và trạng thái lạ) ⇒ chết (F-11)
  const baoCao = dungBaoCao(b);
  return baoCao ? { ok: true, baoCao } : TU_CHOI;
}

const THOAT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const e = (v: string | number | null) => String(v ?? "").replace(/[&<>"']/g, (c) => THOAT[c]!);

/** HTML in được (Ctrl+P → Lưu PDF). Không script, không tài nguyên ngoài. Mọi chuỗi đều được thoát. */
export function dungBaoCaoHtml(b: BaoCao): string {
  const dong = b.nguoi
    .map(
      (n) =>
        `<section><h2>${n.vaiTro === "PHU_HUYNH" ? "Phụ huynh" : "Học sinh"}: ${e(n.hoTen)}</h2>` +
        `<p>Năm sinh ${e(n.namSinh)}${n.bacHoc ? ` · ${n.bacHoc === "MN" ? "Mầm non" : `Lớp ${e(n.bacHoc)}`}` : ""}${n.nguoiLonQuanSat ? " · Người lớn quan sát và trả lời hộ" : ""}</p>` +
        `<table><thead><tr><th>D</th><th>I</th><th>S</th><th>C</th></tr></thead><tbody><tr>` +
        `<td>${e(n.diem.D)}</td><td>${e(n.diem.I)}</td><td>${e(n.diem.S)}</td><td>${e(n.diem.C)}</td></tr></tbody></table>` +
        `<p class="nho">Bộ đề ${e(n.maBoDe)} · phiên bản ${e(n.phienBanBoDe)}</p></section>`,
    )
    .join("");
  return (
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>Kết quả DISC</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#111}` +
    `table{border-collapse:collapse}th,td{border:1px solid #999;padding:.4rem 1rem;text-align:center}.nho{color:#555;font-size:.85rem}</style></head>` +
    `<body><h1>Kết quả DISC</h1><p class="nho">Lập lúc ${e(b.taoLuc)} · động cơ ${e(b.engineVersion)}</p>${dong}</body></html>`
  );
}
