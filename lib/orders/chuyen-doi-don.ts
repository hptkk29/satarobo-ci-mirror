import "server-only";
import { db } from "@/lib/db";
import { dongPhamViDangBat } from "@/lib/entitlements/gate-xep-lop";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import {
  demBuoiDaQua,
  duocXep,
  xetXepVaoLop,
  type XetXepLop,
} from "@/lib/lms/xep-vao-lop";

// lib/orders/chuyen-doi-don.ts — nạp dữ liệu cho màn CHUYỂN ĐỔI (xếp học viên vào lớp).
//
// ── VÌ SAO ĐI TỪ ĐƠN, KHÔNG ĐI TỪ LEAD ──────────────────────────────────────────────
// Màn chuyển đổi cũ (`/admin/leads/[id]/convert`) lấy mọi thứ từ `Lead` + `LeadChild`.
// Đo `satarobo_local` 29/09/2026: **19/515 đơn có `leadId` (3,7%)**. Dùng lại đường ấy là
// tính năng chỉ phục vụ 4% đơn. Nên ĐƠN là nguồn chính; lead chỉ BỔ SUNG khi có.
//
// ── MỖI DÒNG ĐƠN = MỘT ĐỨA TRẺ, XẾP RIÊNG ───────────────────────────────────────────
// Chủ dự án: *"mỗi con xếp riêng để có thể chọn 2 lớp riêng cho 2 con hoặc 1 con học 1
// con nghỉ"*. Nên hàm này trả về MỘT mảng theo dòng, mỗi dòng tự mang danh sách lớp ứng
// viên + phán quyết của `xetXepVaoLop`. Không có "phán quyết của cả đơn".
//
// ── DẤU "DÒNG NÀY ĐÃ CHUYỂN ĐỔI" ────────────────────────────────────────────────────
// `OrderItem.enrollmentId` — cột ĐÃ CÓ SẴN và đang được dùng (493/525 dòng trên local),
// KHÔNG cần migration. Nó ở đúng cấp DÒNG, khớp với chốt "mỗi con xếp riêng"; một cột
// cấp ĐƠN sẽ không diễn đạt được ca "con A đã xếp, con B để sau".

/**
 * Phán quyết thay cho `xetXepVaoLop` ở dòng SCOPE khi cờ phạm vi BẬT [GATE D]: bài bắt đầu / học vượt do QUYỀN HỌC quyết SAU khi xếp lớp
 * (`lib/entitlements/xep-lop-tu-don.ts`), nên màn này KHÔNG được in "học vượt N buổi" / "mất N buổi" của luật cũ (luật 12 — lời hứa suông), KHÔNG chặn lớp
 * nào ngoài sĩ số, và hành động chuyển đổi KHÔNG ghi `buoiBatDau` / phiếu học bù. Cờ TẮT ⇒ không bao giờ dùng giá trị này.
 */
function xetTheoPhamVi(buoiKeTiepCuaLop: number): XetXepLop {
  return {
    loai: "khong_xet",
    xepDuoc: true,
    chiAdmin: false,
    buoiBatDau: null,
    buoiKeTiepCuaLop,
    soBuoiHocVuot: 0,
    soBuoiMatTrang: 0,
    cau: "Dòng mua theo phạm vi học — bài bắt đầu và phần học vượt do QUYỀN HỌC chốt sau khi xếp lớp (không dùng luật \"học các buổi cuối\" cũ).",
  };
}

/** Trạng thái lớp còn nhận ghi danh — cùng bộ với `enrollStudent`. */
const TRANG_THAI_LOP_NHAN = ["PLANNED", "RECRUITING", "ACTIVE"] as const;

export type LopUngVien = {
  id: string;
  ten: string;
  maLop: string | null;
  lich: string | null;
  /** Sĩ số đang học / tối đa. */
  siSo: number;
  siSoToiDa: number;
  /** Lớp đã đầy — `enrollStudent` sẽ từ chối. */
  daDay: boolean;
  /** Số buổi lớp ĐÃ QUA NGÀY. */
  soBuoiDaQua: number;
  /** Phán quyết của luật xếp lớp cho ĐÚNG dòng đơn này. */
  xet: XetXepLop;
  /** Vai thường có chọn được lớp này không (đã tính cả `daDay`). */
  chonDuoc: boolean;
};

