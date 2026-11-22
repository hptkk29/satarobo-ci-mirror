// lib/orders/gan-danh-tinh-don-tay-db.ts — GẮN DANH TÍNH CHO DÒNG ĐƠN: hai đường NGOÀI convert [26/10/2026] (phần DB).
//
// Luật ở `gan-danh-tinh-dong-don.ts` (thuần, có test). Ở đây chỉ NẠP đầu vào, GỌI phần ghi dùng chung
// (`ghiKeHoachGanDanhTinh` — đúng BA cột, mỗi lời ghi có điều kiện «đang NULL»), và để lại dấu vết.
//
//   1. `ganDanhTinhDonMoiTao` — đơn lập TAY (`createOrderManualAction`) cho học viên ĐÃ có ghi danh (gia hạn, anh/chị/em,
//      mua thêm): chạy trong CÙNG transaction, SAU `order.create` và phiếu thu.
//   2. `ganDongDonMoCoiChoGhiDanh` — NỬA CÒN LẠI: ghi danh sinh SAU đơn (Sale lập đơn trước, giáo vụ xếp lớp sau). Chạy trong
//      CÙNG transaction tạo ghi danh.
//
// KHÔNG đụng Payment, giá, ghi danh, Receipt, hoa hồng — chỉ ĐỌC `Payment` để dựng lưới «ghi danh đã có tiền của đơn khác».
// Mơ hồ ⇒ BỎ QUA (không ném): tạo đơn / xếp lớp không được hỏng vì không gắn được danh tính. Chỉ các mã BỎ QUA «bất thường»
// (xem `MA_BAT_THUONG`) để lại dấu vết `GAN_DANH_TINH_DON_BO_QUA` — mã «bình thường» (đơn chưa có ghi danh, học viên chưa chọn…)
// sẽ đẻ một dòng audit cho MỖI đơn nếu ghi.
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
  type MaBoQua,
} from "@/lib/orders/gan-danh-tinh-dong-don";
import { ghiKeHoachGanDanhTinh } from "@/lib/orders/gan-danh-tinh-dong-don-db";

type Tx = Prisma.TransactionClient;

/** Mã BỎ QUA đáng để người rà biết (khác mã «bình thường»: chưa có bé / chưa có ghi danh / khác cơ sở). */
export const MA_BAT_THUONG: readonly MaBoQua[] = [
  "NHIEU_GHI_DANH",
  "GHI_DANH_DA_GAN_DONG_KHAC",
  "XUNG_DOT_LIEN_KET",
  "TRUNG_DONG",
  "GHI_DANH_CO_KHOAN_DON_KHAC",
  "DONG_DONG_CAP_CHUA_GAN",
];

export type KetQuaGanDonTay = {
  dong: number;
  don: number;
  boQua: KeHoachGanDanhTinh["boQua"];
  /** Lý do dừng SỚM trước khi lập kế hoạch (đường 2): `null` = đã lập kế hoạch. */
  dungSom: "KHONG_CO_GI_DE_GAN" | "DA_CO_GHI_DANH_KHAC_CUNG_KHOA" | null;
};

const RONG: KetQuaGanDonTay = { dong: 0, don: 0, boQua: [], dungSom: "KHONG_CO_GI_DE_GAN" };

type DonVoiDong = {
  id: string;
  centerId: string | null;
  leadChildId: string | null;
  studentId: string | null;
  items: { id: string; type: string; studentId: string | null; enrollmentId: string | null; metadata: unknown }[];
};

const SELECT_DON = {
  id: true,
  centerId: true,
  leadChildId: true,
  studentId: true,
  items: { select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true } },
} as const;

