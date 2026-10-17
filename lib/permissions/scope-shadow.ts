// lib/permissions/scope-shadow.ts — Nền Hệ thống P3 · US-12.
//
// Resolver `dataScope` đo bằng ĐƠN VỊ (`orgUnitId`) chạy SONG SONG resolver đang chạy
// thật (đo bằng `centerId`, xem lib/permissions/can.ts), so kết quả, lệch thì ghi log.
//
// ── VÌ SAO CẦN BƯỚC NÀY ─────────────────────────────────────────────────────────
// Luật cứng #2: trước P4 không được đổi hành vi đường cũ. Nên không thể "đổi sang đo
// bằng orgUnitId rồi xem có ai kêu không" — phải chạy im lặng, đủ lâu, đếm được, rồi
// mới bật (US-13 AC1: 7 ngày liên tục 0 lệch chưa giải thích).
//
// ── HAI MỨC UNIT_* RESOLVE BẰNG PATH Ở ĐÂU ──────────────────────────────────────
// Không so chuỗi `path LIKE` lúc chạy. `buildActor()` đã dùng path/cây để tính sẵn
// subtree thành DANH SÁCH `orgUnitId` (`getSubtreeOrgUnitIds`), nên lúc chạy chỉ còn
// một phép `includes` — cùng hình dạng với `roleCenterScope` đang chạy, để hai vế so
// được với nhau một cách công bằng. Path vẫn là thứ quyết định danh sách đó.
//
// ── "CHƯA PHỦ" KHÁC "LỆCH" — chỗ quan trọng nhất file này ───────────────────────
// Phần lớn chỗ gọi hiện truyền `Target` chỉ có `centerId`. Coi "thiếu orgUnitId" là
// LỆCH thì shadow đỏ rực ngay ngày đầu vì lý do chẳng liên quan gì tới đúng/sai của
// resolver, và cổng 7 ngày thành vô nghĩa — đúng vết xe repo đã ghi ("kêu sói mỗi đêm
// … là cách nhanh nhất khiến cả đội thôi đọc alert"). Nên ca đó ĐẾM RIÊNG là `chua-phu`.
// Con số `chua-phu` chính là ĐỘ PHỦ của pha shadow: nó phải giảm về gần 0 trước khi
// bảo "7 ngày sạch" có ý nghĩa. Sạch trên một mẫu rỗng không phải là sạch.
import type { Actor, PermEntry, Target } from "@/lib/auth/actor";
import type { GrantRow } from "@/lib/permissions/grant-types";

/** Phạm vi ĐƠN VỊ của một vai — bản song song `RoleCenterScope`, đo bằng orgUnitId. */
export type RoleOrgScope = "ALL" | { unitOnly: string[]; unitAndBelow: string[] };

/**
 * Resolver MỚI: cùng cấu trúc `scopeSatisfied` của can.ts, chỉ đổi đơn vị đo từ
 * `centerId` sang `orgUnitId`. Giữ y nguyên hành vi fail-closed: thiếu mapping,
 * thiếu target, hay dataScope lạ đều trả false.
 */
export function scopeSatisfiedByOrgUnit(
  grant: GrantRow,
  actor: Actor,
  target?: Target,
): boolean {
  switch (grant.dataScope) {
    case "ALL":
      return true;
    case "UNIT_AND_BELOW":
    case "UNIT_ONLY": {
      const orgUnitId = target?.orgUnitId;
      if (!orgUnitId) return false;
      const scope = actor.roleOrgScope?.[grant.subjectId];
      if (scope == null) return false; // thiếu mapping → an toàn = false
      if (scope === "ALL") return true;
      const units =
        grant.dataScope === "UNIT_ONLY" ? scope.unitOnly : scope.unitAndBelow;
      return units.includes(orgUnitId);
    }
    case "OWN":
      return !!target?.createdById && target.createdById === actor.userId;
    default:
      return false;
  }
}

export type KetQuaSoSanh = {
  /**
   * `giong`     — hai resolver cùng kết quả.
   * `lech`      — khác nhau: đây mới là thứ cần điều tra, và là thứ cổng 7 ngày đếm.
   * `chua-phu`  — KHÔNG so được vì chỗ gọi chưa truyền `orgUnitId`. Không phải lỗi
   *               của resolver; là thước đo độ phủ của pha shadow.
   */
  ketQua: "giong" | "lech" | "chua-phu";
  /** Kết quả resolver ĐANG CHẠY THẬT (đo bằng centerId). */
  cu: boolean;
  /** Kết quả resolver MỚI (đo bằng orgUnitId). `null` khi chưa phủ. */
  moi: boolean | null;
  lyDo?: string;
};

