// lib/cham-cong/huy-don.ts — HUỶ ĐƠN ĐÃ DUYỆT (đợt 11 đơn từ, BA §15).
//
//   APPROVED ──(người nộp xin huỷ, kèm lý do)──▶ CANCEL_REQUESTED ──(quản lý duyệt huỷ)──▶ CANCELLED
//                                                       └──(quản lý từ chối huỷ)──▶ APPROVED
//
// · Trong lúc CHỜ duyệt huỷ, đơn VẪN còn hiệu lực (`TRANG_THAI_CON_HIEU_LUC`): người ta xin huỷ chưa có
//   nghĩa là đã huỷ.
// · Duyệt huỷ = MỘT giao dịch: giành đơn (updateMany có điều kiện) → hoàn tác theo loại
//   (`don/hoan-tac.ts`) → ghi trạng thái + ảnh chụp hoàn tác → audit. Hoàn tác từ chối ⇒ `throw` ⇒
//   rollback cả cụm, đơn giữ CANCEL_REQUESTED.
// · Cổng kỳ đã chốt DÙNG CHUNG với duyệt đơn (`loiKyDaChotCuaDon`) — hoàn tác cũng là ghi vào kỳ.
// · Chỉ người nộp xin huỷ (cùng luật thu hồi, Q-2). Quyền duyệt huỷ = quyền duyệt đơn của cơ sở.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { vnYmd } from "@/lib/time/vn";
import { WR_KIND_LABEL, type WorkRequestKindV } from "@/lib/work-request";
import { DecideError, HREF_DON_CUA_TOI, type DecideNotify } from "./don/kieu";
import { HOAN_TAC_DON } from "./don/hoan-tac";
import { loiDonKhongConCho, loiKyDaChotCuaDon, REQ_SELECT } from "./requests";
import { coTheXinHuy } from "./huy-don-mo-ta";

const nhanNgay = (d: Date | null) => (d ? vnYmd(new Date(d.getTime() + 12 * 3_600_000)) : "");

export type YeuCauHuyResult = { ok: true; centerId: string | null; kind: WorkRequestKindV; fromDate: Date | null } | { ok: false; error: string };

/**
 * Người nộp xin huỷ một đơn ĐÃ DUYỆT. Chặn sớm những ca chắc chắn không huỷ được (đơn duyệt theo luật
 * cũ — không có ảnh chụp để hoàn tác; kỳ đã chốt) để người ta không phải chờ quản lý mới biết.
 */
export async function yeuCauHuyDon(input: {
  requestId: string;
  requesterId: string;
  requesterName: string;
  lyDo: string;
  now?: Date;
}): Promise<YeuCauHuyResult> {
  const now = input.now ?? new Date();
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, error: "Ghi lý do xin huỷ (tối thiểu 5 ký tự)" };
  const req = await db.workRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true, requesterId: true, status: true, centerId: true, orgUnitId: true, kind: true, fromDate: true, toDate: true,
      effectVersion: true, leaveDurationType: true, appliedEffect: true,
    },
  });
  // Đơn của người khác trả CÙNG câu với đơn không tồn tại (cùng luật thu hồi).
  if (!req || req.requesterId !== input.requesterId) return { ok: false, error: "Không tìm thấy đơn" };
  if (req.status === "PENDING") return { ok: false, error: "Đơn còn chờ duyệt — dùng nút Thu hồi" };
  if (req.status !== "APPROVED") return { ok: false, error: loiDonKhongConCho(req.status) };
  if (!req.effectVersion) {
    return { ok: false, error: "Đơn này được duyệt trước khi có chức năng huỷ — nhờ quản lý sửa trực tiếp trên lịch ca / bảng công" };
  }
  // Cùng hàm trang dùng để vẽ nút (luật 12): nút hiện ⇔ server nhận.
  const kindV = req.kind as WorkRequestKindV;
  if (!coTheXinHuy({ ...req, kind: kindV })) {
    return { ok: false, error: "Đơn này được duyệt trước khi hệ thống lưu đủ dữ liệu để tự hoàn tác — nhờ quản lý sửa trực tiếp trên lịch ca / bảng công / màn lớp học" };
  }
  const ky = await loiKyDaChotCuaDon(req);
  if (ky) return { ok: false, error: ky };

  return db.$transaction(async (tx) => {
    const r = await tx.workRequest.updateMany({
      where: { id: req.id, requesterId: input.requesterId, status: "APPROVED" },
      data: { status: "CANCEL_REQUESTED", cancelReason: lyDo, cancelRequestedAt: now, cancelDecidedById: null, cancelDecidedByName: null, cancelDecidedAt: null, cancelDecisionNote: null },
    });
    if (r.count === 0) {
      const sau = await tx.workRequest.findUnique({ where: { id: req.id }, select: { status: true } });
      return { ok: false as const, error: loiDonKhongConCho(sau?.status ?? "") };
    }
    await writeAudit({
      actor: { id: input.requesterId, name: input.requesterName },
      module: "hr_attendance",
      entityType: "WorkRequest",
      entityId: req.id,
      action: "REQUEST_CANCELLATION",
      oldValues: { status: "APPROVED" },
      newValues: { status: "CANCEL_REQUESTED", kind: req.kind },
      reason: lyDo,
      orgUnitId: req.orgUnitId,
      tx,
    });
    return { ok: true as const, centerId: req.centerId, kind: req.kind as WorkRequestKindV, fromDate: req.fromDate };
  });
}

