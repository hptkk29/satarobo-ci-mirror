// lib/hoc-bu/yeu-cau-them-be-db.ts — YÊU CẦU THÊM HỌC VIÊN VÀO CASE CÓ SẴN, chờ quản lý cơ sở duyệt (24/10/2026). Phép ĐỌC/GHI của riêng yêu cầu.
// Luật quyết định (thêm ngay hay chờ duyệt) ở `yeu-cau-them-be-thuan.ts`. PHÉP DUYỆT (thêm bé thật vào case) nằm ở `case-db.ts` (`duyetYeuCauThemBe`) vì nó dùng chung đường
// xếp bé với lượt thêm trực tiếp — ở đây chỉ có những phép KHÔNG đụng case: gửi · từ chối · rút · huỷ theo case · đọc.
//
// Case KHÔNG đổi một chữ khi gửi / từ chối / rút: yêu cầu chỉ là ghi chú "xin thêm". Mọi phép ghi chạy trong MỘT giao dịch cùng nhật ký + sự kiện (rollback thì không có gì).
import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { phatYeuCauThemBe, phatYeuCauThemBeBiTuChoi } from "@/lib/hoc-bu/su-kien";
import { gomTheoLo, type LoYeuCau } from "@/lib/hoc-bu/yeu-cau-them-be-thuan";

type Sdb = ReturnType<typeof scopedDb>;
type Tx = Prisma.TransactionClient;

/** Dòng cần bù đang có yêu cầu CHỜ DUYỆT → case đang xin vào. Đọc trần (`db`): đầu vào là id dòng đã qua phạm vi của người gọi. */
export async function docYeuCauMoCuaDong(needIds: readonly string[]): Promise<Map<string, string>> {
  if (needIds.length === 0) return new Map();
  const rows = await db.makeupCaseAddRequest.findMany({
    where: { makeupNeedId: { in: [...needIds] }, status: "PENDING" },
    select: { makeupNeedId: true, caseId: true },
  });
  return new Map(rows.map((r) => [r.makeupNeedId, r.caseId]));
}

/**
 * GỬI yêu cầu: ghi một dòng cho mỗi dòng cần bù + sự kiện báo quản lý cơ sở + nhật ký, cùng giao dịch. Nơi gọi (`xepVaoCaseCoSan`) đã kiểm toàn bộ luật xếp trên lô này —
 * yêu cầu không gửi một lô mà chính người gửi đã không xếp được (nhưng luật được KIỂM LẠI lúc duyệt: lượt / lịch / bộ bài có thể đã đổi).
 * Dòng đã có yêu cầu chờ (chỉ mục duy nhất từng phần) ⇒ cả lô không ghi gì.
 */
export async function guiYeuCauThemBe(
  actor: NguoiHocBu,
  p: {
    c: { id: string; centerId: string; orgUnitId: string | null };
    dong: readonly { id: string; studentId: string; hocVien: string }[];
    moRongBai: boolean;
    now?: Date;
  },
): Promise<{ batchId: string }> {
  const now = p.now ?? new Date();
  const batchId = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      for (const d of p.dong) {
        await tx.makeupCaseAddRequest.create({
          data: {
            batchId,
            caseId: p.c.id,
            makeupNeedId: d.id,
            studentId: d.studentId,
            // ⚠️ scopedDb KHÔNG che write: tự set cơ sở (luật Nền #3) — cơ sở của CASE, không của người bấm.
            centerId: p.c.centerId,
            orgUnitId: p.c.orgUnitId,
            moRongBai: p.moRongBai,
            proposedById: actor.userId,
            proposedAt: now,
          },
        });
      }
      await phatYeuCauThemBe(tx, { caseId: p.c.id, batchId });
      await ghiNhatKy(tx, {
        actorId: actor.userId,
        entityType: "MakeupCaseAddRequest",
        entityId: batchId,
        action: "hoc-bu.gui-yeu-cau-them-be",
        orgUnitId: p.c.orgUnitId,
        newValues: { caseId: p.c.id, them: p.dong.map((d) => ({ makeupNeedId: d.id, studentId: d.studentId })), moRongBai: p.moRongBai },
      });
    });
  } catch (e) {
    // P2002 trên chỉ mục từng phần: dòng này đã có yêu cầu chờ (hai người bấm cùng lúc, hoặc dữ liệu cũ trên màn).
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      throw new LoiHocBu("Có dòng vừa được gửi duyệt thêm vào case — tải lại trang");
    }
    throw e;
  }
  return { batchId };
}

/** Các dòng PENDING của một lô, trong tầm nhìn của người gọi (`scopedDb`). Rỗng ⇒ lô đã được xử lý hoặc không thuộc cơ sở của họ. */
export async function docDongPendingCuaLo(sdb: Sdb, batchId: string) {
  return sdb.makeupCaseAddRequest.findMany({
    where: { batchId, status: "PENDING" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, batchId: true, caseId: true, makeupNeedId: true, studentId: true, centerId: true, moRongBai: true, proposedById: true },
  });
}

