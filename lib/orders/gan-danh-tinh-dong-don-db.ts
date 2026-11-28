// lib/orders/gan-danh-tinh-dong-don-db.ts — GẮN DANH TÍNH CHO DÒNG ĐƠN CỦA MỘT LEAD (phần DB) [25/10/2026].
//
// Luật ở `gan-danh-tinh-dong-don.ts` (thuần, có test). Ở đây chỉ NẠP đầu vào, GHI kết quả, và để lại dấu vết.
// Chạy TRONG transaction của `convertLeadV2`, SAU khi Enrollment đã tạo và TRƯỚC `linkRecordedPaymentsToEnrollments`:
//   · TRƯỚC có chủ đích — phép chia tiền (`chiaKhoanTheoDon`) ưu tiên bậc "theo học viên", rồi mới "theo khoá".
//     Dòng đơn chưa có học viên thì hai anh/chị/em CÙNG KHOÁ rơi hết vào bậc "theo khoá" và khoản của bé này bị
//     chia sang ghi danh của bé kia (`[CVG-02]`). Có danh tính trên dòng thì bậc đúng chạy được; dòng nào mơ hồ
//     không được gắn thì phép chia rơi về hành vi cũ y nguyên.
//   · KHÔNG đụng Payment, giá, ghi danh, Receipt, hoa hồng. Chỉ ba cột: `OrderItem.studentId`,
//     `OrderItem.enrollmentId`, `Order.studentId` — và chỉ khi chúng đang NULL (`updateMany` có điều kiện).
//
// Mơ hồ ⇒ BỎ QUA (không ném): chốt lead không được hỏng vì không gắn được danh tính; phần bỏ qua để lại
// một dòng audit `GAN_DANH_TINH_DON_BO_QUA` cho người rà. Bài học PHASE A: đừng đoán, nhưng cũng đừng im lặng.
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import {
  lapKeHoachGanDanhTinh,
  type DongCanXet,
  type GhiDanhUngVien,
  type KeHoachGanDanhTinh,
} from "@/lib/orders/gan-danh-tinh-dong-don";

type Tx = Prisma.TransactionClient;

export type KetQuaGanDanhTinh = {
  dong: number;
  don: number;
  boQua: KeHoachGanDanhTinh["boQua"];
};

const VONG_RONG: KetQuaGanDanhTinh = { dong: 0, don: 0, boQua: [] };

export async function ganDanhTinhDongDonCuaLead(
  tx: Tx,
  params: { leadId: string; actor: AuditActor; orderId?: string },
): Promise<KetQuaGanDanhTinh> {
  const { leadId, actor } = params;

  // Đơn khoá học còn nhận tiền của lead (cùng bộ lọc với `dongDonCuaLead`: đơn nháp/huỷ/hoàn không phải suất học).
  const don = await tx.order.findMany({
    where: {
      leadId,
      type: "COURSE",
      ...locDonNhanTien(),
      ...(params.orderId ? { id: params.orderId } : {}),
    },
    select: {
      id: true,
      centerId: true,
      leadChildId: true,
      studentId: true,
      items: {
        select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true },
      },
    },
  });
  if (don.length === 0) return VONG_RONG;

  const dong: DongCanXet[] = [];
  for (const o of don) {
    const khoa = o.items.filter((it) => it.type === "COURSE_ENROLLMENT");
    for (const it of khoa) {
      dong.push({
        itemId: it.id,
        orderId: o.id,
        orderCenterId: o.centerId,
        orderLeadChildId: o.leadChildId,
        soDongCuaDon: o.items.length,
        soDongKhongPhaiKhoa: o.items.length - khoa.length,
        leadChildId: docConLeadTuMetadata(it.metadata),
        courseId: docHinhThucLop(it.metadata).courseId,
        studentId: it.studentId,
        enrollmentId: it.enrollmentId,
        orderStudentId: o.studentId,
      });
    }
  }
  if (dong.every((d) => d.studentId && d.enrollmentId)) return VONG_RONG;

  // Chỉ nhận bé THUỘC lead này: `metadata.leadChildId` do client gửi (đã gác lúc tạo đơn, nhưng đây là
  // cổng ghi danh tính — không tin lần hai).
  const beUng = [
    ...new Set(
      dong.flatMap((d) => [d.leadChildId, d.orderLeadChildId]).filter((x): x is string => !!x),
    ),
  ];
  const beCuaLead =
    beUng.length === 0
      ? []
      : await tx.leadChild.findMany({ where: { id: { in: beUng }, leadId }, select: { id: true } });
  const beHopLe = new Set(beCuaLead.map((b) => b.id));
  const dongHopLe = dong.map((d) => ({
    ...d,
    leadChildId: d.leadChildId && beHopLe.has(d.leadChildId) ? d.leadChildId : null,
    orderLeadChildId: d.orderLeadChildId && beHopLe.has(d.orderLeadChildId) ? d.orderLeadChildId : null,
  }));

  const ghiDanhRaw =
    beHopLe.size === 0
      ? []
      : await tx.enrollment.findMany({
          where: {
            deletedAt: null,
            leadChildId: { in: [...beHopLe] },
            student: { deletedAt: null },
          },
          select: {
            id: true,
            studentId: true,
            leadChildId: true,
            courseId: true,
            centerId: true,
            status: true,
          },
        });
  // Không có ghi danh nào thì planner tự ra mã bỏ qua đúng (KHONG_CAU_NOI_BE / CHUA_CO_GHI_DANH) — không rẽ nhánh ở đây.
  const dangGiu =
    ghiDanhRaw.length === 0
      ? []
      : await tx.orderItem.findMany({
          where: { enrollmentId: { in: ghiDanhRaw.map((g) => g.id) } },
          select: { id: true, enrollmentId: true },
        });
  const giuTheoGhiDanh = new Map<string, Set<string>>();
  for (const g of dangGiu) {
    if (!g.enrollmentId) continue;
    const s = giuTheoGhiDanh.get(g.enrollmentId) ?? new Set<string>();
    s.add(g.id);
    giuTheoGhiDanh.set(g.enrollmentId, s);
  }
  const ghiDanh: GhiDanhUngVien[] = ghiDanhRaw.map((g) => ({
    enrollmentId: g.id,
    studentId: g.studentId,
    leadChildId: g.leadChildId,
    courseId: g.courseId,
    centerId: g.centerId,
    status: String(g.status),
    dongKhacDangGiu: giuTheoGhiDanh.get(g.id) ?? new Set<string>(),
    // Hai lưới của đường TẠO ĐƠN TAY không áp cho convert: tập rỗng (planner chỉ đọc chúng khi `cauNoiHocVien`).
    donCoKhoanThu: new Set<string>(),
    dongDongCapChuaGan: new Set<string>(),
  }));

  const keHoach = lapKeHoachGanDanhTinh(dongHopLe, ghiDanh, { cauNoiHocVien: false });
  const ghi = await ghiKeHoachGanDanhTinh(tx, { actor, don, keHoach, nguon: "convert-lead" });

  await ghiBoQua(tx, { leadId, actor, boQua: keHoach.boQua });
  return { dong: ghi.dong, don: ghi.don, boQua: keHoach.boQua };
}

