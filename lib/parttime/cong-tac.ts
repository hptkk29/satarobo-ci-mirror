// lib/parttime/cong-tac.ts — ĐỌC bốn công tắc Parttime theo cơ sở. Luật thuần ở `cong-tac-thuan.ts`.
//
// MỘT lượt đọc cho mỗi công tắc: dòng toàn hệ thống (`SystemSetting`) + mọi ghi đè theo cơ sở (`CenterSetting`), cache cùng
// thẻ `settings` với `getSetting` (sửa ở màn Cấu hình vận hành là xoá cache ngay). Không nơi nào bật ⇒ người gọi trả lời TẮT
// mà không thêm câu tra nào — nhân sự ca thường không trả giá gì cho Parttime (lưới FLAG-NORMAL).
import { docPhamViCongTac, rbacV2ChoParttime } from "./cong-tac-doc";
import {
  CAU_RBAC_V2,
  LOI_RBAC_V2,
  batTai,
  coNoiNaoBat,
  hieuLuc,
  trangThaiCongTac,
  type LoaiCongTac,
} from "./cong-tac-thuan";

export { docPhamViCongTac };

export type NoiCongTac = { orgUnitId?: string | null; centerId?: string | null };

/** Bật tại nơi này (chưa xét RBAC). Dùng để HIỂN THỊ ("chưa bật") và cho công tắc không ghi (chấm công theo ngữ cảnh). */
export async function congTacBat(loai: LoaiCongTac, noi: NoiCongTac): Promise<boolean> {
  const pv = await docPhamViCongTac(loai);
  return coNoiNaoBat(pv) && batTai(pv, noi);
}

/** Có hiệu lực cho đường TỰ ĐỘNG (đồng bộ từ đơn / lịch): bật + (RBAC v2 nếu công tắc có ghi). v1 ⇒ coi như tắt, không ném. */
export async function congTacHieuLuc(loai: LoaiCongTac, noi: NoiCongTac): Promise<boolean> {
  return hieuLuc(loai, await congTacBat(loai, noi), rbacV2ChoParttime());
}

export type BoXetCongTac = {
  /** Có nơi nào bật (và đủ RBAC nếu công tắc có ghi) — `false` ⇒ trả lời TẮT ngay, không câu tra nào thêm. */
  coNoiNao: boolean;
  /** THUẦN — gọi được trong giao dịch / dưới khoá mà không chạm DB (xem chú thích `dongBoPhanCongTheoNguon`). */
  tai: (noi: NoiCongTac) => boolean;
};

/** Đọc MỘT lần, xét nhiều nơi. Đã gộp RBAC v2 cho công tắc có ghi (v1 ⇒ mọi nơi TẮT). */
export async function boXetCongTac(loai: LoaiCongTac): Promise<BoXetCongTac> {
  const pv = await docPhamViCongTac(loai);
  const du = coNoiNaoBat(pv) && hieuLuc(loai, true, rbacV2ChoParttime());
  return { coNoiNao: du, tai: (noi) => du && batTai(pv, noi) };
}

/** Có nơi nào bật không (rẻ — cache). Dùng trước một vòng đọc nặng. */
export async function congTacBatODau(loai: LoaiCongTac): Promise<boolean> {
  return coNoiNaoBat(await docPhamViCongTac(loai));
}

/** Lọc các cơ sở đang bật công tắc (đã xét RBAC nếu công tắc có ghi). */
export async function coSoCoHieuLuc(loai: LoaiCongTac, centerIds: Iterable<string>): Promise<Set<string>> {
  const pv = await docPhamViCongTac(loai);
  if (!coNoiNaoBat(pv) || !hieuLuc(loai, true, rbacV2ChoParttime())) return new Set();
  return new Set([...centerIds].filter((c) => batTai(pv, { centerId: c })));
}

/** Bật + chặn RBAC tại một nơi — để MÀN HÌNH nói thật vì sao nút khoá (luật 12). `dung` = bật VÀ không bị chặn. */
export async function trangThaiCongTacTai(loai: LoaiCongTac, noi: NoiCongTac): Promise<{ bat: boolean; chan: typeof LOI_RBAC_V2 | null; dung: boolean }> {
  const t = trangThaiCongTac(loai, await congTacBat(loai, noi), rbacV2ChoParttime());
  return { ...t, dung: t.bat && t.chan === null };
}

export type CongThaoTac = { ok: true } | { ok: false; error: string; ma: "CHUA_BAT" | typeof LOI_RBAC_V2 };

/**
 * Cổng cho THAO TÁC của người dùng (server action): chưa bật ⇒ `cauChuaBat`; bật mà RBAC v1 ⇒ `RBAC_V2_REQUIRED_FOR_PARTTIME`
 * (không âm thầm chạy v1 — v1 không xét cơ sở).
 */
export async function congThaoTacParttime(loai: LoaiCongTac, noi: NoiCongTac, cauChuaBat: string): Promise<CongThaoTac> {
  const t = trangThaiCongTac(loai, await congTacBat(loai, noi), rbacV2ChoParttime());
  if (!t.bat) return { ok: false, error: cauChuaBat, ma: "CHUA_BAT" };
  if (t.chan) return { ok: false, error: CAU_RBAC_V2, ma: t.chan };
  return { ok: true };
}