/** TỪ CHỐI cả lô (bắt buộc lý do ≥ `LY_DO_TOI_THIEU`): các dòng cần bù vẫn nằm ở danh sách cần bù (chưa từng rời), báo người gửi kèm lý do. */
export async function tuChoiYeuCauThemBe(actor: NguoiHocBu, p: { batchId: string; lyDo: string; ten: string; now?: Date }): Promise<void> {
  const lyDo = p.lyDo.trim();
  if (lyDo.length < LY_DO_TOI_THIEU) throw new LoiHocBu(`Ghi lý do từ chối ít nhất ${LY_DO_TOI_THIEU} ký tự`);
  const now = p.now ?? new Date();
  const dong = await docDongPendingCuaLo(scopedDb(actor), p.batchId);
  if (dong.length === 0) throw new LoiHocBu("Yêu cầu này không còn chờ duyệt — tải lại trang");
  const lo = gomTheoLo(dong)[0]!;
  await db.$transaction(async (tx) => {
    const doi = await tx.makeupCaseAddRequest.updateMany({
      where: { batchId: p.batchId, status: "PENDING" },
      data: { status: "REJECTED", decidedById: actor.userId, decidedAt: now, decisionReason: lyDo },
    });
    if (doi.count !== dong.length) throw new LoiHocBu("Yêu cầu vừa được người khác xử lý — tải lại trang");
    if (lo.proposedById !== actor.userId) await phatYeuCauThemBeBiTuChoi(tx, { caseId: lo.caseId, batchId: p.batchId, nguoiGuiId: lo.proposedById });
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupCaseAddRequest",
      entityId: p.batchId,
      action: "hoc-bu.tu-choi-them-be",
      orgUnitId: undefined,
      oldValues: { status: "PENDING" },
      newValues: { status: "REJECTED", caseId: lo.caseId, soDong: dong.length },
      reason: lyDo,
    });
  });
}

/** Người GỬI rút lại yêu cầu còn chờ (không báo ai: chính họ vừa bấm). Người khác muốn bỏ yêu cầu thì từ chối (có lý do). */
export async function rutYeuCauThemBe(actor: NguoiHocBu, p: { batchId: string; ten: string; now?: Date }): Promise<void> {
  const now = p.now ?? new Date();
  const dong = await docDongPendingCuaLo(scopedDb(actor), p.batchId);
  if (dong.length === 0) throw new LoiHocBu("Yêu cầu này không còn chờ duyệt — tải lại trang");
  const lo = gomTheoLo(dong)[0]!;
  if (lo.proposedById !== actor.userId) throw new LoiHocBu("Chỉ người đã gửi yêu cầu mới rút lại được — quản lý cơ sở dùng \"Từ chối\"");
  await db.$transaction(async (tx) => {
    const doi = await tx.makeupCaseAddRequest.updateMany({
      where: { batchId: p.batchId, status: "PENDING", proposedById: actor.userId },
      data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: now, decisionReason: "Người gửi rút lại" },
    });
    if (doi.count !== dong.length) throw new LoiHocBu("Yêu cầu vừa được người khác xử lý — tải lại trang");
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupCaseAddRequest",
      entityId: p.batchId,
      action: "hoc-bu.rut-them-be",
      oldValues: { status: "PENDING" },
      newValues: { status: "CANCELLED", caseId: lo.caseId, soDong: dong.length },
    });
  });
}

/**
 * Case bị HUỶ ⇒ mọi yêu cầu đang chờ của nó mất nghĩa: đóng cùng giao dịch huỷ (nếu không, dòng cần bù bị khoá "đang chờ duyệt" vào một case không còn). Gọi TRONG giao dịch
 * của `huyCase`, sau khi đã khoá hàng case.
 */
export async function huyYeuCauKhiHuyCase(tx: Tx, p: { caseId: string; actorId: string; now: Date }): Promise<number> {
  const cho = await tx.makeupCaseAddRequest.findMany({ where: { caseId: p.caseId, status: "PENDING" }, select: { batchId: true } });
  if (cho.length === 0) return 0;
  const doi = await tx.makeupCaseAddRequest.updateMany({
    where: { caseId: p.caseId, status: "PENDING" },
    data: { status: "CANCELLED", decidedById: p.actorId, decidedAt: p.now, decisionReason: "Case đã huỷ" },
  });
  for (const batchId of new Set(cho.map((r) => r.batchId))) {
    await ghiNhatKy(tx, {
      actorId: p.actorId,
      entityType: "MakeupCaseAddRequest",
      entityId: batchId,
      action: "hoc-bu.huy-yeu-cau-them-be",
      oldValues: { status: "PENDING" },
      newValues: { status: "CANCELLED", caseId: p.caseId },
      reason: "Case đã huỷ",
    });
  }
  return doi.count;
}

// ─── ĐỌC để hiện ────────────────────────────────────────────────────────────────────────────────────────────────────

