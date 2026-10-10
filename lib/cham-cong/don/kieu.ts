// lib/cham-cong/don/kieu.ts — kiểu dùng chung của các HANDLER duyệt đơn (đợt 3 đơn từ, BA §13).
//
// Mỗi loại đơn có MỘT handler trong `registry.ts`; `decideRequest` mở MỘT giao dịch, khoá đơn,
// gọi handler, ghi audit — rồi commit hoặc rollback cả cụm (BA §14: không bao giờ có đơn APPROVED
// mà dữ liệu chưa đổi). Handler TỪ CHỐI bằng `throw new DecideError(...)` — `return` không rollback
// (luật rollback trong CLAUDE.md).
import type { Prisma } from "@prisma/client";
import type { WorkRequestKindV } from "@/lib/work-request";
import type { CenterMap } from "../place";

/** Lỗi nghiệp vụ khi áp đơn — câu tiếng Việt hiện thẳng cho người duyệt. */
export class DecideError extends Error {}

export type DecideNotify = { userId: string; title: string; body: string; href: string };

/** Đúng những cột handler đọc — `requests.ts` select theo kiểu này. */
/**
 * Một ô ca mà lượt DUYỆT đã thay (đợt 11 — để huỷ đơn khôi phục đúng ô): ô `sauId` do đơn tạo ra,
 * ô `truocId` (null = ngày đó chưa có ca) bị huỷ để nhường chỗ. Chỉ ghi khi ô THẬT SỰ đổi.
 */
export type ODaThay = { userId: string; workDate: string; truocId: string | null; sauId: string };

/** Đẩy một ô vào danh sách nếu lượt ghi đổi thật (`changed`) — `setAssignmentCell` trả về đủ hai id. */
export function ghiNhanO(
  o: ODaThay[],
  userId: string,
  workDate: Date,
  r: { before: { id: string } | null; after: { id: string } | null; changed: boolean },
): void {
  if (r.changed && r.after) o.push({ userId, workDate: workDate.toISOString(), truocId: r.before?.id ?? null, sauId: r.after.id });
}

export type DonCanDuyet = {
  id: string;
  requesterId: string;
  centerId: string;
  /** OrgUnit của cơ sở nhận đơn — để đọc cấu hình theo cơ sở khi ngày không có ca. */
  orgUnitId: string | null;
  kind: WorkRequestKindV;
  fromDate: Date | null;
  toDate: Date | null;
  classId: string | null;
  targetUserId: string | null;
  requesterNewTemplateId: string | null;
  targetNewTemplateId: string | null;
  leaveTypeId: string | null;
  requestedInAt: string | null;
  requestedOutAt: string | null;
  requestedIn2At: string | null;
  requestedOut2At: string | null;
  startTime: string | null;
  endTime: string | null;
  detail: string | null;
  /** Nghỉ / nghỉ bù (đợt 7–8): NULL = cả ngày. */
  leaveDurationType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY" | null;
  reason: string;
};

export type NguCanhDuyet = {
  /** Giao dịch DUY NHẤT của lượt duyệt — handler mọi phép ghi đi qua nó. KHÔNG scope. */
  tx: Prisma.TransactionClient;
  don: DonCanDuyet;
  actor: { id: string; name: string };
  note: string | null;
  now: Date;
  map: CenterMap;
  canWriteCenter: (centerId: string) => boolean;
  /** "2026-09-14" — nhãn ngày đơn, dùng trong câu thông báo. */
  dateLabel: string;
  /** "Đi muộn / Về sớm" — nhãn loại đơn. */
  kindLabel: string;
  /** Quản lý chỉnh trước khi duyệt (đợt 4: khung OT được duyệt). Không chỉnh ⇒ các vế null. */
  dieuChinh: DieuChinhKhiDuyet;
};

export type DieuChinhKhiDuyet = { otTu: string | null; otDen: string | null };
export const KHONG_DIEU_CHINH: DieuChinhKhiDuyet = { otTu: null, otDen: null };

export type KetQuaApDon = {
  /** Có thay đổi dữ liệu nghiệp vụ nào không (lưới ca, lượt quét, buổi học, tính lại công). */
  applied: boolean;
  /** Câu tóm tắt hệ quả cho người duyệt. */
  messages: string[];
  notify: DecideNotify[];
  /**
   * Giá trị CŨ → MỚI của dữ liệu nghiệp vụ đã đổi — vào audit trong cùng giao dịch (BA §9: "không
   * được chỉ lưu trạng thái cuối cùng"). `null` = đơn chỉ là căn cứ, không đổi gì.
   */
  hieuQua: Record<string, unknown> | null;
};

export type HandlerDon = (ctx: NguCanhDuyet) => Promise<KetQuaApDon>;

export const HREF_DON_CUA_TOI = "/don-tu/cua-toi";

export async function templateCode(tx: Prisma.TransactionClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const t = await tx.shiftTemplate.findFirst({ where: { id, isActive: true }, select: { code: true } });
  return t?.code ?? null;
}
