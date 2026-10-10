// lib/hoa-hong/phan-loai-giao-dich-db.ts — NẠP dữ liệu cho bộ phân loại giao dịch (CHỈ ĐỌC).
//
// Hàm quyết định là `phanLoaiGiaoDich` (thuần). File này chỉ trả lời "dữ liệu nào đáng tin" bằng
// những cột ĐÃ ĐO là có thật (04 §4.4, 01 §156):
//
//   học viên của dòng  : `OrderItem.studentId` → `Enrollment.studentId` (qua `OrderItem.enrollmentId`)
//                        → `Order.leadChildId` ↔ `Student.leadChildId` khi khớp ĐÚNG MỘT.
//                        `Student.leadId` KHÔNG tham gia quyết học viên — nó chỉ để dò phụ huynh hiện hữu.
//   thực thu           : `WHERE_THUC_THU` (A1) — định nghĩa duy nhất, không viết bộ lọc thứ hai.
//   tái tục            : `Enrollment.renewedFromEnrollmentId` (cờ tay).
//   đổi khoá/cơ sở/lớp : `Enrollment.transferredToId` hai chiều + so `courseId`/`centerId`.
//   bảo lưu            : `StudentReserve` của ghi danh.
//   dừng học           : `OrderItem.status = STOPPED`.
//
// ⚠️ KHÔNG ghi gì. Việc lưu kết quả (`StudentTransaction`) là của lớp ghi sổ (PR5) — hàm này trả
// đầu vào cho hàm thuần, và `phanLoaiDongDon` trả luôn kết quả để người gọi lưu.
//
// ⚠️ `client` là tham số BẮT BUỘC, không mặc định (luật 7): cho gọi trong `$transaction` (thấy dữ
// liệu chưa commit) hoặc với client thường. Client ở đây là client KHÔNG scope — engine hoa hồng
// phân loại theo học viên trên toàn hệ thống, không theo tầm nhìn cơ sở của người bấm.
import type { Prisma, PrismaClient } from "@prisma/client";

import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { phoneVariants } from "@/lib/phone";

import { thanhPhanTheoLoaiDong } from "./loai-giao-dich";
import {
  phanLoaiGiaoDich,
  tinhPhuHuynhHienHuu,
  type DauVaoPhanLoai,
  type GhiDanhPhanLoai,
  type KetQuaPhanLoai,
  type LanMuaTruoc,
} from "./phan-loai-giao-dich";
import { quyThucThuTheoDong, type DongCuaDon } from "./quy-thuc-thu";

export type KhachDoc = PrismaClient | Prisma.TransactionClient;

const LOAI_DONG_HOC_PHI = ["COURSE_ENROLLMENT", "COURSE_PACKAGE"] as const;

/**
 * Dựng `LanMuaTruoc[]` cho một tập học viên: mọi dòng học phí của họ + thực thu quy về từng dòng.
 * Trả `Map<studentId, LanMuaTruoc[]>`. Một câu cho dòng + một câu cho dòng-cùng-đơn + một câu cho
 * bút toán — không N+1.
 */
