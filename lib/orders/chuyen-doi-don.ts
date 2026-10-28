import "server-only";
import { db } from "@/lib/db";
import { dongPhamViDangBat } from "@/lib/entitlements/gate-xep-lop";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { demBuoiDaQua } from "@/lib/lms/xep-vao-lop";
import { khoangBuoiBatDau, type VaiXepLop } from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { lopTuChuoi } from "@/lib/students/dien-tu-lead";
import { gioiTinhTuChuoi, type GioiTinh } from "@/lib/students/gioi-tinh";

// lib/orders/chuyen-doi-don.ts — nạp dữ liệu cho màn CHUYỂN ĐỔI (xếp học viên vào lớp).
//
// ── VÌ SAO ĐI TỪ ĐƠN, KHÔNG ĐI TỪ LEAD ──────────────────────────────────────────────
// Màn chuyển đổi cũ (`/admin/leads/[id]/convert`, ĐÃ BỎ 27/10/2026) lấy mọi thứ từ `Lead` + `LeadChild`. Đo `satarobo_local` 29/09/2026:
// **19/515 đơn có `leadId` (3,7%)**. Nên ĐƠN là nguồn chính; lead chỉ BỔ SUNG khi có.
//
// ── MỖI DÒNG ĐƠN = MỘT ĐỨA TRẺ, XẾP RIÊNG ───────────────────────────────────────────
// Chủ dự án: *"mỗi con xếp riêng để có thể chọn 2 lớp riêng cho 2 con hoặc 1 con học 1 con nghỉ"*. Nên hàm này trả về MỘT mảng theo dòng, mỗi dòng tự mang danh sách
// lớp ứng viên. Chỉ dòng KHOÁ HỌC được trả về: con KHÔNG có dòng đơn (chưa đăng ký / chưa đóng tiền) không bao giờ hiện ở đây [chủ dự án chốt 27/10/2026: "ẩn luôn"].
//
// ── LỚP NÀO HIỆN CHO AI [chốt 27/10/2026] ──────────────────────────────────────────
//   · SALE  : lớp CÙNG CƠ SỞ với đơn; client chỉ hiện lớp sale xếp được (`vaiThayLop`) — luật nằm ở `xep-lop-theo-buoi-bat-dau.ts`;
//   · QLCS  : lớp cùng cơ sở với đơn, KỂ CẢ lớp vượt trần học vượt (QLCS xếp được);
//   · ADMIN : lớp của khoá ở MỌI cơ sở (kèm tên cơ sở), mọi tiến độ.
// Hàm này trả `soBuoiDaQua` cho từng lớp; phán quyết theo buổi bắt đầu do người dùng nhập tính ở client VÀ tính lại ở máy chủ (`chuyenDoiDonAction`).
//
// ── DẤU "DÒNG NÀY ĐÃ CHUYỂN ĐỔI" ────────────────────────────────────────────────────
// `OrderItem.enrollmentId` — cột ĐÃ CÓ SẴN (493/525 dòng trên local), KHÔNG cần migration. Ở đúng cấp DÒNG, khớp với chốt "mỗi con xếp riêng".

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
  /** Lớp đã đầy — `enrollStudent` sẽ từ chối, kể cả Quản trị tối cao. */
  daDay: boolean;
  /** Số buổi lớp ĐÃ QUA NGÀY (P). */
  soBuoiDaQua: number;
  /** Cơ sở của lớp (Quản trị tối cao thấy lớp mọi cơ sở nên cần nhãn). */
  tenCoSo: string | null;
  /** Lớp khác cơ sở với đơn — chỉ Quản trị tối cao có. */
  khacCoSo: boolean;
};

