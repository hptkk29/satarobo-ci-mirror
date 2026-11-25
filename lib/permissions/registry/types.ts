// Nền Hệ thống P0 · US-01 — Registry quyền tập trung.
// Mỗi module nghiệp vụ khai báo quyền của nó bằng một ModuleDecl (file riêng
// trong lib/permissions/registry/), nạp vào bảng PermissionDescriptor lúc deploy.
// Key GIỮ NGUYÊN format v1 `resource:verb` — chuẩn hoá format là việc của pha sau.

export type PermissionDecl = {
  /** Permission key duy nhất toàn hệ, vd "leads:view-all". */
  key: string;
  /** Verb thô sau dấu ":" — "view-all", "edit", "approve"... (không ép enum ở P0). */
  action: string;
  /** Quyền có cần data scope không (BA §2.5). Mặc định true. */
  scopable?: boolean;
  /** Trường nhạy cảm phục vụ DENY cấp trường về sau. Mặc định []. */
  sensitiveFields?: string[];
  /** Mô tả ngắn cho lệnh liệt kê + UI sau này. */
  description?: string;
};

export type ModuleDecl = {
  /** Tên module nghiệp vụ sở hữu nhóm quyền, vd "crm", "lms", "hr". */
  module: string;
  permissions: PermissionDecl[];
};

/** Row đã chuẩn hoá default, sẵn sàng ghi vào bảng PermissionDescriptor. */
export type DescriptorRow = {
  key: string;
  module: string;
  action: string;
  scopable: boolean;
  sensitiveFields: string[];
  description: string | null;
};
