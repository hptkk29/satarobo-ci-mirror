// lib/bao-luu/khai-bao-nen.test.ts — NỀN DỮ LIỆU bảo lưu phải được KHAI ĐỦ mọi chỗ. Thuần, không DB. PHIÊN 2.
//
// Hành vi THẬT của khoá (trigger bất biến, chỉ mục duy nhất từng phần, cascade, scopedDb) đo trên
// Postgres ở `tests/finance/bao-luu-nen.test.ts`. Lưới này chỉ bảo đảm khai báo không biến mất — và
// khẳng định các quyết định mà một người sau dễ "dọn" nhầm: không thêm giá trị vào enum Attendance,
// không đổi kiểu cột tiền, `pause.enabled` mặc định TẮT.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";
import { SETTINGS } from "@/lib/settings/registry";
import { ALL_ACTIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

const MODELS = ["StudentReserve", "StudentReserveEvent"] as const;
const model = (ten: string) => {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === ten);
  if (!m) throw new Error(`Không có model ${ten} (quên prisma generate?)`);
  return m;
};
const enumVals = (ten: string) =>
  Prisma.dmmf.datamodel.enums.find((x) => x.name === ten)?.values.map((v) => v.name) ?? [];

describe.each(MODELS)("[BL2-SC] %s khai đủ ba chỗ của luật cách ly cơ sở (CLAUDE.md luật 3)", (ten) => {
  it("∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS (dữ liệu cá nhân: NULL ≠ ai cũng thấy)", () => {
    expect(SCOPED_MODELS.has(ten)).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has(ten)).toBe(false);
  });
  it("có prefix riêng (thiếu ⇒ rơi về `isHoLevel ? ALL`), gồm cả bao-luu: lẫn students:", () => {
    expect(getModelPrefixes(ten)).toEqual(["bao-luu:", "students:"]);
  });
  it("BACKFILL_SPECS đúng MỘT mục, scoped=true, và ghi kép orgUnitId tự chạy", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === ten);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.scoped).toBe(true);
    expect(DUAL_WRITE_MODELS.has(ten)).toBe(true);
  });
  it("có CẢ centerId lẫn orgUnitId (tuỳ chọn)", () => {
    const f = model(ten).fields;
    expect(f.find((x) => x.name === "centerId")?.isRequired).toBe(false);
    expect(f.find((x) => x.name === "orgUnitId")?.isRequired).toBe(false);
  });
});

