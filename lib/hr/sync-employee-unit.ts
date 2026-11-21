// lib/hr/sync-employee-unit.ts — ĐƠN VỊ CỦA MỘT NGƯỜI NẰM Ở HAI BẢNG, SỬA MỘT LÀ SỬA CẢ HAI.
//
// BUG GỐC (đo 11/08/2026 trên DB thật): "người này thuộc đơn vị nào" được lưu HAI nơi —
// `Employee.centerId/orgUnitId` (hồ sơ nhân sự) và `User.centerId/orgUnitId` (tài khoản
// đăng nhập). Hai màn quản trị khác nhau ghi hai bảng khác nhau, không ai kéo bên kia
// theo. Hệ quả đo được:
//   · Hồ sơ Tổng Giám đốc `centerId = NULL` trong khi tài khoản của ông đã gán CS1;
//   · Một nhân sự hồ sơ ghi CS2 còn tài khoản ghi Hội sở.
// Người vận hành gán cơ sở ở màn Tài khoản rồi tưởng đã xong, còn mọi thứ đọc theo hồ sơ
// (báo cáo nhân sự, backfill vị trí US-11) thì vẫn thấy trống — không ai biết mình đã sửa
// nhầm bảng, vì cả hai màn đều hiện đúng cái nó lưu.
//
// NGUYÊN TẮC (chủ dự án chốt): thông tin dùng chung thì sửa ở MỘT chỗ phải đổi ở MỌI chỗ.
// Cùng luật với tên học viên — xem `lib/students/sync-name.ts`.
//
// Cách nhận ra "cùng một người": `User.employeeId` — khoá 1-1 giữa tài khoản và hồ sơ.
// KHÔNG suy theo tên/email: trùng tên là chuyện thường, và đoán sai ở đây là gán người
// này vào cơ sở của người khác.
//
// Gọi BÊN TRONG transaction của action (caller đã kiểm quyền + scope trên bản ghi họ đang
// sửa). Mỗi lần kéo theo có một dòng AuditLog: đổi cơ sở của một người âm thầm là thứ
// ảnh hưởng tới phạm vi dữ liệu họ nhìn thấy.

import "server-only";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { reconcileUserOrgRoles } from "@/lib/auth/org-role-sync";
import type { Role } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type SyncUnitActor = { id: string | null; name: string };

/** Đơn vị của một người — hai cột đi liền nhau, không tách. */
export type DonVi = { centerId: string | null; orgUnitId: string | null };

function khacNhau(a: DonVi, b: DonVi): boolean {
  return a.centerId !== b.centerId || a.orgUnitId !== b.orgUnitId;
}

/**
 * Vừa đổi đơn vị trên **HỒ SƠ NHÂN SỰ** → kéo **TÀI KHOẢN** theo.
 *
 * Trả về `true` nếu có ghi (để caller biết mà log/hiện thông báo). Không có tài khoản
 * gắn với hồ sơ này, hoặc hai bên đã khớp → không ghi gì.
 */