export type LoChoDuyetThem = {
  batchId: string;
  caseId: string;
  centerId: string;
  proposedAt: Date;
  proposedById: string;
  nguoiGui: string;
  moRongBai: boolean;
  hocVien: { ten: string; lop: string; bai: string }[];
  /** Case mà lô xin vào; `null` = không đọc được (ngoài tầm nhìn / đã xoá). */
  thongTinCase: { date: Date; startTime: string; endTime: string; status: string; khoa: string; version: number } | null;
};

/**
 * Các LÔ yêu cầu đang chờ trong tầm nhìn của người xem. `caseId` khai ⇒ chỉ lô của case đó (màn chi tiết case); `centerId` ⇒ lọc cơ sở. Sớm nhất trước.
 * Người gọi quyết ai được thấy lô nào: màn "Duyệt" gác `makeup:waive` (thấy mọi lô trong cơ sở); màn case cho cả Sale — họ thấy lô của case họ đang xem.
 */
export async function docLoChoDuyetThem(sdb: Sdb, p: { centerId?: string; caseId?: string }): Promise<LoChoDuyetThem[]> {
  const rows = await sdb.makeupCaseAddRequest.findMany({
    where: { status: "PENDING", ...(p.centerId ? { centerId: p.centerId } : {}), ...(p.caseId ? { caseId: p.caseId } : {}) },
    orderBy: [{ proposedAt: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, batchId: true, caseId: true, makeupNeedId: true, studentId: true, centerId: true, moRongBai: true, proposedById: true, proposedAt: true },
  });
  if (rows.length === 0) return [];
  const lo = gomTheoLo(rows);
  const [cases, needs, nguoi] = await Promise.all([
    sdb.makeupCase.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.caseId))] } },
      select: { id: true, date: true, startTime: true, endTime: true, status: true, version: true, courseId: true },
    }),
    db.makeupNeed.findMany({ where: { id: { in: rows.map((r) => r.makeupNeedId) } }, select: { id: true, studentId: true, classId: true, missedSessionId: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.proposedById))] } }, select: { id: true, name: true } }),
  ]);
  // MakeupCase / MakeupNeed không khai quan hệ Prisma sang khoá, học viên, lớp, buổi — đọc rời rồi ghép (cùng cách `case-doc.ts`).
  const [khoa, hocVien, lop, buoi] = await Promise.all([
    db.course.findMany({ where: { id: { in: [...new Set(cases.map((c) => c.courseId))] } }, select: { id: true, name: true } }),
    db.student.findMany({ where: { id: { in: [...new Set(needs.map((n) => n.studentId))] } }, select: { id: true, name: true } }),
    db.class.findMany({ where: { id: { in: [...new Set(needs.map((n) => n.classId))] } }, select: { id: true, name: true } }),
    db.classSession.findMany({
      where: { id: { in: needs.map((n) => n.missedSessionId) } },
      select: { id: true, topic: true, lesson: { select: { order: true, title: true, moduleCode: true } } },
    }),
  ]);
  const caseTheoId = new Map(cases.map((c) => [c.id, c]));
  const needTheoId = new Map(needs.map((n) => [n.id, n]));
  const tenKhoa = new Map(khoa.map((k) => [k.id, k.name]));
  const tenHocVien = new Map(hocVien.map((h) => [h.id, h.name]));
  const tenLop = new Map(lop.map((l) => [l.id, l.name]));
  const buoiTheoId = new Map(buoi.map((b) => [b.id, b]));
  const tenNguoi = new Map(nguoi.map((u) => [u.id, u.name ?? "Nhân viên"]));
  const theoLo = new Map<string, typeof rows>();
  for (const r of rows) theoLo.set(r.batchId, [...(theoLo.get(r.batchId) ?? []), r]);
  return lo.map((l: LoYeuCau) => {
    const dong = theoLo.get(l.batchId)!;
    const c = caseTheoId.get(l.caseId);
    return {
      batchId: l.batchId,
      caseId: l.caseId,
      centerId: dong[0]!.centerId,
      proposedAt: dong[0]!.proposedAt,
      proposedById: l.proposedById,
      nguoiGui: tenNguoi.get(l.proposedById) ?? "—",
      moRongBai: l.moRongBai,
      hocVien: dong.map((r) => {
        const n = needTheoId.get(r.makeupNeedId);
        const b = n ? buoiTheoId.get(n.missedSessionId) : undefined;
        const bai = b?.lesson ? deriveSessionLabel({ lessonOrder: b.lesson.order, lessonTitle: b.lesson.title, moduleCode: b.lesson.moduleCode, topic: b.topic }) : "";
        return { ten: tenHocVien.get(r.studentId) ?? "—", lop: n ? (tenLop.get(n.classId) ?? "—") : "—", bai: bai || "Bài chưa gắn tên" };
      }),
      thongTinCase: c ? { date: c.date, startTime: c.startTime, endTime: c.endTime, status: c.status, khoa: tenKhoa.get(c.courseId) ?? "—", version: c.version } : null,
    };
  });
}
