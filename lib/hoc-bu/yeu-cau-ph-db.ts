// lib/hoc-bu/yeu-cau-ph-db.ts — phần ĐỌC + GHI của "QLCS tạo dòng cần bù theo yêu cầu phụ huynh". Luật thuần ở `yeu-cau-ph.ts`.
//
// Đi qua CỬA DUY NHẤT `taoDongHocBu` (sourceType = MANUAL, nhãn `YEU_CAU_PH`): dòng sinh ra rồi theo đường học bù có sẵn. KHÔNG xếp case, KHÔNG tạo đơn phí ở đây —
// "tính phí" nghĩa là dòng luôn đòi phí (`batBuocPhi`), phí tạo bằng nút "Tạo phí bù" như mọi dòng hết lượt; "không tính phí" là miễn phí ngoại lệ
// (`freeApprovedAt` + lý do) đặt NGAY lúc tạo, cùng giao dịch.
import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { hocVienCuaSale } from "@/lib/hoc-bu/danh-sach-db";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { CAU_KHONG_CUA_SALE, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { buoiBuDuoc, kiemYeuCauBu, NHAN_CHON_PHI, type ChonPhi } from "@/lib/hoc-bu/yeu-cau-ph";
import { NGUON_BU_YEU_CAU_PH } from "@/lib/hoc-bu/xep-case";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

export type BuoiDeBu = { sessionId: string; date: Date; lop: string; lessonId: string; daCoDong: boolean };

/** Đọc các buổi ĐÃ DIỄN RA của những lớp bé đang học, để QLCS chọn buổi cần bù. Đi qua phạm vi cơ sở của người xem. */
export async function docBuoiDeBu(actor: NguoiHocBu, studentId: string, now: Date = new Date()): Promise<BuoiDeBu[]> {
  if (actor.chiCuaSale !== null) {
    const cua = await db.student.count({ where: { id: studentId, ...hocVienCuaSale(actor.chiCuaSale) } });
    if (cua !== 1) throw new LoiHocBu(CAU_KHONG_CUA_SALE);
  }
  const gd = await db.enrollment.findMany({
    where: { studentId, deletedAt: null, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } },
    select: { classId: true },
  });
  const classIds = [...new Set(gd.map((g) => g.classId))];
  if (classIds.length === 0) return [];
  const sdb = scopedDb(actor);
  const [buoi, coDong, coMat] = await Promise.all([
    sdb.classSession.findMany({
      where: { classId: { in: classIds }, date: { lt: now }, status: { not: "CANCELLED" }, lessonId: { not: null } },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: 120,
      select: { id: true, date: true, lessonId: true, class: { select: { name: true } } },
    }),
    sdb.makeupNeed.findMany({ where: { studentId, classId: { in: classIds } }, select: { missedSessionId: true } }),
    db.attendance.findMany({ where: { studentId, status: { in: ["PRESENT", "LATE"] }, session: { classId: { in: classIds } } }, select: { sessionId: true } }),
  ]);
  const dacoDong = new Set(coDong.map((d) => d.missedSessionId));
  const dacoMat = new Set(coMat.map((a) => a.sessionId));
  return buoi
    .filter((b) => !dacoMat.has(b.id))
    .map((b) => ({ sessionId: b.id, date: b.date, lop: b.class.name, lessonId: b.lessonId!, daCoDong: dacoDong.has(b.id) }));
}

export type KetQuaYeuCau = { tao: number; boQua: { sessionId: string; lyDo: string }[] };

/**
 * Tạo dòng cần bù cho (bé, các buổi đã qua). Người gọi PHẢI đã kiểm quyền `makeup:waive` (quyết định tiền của QLCS).
 * Idempotent theo (bé, buổi): buổi đã có dòng thì KHÔNG đổi gì (không đè lựa chọn phí cũ) và được báo trong `boQua`.
 */