/**
 * `scopeSatisfied` của can.ts là hàm nội bộ (không export) — chép lại đúng logic ở đây
 * thay vì export nó ra.
 *
 * VÌ SAO CHÉP CHỨ KHÔNG DÙNG CHUNG: shadow phải đo ĐƯỜNG CŨ **như nó đang là**. Nếu
 * hai bên dùng chung một hàm thì mai kia ai đó sửa hàm đó, cả hai vế shadow cùng đổi
 * và phép so trở thành so chính nó với chính nó — im lặng vô dụng. Bản chép này cố ý
 * đóng băng; nó sẽ bị xoá ở P4 khi đường cũ được gỡ.
 */
function scopeSatisfiedByCenter(
  grant: GrantRow,
  actor: Actor,
  target?: Target,
): boolean {
  switch (grant.dataScope) {
    case "ALL":
      return true;
    case "UNIT_AND_BELOW":
    case "UNIT_ONLY": {
      if (!target?.centerId) return false;
      const scope = actor.roleCenterScope?.[grant.subjectId];
      if (scope == null) return false;
      if (scope === "ALL") return true;
      const centers =
        grant.dataScope === "UNIT_ONLY" ? scope.unitOnly : scope.unitAndBelow;
      return centers.includes(target.centerId);
    }
    case "OWN":
      return !!target?.createdById && target.createdById === actor.userId;
    default:
      return false;
  }
}

/** Chỉ hai mức UNIT_* mới cần `orgUnitId`; ALL và OWN so được không cần gì thêm. */
function canOrgUnitId(grant: GrantRow): boolean {
  return grant.dataScope === "UNIT_ONLY" || grant.dataScope === "UNIT_AND_BELOW";
}

/**
 * So hai resolver trên CÙNG một (grant, actor, target). Thuần tuý — không đụng DB,
 * không log; chỗ gọi quyết định làm gì với kết quả.
 */
export function soSanhScope(
  grant: GrantRow,
  actor: Actor,
  target?: Target,
): KetQuaSoSanh {
  const cu = scopeSatisfiedByCenter(grant, actor, target);

  // Chưa phủ: hai mức UNIT_* mà target KHÔNG mang orgUnitId. Lưu ý ca `target` rỗng
  // hoàn toàn (null) thì KHÔNG tính chưa phủ — lúc đó cả hai vế đều fail-closed vì
  // cùng một lý do, so được và giống nhau.
  if (canOrgUnitId(grant) && target && !target.orgUnitId) {
    return {
      ketQua: "chua-phu",
      cu,
      moi: null,
      lyDo: "target thiếu orgUnitId — chỗ gọi chưa truyền, chưa so được",
    };
  }

  const moi = scopeSatisfiedByOrgUnit(grant, actor, target);
  return { ketQua: cu === moi ? "giong" : "lech", cu, moi };
}

// ═════════════════════════════════════════════════════════════════════════════════
// PHẦN 2 — shadow cho ĐƯỜNG ĐANG ENFORCE THẬT (`canV2` / `PermEntry.scopeType`).
//
// Phần 1 ở trên shadow nhánh `PermissionGrant.dataScope` (bảng P0, 4 mức). Đo lại thì
// bảng đó gần như rỗng: cả repo có ĐÚNG MỘT chỗ ghi vào nó và chỉ ghi grant cấp NHÓM.
// Nếu dừng ở đó, shadow quan sát ~0 lượt và cổng 7 ngày xanh vì KHÔNG CÓ GÌ để lệch.
//
// Thứ prod thực sự dùng để chặn là `scopeMatches` với `scopeType: "CENTER"`, đo bằng
// `PermEntry.centerScope`. P4 lật đúng chỗ đó. Nên shadow phải phủ đúng chỗ đó — bằng
// không thì P3 đo một đằng, P4 lật một nẻo.
// ═════════════════════════════════════════════════════════════════════════════════

/** Chỉ `CENTER` mới đo bằng đơn vị; các mức còn lại không dính gì tới cây tổ chức. */
function canDonVi(p: PermEntry): boolean {
  return p.scopeType === "CENTER";
}

