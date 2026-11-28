// @vitest-environment node
/**
 * [QGT-*] — `kiemQuyenGhiTaiCoSo` (THUẦN, không DB): ba khoá GHI nguồn phải được giữ ĐÚNG tại cơ sở của lead (N9 → đổi nguồn lead, `[PVG-04]`).
 *
 *   [QGT-01] mỗi khoá trong BA khoá: giữ ở CS-A ⇒ đúng ở lead CS-A, SAI ở lead CS-B (dù `kiemQuyen` — tức `can()` GLOBAL — trả true cho cả hai)
 *   [QGT-02] là phép VÀ: `kiemQuyen` trả false ⇒ false dù cơ sở khớp (không thay `can()` bằng phép kiểm cơ sở)
 *   [QGT-03] scope "ALL" (neo vai ở Hội sở) đúng mọi cơ sở; lead chưa quy được cơ sở (`centerId` null) chỉ đúng với "ALL"
 *   [QGT-04] SUPER_ADMIN và per-user grant ALLOW là ngoại lệ toàn cục
 *   [QGT-05] khoá KHÔNG phải khoá GHI (`payments:view`) đi thẳng xuống `kiemQuyen`, không bị siết theo cơ sở
 */
import { describe, expect, it } from "vitest";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import { KHOA_QUYEN_DOI_NGUON } from "./doi-nguon";
import { kiemQuyenGhiTaiCoSo, type KiemQuyen } from "./quyen-ghi-tai-co-so";

const A = "co-so-a";
const B = "co-so-b";
const BA_KHOA = [KHOA_QUYEN_DOI_NGUON.truocThuc, KHOA_QUYEN_DOI_NGUON.sauThuc, KHOA_QUYEN_DOI_NGUON.khoa] as const;
const TARGET = { centerId: null, orgUnitId: null };

const perm = (action: string, centerScope: PermEntry["centerScope"]): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "FX", centerScope });
const actor = (permissions: PermEntry[], extra: Partial<Actor> = {}): Actor =>
  ({ userId: "u", isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions, visibleCenterIds: [A, B], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), ...extra }) as Actor;
/** `can()` GLOBAL: đúng cho MỌI target (đúng điều làm lộ lỗ). */
const canGlobal: KiemQuyen = async () => true;

describe("[QGT] kiemQuyenGhiTaiCoSo", () => {
  it("[QGT-01] mỗi khoá GHI: giữ ở CS-A ⇒ đúng với lead CS-A, SAI với lead CS-B (kiemQuyen GLOBAL trả true cho cả hai)", async () => {
    for (const khoa of BA_KHOA) {
      const a = actor([perm(khoa, [A])]);
      expect(await kiemQuyenGhiTaiCoSo(a, canGlobal, { centerId: A })(khoa, TARGET), `${khoa} @A`).toBe(true);
      expect(await kiemQuyenGhiTaiCoSo(a, canGlobal, { centerId: B })(khoa, TARGET), `${khoa} @B`).toBe(false);
    }
  });

  it("[QGT-02] là phép VÀ: kiemQuyen false ⇒ false dù cơ sở khớp", async () => {
    for (const khoa of BA_KHOA) {
      const a = actor([perm(khoa, [A])]);
      expect(await kiemQuyenGhiTaiCoSo(a, async () => false, { centerId: A })(khoa, TARGET), khoa).toBe(false);
    }
  });

  it("[QGT-03] scope ALL đúng mọi cơ sở; lead không quy được cơ sở chỉ đúng với ALL; thiếu khoá (khoá khác ở cùng cơ sở) ⇒ false", async () => {
    for (const khoa of BA_KHOA) {
      const ho = actor([perm(khoa, "ALL")], { isHoLevel: true });
      expect(await kiemQuyenGhiTaiCoSo(ho, canGlobal, { centerId: B })(khoa, TARGET), `${khoa} ALL@B`).toBe(true);
      expect(await kiemQuyenGhiTaiCoSo(ho, canGlobal, { centerId: null })(khoa, TARGET), `${khoa} ALL@null`).toBe(true);
      const a = actor([perm(khoa, [A])]);
      expect(await kiemQuyenGhiTaiCoSo(a, canGlobal, { centerId: null })(khoa, TARGET), `${khoa} [A]@null`).toBe(false);
    }
    // giữ `leads:overwrite` ở A KHÔNG mượn được `sources:manage` ở A
    const chiDe = actor([perm(KHOA_QUYEN_DOI_NGUON.truocThuc, [A])]);
    expect(await kiemQuyenGhiTaiCoSo(chiDe, canGlobal, { centerId: A })(KHOA_QUYEN_DOI_NGUON.khoa, TARGET)).toBe(false);
  });

  it("[QGT-04] SUPER_ADMIN và per-user grant ALLOW là ngoại lệ toàn cục", async () => {
    for (const khoa of BA_KHOA) {
      expect(await kiemQuyenGhiTaiCoSo(actor([], { isSuperAdmin: true }), canGlobal, { centerId: B })(khoa, TARGET), `${khoa} SA`).toBe(true);
      expect(await kiemQuyenGhiTaiCoSo(actor([], { grantsAllow: new Set([khoa]) }), canGlobal, { centerId: B })(khoa, TARGET), `${khoa} grant`).toBe(true);
    }
  });

  it("[QGT-05] khoá KHÔNG phải khoá GHI (payments:view) đi thẳng xuống kiemQuyen — không bị siết theo cơ sở", async () => {
    const khongGiu = actor([]);
    expect(await kiemQuyenGhiTaiCoSo(khongGiu, canGlobal, { centerId: B })("payments:view", TARGET)).toBe(true);
    expect(await kiemQuyenGhiTaiCoSo(khongGiu, async () => false, { centerId: B })("payments:view", TARGET)).toBe(false);
  });
});
