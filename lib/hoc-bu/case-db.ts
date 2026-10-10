import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { layCaCuaNhieuNguoi } from "@/lib/trial/gv-kha-dung-db";
import { caPhuTronKhungGio } from "@/lib/trial/gv-kha-dung";
import { generateOrderCode, withUniqueRetry } from "@/lib/orders/code";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { giaMoiBuoi } from "@/lib/finance/coach-pricing";
import { docDongTheoId, type DongCanBu } from "@/lib/hoc-bu/danh-sach-db";
import { kiemNhom, caseNhanThem } from "@/lib/hoc-bu/xep-case";
import { baoGvCaBu } from "@/lib/hoc-bu/bao-gv-db";

// CASE DẠY BÙ — đường ghi (docs/hoc-bu/DAC-TA.md §2–3). Quyền hỏi ở server action; ở đây là
// LUẬT NGHIỆP VỤ + phép ghi. Mọi cổng đứng TRƯỚC phép ghi đầu tiên, và từ chối trong
// `$transaction` là `throw` (CLAUDE.md, "Luật rollback").

export class LoiHocBu extends Error {}

const GIO = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Nửa đêm UTC của ngày VN — đúng hình dạng cột `@db.Date` và `workDate` của lưới ca. */
export function ngayTuYmd(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new LoiHocBu("Ngày dạy bù không hợp lệ");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export type GvTrongCa = { id: string; name: string; ma: string };

/**
 * Giáo viên CÓ CA LÀM phủ trọn khung giờ bù, ở đúng cơ sở của case (chốt: "phải lấy giáo viên
 * trong ca làm việc"). Dùng CHUNG cho ô chọn và cho cổng ở máy chủ — ô chọn bày ai thì máy chủ
 * nhận đúng người đó (luật 12). Phép "phủ trọn" là `caPhuTronKhungGio` của ô chọn GV trial.
 */
export async function gvTrongCa(
  actor: Actor,
  p: { centerId: string; ymd: string; startTime: string; endTime: string },
): Promise<{ ds: GvTrongCa[]; lyDoRong: string | null }> {
  if (!GIO.test(p.startTime) || !GIO.test(p.endTime) || p.startTime >= p.endTime) {
    return { ds: [], lyDoRong: "Giờ bắt đầu phải trước giờ kết thúc" };
  }
  const giaoVien = await getAssignableTeachers();
  const ca = await layCaCuaNhieuNguoi(
    actor,
    giaoVien.map((g) => g.id),
    ngayTuYmd(p.ymd),
  );
  if (!ca.luoiDaSinh) {
    return { ds: [], lyDoRong: "Lưới ca của ngày này chưa sinh — chưa biết giáo viên nào trong ca" };
  }
  const ds: GvTrongCa[] = [];
  for (const g of giaoVien) {
    const o = ca.theoNguoi[g.id] ?? null;
    if (!o) continue;
    // Ca gắn cơ sở khác ⇒ người đó đang làm ở nơi khác (ca không gắn cơ sở thì không loại).
    if (o.centerId !== null && o.centerId !== p.centerId) continue;
    const phu = caPhuTronKhungGio({
      ca: o,
      khung: { startTime: p.startTime, endTime: p.endTime },
      luoiDaSinh: true,
      coTrongLuoi: ca.coTrongLuoi.has(g.id),
    });
    if (phu === "PHU_TRON") ds.push({ id: g.id, name: g.name ?? "Giáo viên", ma: o.ma });
  }
  ds.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return {
    ds,
    lyDoRong: ds.length ? null : "Không giáo viên nào có ca làm phủ trọn khung giờ này ở cơ sở này",
  };
}

/** Đọc lại dòng cần bù ở máy chủ và kiểm đủ luật — màn hình không được tin. */
async function kiemDongXep(actor: Actor, needIds: string[]): Promise<DongCanBu[]> {
  const ids = [...new Set(needIds)];
  if (ids.length === 0) throw new LoiHocBu("Chưa chọn học viên nào");
  const dong = await docDongTheoId(scopedDb(actor), ids);
  if (dong.length !== ids.length) throw new LoiHocBu("Có học viên đã được xếp/huỷ — tải lại trang");
  const nhom = kiemNhom(dong.map((d) => ({ ...d, hocVien: d.hocVien })));
  if (!nhom.ok) throw new LoiHocBu(nhom.lyDo);
  for (const d of dong) {
    if (!d.xep.ok) throw new LoiHocBu(`${d.hocVien}: ${d.xep.lyDo}`);
  }
  return dong;
}

async function phanLoaiBu(): Promise<string | null> {
  const bu = await db.sessionCategory.findUnique({ where: { code: "BU" }, select: { id: true, isActive: true } });
  return bu?.isActive ? bu.id : null;
}

export async function taoCaseVaXep(
  actor: Actor,
  p: {
    needIds: string[];
    ymd: string;
    startTime: string;
    endTime: string;
    roomId: string | null;
    teacherId: string;
    note: string | null;
  },
): Promise<string> {
  const dong = await kiemDongXep(actor, p.needIds);
  const dau = dong[0]!;
  const centerId = dau.centerId!;
  const gv = await gvTrongCa(actor, { centerId, ymd: p.ymd, startTime: p.startTime, endTime: p.endTime });
  if (!gv.ds.some((g) => g.id === p.teacherId)) {
    throw new LoiHocBu(gv.lyDoRong ?? "Giáo viên này không có ca làm phủ khung giờ bù");
  }
  if (p.roomId) {
    const phong = await scopedDb(actor).room.findFirst({
      where: { id: p.roomId, centerId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!phong) throw new LoiHocBu("Phòng không thuộc cơ sở này");
  }
  const sessionCategoryId = await phanLoaiBu();

  const caseId = await db.$transaction(async (tx) => {
    const c = await tx.makeupCase.create({
      data: {
        centerId,
        courseId: dau.courseId,
        lessonId: dau.lessonId!,
        date: ngayTuYmd(p.ymd),
        startTime: p.startTime,
        endTime: p.endTime,
        roomId: p.roomId,
        teacherId: p.teacherId,
        sessionCategoryId,
        note: p.note,
        createdById: actor.userId,
      },
      select: { id: true, orgUnitId: true },
    });
    await ghiBeVaoCase(tx, c, centerId, dong, actor.userId);
    return c.id;
  });
  // SAU commit, không bao giờ ném (lib/hoc-bu/bao-gv-db.ts).
  await baoGvCaBu("ca-moi", caseId, actor.userId);
  return caseId;
}

export async function xepVaoCaseCoSan(actor: Actor, p: { caseId: string; needIds: string[] }): Promise<void> {
  const dong = await kiemDongXep(actor, p.needIds);
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: p.caseId },
    select: { id: true, orgUnitId: true, centerId: true, courseId: true, lessonId: true, status: true },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  const nhan = caseNhanThem(c, dong[0]!);
  if (!nhan.ok) throw new LoiHocBu(nhan.lyDo);
  await db.$transaction(async (tx) => {
    await ghiBeVaoCase(tx, c, c.centerId, dong, actor.userId);
  });
  await baoGvCaBu("them-hv", c.id, actor.userId);
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function ghiBeVaoCase(
  tx: Tx,
  c: { id: string; orgUnitId: string | null },
  centerId: string,
  dong: DongCanBu[],
  addedById: string,
): Promise<void> {
  // Cổng chống đua đứng TRƯỚC: chỉ dòng còn PENDING mới chuyển; lệch số ⇒ throw ⇒ rollback cả case.
  const doi = await tx.makeupNeed.updateMany({
    where: { id: { in: dong.map((d) => d.id) }, status: "PENDING", waivedAt: null },
    data: { status: "SCHEDULED" },
  });
  if (doi.count !== dong.length) throw new LoiHocBu("Có học viên vừa được người khác xếp — tải lại trang");
  await tx.makeupCaseStudent.createMany({
    data: dong.map((d) => ({
      caseId: c.id,
      makeupNeedId: d.id,
      centerId,
      orgUnitId: c.orgUnitId,
      dungLuot: d.xep.ok && d.xep.dungLuot,
      addedById,
    })),
  });
}

/** Gỡ bé khỏi case (chưa điểm danh) ⇒ dòng cần bù quay lại danh sách. */
export async function goKhoiCase(actor: Actor, caseStudentId: string): Promise<void> {
  const cs = await scopedDb(actor).makeupCaseStudent.findUnique({
    where: { id: caseStudentId },
    select: { id: true, status: true, makeupNeedId: true, case: { select: { status: true } } },
  });
  if (!cs) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (cs.status !== "PLACED" || cs.case.status !== "SCHEDULED") {
    throw new LoiHocBu("Học viên đã được điểm danh — không gỡ được");
  }
  await db.$transaction(async (tx) => {
    const xoa = await tx.makeupCaseStudent.deleteMany({ where: { id: cs.id, status: "PLACED" } });
    if (xoa.count !== 1) throw new LoiHocBu("Học viên vừa được điểm danh — tải lại trang");
    await tx.makeupNeed.update({ where: { id: cs.makeupNeedId }, data: { status: "PENDING" } });
  });
}

/**
 * Điểm danh MỘT bé ở buổi bù (chỉ lần đầu — `PLACED`).
 *   · Có mặt ⇒ buổi vắng gốc ĐÃ BÙ (MakeupNeed COMPLETED, Attendance MADE_UP), tiêu lượt nếu
 *     bé được xếp bằng lượt.
 *   · Vắng ⇒ dòng quay về danh sách cần bù, KHÔNG tiêu lượt; phí đã thu vẫn giữ (chốt 5).
 * Khi không còn bé nào chưa điểm danh: case COMPLETED nếu có ít nhất một bé có mặt, ngược lại
 * CANCELLED (không ai tới thì không sinh công dạy).
 */
export async function diemDanhBu(
  actor: Actor | null,
  p: { caseStudentId: string; coMat: boolean; chiGiaoVien?: string },
): Promise<void> {
  const chon = {
    id: true,
    status: true,
    dungLuot: true,
    caseId: true,
    case: { select: { status: true, teacherId: true } },
    makeupNeed: { select: { id: true, studentId: true, missedSessionId: true } },
  } as const;
  // Admin: đọc qua scopedDb (cách ly cơ sở). Site GV (`actor = null`): đọc trần rồi cổng
  // `chiGiaoVien` bên dưới chốt "đúng giáo viên của case" — GV dạy case ở cơ sở khác cơ sở neo
  // vai vẫn phải điểm danh được (cùng lý do bản vá site GV 68f9b0c5).
  const cs = actor
    ? await scopedDb(actor).makeupCaseStudent.findUnique({ where: { id: p.caseStudentId }, select: chon })
    : await db.makeupCaseStudent.findUnique({ where: { id: p.caseStudentId }, select: chon });
  if (!cs) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (!actor && p.chiGiaoVien === undefined) throw new LoiHocBu("Thiếu người điểm danh");
  if (p.chiGiaoVien !== undefined && cs.case.teacherId !== p.chiGiaoVien) {
    throw new LoiHocBu("Bạn không phải giáo viên của buổi bù này");
  }
  if (cs.case.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ");
  if (cs.status !== "PLACED") throw new LoiHocBu("Học viên này đã được điểm danh");

  const now = new Date();
  await db.$transaction(async (tx) => {
    const doi = await tx.makeupCaseStudent.updateMany({
      where: { id: cs.id, status: "PLACED" },
      data: { status: p.coMat ? "PRESENT" : "ABSENT" },
    });
    if (doi.count !== 1) throw new LoiHocBu("Học viên vừa được điểm danh — tải lại trang");

    if (p.coMat) {
      await tx.makeupNeed.update({
        where: { id: cs.makeupNeed.id },
        data: { status: "COMPLETED", completedAt: now, usedQuota: cs.dungLuot },
      });
      // Chốt 29/09: "buổi trước đánh vắng, buổi bù đánh có mặt thì database cập nhật đồng loạt là
      // có mặt". Đổi `status` sang PRESENT NHƯNG giữ dấu `MADE_UP` — thống kê chuyên cần và lịch sử
      // vẫn biết đây là buổi học BÙ, không phải học đúng buổi.
      await tx.attendance.updateMany({
        where: { sessionId: cs.makeupNeed.missedSessionId, studentId: cs.makeupNeed.studentId },
        data: { status: "PRESENT", makeupStatus: "MADE_UP" },
      });
    } else {
      await tx.makeupNeed.update({
        where: { id: cs.makeupNeed.id },
        data: { status: "PENDING", completedAt: null, usedQuota: false },
      });
    }

    const conCho = await tx.makeupCaseStudent.count({ where: { caseId: cs.caseId, status: "PLACED" } });
    if (conCho === 0) {
      const coMat = await tx.makeupCaseStudent.count({ where: { caseId: cs.caseId, status: "PRESENT" } });
      await tx.makeupCase.update({
        where: { id: cs.caseId },
        data: coMat > 0 ? { status: "COMPLETED", completedAt: now } : { status: "CANCELLED" },
      });
    }
  });
}

/** Huỷ case chưa điểm danh ⇒ mọi bé quay về danh sách cần bù. */
export async function huyCase(actor: Actor, caseId: string): Promise<void> {
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, students: { select: { id: true, status: true, makeupNeedId: true } } },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  if (c.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ");
  if (c.students.some((s) => s.status !== "PLACED")) {
    throw new LoiHocBu("Case đã có bé được điểm danh — không huỷ được, hãy điểm danh nốt");
  }
  await db.$transaction(async (tx) => {
    const doi = await tx.makeupCase.updateMany({ where: { id: c.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    if (doi.count !== 1) throw new LoiHocBu("Case vừa đổi trạng thái — tải lại trang");
    const needIds = c.students.map((s) => s.makeupNeedId);
    await tx.makeupCaseStudent.deleteMany({ where: { caseId: c.id, status: "PLACED" } });
    if (needIds.length) {
      await tx.makeupNeed.updateMany({ where: { id: { in: needIds }, status: "SCHEDULED" }, data: { status: "PENDING" } });
    }
  });
  await baoGvCaBu("huy", c.id, actor.userId);
}

/**
 * Tạo PHÍ HỌC BÙ khi hết lượt (chốt 6): một đơn một dòng `MAKEUP_FEE`, giá = giá niêm yết
 * MỘT buổi của khoá — cùng phép `giaMoiBuoi` mà màn tạo đơn in "đ/buổi". Đơn có phiếu thu
 * + QR ngay (`ensureFullOrderRequest`), tiền về đi đúng đường đối khớp hiện có.
 */
export async function taoPhiBu(actor: Actor, needId: string): Promise<{ orderId: string }> {
  const [d] = await docDongTheoId(scopedDb(actor), [needId]);
  if (!d) throw new LoiHocBu("Không tìm thấy buổi cần bù");
  if (d.phi.loai !== "CAN_THU") {
    throw new LoiHocBu(d.phi.loai === "CHO_THU" ? "Đã có phí bù đang chờ thu" : "Học viên này chưa cần thu phí bù");
  }
  const [khoa, hv] = await Promise.all([
    db.course.findUnique({ where: { id: d.courseId }, select: { price: true, totalSessions: true, name: true } }),
    db.student.findUnique({ where: { id: d.studentId }, select: { name: true, parentName: true, parentPhone: true } }),
  ]);
  const gia = khoa?.price && khoa.totalSessions ? giaMoiBuoi(khoa.price, khoa.totalSessions) : 0;
  if (gia <= 0) throw new LoiHocBu("Khoá chưa có giá niêm yết hoặc số buổi — không tính được giá một buổi");
  if (!hv) throw new LoiHocBu("Không tìm thấy học viên");

  return db.$transaction(async (tx) => {
    const order = await withUniqueRetry(async () =>
      tx.order.create({
        data: {
          code: await generateOrderCode(tx),
          type: "COURSE",
          status: "PENDING_PAYMENT",
          customerName: hv.parentName ?? hv.name,
          customerPhone: hv.parentPhone ?? "",
          studentId: d.studentId,
          centerId: d.centerId,
          createdById: actor.userId,
          subtotal: gia,
          discountAmount: 0,
          totalAmount: gia,
          internalNote: `Phí học bù — ${d.hocVien} · ${d.buoiVang ?? "buổi vắng"}`,
          items: {
            create: [
              {
                type: "MAKEUP_FEE",
                itemName: `Phí học bù ${khoa?.name ?? ""} — ${d.buoiVang ?? "1 buổi"}`.trim(),
                quantity: 1,
                unitPrice: gia,
                totalPrice: gia,
                studentId: d.studentId,
              },
            ],
          },
        },
        select: { id: true, code: true, totalAmount: true, centerId: true, items: { select: { id: true } } },
      }),
    );
    await ensureFullOrderRequest(tx, order);
    const gan = await tx.makeupNeed.updateMany({
      where: { id: d.id, status: "PENDING" },
      data: { feeOrderItemId: order.items[0]!.id },
    });
    if (gan.count !== 1) throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
    return { orderId: order.id };
  });
}

/** Miễn phí ngoại lệ (QLCS + Admin; "Giám đốc" = vai Admin — quyền hỏi ở action), bắt buộc lý do. */
export async function mienPhiBu(actor: Actor, p: { needId: string; lyDo: string }): Promise<void> {
  const [d] = await docDongTheoId(scopedDb(actor), [p.needId]);
  if (!d) throw new LoiHocBu("Không tìm thấy buổi cần bù");
  if (d.phi.loai === "LUOT" || d.phi.loai === "DA_THU" || d.phi.loai === "MIEN_PHI") {
    throw new LoiHocBu("Học viên này không cần miễn phí (còn lượt hoặc đã thu)");
  }
  const doi = await db.makeupNeed.updateMany({
    where: { id: d.id, status: "PENDING", freeApprovedAt: null },
    data: { freeApprovedAt: new Date(), freeApprovedById: actor.userId, freeReason: p.lyDo },
  });
  if (doi.count !== 1) throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
}

/**
 * Bé trong case để NHẬN XÉT — chỉ bé ĐÃ CÓ MẶT ở buổi bù (bé vắng thì không có buổi để nhận xét).
 * Trả buổi VẮNG gốc: nhận xét ghi vào đó "như nhập ở buổi chính" (chốt 29/09).
 * `chiGiaoVien` (site GV) chốt "đúng giáo viên của case"; admin đọc qua scopedDb.
 */
export async function beDeNhanXet(
  actor: Actor | null,
  p: { caseStudentId: string; chiGiaoVien?: string },
): Promise<{ missedSessionId: string; studentId: string; caseId: string }> {
  const chon = {
    status: true,
    caseId: true,
    case: { select: { status: true, teacherId: true } },
    makeupNeed: { select: { studentId: true, missedSessionId: true } },
  } as const;
  const cs = actor
    ? await scopedDb(actor).makeupCaseStudent.findUnique({ where: { id: p.caseStudentId }, select: chon })
    : await db.makeupCaseStudent.findUnique({ where: { id: p.caseStudentId }, select: chon });
  if (!cs) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (!actor && p.chiGiaoVien === undefined) throw new LoiHocBu("Thiếu người nhận xét");
  if (p.chiGiaoVien !== undefined && cs.case.teacherId !== p.chiGiaoVien) {
    throw new LoiHocBu("Bạn không phải giáo viên của buổi bù này");
  }
  if (cs.case.status === "CANCELLED") throw new LoiHocBu("Case đã huỷ");
  if (cs.status !== "PRESENT") throw new LoiHocBu("Chỉ nhận xét bé đã có mặt ở buổi bù — điểm danh trước");
  return { missedSessionId: cs.makeupNeed.missedSessionId, studentId: cs.makeupNeed.studentId, caseId: cs.caseId };
}