export type QuyetDinhHuyInput = {
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  note: string | null;
  actor: { id: string; name: string };
  canWriteCenter: (centerId: string) => boolean;
  /** Vượt cổng kỳ đã chốt — action tự kiểm quyền cấp Hội sở trước (cùng khuôn `decideRequest`). */
  boQuaKyDaChot?: boolean;
  now?: Date;
};

export type QuyetDinhHuyResult = { ok: true; message?: string; notify: DecideNotify[] } | { ok: false; error: string };

export async function quyetDinhHuy(input: QuyetDinhHuyInput): Promise<QuyetDinhHuyResult> {
  const now = input.now ?? new Date();
  const req = await db.workRequest.findUnique({
    where: { id: input.requestId },
    select: { ...REQ_SELECT, appliedEffect: true, cancelReason: true },
  });
  if (!req) return { ok: false, error: "Không tìm thấy đơn" };
  if (req.status !== "CANCEL_REQUESTED") return { ok: false, error: req.status === "APPROVED" ? "Đơn không có yêu cầu huỷ nào đang chờ" : loiDonKhongConCho(req.status) };
  if (!req.centerId || !input.canWriteCenter(req.centerId)) return { ok: false, error: "Đơn thuộc cơ sở bạn không có quyền duyệt" };
  if (input.decision === "APPROVED") {
    const ky = await loiKyDaChotCuaDon(req);
    if (ky && !input.boQuaKyDaChot) return { ok: false, error: ky };
  }

  const kind = req.kind as WorkRequestKindV;
  const kindLabel = WR_KIND_LABEL[kind] ?? req.kind;
  const dateLabel = nhanNgay(req.fromDate);
  const quyetDinh = {
    cancelDecidedById: input.actor.id,
    cancelDecidedByName: input.actor.name,
    cancelDecidedAt: now,
    cancelDecisionNote: input.note?.trim() || null,
  };

  try {
    const out = await db.$transaction(async (tx) => {
      // Giành đơn TRƯỚC mọi phép ghi khác: hai quản lý bấm cùng lúc thì một người đổi 0 dòng.
      const lock = await tx.workRequest.updateMany({
        where: { id: req.id, status: "CANCEL_REQUESTED" },
        data: { ...quyetDinh, status: input.decision === "APPROVED" ? "CANCELLED" : "APPROVED" },
      });
      if (lock.count === 0) {
        const sau = await tx.workRequest.findUnique({ where: { id: req.id }, select: { status: true } });
        throw new DecideError(sau?.status === "CANCEL_REQUESTED" || !sau ? "Yêu cầu huỷ vừa được người khác xử lý" : loiDonKhongConCho(sau.status));
      }

      if (input.decision === "REJECTED") {
        await writeAudit({
          actor: input.actor,
          module: "hr_attendance",
          entityType: "WorkRequest",
          entityId: req.id,
          action: "REJECT_CANCELLATION",
          oldValues: { status: "CANCEL_REQUESTED" },
          newValues: { status: "APPROVED", kind },
          reason: input.note ?? undefined,
          orgUnitId: req.orgUnitId,
          tx,
        });
        return {
          messages: [] as string[],
          notify: [
            {
              userId: req.requesterId,
              title: `Yêu cầu huỷ đơn ${kindLabel} ${dateLabel} bị từ chối`,
              body: `${input.actor.name} không đồng ý huỷ — đơn vẫn giữ hiệu lực${input.note ? ` — ${input.note}` : ""}.`,
              href: HREF_DON_CUA_TOI,
            },
          ] as DecideNotify[],
        };
      }

      const kq = await HOAN_TAC_DON[kind]({
        tx,
        don: { ...req, kind, centerId: req.centerId! },
        actor: input.actor,
        now,
        canWriteCenter: input.canWriteCenter,
        dateLabel,
      });
      await tx.workRequest.update({ where: { id: req.id }, data: { cancelEffect: kq.hieuQua as Prisma.InputJsonValue } });
      await writeAudit({
        actor: input.actor,
        module: "hr_attendance",
        entityType: "WorkRequest",
        entityId: req.id,
        action: "APPROVE_CANCELLATION",
        oldValues: { status: "CANCEL_REQUESTED", hieuQua: req.appliedEffect as Prisma.InputJsonValue },
        newValues: { status: "CANCELLED", kind, hoanTac: kq.hieuQua as Prisma.InputJsonValue },
        reason: input.note ?? req.cancelReason ?? undefined,
        orgUnitId: req.orgUnitId,
        tx,
      });
      return {
        messages: kq.messages,
        notify: [
          {
            userId: req.requesterId,
            title: `Đơn ${kindLabel} ${dateLabel} đã được huỷ`,
            body: `${input.actor.name} đã duyệt huỷ — ${kq.messages.join("; ")}${input.note ? ` — ${input.note}` : ""}.`,
            href: HREF_DON_CUA_TOI,
          },
          ...kq.notify,
        ],
      };
    });
    return { ok: true, message: out.messages.join(" · ") || undefined, notify: out.notify };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: err instanceof DecideError ? msg : `Chưa duyệt huỷ được — lỗi hoàn tác: ${msg}` };
  }
}
