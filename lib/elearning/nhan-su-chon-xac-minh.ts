import { z } from "zod";
import { ActionError, type ScopedDb } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/permissions/can";
import { assertKhongTuQuyet } from "@/lib/elearning/self-decision";
import { dieuKienNhanSuChon } from "@/lib/elearning/nhan-su-chon";

/**
 * CỔNG Ở SERVER cho id người do giao diện gửi (chủ nội dung của chương trình, người Nhân sự đồng phê duyệt).
 *
 * ⚠️ TỆP RIÊNG, CỐ Ý, KHÔNG GỘP VÀO `nhan-su-chon.ts`. `nhan-su-chon.ts` được một component CLIENT (`chon-nhan-su.tsx`) import
 * để lấy `TRAN_NHAN_SU_CHON`; mọi `import` lúc chạy ở đó (ActionError, resolveActor, can…) bị kéo cả chuỗi `next/headers`/Prisma vào
 * bundle client và `next build` đỏ. `tsc` và test đơn vị KHÔNG thấy lỗi này — chỉ bản build production thấy (đo 26/10/2026).
 * Lưới `[XMN-W7]` (`lib/elearning/chon-nguoi-wiring.test.ts`) ghim cả hai chiều.
 *
 * Vị từ "ai là người hợp lệ" nằm MỘT chỗ — `dieuKienNhanSuChon` — và ô chọn dùng chung nó: phía nào lỏng hơn phía kia là hoặc một
 * lời hứa suông (ô liệt kê người mà server từ chối) hoặc một lỗ (server nhận người mà ô không bao giờ đưa ra).
 */

/**
 * MỘT câu cho mọi lý do từ chối (id giả · ngoài cơ sở · đã nghỉ · khoá tài khoản · chưa có tài khoản). Cố ý không phân
 * biệt: người gửi request tự dựng không được dò xem một id có tồn tại / thuộc cơ sở khác không.
 */
export const THONG_DIEP_NGUOI_KHONG_HOP_LE =
  "Người được chọn không hợp lệ hoặc nằm ngoài phạm vi của bạn — hãy chọn lại từ danh sách";

/** Hình dạng của một `User.id` (cuid / id seed). Chặn rác và chuỗi toàn khoảng trắng TRƯỚC khi chạm DB. */
export const idNguoiChonSchema = z
  .string()
  .trim()
  .min(1, THONG_DIEP_NGUOI_KHONG_HOP_LE)
  .max(64, THONG_DIEP_NGUOI_KHONG_HOP_LE)
  .regex(/^[A-Za-z0-9_-]+$/, THONG_DIEP_NGUOI_KHONG_HOP_LE);

export type NguoiDuocChon = { userId: string; hoTen: string };

/**
 * Cổng server cho MỌI id người nhận từ client: đúng hình dạng → có `Employee` đang làm việc + tài khoản hợp lệ →
 * nằm trong tầm nhìn của người thao tác. MỘT câu truy vấn qua `scopedDb` gánh cả ba (tồn tại · còn làm việc · cùng phạm vi cơ sở).
 *
 * ⚠️ KHÔNG tra `db.user` ở đây: `User` nằm trong danh sách đọc toàn cục của `scopedDb`, tra qua đó là BỎ phép cách ly cơ sở.
 * Phạm vi cơ sở đến từ `Employee` ∈ SCOPED_MODELS — cùng nguồn với ô chọn.
 *
 * Gọi TRONG LÕI của action và TRƯỚC phép ghi đầu tiên (luật rollback CLAUDE.md: `return` không rollback).
 */
export async function xacMinhNguoiDuocChon(
  db: ScopedDb,
  userIdTho: unknown,
  field: string,
): Promise<NguoiDuocChon> {
  const p = idNguoiChonSchema.safeParse(userIdTho);
  if (!p.success) throw new ActionError("VALIDATION", THONG_DIEP_NGUOI_KHONG_HOP_LE, field);

  const nv = await db.employee.findFirst({
    where: dieuKienNhanSuChon(p.data),
    select: { fullName: true, userAccount: { select: { id: true } } },
  });
  if (!nv?.userAccount) throw new ActionError("VALIDATION", THONG_DIEP_NGUOI_KHONG_HOP_LE, field);
  return { userId: nv.userAccount.id, hoTen: nv.fullName };
}

