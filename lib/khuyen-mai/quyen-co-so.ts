// lib/khuyen-mai/quyen-co-so.ts — "người này được ban hành / sửa chính sách khuyến mãi CỦA NHỮNG CƠ SỞ NÀO". THUẦN.
//
// ── VÌ SAO CÓ FILE NÀY (01/11/2026) ──────────────────────────────────────────────────────────
// Quyền `promotions:manage` ban đầu chỉ có Quản trị tối cao + Giám đốc (chủ dự án chốt 26/09: "BLĐ"), nên mọi
// Server Action của module giả định người giữ quyền này quản lý ĐƯỢC MỌI THỨ. Chủ dự án mở quyền cho Quản lý
// cơ sở (01/11) — vai bị giới hạn theo cơ sở. Cấp quyền mà không đo lại giả định đó là hai lỗ câm:
//   · QLCS bỏ trống ô cơ sở ⇒ ban hành chính sách TOÀN HỆ THỐNG (rỗng = toàn hệ thống), tức áp cho cơ sở người khác;
//   · QLCS sửa / thu hồi chính sách của cơ sở khác (hoặc của Ban lãnh đạo) vì action chỉ hỏi "có `promotions:manage`".
// Luật nay: người chỉ có quyền ở một số cơ sở thì CHỈ làm việc với chính sách mà MỌI cơ sở của chính sách nằm trong
// phạm vi của họ, và chính sách phải NÊU RÕ cơ sở (không bao giờ rỗng). Thiếu dữ liệu ⇒ từ chối (fail-closed).
//
// ⚠️ Đơn vị đo là OrgUnit.id (cùng không gian với `PromotionPolicy.orgUnitIds`) — KHÔNG phải Center.id.
import type { ActionScopeActor } from "@/lib/lms/report-card-core";

export type PhamViKhuyenMai = "TAT_CA" | readonly string[];

/** Actor + tập OrgUnit mà từng quyền của họ phủ (`PermEntry.orgUnitScope`). */
export type ActorPhamViKm = Pick<ActionScopeActor, "isSuperAdmin" | "grantsAllow"> & {
  permissions: readonly { action: string; orgUnitScope?: "ALL" | readonly string[] | null }[];
};

export const QUYEN_QUAN_LY_KHUYEN_MAI = "promotions:manage" as const;

/**
 * Phạm vi OrgUnit của `promotions:manage` — hợp các quyền cùng tên; `"TAT_CA"` khi là Quản trị tối cao, có grant
 * riêng, hoặc neo vai ở Hội sở. Quyền thiếu `orgUnitScope` (actor dựng tay / chưa phủ) KHÔNG đóng góp gì ⇒ `[]`.
 */
export function phamViKhuyenMai(actor: ActorPhamViKm): PhamViKhuyenMai {
  if (actor.isSuperAdmin) return "TAT_CA";
  if (actor.grantsAllow.has(QUYEN_QUAN_LY_KHUYEN_MAI)) return "TAT_CA";
  const tap = new Set<string>();
  for (const p of actor.permissions) {
    if (p.action !== QUYEN_QUAN_LY_KHUYEN_MAI) continue;
    if (p.orgUnitScope === "ALL") return "TAT_CA";
    if (Array.isArray(p.orgUnitScope)) for (const id of p.orgUnitScope) tap.add(id);
  }
  return [...tap];
}

/**
 * Chính sách có `coSoChinhSach` (OrgUnit.id) thuộc phạm vi `pham` không.
 *
 * Người phạm vi TẤT CẢ làm được mọi thứ (kể cả chính sách toàn hệ thống = rỗng). Người phạm vi hẹp thì chính sách
 * PHẢI nêu ít nhất một cơ sở và MỌI cơ sở đó ∈ phạm vi — rỗng nghĩa là "toàn hệ thống", không phải "không cơ sở nào".
 */
export function duocLamViecVoi(pham: PhamViKhuyenMai, coSoChinhSach: readonly string[]): boolean {
  if (pham === "TAT_CA") return true;
  if (coSoChinhSach.length === 0) return false;
  return coSoChinhSach.every((c) => pham.includes(c));
}

/** Ô chọn cơ sở trên form: người phạm vi hẹp chỉ thấy cơ sở của mình (server vẫn kiểm lại bằng `duocLamViecVoi`). */
export function locCoSoChoNguoiDung<T extends { id: string }>(pham: PhamViKhuyenMai, ds: readonly T[]): T[] {
  return pham === "TAT_CA" ? [...ds] : ds.filter((c) => pham.includes(c.id));
}

export const CAU_NGOAI_PHAM_VI =
  "Chính sách này nằm ngoài cơ sở bạn quản lý — chỉ Ban lãnh đạo sửa được chính sách toàn hệ thống hoặc của cơ sở khác.";
export const CAU_BAN_HANH_NGOAI_PHAM_VI =
  "Quản lý cơ sở chỉ ban hành cho cơ sở của mình: chọn ít nhất một cơ sở bạn quản lý (không để trống — trống nghĩa là toàn hệ thống).";