export type DongChuyenDoi = {
  orderItemId: string;
  /** Tên hiển thị của dòng (tên khoá). */
  tenDong: string;
  /** `Course.id` của dòng. Luôn có — dòng không phải khoá học bị loại khỏi danh sách. */
  courseId: string;
  tenKhoa: string | null;
  tongSoBuoiKhoa: number | null;
  /** Số buổi đã mua, `null` = mua đủ khoá. */
  soBuoiMua: number | null;
  /** Khoảng buổi bắt đầu hợp lệ (Sale nhập). `null` ⇒ khoá không khai số buổi, hoặc dòng SCOPE (quyền học quyết). */
  khoangBuoi: { min: number; max: number; macDinh: number; muaDuKhoa: boolean } | null;
  /** Tên bé đã biết (từ `Student` đã gắn, hoặc từ `LeadChild`). Rỗng ⇒ người dùng nhập. */
  tenBe: string;
  /** Điền sẵn từ `Student` đã gắn, rồi tới `LeadChild`. Chuỗi rỗng ⇒ chưa có. */
  ngaySinh: string;
  gioiTinh: GioiTinh | "";
  /** Lớp ở trường (1–12) dạng chuỗi để gắn thẳng vào ô chọn. */
  lopTruong: string;
  truong: string;
  /** `LeadChild.id` nếu dòng có gắn — cầu nối sang lead. */
  leadChildId: string | null;
  /** `Student.id` nếu dòng đã gắn học viên. */
  studentId: string | null;
  /** Đã chuyển đổi rồi ⇒ khoá dòng, không xếp lại. */
  enrollmentId: string | null;
  /** Buổi bắt đầu đã lưu của ghi danh (chỉ khi `enrollmentId`) — để Quản trị tối cao sửa. */
  buoiBatDauDaLuu: number | null;
  /** Dòng mua theo PHẠM VI HỌC và cờ BẬT cho cơ sở — quyền học quyết bài bắt đầu / học vượt, màn này KHÔNG hỏi buổi bắt đầu. BẮT BUỘC (luật 7). */
  phamVi: boolean;
  lop: LopUngVien[];
};

export type PhuHuynhChuyenDoi = {
  ten: string;
  sdt: string;
  email: string;
  /** Quan hệ với bé ("Mẹ", "Bố"…) — chữ tự do. */
  quanHe: string;
  gioiTinh: GioiTinh | "";
  ngaySinh: string;
  facebook: string;
  /** Số nhà, đường. */
  diaChi: string;
  tinh: string;
  phuong: string;
};

export type DuLieuChuyenDoi = {
  orderId: string;
  maDon: string;
  /** Thông tin phụ huynh — lấy từ ĐƠN, lead chỉ bù chỗ trống. */
  phuHuynh: PhuHuynhChuyenDoi;
  centerId: string | null;
  /** Lead của đơn (`Order.leadId`). `null` ⇒ đơn không đi từ lead. BẮT BUỘC (luật 7). */
  leadId: string | null;
  /**
   * SALE PHỤ TRÁCH học viên của đơn = người đang CHĂM lead (`Lead.assignedToId`) — KHÔNG phải người bấm chốt đơn
   * [chủ dự án chốt 21/10/2026]. `null` khi đơn không có lead hoặc lead chưa có người chăm — cố ý KHÔNG rơi về `Order.createdById`.
   */
  saleId: string | null;
  /** Đơn đã được Quản trị tối cao cấp học bổng 100% — qua cổng "đã có tiền". */
  donHocBong: boolean;
  /** Trần học vượt của cơ sở đơn (`enrollment.catchUpMaxSessions`). */
  tran: number;
  dong: DongChuyenDoi[];
};

const ngayIso = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "");

/**
 * Nạp mọi thứ màn chuyển đổi cần.
 *
 * ⚠️ `bayGio` BẮT BUỘC, không mặc định `new Date()` (luật 19 — nó quyết định lớp nào xếp được).
 * ⚠️ `boiCanh` BẮT BUỘC (luật 7): `vai` quyết lớp nào được nạp (Quản trị tối cao: mọi cơ sở), `tran` là trần học vượt của cơ sở đơn đã đọc sẵn, `xemPiiLead` = người xem
 *    có `leads:view-pii` không — thiếu quyền thì các ô PHỤ HUYNH lấy từ LEAD (giới tính · ngày sinh · Facebook · địa chỉ) để TRỐNG, không phải bản che (lưới `[S-1]`:
 *    ô điền sẵn bằng giá trị đã che rồi bấm Lưu là ghi giá trị đục vào hồ sơ thật).
 * ⚠️ KHÔNG gác quyền — người gọi (RSC/action) đã gác. Hàm này chỉ đọc.
 */