function dongCanXet(don: readonly DonVoiDong[]): DongCanXet[] {
  const ra: DongCanXet[] = [];
  for (const o of don) {
    const khoa = o.items.filter((it) => it.type === "COURSE_ENROLLMENT");
    for (const it of khoa) {
      ra.push({
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
  return ra;
}

type GhiDanhTho = {
  id: string;
  studentId: string;
  /** Khoá bé hiệu lực: `Enrollment.leadChildId`, rơi về `Student.leadChildId` (ghi danh tay không mang cột này). */
  leadChildId: string | null;
  courseId: string | null;
  centerId: string | null;
  status: string;
};

/**
 * Dựng `GhiDanhUngVien[]` kèm BA tập mà planner của đường tay đọc: dòng khác đang giữ · đơn khác đã có khoản thu · dòng đồng cấp chưa gắn.
 * `dongDangXet` = id các dòng đang được lập kế hoạch (loại khỏi «đồng cấp»).
 */
async function napGhiDanhUngVien(tx: Tx, ghiDanhTho: readonly GhiDanhTho[], dongDangXet: ReadonlySet<string>): Promise<GhiDanhUngVien[]> {
  if (ghiDanhTho.length === 0) return [];
  const ids = ghiDanhTho.map((g) => g.id);
  const [dangGiu, khoan] = await Promise.all([
    tx.orderItem.findMany({ where: { enrollmentId: { in: ids } }, select: { id: true, enrollmentId: true } }),
    tx.payment.findMany({ where: { enrollmentId: { in: ids }, deletedAt: null }, select: { enrollmentId: true, orderId: true } }),
  ]);
  const giu = new Map<string, Set<string>>();
  for (const x of dangGiu) {
    if (!x.enrollmentId) continue;
    const s = giu.get(x.enrollmentId) ?? new Set<string>();
    s.add(x.id);
    giu.set(x.enrollmentId, s);
  }
  const donCoKhoan = new Map<string, Set<string>>();
  for (const x of khoan) {
    if (!x.enrollmentId || !x.orderId) continue;
    const s = donCoKhoan.get(x.enrollmentId) ?? new Set<string>();
    s.add(x.orderId);
    donCoKhoan.set(x.enrollmentId, s);
  }

  // Lưới 2: dòng khoá học CHƯA gắn ghi danh của đơn KHÁC còn nhận tiền, cùng học viên/bé + cùng khoá + cùng cơ sở.
  const hocVien = [...new Set(ghiDanhTho.map((g) => g.studentId))];
  const be = [...new Set(ghiDanhTho.flatMap((g) => (g.leadChildId ? [g.leadChildId] : [])))];
  const cungCap = await tx.orderItem.findMany({
    where: {
      type: "COURSE_ENROLLMENT",
      enrollmentId: null,
      order: { type: "COURSE", ...locDonNhanTien() },
      OR: [
        { studentId: { in: hocVien } },
        // Đơn nhập lịch sử / backfill chỉ mang `Order.studentId` (dòng không có học viên lẫn metadata) — vẫn là ĐỐI THỦ của đơn mới (review độc lập 26/10: lưới 2 từng mù với chúng).
        { order: { studentId: { in: hocVien } } },
        ...be.flatMap((b) => [{ metadata: { path: ["leadChildId"], equals: b } }, { order: { leadChildId: b } }]),
      ],
    },
    select: { id: true, studentId: true, metadata: true, order: { select: { id: true, centerId: true, leadChildId: true, studentId: true } } },
  });
  const dongCap = new Map<string, Set<string>>();
  for (const k of cungCap) {
    if (dongDangXet.has(k.id)) continue;
    const khoaK = docHinhThucLop(k.metadata).courseId;
    const beK = docConLeadTuMetadata(k.metadata) ?? k.order.leadChildId;
    for (const g of ghiDanhTho) {
      const cungNguoi = k.studentId === g.studentId || k.order.studentId === g.studentId || (!!g.leadChildId && beK === g.leadChildId);
      // Dòng KHÔNG khai khoá ⇒ không loại được ⇒ tính là đối thủ (fail-closed).
      const cungKhoa = khoaK === null || khoaK === g.courseId;
      const cungCoSo = !!g.centerId && k.order.centerId === g.centerId;
      if (cungNguoi && cungKhoa && cungCoSo) {
        const s = dongCap.get(g.id) ?? new Set<string>();
        s.add(k.id);
        dongCap.set(g.id, s);
      }
    }
  }

  return ghiDanhTho.map((g) => ({
    enrollmentId: g.id,
    studentId: g.studentId,
    leadChildId: g.leadChildId,
    courseId: g.courseId,
    centerId: g.centerId,
    status: g.status,
    dongKhacDangGiu: giu.get(g.id) ?? new Set<string>(),
    donCoKhoanThu: donCoKhoan.get(g.id) ?? new Set<string>(),
    dongDongCapChuaGan: dongCap.get(g.id) ?? new Set<string>(),
  }));
}

async function ghiBoQuaBatThuong(tx: Tx, params: { actor: AuditActor; entityType: "Order" | "Enrollment"; entityId: string; boQua: KeHoachGanDanhTinh["boQua"]; nguon: string }): Promise<void> {
  const dang = params.boQua.filter((b) => MA_BAT_THUONG.includes(b.ma));
  if (dang.length === 0) return;
  await writeAudit({
    actor: params.actor,
    module: "orders",
    entityType: params.entityType,
    entityId: params.entityId,
    action: "GAN_DANH_TINH_DON_BO_QUA",
    newValues: { boQua: dang, nguon: params.nguon },
    tx,
  });
}

/**
 * ĐƯỜNG 1 — đơn lập TAY. `orderId` = đơn VỪA TẠO trong cùng transaction.
 * Không ném khi mơ hồ; lỗi DB thật thì ném như mọi phép đọc/ghi trong transaction.
 */
export async function ganDanhTinhDonMoiTao(tx: Tx, params: { orderId: string; actor: AuditActor }): Promise<KetQuaGanDonTay> {
  const o = await tx.order.findFirst({
    where: { id: params.orderId, type: "COURSE", ...locDonNhanTien() },
    select: { ...SELECT_DON, leadId: true },
  });
  if (!o) return RONG;
  const dong = dongCanXet([o]);
  if (dong.length === 0 || dong.every((d) => d.studentId && d.enrollmentId)) return RONG;

  // Bé trên dòng chỉ được tin khi THUỘC lead của đơn (metadata do client gửi; đã gác lúc tạo đơn nhưng đây là cổng ghi danh tính).
  const beUng = [...new Set(dong.flatMap((d) => [d.leadChildId, d.orderLeadChildId]).filter((x): x is string => !!x))];
  const beHopLe = new Set(
    beUng.length === 0 || !o.leadId
      ? []
      : (await tx.leadChild.findMany({ where: { id: { in: beUng }, leadId: o.leadId }, select: { id: true } })).map((b) => b.id),
  );
  const dongHopLe = dong.map((d) => ({
    ...d,
    leadChildId: d.leadChildId && beHopLe.has(d.leadChildId) ? d.leadChildId : null,
    orderLeadChildId: d.orderLeadChildId && beHopLe.has(d.orderLeadChildId) ? d.orderLeadChildId : null,
  }));
  const hocVien = [...new Set(dong.flatMap((d) => (d.studentId ? [d.studentId] : [])))];
  if (hocVien.length === 0 && beHopLe.size === 0) return RONG;

  const raw = await tx.enrollment.findMany({
    where: {
      deletedAt: null,
      student: { deletedAt: null },
      OR: [...(hocVien.length ? [{ studentId: { in: hocVien } }] : []), ...(beHopLe.size ? [{ leadChildId: { in: [...beHopLe] } }] : [])],
    },
    select: { id: true, studentId: true, leadChildId: true, courseId: true, centerId: true, status: true },
  });
  const ghiDanh = await napGhiDanhUngVien(
    tx,
    raw.map((g) => ({ id: g.id, studentId: g.studentId, leadChildId: g.leadChildId, courseId: g.courseId, centerId: g.centerId, status: String(g.status) })),
    new Set(dong.map((d) => d.itemId)),
  );
  const keHoach = lapKeHoachGanDanhTinh(dongHopLe, ghiDanh, { cauNoiHocVien: true });
  const ghi = await ghiKeHoachGanDanhTinh(tx, { actor: params.actor, don: [o], keHoach, nguon: "tao-don-tay" });
  await ghiBoQuaBatThuong(tx, { actor: params.actor, entityType: "Order", entityId: o.id, boQua: keHoach.boQua, nguon: "tao-don-tay" });
  return { dong: ghi.dong, don: ghi.don, boQua: keHoach.boQua, dungSom: null };
}

/**
 * ĐƯỜNG 2 — ghi danh VỪA TẠO (cùng transaction). Tìm các đơn khoá học còn nhận tiền của CHÍNH học viên đó (theo `studentId` trên dòng, hoặc theo
 * khoá bé của học viên khi dòng chưa có học viên) mà dòng khoá học CHƯA gắn ghi danh, rồi để planner quyết — cùng luật, cùng hai lưới.
 *
 * Thêm một cổng riêng của hướng này: học viên đã có ghi danh KHÁC cùng khoá (mọi trạng thái, còn sống) ⇒ DỪNG, vì đây có thể là học lại và dòng đơn
 * mồ côi nhiều khả năng thuộc LẦN HỌC CŨ — gắn vào ghi danh mới là gắn nhầm lịch sử.
 */
export async function ganDongDonMoCoiChoGhiDanh(tx: Tx, params: { enrollmentId: string; actor: AuditActor }): Promise<KetQuaGanDonTay> {
  const e = await tx.enrollment.findFirst({
    where: { id: params.enrollmentId, deletedAt: null, student: { deletedAt: null } },
    select: { id: true, studentId: true, leadChildId: true, courseId: true, centerId: true, status: true, student: { select: { leadChildId: true, leadId: true } } },
  });
  if (!e || !e.courseId || !e.centerId) return RONG;

  const khac = await tx.enrollment.count({ where: { studentId: e.studentId, courseId: e.courseId, deletedAt: null, id: { not: e.id } } });
  if (khac > 0) return { ...RONG, dungSom: "DA_CO_GHI_DANH_KHAC_CUNG_KHOA" };

  const be = e.leadChildId ?? e.student.leadChildId;
  // Nối theo BÉ chỉ khi đơn cùng lead với học viên (metadata do client gửi lúc tạo đơn — không tin lần hai, như đường convert).
  const leadHocVien = e.student.leadId;
  const don = await tx.order.findMany({
    where: {
      type: "COURSE",
      centerId: e.centerId,
      ...locDonNhanTien(),
      items: {
        some: {
          type: "COURSE_ENROLLMENT",
          enrollmentId: null,
          OR: [
            { studentId: e.studentId },
            ...(be && leadHocVien ? [{ studentId: null, metadata: { path: ["leadChildId"], equals: be }, order: { leadId: leadHocVien } }] : []),
            ...(be && leadHocVien ? [{ studentId: null, order: { leadChildId: be, leadId: leadHocVien } }] : []),
          ],
        },
      },
    },
    select: SELECT_DON,
  });
  if (don.length === 0) return RONG;
  const dong = dongCanXet(don);

  // Ứng viên = CHÍNH ghi danh này (học viên chỉ có đúng một ghi danh cùng khoá — cổng ở trên). Khoá bé hiệu lực = cột của ghi danh, rơi về cột của học viên.
  const ghiDanh = await napGhiDanhUngVien(
    tx,
    [{ id: e.id, studentId: e.studentId, leadChildId: be, courseId: e.courseId, centerId: e.centerId, status: String(e.status) }],
    new Set(dong.map((d) => d.itemId)),
  );
  const keHoach = lapKeHoachGanDanhTinh(dong, ghiDanh, { cauNoiHocVien: true });
  const ghi = await ghiKeHoachGanDanhTinh(tx, { actor: params.actor, don, keHoach, nguon: "ghi-danh-moi" });
  await ghiBoQuaBatThuong(tx, { actor: params.actor, entityType: "Enrollment", entityId: e.id, boQua: keHoach.boQua, nguon: "ghi-danh-moi" });
  return { dong: ghi.dong, don: ghi.don, boQua: keHoach.boQua, dungSom: null };
}