export type DongChuyenDoi = {
  orderItemId: string;
  /** Tên hiển thị của dòng (tên khoá). */
  tenDong: string;
  /** `Course.id` của dòng; `null` khi dòng không phải khoá học. */
  courseId: string | null;
  tenKhoa: string | null;
  tongSoBuoiKhoa: number | null;
  /** Số buổi đã mua, `null` = mua đủ khoá. */
  soBuoiMua: number | null;
  /** Buổi đầu tiên bé được học — `null` khi không suy được. */
  buoiBatDau: number | null;
  /** Tên bé đã biết (từ `Student` đã gắn, hoặc từ `LeadChild`). Rỗng ⇒ người dùng nhập. */
  tenBe: string;
  /** `LeadChild.id` nếu dòng có gắn — cầu nối sang lead. */
  leadChildId: string | null;
  /** `Student.id` nếu dòng đã gắn học viên. */
  studentId: string | null;
  /** Đã chuyển đổi rồi ⇒ khoá dòng, không xếp lại. */
  enrollmentId: string | null;
  /** Dòng mua theo PHẠM VI HỌC và cờ BẬT cho cơ sở — `xet` của mọi lớp là phán quyết trung tính, không có luật "học các buổi cuối". BẮT BUỘC (luật 7). */
  phamVi: boolean;
  lop: LopUngVien[];
};

export type DuLieuChuyenDoi = {
  orderId: string;
  maDon: string;
  /** Thông tin phụ huynh — lấy từ ĐƠN, lead chỉ bù chỗ trống. */
  phuHuynh: { ten: string; sdt: string; email: string | null };
  centerId: string | null;
  /** Lead của đơn (`Order.leadId`). `null` ⇒ đơn không đi từ lead. BẮT BUỘC (luật 7). */
  leadId: string | null;
  /**
   * SALE PHỤ TRÁCH học viên của đơn = người đang CHĂM lead (`Lead.assignedToId`) — KHÔNG phải người bấm chốt đơn
   * [chủ dự án chốt 21/10/2026: admin / quản lý có thể tạo đơn giùm]. `null` khi đơn không có lead hoặc lead chưa có người chăm
   * — cố ý KHÔNG rơi về `Order.createdById`.
   */
  saleId: string | null;
  dong: DongChuyenDoi[];
};

/**
 * Nạp mọi thứ màn chuyển đổi cần.
 *
 * ⚠️ `bayGio` BẮT BUỘC, không mặc định `new Date()` (luật 19 — hàm đọc đồng hồ thật là
 * một ca hẹn giờ nổ, và ở đây nó còn quyết định lớp nào xếp được).
 *
 * ⚠️ KHÔNG gác quyền — người gọi (RSC/action) đã gác. Hàm này chỉ đọc.
 */