/**
 * Bản song song của `scopeMatches` (lib/auth/can.ts), đổi đơn vị đo sang `orgUnitId`.
 * Các nhánh không đo bằng đơn vị được chuyển nguyên trạng — chúng không phải chủ đề
 * của P4 nên đổi cách xử lý ở đây là tự tạo lệch giả.
 */
export function scopeMatchesByOrgUnit(
  p: PermEntry,
  actor: Actor,
  target?: Target,
): boolean {
  switch (p.scopeType) {
    case "GLOBAL":
      return true;
    case "CENTER": {
      if (!target?.orgUnitId) return false; // target thiếu scope → an toàn = false
      const scope = p.orgUnitScope;
      // `null` = vai quan hệ (PARENT): CỐ Ý không bao giờ khớp scope CENTER. Giữ y hệt
      // đường cũ — nới ở đây là nới quyền phụ huynh im lặng ở P4.
      if (scope == null) return false;
      return scope === "ALL" || scope.includes(target.orgUnitId);
    }
    case "OWN":
      return !!target?.createdById && target.createdById === actor.userId;
    case "CHILDREN":
      return !!target?.parentUserId && target.parentUserId === actor.userId;
    case "CLASS":
    case "ASSIGNED":
      return !!target?.classId && actor.assignedClassIds.has(target.classId);
    default:
      return false;
  }
}

/** Bản chép ĐÓNG BĂNG của `scopeMatches` — xem lý do ở `scopeSatisfiedByCenter`. */
function scopeMatchesByCenter(p: PermEntry, actor: Actor, target?: Target): boolean {
  switch (p.scopeType) {
    case "GLOBAL":
      return true;
    case "CENTER":
      if (!target?.centerId) return false;
      return (
        p.centerScope === "ALL" ||
        (Array.isArray(p.centerScope) && p.centerScope.includes(target.centerId))
      );
    case "OWN":
      return !!target?.createdById && target.createdById === actor.userId;
    case "CHILDREN":
      return !!target?.parentUserId && target.parentUserId === actor.userId;
    case "CLASS":
    case "ASSIGNED":
      return !!target?.classId && actor.assignedClassIds.has(target.classId);
    default:
      return false;
  }
}

/** So hai đường trên MỘT `PermEntry`. Cùng ba trạng thái với `soSanhScope`. */
export function soSanhPermEntry(
  p: PermEntry,
  actor: Actor,
  target?: Target,
): KetQuaSoSanh {
  const cu = scopeMatchesByCenter(p, actor, target);
  if (!canDonVi(p)) return { ketQua: "giong", cu, moi: cu };

  // Actor dựng tay (system-actor, test cũ) chưa mang orgUnitScope — chưa so được.
  if (p.orgUnitScope === undefined) {
    return {
      ketQua: "chua-phu",
      cu,
      moi: null,
      lyDo: "PermEntry thiếu orgUnitScope — Actor dựng tay, chưa so được",
    };
  }
  if (target && !target.orgUnitId) {
    return {
      ketQua: "chua-phu",
      cu,
      moi: null,
      lyDo: "target thiếu orgUnitId — chỗ gọi chưa truyền, chưa so được",
    };
  }

  const moi = scopeMatchesByOrgUnit(p, actor, target);
  return { ketQua: cu === moi ? "giong" : "lech", cu, moi };
}

// ═════════════════════════════════════════════════════════════════════════════════
// PHẦN 3 — SO Ở MỨC QUYẾT ĐỊNH. Đây là thứ pha shadow thực sự phát đi.
//
// Hai phần trên là VIÊN GẠCH: chúng so từng dòng grant / từng PermEntry. Nhưng `can()`
// là ALLOW-wins trên NHIỀU dòng, nên một dòng đo lệch mà dòng khác vẫn cho phép thì
// người dùng KHÔNG thấy gì khác. Đếm theo dòng làm số "lệch" phồng lên bằng nhiễu vô
// hại — và P4 sẽ bị chặn bởi những dòng chẳng đổi gì.
//
// Câu hỏi P4 cần trả lời là: **lật đơn vị đo thì `can()` có trả khác không.** Hàm dưới
// so đúng câu đó, một phép so cho một lượt `can()`.
//
// Chuỗi resolve được nhân bản y hệt `lib/permissions/can.ts` (grant thắng; grant đã nói
// về key thì KHÔNG rơi xuống đường cũ) — nhân bản chứ không dùng chung, vì lý do đóng
// băng đã nêu ở `scopeSatisfiedByCenter`.
// ═════════════════════════════════════════════════════════════════════════════════

