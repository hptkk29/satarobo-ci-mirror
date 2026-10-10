// lib/validators/user-group.ts — US-03 (Nền Hệ thống P0): validator UserGroup + grant GROUP.
// Hợp đồng đông cứng (thiết kế duyệt 09/08/2026, test viết TRƯỚC — luật #5)
// + SIẾT theo review đối kháng 09/08:
//   - Grant GROUP ở P0 CHỈ nhận dataScope ALL (xem chú thích GROUP_GRANT_DATA_SCOPES —
//     đây là siết THÊM so với chốt "ALL|OWN" 09/08, chờ user veto). UNIT_*/OWN bị chặn
//     với LỖI RÕ CHỮ ngay write path — cấm tạo grant "trông như hoạt động".
//   - permissionKey KHÔNG được thuộc NON_GROUP_GRANTABLE_KEYS (khoá quản trị hệ thống —
//     chống tự-leo-thang qua nhóm).
//   - ALLOW ⇒ fieldMask BẮT BUỘC rỗng (mask chỉ dành cho DENY cấp trường — BA §2.5;
//     engine US-02 bỏ qua row ALLOW+mask kèm warn, đây là cú chặn cứng hứa ở đó).
//   - reason BẮT BUỘC 5..500 (audit — RbacAuditLog).
//   - permissionKey còn lại chỉ check "có chữ" ở đây; tồn tại + isActive đối chiếu
//     PermissionDescriptor (DB) ở Server Action — KHÔNG dùng ALL_ACTIONS v1 vì registry
//     có key khai trước (chat) nằm ngoài matrix v1.
import { z } from "zod";

/** "" / "   " / null / undefined → null; còn lại trim (pattern nullableStr của repo). */
const nullableStr = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  });

/**
 * dataScope hợp lệ cho grant GROUP ở P0 — UI đọc từ đây (1 nguồn).
 *
 * ⚠️ SIẾT 09/08 (review đối kháng) — CHỈ còn ALL, hẹp hơn chốt "ALL|OWN" của thiết
 * kế duyệt 09/08. Lý do (báo cáo cuối phải nêu cho user veto):
 *   - [major] ALLOW+OWN = bẫy thu hồi im lặng: consumer hiện hành gọi
 *     can(actor, key) KHÔNG truyền target → resolveGrant trúng grant OWN nhưng
 *     scope check fail (không có target để so OWN) → trả false, ĐÈ luôn quyền
 *     ALLOW sẵn có từ vai. Grant "cấp thêm" hoá thành lệnh thu hồi không ai hay.
 *   - [minor] DENY-mask+OWN cũng vô tác dụng ở consumer không truyền target.
 * OWN/UNIT_ONLY/UNIT_AND_BELOW mở lại ở P1 khi consumer truyền target đầy đủ.
 */
export const GROUP_GRANT_DATA_SCOPES = ["ALL"] as const;

/**
 * Khoá QUẢN TRỊ hệ thống — CẤM cấp qua grant GROUP (chống tự-leo-thang: người giữ
 * user-groups:manage mà cấp được roles:manage/users:manage cho nhóm của chính mình
 * là tự phong SUPER_ADMIN vòng sau lưng audit vai). Các quyền này CHỈ đi qua vai
 * (UserOrgRole). Export để [id]/page.tsx lọc khỏi Select grant editor (1 nguồn).
 */
export const NON_GROUP_GRANTABLE_KEYS = [
  "roles:manage",
  "users:manage",
  "user-groups:manage",
  "settings:view",
  "settings:edit",
  "audit-logs:view",
  "audit-logs:view-pii",
] as const;

/**
 * US-03 — điều kiện thành viên nhóm, ĐỐI XỨNG với truy vấn ứng viên ở
 * app/(admin)/admin/user-groups/[id]/page.tsx (page lọc `role: { not: "PARENT" }`
 * trên vai trò CHÍNH; page KHÔNG lọc roles[] nên đây cũng không — giữ 2 phía trùng
 * điều kiện, PH kiêm nhân viên (role chính ≠ PARENT) vẫn hợp lệ ở cả 2 phía).
 * Nhóm là công cụ cấp quyền NỘI BỘ ở P0 — tài khoản phụ huynh không vào nhóm.
 * Trả message lỗi (tiếng Việt) nếu không hợp lệ, null nếu OK. Server Action
 * addGroupMemberAction dùng trực tiếp; unit test pin ở user-group.test.ts.
 */