export async function taoDongBuTheoYeuCau(
  actor: NguoiHocBu,
  p: { studentId: string; sessionIds: string[]; chonPhi: ChonPhi; lyDo: string; ten: string; now?: Date },
): Promise<KetQuaYeuCau> {
  const now = p.now ?? new Date();
  const ids = [...new Set(p.sessionIds)];
  const loi = kiemYeuCauBu({ soBuoi: ids.length, chonPhi: p.chonPhi, lyDo: p.lyDo });
  if (loi) throw new LoiHocBu(loi);
  const lyDo = p.lyDo.trim();

  const sdb = scopedDb(actor);
  const buoi = await sdb.classSession.findMany({
    where: { id: { in: ids } },
    select: { id: true, classId: true, date: true, status: true, lessonId: true, class: { select: { centerId: true } } },
  });
  if (buoi.length !== ids.length) throw new LoiHocBu("Có buổi không tồn tại hoặc ngoài phạm vi cơ sở của bạn");
  for (const b of buoi) {
    const sai = buoiBuDuoc(b, now);
    if (sai) throw new LoiHocBu(sai);
  }
  if (actor.chiCuaSale !== null) {
    const cua = await db.student.count({ where: { id: p.studentId, ...hocVienCuaSale(actor.chiCuaSale) } });
    if (cua !== 1) throw new LoiHocBu(CAU_KHONG_CUA_SALE);
  }
  const classIds = [...new Set(buoi.map((b) => b.classId))];
  const gd = await db.enrollment.findMany({
    where: { studentId: p.studentId, classId: { in: classIds }, deletedAt: null, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } },
    select: { classId: true },
  });
  if (new Set(gd.map((g) => g.classId)).size !== classIds.length) throw new LoiHocBu("Học viên không đang học lớp của buổi này");
  const coMat = await db.attendance.count({ where: { studentId: p.studentId, sessionId: { in: ids }, status: { in: ["PRESENT", "LATE"] } } });
  if (coMat > 0) throw new LoiHocBu("Học viên đã có mặt ở một trong các buổi này — không cần bù");

  // OrgUnit tra TRƯỚC khi mở giao dịch (không mở kết nối thứ hai bên trong — xem ghi chú `taoDongHocBu.orgUnitId`).
  const orgTheoCoSo = new Map<string, string | null>();
  for (const b of buoi) {
    const c = b.class.centerId;
    if (c && !orgTheoCoSo.has(c)) orgTheoCoSo.set(c, await orgUnitIdForCenter(c));
  }

  return db.$transaction(async (tx) => {
    const kq: KetQuaYeuCau = { tao: 0, boQua: [] };
    for (const b of buoi.sort((x, y) => x.date.getTime() - y.date.getTime())) {
      const r = await taoDongHocBu(tx, {
        studentId: p.studentId,
        missedSessionId: b.id,
        nguon: "MANUAL",
        nguonBaoLuu: NGUON_BU_YEU_CAU_PH,
        createdById: actor.userId,
        note: `QLCS tạo theo yêu cầu phụ huynh: ${lyDo}`,
        orgUnitId: b.class.centerId ? (orgTheoCoSo.get(b.class.centerId) ?? null) : null,
      });
      if (r.ket !== "TAO") {
        kq.boQua.push({
          sessionId: b.id,
          lyDo: r.ket === "BO_QUA_BAO_LUU" ? "Buổi nằm trong khoảng bảo lưu" : "Buổi này đã có dòng cần bù (kể cả đã huỷ) — dùng nút ở danh sách học bù",
        });
        continue;
      }
      if (p.chonPhi === "KHONG_TINH_PHI") {
        const doi = await tx.makeupNeed.updateMany({
          where: { id: r.id, status: "PENDING", freeApprovedAt: null, waivedAt: null },
          data: { freeApprovedAt: now, freeApprovedById: actor.userId, freeReason: lyDo },
        });
        if (doi.count !== 1) throw new LoiHocBu("Dòng vừa đổi trạng thái — thử lại");
      }
      await ghiNhatKy(tx, {
        actorId: actor.userId,
        ten: p.ten,
        entityType: "MakeupNeed",
        entityId: r.id,
        action: "hoc-bu.tao-theo-yeu-cau",
        newValues: { chonPhi: p.chonPhi, nhan: NHAN_CHON_PHI[p.chonPhi], missedSessionId: b.id, studentId: p.studentId },
        reason: lyDo,
      });
      kq.tao++;
    }
    return kq;
  });
}