export async function keoTaiKhoanTheoHoSo(
  tx: Tx,
  input: { employeeId: string; donVi: DonVi; actor: SyncUnitActor },
): Promise<boolean> {
  const taiKhoan = await tx.user.findFirst({
    where: { employeeId: input.employeeId, deletedAt: null },
    select: { id: true, centerId: true, orgUnitId: true, role: true, roles: true },
  });
  if (!taiKhoan) return false;
  const cu: DonVi = { centerId: taiKhoan.centerId, orgUnitId: taiKhoan.orgUnitId };
  if (!khacNhau(cu, input.donVi)) return false;

  await tx.user.update({
    where: { id: taiKhoan.id },
    data: { centerId: input.donVi.centerId, orgUnitId: input.donVi.orgUnitId },
  });

  // ĐỔI ĐƠN VỊ PHẢI NEO LẠI VAI — không thì đổi cơ sở chỉ là đổi nhãn.
  //
  // `User.orgUnitId` là thứ hiển thị; thứ QUYẾT ĐẮC quyền là các dòng `UserOrgRole`.
  // Trước bản vá này `reconcileUserOrgRoles` chỉ được gọi từ đường ĐỔI VAI TRÒ (hàm đó
  // còn thoát sớm với "Vai trò không thay đổi"), nên chuyển một người sang cơ sở khác
  // KHÔNG hề dịch vai của họ. Trường hợp đắt nhất đo được trên prod: giáo viên parttime
  // đang neo tại Hội sở ⇒ `isHoLevel` ⇒ đọc được học viên, điểm danh, nhận xét của MỌI
  // cơ sở; gán họ về CS1/CS2 trên màn nhân sự vẫn không thu hẹp gì.
  //
  // CHỈ neo lại khi đơn vị ĐÍCH có thật. Đích `null` (người Hội sở, hoặc vừa xoá đơn vị)
  // thì `reconcileUserOrgRoles` ném `OrgRoleSyncError` — cố ý fail-closed — và ném ở đây là
  // chặn luôn việc lưu hồ sơ. Giữ nguyên hiện trạng cho nhánh đó: không nới thêm quyền cho ai,
  // và việc rà nhóm thiếu đơn vị neo thuộc script chẩn đoán riêng.
  if (cu.orgUnitId !== input.donVi.orgUnitId && input.donVi.orgUnitId) {
    const roles: Role[] =
      taiKhoan.roles.length > 0 ? taiKhoan.roles : [taiKhoan.role];
    await reconcileUserOrgRoles({
      tx,
      userId: taiKhoan.id,
      previous: { roles, orgUnitId: cu.orgUnitId },
      next: { roles, orgUnitId: input.donVi.orgUnitId },
      actorId: input.actor.id ?? null,
      actorName: input.actor.name,
      reason: "Đổi đơn vị làm việc trên hồ sơ nhân sự — neo lại vai theo đơn vị mới",
      // BẬT Ở ĐÚNG ĐƯỜNG NÀY và không ở đâu khác: hồ sơ nhân sự LÀ nguồn sự thật về
      // "người này làm ở đâu", nên một dòng vai cùng mã đặt ở đơn vị khác là dị thường
      // cần dọn. Đo được trên prod 22/08: tài khoản đã trỏ CS2 mà vẫn giữ dòng vai neo
      // tại Hội sở ⇒ vẫn `isHoLevel` ⇒ vẫn thấy mọi cơ sở, lưu lại bao nhiêu lần cũng vậy.
      revokeMisplaced: true,
    });
  }
  await writeAudit({
    actor: { id: input.actor.id ?? "", name: input.actor.name },
    module: "users",
    entityType: "User",
    entityId: taiKhoan.id,
    action: "UPDATE",
    oldValues: cu,
    newValues: input.donVi,
    orgUnitId: input.donVi.orgUnitId,
    // Người đọc audit phải biết dòng này KHÔNG do ai bấm vào màn tài khoản.
    reason: "Đồng bộ đơn vị theo hồ sơ nhân sự",
    tx,
  }).catch(() => null);
  return true;
}

/**
 * Vừa đổi đơn vị trên **TÀI KHOẢN** → kéo **HỒ SƠ NHÂN SỰ** theo.
 *
 * ⚠️ Chỉ chạy khi tài khoản CÓ gắn hồ sơ (`employeeId`). Tài khoản phụ huynh không có hồ
 * sơ nhân sự — và cũng không được đẻ ra một hồ sơ.
 */
export async function keoHoSoTheoTaiKhoan(
  tx: Tx,
  input: { employeeId: string | null; donVi: DonVi; actor: SyncUnitActor },
): Promise<boolean> {
  if (!input.employeeId) return false;
  const hoSo = await tx.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  if (!hoSo) return false;
  const cu: DonVi = { centerId: hoSo.centerId, orgUnitId: hoSo.orgUnitId };
  if (!khacNhau(cu, input.donVi)) return false;

  await tx.employee.update({
    where: { id: hoSo.id },
    data: { centerId: input.donVi.centerId, orgUnitId: input.donVi.orgUnitId },
  });
  await writeAudit({
    actor: { id: input.actor.id ?? "", name: input.actor.name },
    module: "employees",
    entityType: "Employee",
    entityId: hoSo.id,
    action: "UPDATE",
    oldValues: cu,
    newValues: input.donVi,
    orgUnitId: input.donVi.orgUnitId,
    reason: "Đồng bộ đơn vị theo tài khoản",
    tx,
  }).catch(() => null);
  return true;
}