export async function docLanMuaTheoHocVien(
  client: KhachDoc,
  studentIds: readonly string[],
): Promise<Map<string, LanMuaTruoc[]>> {
  const ketQua = new Map<string, LanMuaTruoc[]>();
  for (const id of studentIds) ketQua.set(id, []);
  if (studentIds.length === 0) return ketQua;

  const dongs = await client.orderItem.findMany({
    where: {
      type: { in: [...LOAI_DONG_HOC_PHI] },
      OR: [{ studentId: { in: [...studentIds] } }, { enrollment: { studentId: { in: [...studentIds] } } }],
    },
    select: {
      id: true,
      orderId: true,
      studentId: true,
      enrollment: { select: { studentId: true } },
      // Mốc "lần mua" = NGÀY CỦA ĐƠN. `OrderItem.createdAt` là lúc dòng được GHI: đường nhập đơn lịch sử (`ghi-giao-dich-cu`) đặt
      // `Order.createdAt` = ngày thật trong sheet nhưng không truyền `createdAt` cho dòng lồng bên trong ⇒ dòng mang giờ nhập.
      order: { select: { status: true, createdAt: true } },
    },
  });
  if (dongs.length === 0) return ketQua;

  const orderIds = [...new Set(dongs.map((d) => d.orderId))];
  const [tatCaDong, butToan] = await Promise.all([
    client.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, orderId: true, type: true, enrollmentId: true },
    }),
    client.payment.findMany({
      where: { ...WHERE_THUC_THU, orderId: { in: orderIds } },
      select: { orderId: true, orderItemId: true, enrollmentId: true, amount: true },
    }),
  ]);

  const dongCuaDon: DongCuaDon[] = tatCaDong.map((d) => ({
    orderItemId: d.id,
    orderId: d.orderId,
    laHocPhi: (LOAI_DONG_HOC_PHI as readonly string[]).includes(d.type),
    enrollmentId: d.enrollmentId,
  }));
  const quy = quyThucThuTheoDong(dongCuaDon, butToan);

  for (const d of dongs) {
    const sid = d.studentId ?? d.enrollment?.studentId ?? null;
    if (sid === null || !ketQua.has(sid)) continue;
    const t = quy.get(d.id) ?? { thucThu: 0, moHo: false };
    ketQua.get(sid)!.push({
      orderItemId: d.id,
      orderId: d.orderId,
      taoLuc: d.order.createdAt,
      daHuy: d.order.status === "CANCELLED",
      thucThu: t.thucThu,
      moHo: t.moHo,
    });
  }
  return ketQua;
}

/**
 * Học viên của một dòng đơn — 04 §4.4 bước 1, 2, 4 (bước 3 "đơn có đúng một dòng học phí" là của
 * khoản thu, không phải của dòng). Trả `null` khi không ra, hoặc khi ra HAI học viên (mơ hồ).
 */
async function hocVienCuaDong(
  client: KhachDoc,
  dong: { studentId: string | null; enrollment: { studentId: string } | null; order: { leadChildId: string | null } },
): Promise<string | null> {
  if (dong.studentId) return dong.studentId;
  if (dong.enrollment?.studentId) return dong.enrollment.studentId;
  const leadChildId = dong.order.leadChildId;
  if (!leadChildId) return null;
  const khop = await client.student.findMany({
    where: { leadChildId, deletedAt: null },
    select: { id: true },
    take: 2,
  });
  return khop.length === 1 ? khop[0]!.id : null;
}