/**
 * Quyền đặc trưng của người Nhân sự. `employees:edit` do đúng `HO_HR` (GLOBAL) và `CENTER_HR` (CENTER) giữ (+ `SUPER_ADMIN`
 * qua bypass của `can()`) — đo ở `prisma/seed-roles.ts`. Dùng KHÔNG đổi chính sách: hỏi `can()` của CHÍNH người được chọn
 * qua engine hợp nhất, không so mã vai, không viết điều kiện vai nào ở đây (luật cứng "mọi kiểm tra quyền đi qua can()").
 */
export const QUYEN_NGUOI_NHAN_SU = "employees:edit";

/**
 * Người "Nhân sự đồng phê duyệt" của mức gắn đánh giá (EL-21, luật hai người):
 *  1. KHÁC người đang thao tác (`SELF_APPROVAL`, không nhánh miễn theo vai — ADR-0001);
 *  2. qua cổng `xacMinhNguoiDuocChon` (có thật · đang làm việc · tài khoản hợp lệ · cùng phạm vi cơ sở);
 *  3. THUỘC NHÂN SỰ: CHÍNH người đó phải `can(QUYEN_NGUOI_NHAN_SU)` trên cơ sở của cấu hình, KHÔNG tính đường tắt SUPER_ADMIN.
 *
 * `centerId` PHẢI lấy từ bản ghi chương trình ở server, không từ input: người Nhân sự cơ sở (scope CENTER) chỉ đồng duyệt được
 * cấu hình của chính cơ sở mình; cấu hình TOÀN CÔNG TY (`centerId = null`) chỉ Nhân sự Hội sở đồng duyệt được.
 *
 * ⚠️ Chưa phải "chữ ký thật": nó chứng minh người được NÊU TÊN là người Nhân sự khác mình, không chứng minh người đó ĐÃ ĐỒNG Ý.
 * Muốn chữ ký thật phải có bước xác nhận của chính họ (đổi lược đồ) — còn mở, xem docs/elearning/ux/ban-giao-ux.md.
 */
export async function xacMinhNguoiNhanSuDuyet(
  db: ScopedDb,
  actor: Pick<Actor, "userId">,
  userIdTho: unknown,
  boiCanh: { centerId: string | null },
  field = "hrApprovedByUserId",
): Promise<NguoiDuocChon> {
  const p = idNguoiChonSchema.safeParse(userIdTho);
  if (!p.success) throw new ActionError("VALIDATION", THONG_DIEP_NGUOI_KHONG_HOP_LE, field);

  // Tự duyệt kiểm TRƯỚC mọi truy vấn: không tốn DB, và không phụ thuộc người đó có hợp lệ hay không.
  assertKhongTuQuyet(
    actor.userId,
    p.data,
    "Người Nhân sự đồng phê duyệt phải là người khác với người đang lưu cấu hình",
    field,
  );

  const nguoi = await xacMinhNguoiDuocChon(db, p.data, field);

  const actorDuyet = await resolveActor(nguoi.userId);
  // ⚠️ SUPER_ADMIN KHÔNG thay thế người Nhân sự (owner chốt 26/10/2026): tắt đường vòng `isSuperAdmin` của `can()` để chỉ còn quyền
  // đến từ VAI Nhân sự thật. Người vừa là SUPER_ADMIN vừa giữ vai HR thật vẫn hợp lệ (quyền của họ đến từ vai HR).
  if (!can({ ...actorDuyet, isSuperAdmin: false }, QUYEN_NGUOI_NHAN_SU, { centerId: boiCanh.centerId })) {
    throw new ActionError(
      "PERMISSION_DENIED",
      "Người được chọn không thuộc Nhân sự trong phạm vi của cấu hình này",
      field,
    );
  }
  return nguoi;
}