type Do = (
  g: GrantRow,
  a: Actor,
  t?: Target,
) => boolean;
type DoPerm = (p: PermEntry, a: Actor, t?: Target) => boolean;

/** Nhân bản `resolveGrant` + fallback `canV2`, tham số hoá theo ĐƠN VỊ ĐO. */
function quyetDinh(
  actor: Actor,
  permissionKey: string,
  target: Target | undefined,
  doGrant: Do,
  doPerm: DoPerm,
): { ketQua: boolean; nguon: "grant" | "perm" } {
  const matched = (actor.permissionGrants ?? []).filter(
    (g) =>
      g.permissionKey === permissionKey &&
      (g.subjectType === "ROLE" ? actor.roleIds : actor.groupIds)?.includes(g.subjectId) &&
      !(g.effect === "ALLOW" && g.fieldMask.length > 0),
  );
  if (matched.length > 0) {
    for (const g of matched) {
      if (g.effect === "DENY" && g.fieldMask.length === 0 && doGrant(g, actor, target)) {
        return { ketQua: false, nguon: "grant" };
      }
    }
    const allows = matched.filter((g) => g.effect === "ALLOW");
    if (allows.length > 0) {
      return { ketQua: allows.some((g) => doGrant(g, actor, target)), nguon: "grant" };
    }
  }
  if (actor.grantsAllow?.has(permissionKey)) return { ketQua: true, nguon: "perm" };
  for (const p of actor.permissions ?? []) {
    if (p.action === permissionKey && doPerm(p, actor, target)) {
      return { ketQua: true, nguon: "perm" };
    }
  }
  return { ketQua: false, nguon: "perm" };
}

/**
 * Có đủ dữ liệu để so không. Trả lý do khi thiếu — "chưa phủ" phải nói được THIẾU GÌ,
 * nếu không thì nó chỉ là một con số không ai hành động được.
 */
function thieuGiDeSo(
  actor: Actor,
  permissionKey: string,
  target?: Target,
): string | null {
  const grantsDoDonVi = (actor.permissionGrants ?? []).filter(
    (g) =>
      g.permissionKey === permissionKey &&
      (g.subjectType === "ROLE" ? actor.roleIds : actor.groupIds)?.includes(g.subjectId) &&
      canOrgUnitId(g),
  );
  const permsDoDonVi = (actor.permissions ?? []).filter(
    (p) => p.action === permissionKey && p.scopeType === "CENTER",
  );
  // Không dòng nào đo bằng đơn vị ⇒ lật P4 không đụng gì tới lượt này ⇒ so được.
  if (grantsDoDonVi.length === 0 && permsDoDonVi.length === 0) return null;

  if (permsDoDonVi.some((p) => p.orgUnitScope === undefined)) {
    return "PermEntry thiếu orgUnitScope — Actor dựng tay, chưa so được";
  }
  if (!target?.orgUnitId) {
    return "target thiếu orgUnitId — chỗ gọi chưa truyền, chưa so được";
  }
  return null;
}

/**
 * Phép so mà pha shadow phát đi: MỘT kết quả cho MỘT lượt `can()`.
 * `nguon` cho biết quyết định đến từ bảng grant mới hay từ PermEntry đường cũ — để
 * báo cáo tách được "shadow phủ chỗ nào".
 */
export function soSanhQuyetDinh(
  actor: Actor,
  permissionKey: string,
  target?: Target,
): KetQuaSoSanh & { nguon: "grant" | "perm" } {
  // SUPER_ADMIN đi tắt ở CẢ HAI đường — không có gì để học, và cũng không nên đổ
  // hàng nghìn dòng "giống" vào bảng chỉ vì admin bấm nhiều.
  if (actor.isSuperAdmin) {
    return { ketQua: "giong", cu: true, moi: true, nguon: "perm" };
  }

  const cu = quyetDinh(actor, permissionKey, target, scopeSatisfiedByCenter, scopeMatchesByCenter);

  const thieu = thieuGiDeSo(actor, permissionKey, target);
  if (thieu) return { ketQua: "chua-phu", cu: cu.ketQua, moi: null, lyDo: thieu, nguon: cu.nguon };

  const moi = quyetDinh(
    actor,
    permissionKey,
    target,
    scopeSatisfiedByOrgUnit,
    scopeMatchesByOrgUnit,
  );
  return {
    ketQua: cu.ketQua === moi.ketQua ? "giong" : "lech",
    cu: cu.ketQua,
    moi: moi.ketQua,
    nguon: cu.nguon,
  };
}
