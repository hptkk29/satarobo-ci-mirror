// lib/yeu-cau-ph/da-xu-ly.ts — V8.19 (BR-REQ-02): MỘT chỗ phát sự kiện `parent_request.handled` cho MỌI đường đổi `ParentRequest.status` sang đã xử lý.
//
// Trước đây chỉ hai đường của màn «Yêu cầu phụ huynh» phát sự kiện; bốn đường nghiệp vụ khác (Bảo lưu · Học bù · duyệt bảo lưu từ yêu cầu) ghi thẳng trạng thái
// nên phụ huynh KHÔNG nhận thông báo (web chuông + mobile `GET /notifications` đọc cùng bảng `Notification` do handler `yeu-cau-xu-ly-notif` tạo).
//
// Luật:
//   · Chỉ phát khi trạng thái THẬT SỰ ĐỔI (trước ≠ sau) và sau ∈ {APPROVED, REJECTED}. Cùng trạng thái ghi lại (đổi lời phản hồi) / CANCELLED / PENDING ⇒ không phát.
//   · Phát TRONG CÙNG transaction với phép ghi (outbox `DomainEvent`): ghi lỗi ⇒ không có sự kiện; ghi xong mà gửi hỏng ⇒ dispatcher retry (maxAttempts) — không mất thông báo.
//   · `dedupeKey = parent_request.handled:<id>:<handledAt>` trùng khoá handler ⇒ hai quản trị bấm đồng thời / phát lại ⇒ đúng MỘT sự kiện, MỘT thông báo.
//   · Đường hàng loạt (`doiTrangThaiYeuCau`) chỉ phát cho dòng MÀ CHÍNH LẦN GHI NÀY đổi (đối chiếu `handledAt` đúng bằng mốc vừa ghi) — người thua cuộc đua không phát.
import type { Prisma } from "@prisma/client";
import { publishEvent } from "@/lib/events/publish";

type Tx = Prisma.TransactionClient;
type TrangThaiYeuCau = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

const CAN_BAO: readonly string[] = ["APPROVED", "REJECTED"];

/** Có nên báo phụ huynh khi yêu cầu đổi `truoc` → `sau` không (hàm thuần — dùng chung với test). */
export const canBaoPhuHuynh = (truoc: string, sau: string): boolean => truoc !== sau && CAN_BAO.includes(sau);

export const khoaSuKienDaXuLy = (requestId: string, handledAt: Date): string => `parent_request.handled:${requestId}:${handledAt.getTime()}`;

/** Phát sự kiện cho MỘT yêu cầu vừa được ghi (người gọi đã biết trạng thái trước/sau). */
export async function phatYeuCauDaXuLy(tx: Tx, p: { requestId: string; truoc: string; sau: string; handledAt: Date }): Promise<boolean> {
  if (!canBaoPhuHuynh(p.truoc, p.sau)) return false;
  await publishEvent("parent_request.handled", { requestId: p.requestId }, { tx, dedupeKey: khoaSuKienDaXuLy(p.requestId, p.handledAt) });
  return true;
}

/**
 * Đổi trạng thái nhiều yêu cầu theo `where` + phát sự kiện cho dòng đổi thật. `data.handledAt` BẮT BUỘC (mốc dùng nhận biết dòng do chính lần ghi này đổi).
 * Trả số dòng đã đổi. Đọc trạng thái trước → ghi có điều kiện theo trạng thái đó (người ghi sau trong cuộc đua đổi 0 dòng) → đọc lại theo mốc.
 */
export async function doiTrangThaiYeuCau(
  tx: Tx,
  where: Prisma.ParentRequestWhereInput,
  data: { status: TrangThaiYeuCau; handledAt: Date } & Omit<Prisma.ParentRequestUncheckedUpdateManyInput, "status" | "handledAt">,
): Promise<number> {
  const truoc = await tx.parentRequest.findMany({ where, select: { id: true, status: true } });
  if (truoc.length === 0) return 0;
  const ids = truoc.map((r) => r.id);
  const trangThaiTruoc = new Map(truoc.map((r) => [r.id, r.status as string]));
  const r = await tx.parentRequest.updateMany({ where: { id: { in: ids }, status: { in: [...new Set(truoc.map((x) => x.status))] } }, data });
  if (r.count === 0) return 0;
  const doi = await tx.parentRequest.findMany({ where: { id: { in: ids }, handledAt: data.handledAt, status: data.status }, select: { id: true } });
  for (const d of doi) await phatYeuCauDaXuLy(tx, { requestId: d.id, truoc: trangThaiTruoc.get(d.id) ?? "PENDING", sau: data.status, handledAt: data.handledAt });
  return r.count;
}