describe("[BL2-MD] hình dạng dữ liệu — đo từ Prisma.dmmf, không đọc chú thích", () => {
  it("[BL2-MD-01] StudentReserve giữ MỌI cột cũ (additive thuần) và có đủ cột spec §F", () => {
    const ten = model("StudentReserve").fields.map((f) => f.name);
    for (const cu of ["id", "studentId", "enrollmentId", "reason", "startedAt", "expectedEndAt", "endedAt", "endReason",
      "createdByUserId", "createdByName", "endedByUserId", "endedByName", "isActive", "createdAt", "updatedAt"]) {
      expect(ten, `cột cũ ${cu}`).toContain(cu);
    }
    for (const moi of ["status", "type", "reasonCode", "reasonNote", "centerId", "orgUnitId", "requestedAt",
      "firstAbsentDate", "approvedAt", "standardEndDate", "extendedEndDate", "extendCount", "endKind",
      "officialNoticeSentAt", "officialNoticeChannel", "responseDeadline", "lastContactAt",
      "snapSessionsRemaining", "snapUnitPrice", "snapTuitionNet", "snapSoBuoiMua", "snapSoBuoiSuyRa",
      "snapPricing", "snapStoppedAtLessonOrder", "policySnapshot", "approvedById", "extendedById",
      "applicationFileKey", "evidenceFileKeys", "resumeClassId"]) {
      expect(ten, `cột mới ${moi}`).toContain(moi);
    }
  });

  it("[BL2-MD-02] ảnh chụp quyền lợi lưu CẶP chưa chia và mọi cột snap* tiền/buổi đều NULL được (thiếu giá ≠ 0)", () => {
    const f = model("StudentReserve").fields;
    for (const c of ["snapSessionsRemaining", "snapUnitPrice", "snapTuitionNet", "snapSoBuoiMua", "snapStoppedAtLessonOrder"]) {
      const x = f.find((y) => y.name === c)!;
      expect(x.isRequired, `${c} phải NULL được`).toBe(false);
      expect(x.type).toBe("Int");
    }
    expect(f.find((y) => y.name === "snapSoBuoiSuyRa")!.hasDefaultValue).toBe(true);
  });

  it("[BL2-MD-03] enum trạng thái đủ 10 giá trị theo spec §B; loại hồ sơ đủ 3; sự kiện đủ", () => {
    expect(enumVals("StudentReserveStatus").sort()).toEqual(
      ["ACTIVE", "APPROVED", "CANCELLED", "ENDED", "NOTICE_SENT", "OVERDUE", "PENDING", "REJECTED", "RESUME_PENDING", "TERMINATED"],
    );
    expect(enumVals("StudentReserveType").sort()).toEqual(["CENTER", "LEGACY", "PARENT"]);
    for (const k of ["REQUEST", "APPROVE", "REJECT", "START", "EXTEND", "CONTACT", "NOTICE", "RESUME_REQUEST", "RESUME", "EXPIRE", "ESCALATE", "TERMINATE", "RESTORE", "CANCEL", "CONVERT_CENTER"]) {
      expect(enumVals("StudentReserveEventKind")).toContain(k);
    }
  });

  it("[BL2-MD-04] CẤM thêm 'Bảo lưu' vào enum Attendance (chốt 07/10) — buổi nằm trong khoảng bảo lưu được loại bằng dangBaoLuu", () => {
    expect(enumVals("AttendanceStatus").sort()).toEqual(["ABSENT", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED", "EXCUSED", "LATE", "PRESENT"]);
  });

  it("[BL2-MD-05] Course.allowPause mặc định BẬT; MakeupNeed.nguon NULL được (không enum)", () => {
    const a = model("Course").fields.find((f) => f.name === "allowPause")!;
    expect(a.default).toBe(true);
    const n = model("MakeupNeed").fields.find((f) => f.name === "nguon")!;
    expect(n.isRequired).toBe(false);
    expect(n.type).toBe("String");
  });
});

describe("[BL2-CFG] tham số pause.*", () => {
  it("[BL2-CFG-01] pause.enabled mặc định TẮT và cài riêng được theo cơ sở", () => {
    expect(SETTINGS["pause.enabled"].default).toBe(false);
    expect(SETTINGS["pause.enabled"].centerOverridable).toBe(true);
  });

  it("[BL2-CFG-02] mặc định khớp spec §D", () => {
    const mong: Record<string, unknown> = {
      "pause.minDays": 0, "pause.extendTimes": 1, "pause.extendMaxMonths": 1, "pause.maxPerEnrollment": 1,
      "pause.backdateMaxSessions": 2, "pause.remindBeforeDays": 14, "pause.escalateAfterDays": 3,
      "pause.noticeResponseDays": 7, "pause.maxOverdueDebtDays": 7, "pause.medicalProofDays": 30,
      "pause.resumeLessonTolerance": 2,
    };
    for (const [k, v] of Object.entries(mong)) expect((SETTINGS as Record<string, { default: unknown }>)[k]!.default, k).toBe(v);
  });

  it("[BL2-CFG-05] pause.effectiveDate: chỉ nhận rỗng hoặc YYYY-MM-DD thật (regex đã từng mất dấu gạch chéo ngược)", () => {
    const s = SETTINGS["pause.effectiveDate"].schema;
    expect(s.safeParse("").success).toBe(true);
    expect(s.safeParse("2026-10-08").success).toBe(true);
    for (const sai of ["dddd-dd-dd", "2026-1-8", "08/10/2026", "2026-10-08T00:00", "abc"]) {
      expect(s.safeParse(sai).success, sai).toBe(false);
    }
  });

  it("[BL2-CFG-03] KHÔNG đẻ khoá trùng pause.maxMonths — trần dùng lại enrollment.suspendMaxMonths", () => {
    expect(Object.keys(SETTINGS)).not.toContain("pause.maxMonths");
    expect(SETTINGS["enrollment.suspendMaxMonths"].default).toBe(6);
  });

  it("[BL2-CFG-04] trong các khoá pause.* CHỈ pause.minDays mở cho QLCS tự sửa (qlcsSuaDuoc, mở ở Phiên 7); mọi khoá còn lại chỉ Quản trị tối cao", () => {
    const mo = Object.entries(SETTINGS)
      .filter(([k, d]) => k.startsWith("pause.") && (d as { qlcsSuaDuoc?: boolean }).qlcsSuaDuoc === true)
      .map(([k]) => k);
    expect(mo).toEqual(["pause.minDays"]);
  });
});

describe("[BL2-PERM] quyền bao-luu:*", () => {
  const KEYS = ["view", "create", "approve", "extend", "exception", "center-pause", "settings", "refund-request"].map((v) => `bao-luu:${v}`);
  const cua = (code: string) => new Set(ROLE_SEED.find((r) => r.code === code)!.perms.map((p) => p.action as string));

  it("[BL2-PERM-01] đủ 8 khoá ở v1 (ALL_ACTIONS) và chỉ SUPER_ADMIN có bao-luu:exception", () => {
    for (const k of KEYS) expect(ALL_ACTIONS as string[], k).toContain(k);
    expect((PERMISSIONS as Record<string, string[]>)["bao-luu:exception"]).toEqual(["SUPER_ADMIN"]);
  });

  it("[BL2-PERM-02] phân vai theo chốt 07/10: Sale lập, QLCS duyệt/gia hạn/trung tâm/cấu hình/hoàn, Kế toán chỉ xem", () => {
    expect([...cua("CENTER_SALES_CSM")].filter((a) => a.startsWith("bao-luu:")).sort()).toEqual(["bao-luu:create", "bao-luu:view"]);
    expect([...cua("CENTER_MANAGER")].filter((a) => a.startsWith("bao-luu:")).sort()).toEqual(
      ["bao-luu:approve", "bao-luu:center-pause", "bao-luu:extend", "bao-luu:refund-request", "bao-luu:settings", "bao-luu:view"],
    );
    for (const ke of ["HO_ACCOUNTANT", "CENTER_ACCOUNTANT"]) {
      expect([...cua(ke)].filter((a) => a.startsWith("bao-luu:")), ke).toEqual(["bao-luu:view"]);
    }
  });

  it("[BL2-PERM-03] vai LẬP (Sale) không có quyền duyệt; vai duyệt (QLCS) không có quyền lập — lớp quyền của maker–checker", () => {
    expect(cua("CENTER_SALES_CSM").has("bao-luu:approve")).toBe(false);
    expect(cua("CENTER_MANAGER").has("bao-luu:create")).toBe(false);
  });

  it("[BL2-PERM-04] không vai nào ngoài SUPER_ADMIN ở v2 có bao-luu:exception", () => {
    for (const r of ROLE_SEED) {
      if (r.code === "SUPER_ADMIN") continue;
      expect(r.perms.map((p) => p.action as string), r.code).not.toContain("bao-luu:exception");
    }
  });
});

describe("[BL2-MIG] migration 20261008150000 — CHỈ THÊM", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "prisma/migrations/20261008150000_bao_luu_nen_du_lieu/migration.sql"),
    "utf8",
  ).split("\n").filter((d) => !d.trimStart().startsWith("--")).join("\n");

  it("[BL2-MIG-01] không DROP/RENAME/ALTER COLUMN TYPE/DELETE/TRUNCATE nào", () => {
    for (const cam of [/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i, /\bRENAME\b/i, /\bALTER\s+COLUMN\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i]) {
      expect(sql, String(cam)).not.toMatch(cam);
    }
  });

  it("[BL2-MIG-02] mọi ADD COLUMN đều IF NOT EXISTS; mọi CREATE TABLE/INDEX đều IF NOT EXISTS", () => {
    expect(sql.match(/ADD COLUMN(?! IF NOT EXISTS)/g) ?? []).toEqual([]);
    expect(sql.match(/CREATE (UNIQUE )?(TABLE|INDEX)(?! IF NOT EXISTS)/g) ?? []).toEqual([]);
  });

  it("[BL2-MIG-03] bảng sự kiện bật RLS (chỉ ENABLE) và có trigger chặn UPDATE", () => {
    expect(sql.match(/ALTER TABLE "StudentReserveEvent" ENABLE ROW LEVEL SECURITY/g)).toHaveLength(1);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/BEFORE UPDATE ON "StudentReserveEvent"/);
  });

  it("[BL2-MIG-04] KHÔNG đụng enum AttendanceStatus", () => {
    expect(sql).not.toMatch(/AttendanceStatus/);
  });
});