export async function docDuLieuChuyenDoi(
  orderId: string,
  bayGio: Date,
): Promise<DuLieuChuyenDoi | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      code: true,
      centerId: true,
      leadId: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      lead: { select: { parentName: true, phone: true, email: true, assignedToId: true } },
      items: {
        select: {
          id: true,
          itemName: true,
          type: true,
          metadata: true,
          studentId: true,
          enrollmentId: true,
          student: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!order) return null;

  // Con khai trong lead — nguồn tên bé khi dòng chưa gắn `Student`. Đọc RIÊNG vì
  // `LeadChild` không có `centerId` nên `scopedDb` là pass-through; và dòng nối tới nó
  // bằng `metadata.leadChildId`, không bằng quan hệ.
  const leadChildIds = order.items
    .map((it) => docLeadChildId(it.metadata))
    .filter((x): x is string => x !== null);
  const conLead =
    leadChildIds.length > 0
      ? await db.leadChild.findMany({
          where: { id: { in: leadChildIds } },
          select: { id: true, fullName: true },
        })
      : [];
  const tenConTheoId = new Map(conLead.map((c) => [c.id, c.fullName]));

  const courseIds = [
    ...new Set(
      order.items
        .map((it) => docHinhThucLop(it.metadata).courseId)
        .filter((x): x is string => x !== null),
    ),
  ];
  const khoa =
    courseIds.length > 0
      ? await db.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, name: true, totalSessions: true },
        })
      : [];
  const khoaTheoId = new Map(khoa.map((k) => [k.id, k]));

  // Lớp ứng viên: đúng khoá, còn nhận ghi danh, và CÙNG CƠ SỞ với đơn (cùng luật
  // cross-center mà `enrollStudent` ép — bày lớp cơ sở khác ra rồi để action từ chối là
  // affordance nói dối).
  const lopRaw =
    courseIds.length > 0
      ? await db.class.findMany({
          where: {
            deletedAt: null,
            courseId: { in: courseIds },
            status: { in: [...TRANG_THAI_LOP_NHAN] },
            ...(order.centerId ? { centerId: order.centerId } : {}),
          },
          select: {
            id: true,
            name: true,
            classCode: true,
            schedule: true,
            courseId: true,
            maxStudents: true,
            sessions: { select: { date: true } },
            _count: {
              select: { enrollments: { where: { status: { in: ["STUDYING", "ACTIVE"] } } } },
            },
          },
          orderBy: [{ startDate: "asc" }, { name: "asc" }],
        })
      : [];

  const dongPhamVi = await dongPhamViDangBat(order.centerId, order.items);

  const dong: DongChuyenDoi[] = order.items.map((it) => {
    const ht = docHinhThucLop(it.metadata);
    const laPhamVi = dongPhamVi.has(it.id);
    const k = ht.courseId ? khoaTheoId.get(ht.courseId) : undefined;
    const tongSoBuoiKhoa = k?.totalSessions ?? null;
    const leadChildId = docLeadChildId(it.metadata);

    const lop: LopUngVien[] = lopRaw
      .filter((c) => c.courseId === ht.courseId)
      .map((c) => {
        const soBuoiDaQua = demBuoiDaQua(c.sessions, bayGio);
        const xet = laPhamVi
          ? xetTheoPhamVi(soBuoiDaQua + 1)
          : xetXepVaoLop({
              tongSoBuoiKhoa,
              soBuoiMua: ht.soBuoi,
              soBuoiDaQua,
            });
        const daDay = c._count.enrollments >= c.maxStudents;
        return {
          id: c.id,
          ten: c.name,
          maLop: c.classCode,
          lich: c.schedule,
          siSo: c._count.enrollments,
          siSoToiDa: c.maxStudents,
          daDay,
          soBuoiDaQua,
          xet,
          // Lớp đầy thì KHÔNG ai chọn được, kể cả Quản trị tối cao: `enrollStudent`
          // từ chối `CLASS_FULL` vô điều kiện, và vẽ một lựa chọn chắc chắn ăn từ chối
          // là lời hứa suông (luật 12).
          chonDuoc: !daDay && duocXep(xet, false),
        };
      });

    return {
      orderItemId: it.id,
      tenDong: it.itemName,
      courseId: ht.courseId,
      tenKhoa: k?.name ?? null,
      tongSoBuoiKhoa,
      soBuoiMua: ht.soBuoi,
      // Lấy từ chính phán quyết của lớp đầu tiên thì sai khi dòng không có lớp nào —
      // tính riêng để luôn có số, kể cả khi danh sách lớp rỗng.
      buoiBatDau: laPhamVi ? null : xetXepVaoLop({ tongSoBuoiKhoa, soBuoiMua: ht.soBuoi, soBuoiDaQua: 0 }).buoiBatDau,
      phamVi: laPhamVi,
      tenBe:
        it.student?.name ??
        (leadChildId ? (tenConTheoId.get(leadChildId) ?? "") : ""),
      leadChildId,
      studentId: it.studentId,
      enrollmentId: it.enrollmentId,
      lop,
    };
  });

  return {
    orderId: order.id,
    maDon: order.code,
    phuHuynh: {
      // ĐƠN trước, lead chỉ bù chỗ trống — 96,3% đơn không có lead, và đơn là thứ khách
      // vừa ký. Lấy lead trước là ghi đè dữ liệu mới bằng dữ liệu cũ.
      ten: order.customerName || order.lead?.parentName || "",
      sdt: order.customerPhone || order.lead?.phone || "",
      email: order.customerEmail || order.lead?.email || null,
    },
    centerId: order.centerId,
    leadId: order.leadId,
    saleId: order.lead?.assignedToId ?? null,
    dong,
  };
}

/** `OrderItem.metadata.leadChildId` — cầu nối sang con khai trong lead. */
function docLeadChildId(metadata: unknown): string | null {
  const m =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const v = m.leadChildId;
  return typeof v === "string" && v.length > 0 ? v : null;
}