export async function docDuLieuChuyenDoi(
  orderId: string,
  bayGio: Date,
  boiCanh: { vai: VaiXepLop; tran: number; xemPiiLead: boolean },
): Promise<DuLieuChuyenDoi | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      code: true,
      centerId: true,
      leadId: true,
      hocBong100: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      invoiceEmail: true,
      lead: {
        select: {
          parentName: true,
          phone: true,
          email: true,
          assignedToId: true,
          facebookUrl: true,
          parentGender: true,
          parentDob: true,
          city: true,
          ward: true,
          addressLine: true,
        },
      },
      items: {
        select: {
          id: true,
          itemName: true,
          type: true,
          metadata: true,
          studentId: true,
          enrollmentId: true,
          student: {
            select: { id: true, name: true, dateOfBirth: true, gender: true, school: true, currentGrade: true },
          },
        },
      },
    },
  });
  if (!order) return null;

  // Con khai trong lead — nguồn tên bé + ngày sinh, giới tính, trường, lớp khi dòng chưa gắn `Student`. Đọc RIÊNG vì `LeadChild` không có `centerId` nên `scopedDb`
  // là pass-through; và dòng nối tới nó bằng `metadata.leadChildId`, không bằng quan hệ.
  const leadChildIds = order.items.map((it) => docLeadChildId(it.metadata)).filter((x): x is string => x !== null);
  const conLead =
    leadChildIds.length > 0
      ? await db.leadChild.findMany({
          where: { id: { in: leadChildIds } },
          select: { id: true, fullName: true, dob: true, gender: true, schoolName: true, gradeLevel: true },
        })
      : [];
  const conTheoId = new Map(conLead.map((c) => [c.id, c]));

  const courseIds = [
    ...new Set(order.items.map((it) => docHinhThucLop(it.metadata).courseId).filter((x): x is string => x !== null)),
  ];
  const khoa =
    courseIds.length > 0
      ? await db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true, totalSessions: true } })
      : [];
  const khoaTheoId = new Map(khoa.map((k) => [k.id, k]));

  // Lớp ứng viên: đúng khoá, còn nhận ghi danh. CƠ SỞ: Sale/QLCS chỉ lớp CÙNG CƠ SỞ với đơn (cùng luật cross-center mà `enrollStudent` ép — bày lớp cơ sở khác ra
  // rồi để action từ chối là affordance nói dối); Quản trị tối cao thấy lớp của khoá ở MỌI cơ sở.
  const lopRaw =
    courseIds.length > 0
      ? await db.class.findMany({
          where: {
            deletedAt: null,
            courseId: { in: courseIds },
            status: { in: [...TRANG_THAI_LOP_NHAN] },
            ...(boiCanh.vai !== "ADMIN" && order.centerId ? { centerId: order.centerId } : {}),
          },
          select: {
            id: true,
            name: true,
            classCode: true,
            schedule: true,
            courseId: true,
            centerId: true,
            maxStudents: true,
            sessions: { select: { date: true } },
            _count: {
              select: { enrollments: { where: { status: { in: ["STUDYING", "ACTIVE"] } } } },
            },
          },
          orderBy: [{ startDate: "asc" }, { name: "asc" }],
        })
      : [];

  const coSoIds = [...new Set(lopRaw.map((c) => c.centerId).filter((x): x is string => x !== null))];
  const tenCoSo =
    boiCanh.vai === "ADMIN" && coSoIds.length > 0
      ? new Map((await db.center.findMany({ where: { id: { in: coSoIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]))
      : new Map<string, string>();

  const dongPhamVi = await dongPhamViDangBat(order.centerId, order.items);

  const dong: DongChuyenDoi[] = order.items.flatMap((it): DongChuyenDoi[] => {
    const ht = docHinhThucLop(it.metadata);
    // Chỉ dòng KHOÁ HỌC. Dòng kit / sản phẩm / phí không có lớp để xếp.
    if (!ht.courseId) return [];
    const courseId = ht.courseId;
    const laPhamVi = dongPhamVi.has(it.id);
    const k = khoaTheoId.get(courseId);
    const tongSoBuoiKhoa = k?.totalSessions ?? null;
    const leadChildId = docLeadChildId(it.metadata);
    const con = leadChildId ? conTheoId.get(leadChildId) : undefined;
    const hv = it.student;

    const lop: LopUngVien[] = lopRaw
      .filter((c) => c.courseId === courseId)
      .map((c) => {
        const daDay = c._count.enrollments >= c.maxStudents;
        return {
          id: c.id,
          ten: c.name,
          maLop: c.classCode,
          lich: c.schedule,
          siSo: c._count.enrollments,
          siSoToiDa: c.maxStudents,
          daDay,
          soBuoiDaQua: demBuoiDaQua(c.sessions, bayGio),
          tenCoSo: c.centerId ? (tenCoSo.get(c.centerId) ?? null) : null,
          khacCoSo: !!order.centerId && c.centerId !== order.centerId,
        };
      });

    const gioiTinh: GioiTinh | "" = hv?.gender ?? gioiTinhTuChuoi(con?.gender) ?? "";
    const lopSo = hv?.currentGrade ?? lopTuChuoi(con?.gradeLevel);

    return [
      {
        orderItemId: it.id,
        tenDong: it.itemName,
        courseId,
        tenKhoa: k?.name ?? null,
        tongSoBuoiKhoa,
        soBuoiMua: ht.soBuoi,
        // Dòng SCOPE: bài bắt đầu do QUYỀN HỌC chốt sau khi xếp lớp (`xep-lop-tu-don.ts`), màn này không hỏi.
        khoangBuoi: laPhamVi ? null : khoangBuoiBatDau({ tongSoBuoiKhoa, soBuoiMua: ht.soBuoi }),
        phamVi: laPhamVi,
        tenBe: hv?.name ?? con?.fullName ?? "",
        ngaySinh: ngayIso(hv?.dateOfBirth) || ngayIso(con?.dob),
        gioiTinh,
        lopTruong: lopSo != null ? String(lopSo) : "",
        truong: hv?.school?.trim() || con?.schoolName?.trim() || "",
        leadChildId,
        studentId: it.studentId,
        enrollmentId: it.enrollmentId,
        buoiBatDauDaLuu: null,
        lop,
      },
    ];
  });

  // Buổi bắt đầu đã lưu của các ghi danh đã chuyển đổi (Quản trị tối cao sửa ở chính màn này).
  const gdIds = dong.map((d) => d.enrollmentId).filter((x): x is string => x !== null);
  if (gdIds.length > 0) {
    const gd = await db.enrollment.findMany({ where: { id: { in: gdIds } }, select: { id: true, buoiBatDau: true } });
    const theoId = new Map(gd.map((g) => [g.id, g.buoiBatDau ?? 1]));
    for (const d of dong) if (d.enrollmentId) d.buoiBatDauDaLuu = theoId.get(d.enrollmentId) ?? 1;
  }

  const lead = order.lead;
  return {
    orderId: order.id,
    maDon: order.code,
    phuHuynh: {
      // ĐƠN trước, lead chỉ bù chỗ trống — 96,3% đơn không có lead, và đơn là thứ khách vừa ký. Lấy lead trước là ghi đè dữ liệu mới bằng dữ liệu cũ.
      ten: order.customerName || order.lead?.parentName || "",
      sdt: order.customerPhone || order.lead?.phone || "",
      // Email nhận hoá đơn (ô "Người mua trên hoá đơn") dùng làm dự phòng khi đơn không có email liên hệ.
      email: order.customerEmail || order.lead?.email || order.invoiceEmail || "",
      quanHe: "",
      gioiTinh: (boiCanh.xemPiiLead ? lead?.parentGender : null) ?? "",
      ngaySinh: boiCanh.xemPiiLead ? ngayIso(lead?.parentDob) : "",
      facebook: (boiCanh.xemPiiLead ? lead?.facebookUrl?.trim() : null) ?? "",
      diaChi: (boiCanh.xemPiiLead ? lead?.addressLine?.trim() : null) ?? "",
      tinh: (boiCanh.xemPiiLead ? lead?.city?.trim() : null) ?? "",
      phuong: (boiCanh.xemPiiLead ? lead?.ward?.trim() : null) ?? "",
    },
    centerId: order.centerId,
    leadId: order.leadId,
    saleId: order.lead?.assignedToId ?? null,
    donHocBong: order.hocBong100,
    tran: boiCanh.tran,
    dong,
  };
}

/** `OrderItem.metadata.leadChildId` — cầu nối sang con khai trong lead. */
function docLeadChildId(metadata: unknown): string | null {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const v = m.leadChildId;
  return typeof v === "string" && v.length > 0 ? v : null;
}