export function groupMemberIneligibleReason(user: { role: string }): string | null {
  if (user.role === "PARENT") {
    return "Tài khoản phụ huynh (PARENT) không thể thêm vào nhóm quyền — nhóm chỉ dành cho tài khoản nội bộ";
  }
  return null;
}

export const userGroupCreateSchema = z.object({
  name: z
    .string("Nhập tên nhóm")
    .trim()
    .min(1, "Tên nhóm không được để trống")
    .max(100, "Tên nhóm tối đa 100 ký tự"),
  description: nullableStr,
});

/** Sửa nhóm dùng cùng shape tạo (name + description) — tách alias để call-site rõ nghĩa. */
export const userGroupUpdateSchema = userGroupCreateSchema;

/** Thêm thành viên — userId cuid, chỉ cần "có chữ" (tồn tại/active check ở action). */
export const groupMemberAddSchema = z.object({
  userId: z.string("Chọn người dùng").trim().min(1, "Chọn người dùng để thêm vào nhóm"),
});

export const groupGrantCreateSchema = z
  .object({
    permissionKey: z
      .string("Chọn permission key")
      .trim()
      .min(1, "Chọn permission key cho grant"),
    effect: z.enum(["ALLOW", "DENY"], {
      error: "Effect chỉ nhận ALLOW hoặc DENY",
    }),
    // Refine 1 — dataScope P0 chỉ ALL: lỗi phải TỰ GIẢI THÍCH cho người cấp quyền
    // (không phải enum error câm). OWN = bẫy thu hồi im lặng (consumer chưa truyền
    // target → ALLOW+OWN đè quyền vai sẵn có thành false); UNIT_* chưa có mapping
    // nhóm→đơn vị. Cả hai mở lại ở P1 khi consumer truyền target.
    dataScope: z.enum(GROUP_GRANT_DATA_SCOPES, {
      error:
        "Grant nhóm ở P0 chỉ nhận dataScope ALL — OWN tạo bẫy thu hồi im lặng " +
        "(consumer hiện chưa truyền target: ALLOW+OWN đè quyền từ vai thành false, " +
        "DENY-mask+OWN vô tác dụng), UNIT_ONLY/UNIT_AND_BELOW chưa có mapping " +
        "nhóm→đơn vị; các scope này mở lại ở P1 khi consumer truyền target",
    }),
    fieldMask: z
      .array(z.string().trim().min(1, "Tên trường trong fieldMask không được rỗng"))
      .max(30, "fieldMask tối đa 30 trường")
      .default([]),
    // Refine 3 — reason bắt buộc (audit RbacAuditLog), 5..500 sau trim.
    reason: z
      .string("Nhập lý do cấp/chặn quyền (bắt buộc — audit)")
      .trim()
      .min(5, "Lý do tối thiểu 5 ký tự (audit yêu cầu lý do thật, không gõ chống chế)")
      .max(500, "Lý do tối đa 500 ký tự"),
  })
  // Refine 2 — fieldMask CHỈ dành cho DENY cấp trường: ALLOW ⇒ fieldMask phải rỗng
  // (chặn cứng ở write path — engine US-02 chỉ warn + bỏ qua row ALLOW+mask).
  // Refine 4 — khoá quản trị KHÔNG cấp qua nhóm (chống tự-leo-thang; UI đã lọc
  // khỏi Select nhưng action nhận input thô nên chặn lại ở đây).
  .superRefine((d, ctx) => {
    if (d.effect === "ALLOW" && d.fieldMask.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["fieldMask"],
        message:
          "fieldMask chỉ dành cho DENY cấp trường (che trường, không chặn action) — " +
          "grant ALLOW phải để fieldMask rỗng",
      });
    }
    if ((NON_GROUP_GRANTABLE_KEYS as readonly string[]).includes(d.permissionKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["permissionKey"],
        message:
          `Không cấp khoá quản trị "${d.permissionKey}" qua nhóm — quyền quản trị hệ ` +
          "thống chỉ đi qua vai (UserOrgRole) để chặn đường tự leo thang: người giữ " +
          "user-groups:manage không được tự cấp quyền quản trị cho nhóm của chính mình",
      });
    }
  });

export type UserGroupCreateInput = z.infer<typeof userGroupCreateSchema>;
export type GroupMemberAddInput = z.infer<typeof groupMemberAddSchema>;
export type GroupGrantCreateInput = z.infer<typeof groupGrantCreateSchema>;