/** Nạp đầu vào cho `phanLoaiGiaoDich`. `null` = không có dòng đơn này. */
export async function docDauVaoPhanLoai(
  client: KhachDoc,
  input: { orderItemId: string; moc: Date },
): Promise<DauVaoPhanLoai | null> {
  const dong = await client.orderItem.findUnique({
    where: { id: input.orderItemId },
    select: {
      id: true,
      orderId: true,
      type: true,
      status: true,
      studentId: true,
      enrollmentId: true,
      order: { select: { leadId: true, leadChildId: true, createdAt: true } },
      enrollment: {
        select: {
          id: true,
          studentId: true,
          courseId: true,
          centerId: true,
          renewedFromEnrollmentId: true,
          transferredTo: { select: { id: true, courseId: true, centerId: true } },
          transferredFrom: { select: { id: true, courseId: true, centerId: true } },
          reserves: { select: { startedAt: true, endedAt: true } },
        },
      },
    },
  });
  if (!dong) return null;

  // Chưa biết loại dòng ⇒ coi là NGOÀI học phí (không tự coi là học phí).
  const thanhPhan = thanhPhanTheoLoaiDong(dong.type) ?? "OTHER";
  const studentId = await hocVienCuaDong(client, dong);

  const e = dong.enrollment;
  const ghiDanh: GhiDanhPhanLoai | null = e
    ? {
        id: e.id,
        courseId: e.courseId,
        centerId: e.centerId,
        renewedFromEnrollmentId: e.renewedFromEnrollmentId,
        chuyenTu: e.transferredFrom.map((x) => ({ enrollmentId: x.id, courseId: x.courseId, centerId: x.centerId })),
        chuyenDen: e.transferredTo
          ? { enrollmentId: e.transferredTo.id, courseId: e.transferredTo.courseId, centerId: e.transferredTo.centerId }
          : null,
        baoLuu: e.reserves.map((r) => ({ batDau: r.startedAt, ketThuc: r.endedAt })),
      }
    : null;

  let lanMuaTruoc: LanMuaTruoc[] = [];
  let ghiDanhMoCoi: { enrollmentId: string; taoLuc: Date }[] = [];
  let hocVien: { leadId: string | null; parentPhone: string | null } | null = null;
  let phuHuynh = { hienHuu: null as boolean | null, can: null as "CUNG_LEAD" | "CUNG_SDT" | null };

  if (studentId) {
    const [lanMua, moCoi, sv] = await Promise.all([
      docLanMuaTheoHocVien(client, [studentId]),
      client.enrollment.findMany({
        where: {
          studentId,
          deletedAt: null,
          orderItems: { none: {} },
          // Ghi danh đích/đã chuyển đi của một lượt chuyển CŨNG tính là "đã học mà chưa có đơn" — không
          // đoán là nó đã được nhận diện: dòng đang xét mà dính chuyển đã dừng ở bước 2 (PENDING/xem tay)
          // từ trước khi tới bước này, còn ca khác thì thà xem tay còn hơn gọi nhầm "lần mua đầu".
        },
        select: { id: true, createdAt: true },
      }),
      client.student.findUnique({ where: { id: studentId }, select: { leadId: true, parentPhone: true } }),
    ]);
    lanMuaTruoc = (lanMua.get(studentId) ?? []).filter((l) => l.orderItemId !== dong.id);
    ghiDanhMoCoi = moCoi.map((x) => ({ enrollmentId: x.id, taoLuc: x.createdAt }));
    hocVien = sv;

    const leadIds = [...new Set([sv?.leadId, dong.order.leadId].filter((x): x is string => !!x))];
    const sdt = phoneVariants(sv?.parentPhone ?? null);
    const coDinhDanh = leadIds.length > 0 || sdt.length > 0;
    const ungVien =
      coDinhDanh
        ? await client.student.findMany({
            where: {
              id: { not: studentId },
              deletedAt: null,
              OR: [
                ...(leadIds.length > 0 ? [{ leadId: { in: leadIds } }] : []),
                ...(sdt.length > 0 ? [{ parentPhone: { in: sdt } }] : []),
              ],
            },
            select: { id: true, leadId: true, parentPhone: true },
            take: 50,
          })
        : [];
    const lanMuaUngVien = await docLanMuaTheoHocVien(
      client,
      ungVien.map((u) => u.id),
    );
    const sdtChuan = new Set(sdt);
    phuHuynh = tinhPhuHuynhHienHuu({
      dong: { orderItemId: dong.id, orderId: dong.orderId, taoLuc: dong.order.createdAt },
      ungVien: ungVien.map((u) => ({
        studentId: u.id,
        cungLead: u.leadId !== null && leadIds.includes(u.leadId),
        cungSdt: u.parentPhone !== null && phoneVariants(u.parentPhone).some((v) => sdtChuan.has(v)),
        lanMua: lanMuaUngVien.get(u.id) ?? [],
      })),
      coDinhDanh,
    });
  }

  return {
    dong: {
      orderItemId: dong.id,
      orderId: dong.orderId,
      thanhPhan,
      trangThai: dong.status,
      taoLuc: dong.order.createdAt,
    },
    studentId,
    ghiDanh,
    lanMuaTruoc,
    ghiDanhMoCoi,
    phuHuynh,
    coLead: dong.order.leadId !== null || hocVien?.leadId != null,
    moc: input.moc,
  };
}

/** Nạp + phân loại MỘT dòng đơn. `null` = không có dòng đơn. */
export async function phanLoaiDongDon(
  client: KhachDoc,
  input: { orderItemId: string; moc: Date },
): Promise<KetQuaPhanLoai | null> {
  const dau = await docDauVaoPhanLoai(client, input);
  return dau ? phanLoaiGiaoDich(dau) : null;
}