/**
 * PHẦN GHI dùng chung cho mọi đường (convert · tạo đơn tay · ghi danh sinh sau): chỉ BA cột, mỗi lời ghi có điều kiện
 * «đang NULL» trong `where` — hai lượt đua nhau không đè nhau và không bao giờ đè giá trị có sẵn. Kèm MỘT dòng audit/đơn.
 */
export async function ghiKeHoachGanDanhTinh(
  tx: Tx,
  params: {
    actor: AuditActor;
    don: readonly { id: string; centerId: string | null; studentId: string | null }[];
    keHoach: KeHoachGanDanhTinh;
    /** Nhãn đường gọi, ghi vào audit (`convert-lead` · `tao-don-tay` · …). */
    nguon: string;
  },
): Promise<{ dong: number; don: number }> {
  const { actor, keHoach } = params;
  const don = params.don;
  let soDong = 0;
  const theoDon = new Map<string, { itemId: string; studentId?: string; enrollmentId?: string }[]>();
  for (const p of keHoach.dong) {
    // Điều kiện "đang NULL" nằm TRONG where: hai lượt đua nhau không đè nhau, và không bao giờ đè giá trị có sẵn.
    let ghi = false;
    if (p.studentId) {
      const r = await tx.orderItem.updateMany({
        where: { id: p.itemId, studentId: null },
        data: { studentId: p.studentId },
      });
      ghi = ghi || r.count > 0;
    }
    if (p.enrollmentId) {
      const r = await tx.orderItem.updateMany({
        where: { id: p.itemId, enrollmentId: null },
        data: { enrollmentId: p.enrollmentId },
      });
      ghi = ghi || r.count > 0;
    }
    if (ghi) {
      soDong++;
      const ds = theoDon.get(p.orderId) ?? [];
      ds.push({ itemId: p.itemId, studentId: p.studentId, enrollmentId: p.enrollmentId });
      theoDon.set(p.orderId, ds);
    }
  }

  let soDon = 0;
  const donStudent = new Map(keHoach.don.map((d) => [d.orderId, d.studentId]));
  for (const o of don) {
    const dsDong = theoDon.get(o.id) ?? [];
    const studentId = donStudent.get(o.id) ?? null;
    let ghiDon = false;
    if (studentId) {
      const r = await tx.order.updateMany({ where: { id: o.id, studentId: null }, data: { studentId } });
      ghiDon = r.count > 0;
      if (ghiDon) soDon++;
    }
    if (dsDong.length === 0 && !ghiDon) continue;
    await writeAudit({
      actor,
      module: "orders",
      entityType: "Order",
      entityId: o.id,
      action: "GAN_DANH_TINH_DON",
      oldValues: { studentId: o.studentId },
      newValues: { studentId: ghiDon ? studentId : o.studentId, dong: dsDong, nguon: params.nguon },
      orgUnitId: o.centerId,
      tx,
    });
  }
  return { dong: soDong, don: soDon };
}

async function ghiBoQua(
  tx: Tx,
  params: { leadId: string; actor: AuditActor; boQua: KeHoachGanDanhTinh["boQua"] },
): Promise<void> {
  if (params.boQua.length === 0) return;
  await writeAudit({
    actor: params.actor,
    module: "orders",
    entityType: "Lead",
    entityId: params.leadId,
    action: "GAN_DANH_TINH_DON_BO_QUA",
    newValues: { boQua: params.boQua, nguon: "convert-lead" },
    tx,
  });
}
