// Nền Hệ thống P0 · US-01 — Registry quyền tập trung (TS-01).
// Gom khai báo quyền của 9 module nghiệp vụ, chuẩn hoá thành DescriptorRow và
// CHẶN key trùng giữa các module (fail sớm trước khi ghi PermissionDescriptor).
// Zero-behavior-change: registry chỉ MÔ TẢ quyền — nguồn enforce vẫn là
// lib/auth/permissions.ts (v1) + lib/auth/can.ts (v2).
import type { DescriptorRow, ModuleDecl } from "./types";
import { chatModule } from "./chat";
import { crmModule } from "./crm";
import { studentsModule } from "./students";
import { classesModule } from "./classes";
import { lmsModule } from "./lms";
import { hrModule } from "./hr";
import { financeModule } from "./finance";
import { contentModule } from "./content";
import { inventoryModule } from "./inventory";
import { systemModule } from "./system";
import { elearningModule } from "./elearning";

export type { PermissionDecl, ModuleDecl, DescriptorRow } from "./types";

/** Hai module khai cùng một permission key — lỗi khai báo, phải sửa registry. */
export class DuplicatePermissionKeyError extends Error {
  constructor(key: string, firstModule: string, secondModule: string) {
    super(
      `Trùng permission key "${key}": đã khai báo ở module "${firstModule}", ` +
        `bị khai báo lại ở module "${secondModule}"`,
    );
    this.name = "DuplicatePermissionKeyError";
  }
}

/** Toàn bộ khai báo quyền của hệ thống — mỗi prefix `resource:` nằm ĐÚNG MỘT module. */
export const ALL_MODULE_DECLS: ModuleDecl[] = [
  chatModule, // khai TRƯỚC khi chat merge (AC4) — xem ghi chú trong chat.ts
  crmModule,
  studentsModule,
  classesModule,
  lmsModule,
  hrModule,
  financeModule,
  contentModule,
  inventoryModule,
  systemModule,
  elearningModule, // EL-02 — đào tạo nội bộ (17 key, prefix duy nhất)
];

/**
 * Gom khai báo → Map key → DescriptorRow (đã chuẩn hoá default).
 * Hàm PURE — không đụng DB/IO; gặp key trùng throw DuplicatePermissionKeyError.
 */
export function collectDescriptors(
  decls: ModuleDecl[] = ALL_MODULE_DECLS,
): Map<string, DescriptorRow> {
  const rows = new Map<string, DescriptorRow>();
  for (const decl of decls) {
    for (const perm of decl.permissions) {
      const existing = rows.get(perm.key);
      if (existing) {
        throw new DuplicatePermissionKeyError(
          perm.key,
          existing.module,
          decl.module,
        );
      }
      rows.set(perm.key, {
        key: perm.key,
        module: decl.module,
        action: perm.action,
        scopable: perm.scopable ?? true,
        sensitiveFields: perm.sensitiveFields ?? [],
        description: perm.description ?? null,
      });
    }
  }
  return rows;
}
