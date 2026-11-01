"use server";

// lib/cham-cong/xac-nhan-cong-actions.ts — P2.2 Server Action XÁC NHẬN CÔNG + KHIẾU NẠI CÔNG, dùng chung
// cho site GV và admin. Quyền qua `can()`, đúng khuôn đơn từ (`request-actions.ts`):
//   · nhân sự xác nhận / khiếu nại / trả lời → `hr_attendance:checkin` tại cơ sở của kỳ, và CHỈ trên dữ
//     liệu của chính mình (userId lấy từ phiên, không nhận từ client);
//   · quản lý xử lý khiếu nại → `hr_attendance:approve` tại cơ sở của khiếu nại (đúng người duyệt đơn);
//   · xác nhận THAY → `hr_attendance:close-period` tại cơ sở (đúng người chốt kỳ), lý do bắt buộc.
// Luật nghiệp vụ + chống đua ở `lib/cham-cong/xac-nhan-cong.ts`.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { notifyStaff } from "@/lib/notifications/notify";
import { parsePeriodKey } from "./period";
import { approversOfCenter } from "./requests";
import { chuyenTrangThaiKhieuNai, docKhieuNai, moKhieuNai, nguoiCanMoiXacNhan, xacNhanCong, xacNhanThay } from "./xac-nhan-cong";
import { phatZnsChamCong } from "./zns-cham-cong";
import { LOAI_KHIEU_NAI, NHAN_HANH_DONG, NHAN_LOAI_KHIEU_NAI } from "./xac-nhan-cong-thuan";

type Res = { ok: true; note?: string } | { ok: false; error: string; doiMoi?: boolean };

const ky = z.string().refine((s) => !!parsePeriodKey(s), "Kỳ dạng YYYY-MM");
const loi = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";

function lamMoi() {
  revalidatePath("/teacher/bang-cong");
  revalidatePath("/cham-cong/lich-ca");
  revalidatePath("/cham-cong/xac-nhan-cong");
}

export async function xacNhanCongAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ centerId: z.string().min(1), ky, vanTay: z.string().length(64) }).safeParse(input);
  if (!p.success) return { ok: false, error: loi(p.error) };
  if (!(await checkPermission("hr_attendance:checkin", { centerId: p.data.centerId }))) {
    return { ok: false, error: "Không có quyền chấm công tại cơ sở này" };
  }
  const r = await xacNhanCong({
    userId: session.user.id,
    userName: session.user.name ?? "Nhân sự",
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    vanTayDaXem: p.data.vanTay,
    now: new Date(),
  });
  if (r.ok) lamMoi();
  return r.ok ? { ok: true, note: `Đã xác nhận bảng công kỳ ${p.data.ky}` } : r;
}

export async function moKhieuNaiAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z
    .object({
      centerId: z.string().min(1),
      ky,
      ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      loai: z.enum(LOAI_KHIEU_NAI),
      moTa: z.string().max(2000),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: loi(p.error) };
  if (!(await checkPermission("hr_attendance:checkin", { centerId: p.data.centerId }))) {
    return { ok: false, error: "Không có quyền chấm công tại cơ sở này" };
  }
  const r = await moKhieuNai({
    userId: session.user.id,
    userName: session.user.name ?? "Nhân sự",
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    workDate: p.data.ngay ? new Date(`${p.data.ngay}T00:00:00Z`) : null,
    category: p.data.loai,
    moTa: p.data.moTa,
    now: new Date(),
  });
  if (!r.ok) return r;
  const nguoiDuyet = await approversOfCenter(p.data.centerId);
  if (nguoiDuyet.length) {
    await notifyStaff({
      userIds: nguoiDuyet,
      dedupeKey: `khieu-nai-cong.moi:${r.id}`,
      title: `Khiếu nại công kỳ ${p.data.ky} — ${session.user.name ?? "nhân sự"}`,
      body: `${NHAN_LOAI_KHIEU_NAI[p.data.loai]}: ${p.data.moTa}`.slice(0, 300),
      href: `/cham-cong/xac-nhan-cong?coSo=${p.data.centerId}&ky=${p.data.ky}`,
      entityId: r.id,
    });
  }
  lamMoi();
  return { ok: true, note: "Đã gửi khiếu nại — quản lý sẽ xem và trả lời" };
}

const HANH_DONG_NV = ["TRA_LOI", "RUT", "DONG_Y", "KHIEU_NAI_TIEP"] as const;
const HANH_DONG_QL = ["NHAN_XU_LY", "HOI_LAI", "GIAI_QUYET", "TU_CHOI"] as const;

/** Nhân sự thao tác trên khiếu nại CỦA MÌNH. */
export async function nvKhieuNaiAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ id: z.string().min(1), hanhDong: z.enum(HANH_DONG_NV), ghiChu: z.string().max(2000) }).safeParse(input);
  if (!p.success) return { ok: false, error: loi(p.error) };
  const kn = await docKhieuNai(p.data.id);
  if (!kn) return { ok: false, error: "Không tìm thấy khiếu nại" };
  if (!(await checkPermission("hr_attendance:checkin", { centerId: kn.centerId }))) {
    return { ok: false, error: "Không có quyền chấm công tại cơ sở này" };
  }
  const r = await chuyenTrangThaiKhieuNai({
    disputeId: kn.id,
    hanhDong: p.data.hanhDong,
    vai: "NV",
    ghiChu: p.data.ghiChu,
    linkedRequestId: null,
    actor: { id: session.user.id, name: session.user.name ?? "Nhân sự" },
    now: new Date(),
  });
  if (!r.ok) return r;
  if (p.data.hanhDong === "TRA_LOI" || p.data.hanhDong === "KHIEU_NAI_TIEP") {
    const nguoiDuyet = await approversOfCenter(kn.centerId);
    if (nguoiDuyet.length) {
      await notifyStaff({
        userIds: nguoiDuyet,
        // Khoá theo ID TIN của lượt chuyển (P2.6) — `Date.now()` cũ làm thử lại sinh mục mới.
        dedupeKey: `khieu-nai-cong.nhan-su:${kn.id}:${r.messageId}`,
        title: `Khiếu nại công kỳ ${kn.periodKey}: ${NHAN_HANH_DONG[p.data.hanhDong]} — ${session.user.name ?? "nhân sự"}`,
        body: p.data.ghiChu.slice(0, 300),
        href: `/cham-cong/xac-nhan-cong?coSo=${kn.centerId}&ky=${kn.periodKey}`,
        entityId: kn.id,
      });
    }
  }
  lamMoi();
  return { ok: true };
}

/** Quản lý xử lý khiếu nại tại cơ sở mình duyệt đơn. */
export async function qlKhieuNaiAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z
    .object({ id: z.string().min(1), hanhDong: z.enum(HANH_DONG_QL), ghiChu: z.string().max(2000), maDon: z.string().max(60).nullable() })
    .safeParse(input);
  if (!p.success) return { ok: false, error: loi(p.error) };
  const kn = await docKhieuNai(p.data.id);
  if (!kn) return { ok: false, error: "Không tìm thấy khiếu nại" };
  if (!(await checkPermission("hr_attendance:approve", { centerId: kn.centerId }))) {
    return { ok: false, error: "Không có quyền xử lý khiếu nại ở cơ sở này" };
  }
  const r = await chuyenTrangThaiKhieuNai({
    disputeId: kn.id,
    hanhDong: p.data.hanhDong,
    vai: "QL",
    ghiChu: p.data.ghiChu,
    linkedRequestId: p.data.maDon?.trim() || null,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    now: new Date(),
  });
  if (!r.ok) return r;
  if (p.data.hanhDong !== "NHAN_XU_LY") {
    await notifyStaff({
      userIds: [kn.userId],
      dedupeKey: `khieu-nai-cong.ket-qua:${kn.id}:${r.messageId}`,
      title: `Khiếu nại công kỳ ${kn.periodKey}: ${NHAN_HANH_DONG[p.data.hanhDong]}`,
      body: p.data.ghiChu.slice(0, 300),
      href: `/teacher/bang-cong?ky=${kn.periodKey}`,
      entityId: kn.id,
    });
    // ZNS (P2.6): TẮT mặc định; không mẫu ⇒ không gửi. Cùng khoá chống trùng với mục trong ứng dụng.
    await phatZnsChamCong({
      loai: "KHIEU_NAI_XU_LY",
      userId: kn.userId,
      ky: kn.periodKey,
      ketQua: NHAN_HANH_DONG[p.data.hanhDong],
      dedupeKey: `khieu-nai-cong.ket-qua:${kn.id}:${r.messageId}`,
    });
  }
  lamMoi();
  return { ok: true };
}

/** HR / quản lý xác nhận THAY một người (nghỉ việc, không vào được hệ thống…). */
export async function xacNhanThayAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ userId: z.string().min(1), centerId: z.string().min(1), ky, lyDo: z.string().max(500) }).safeParse(input);
  if (!p.success) return { ok: false, error: loi(p.error) };
  if (!(await checkPermission("hr_attendance:close-period", { centerId: p.data.centerId }))) {
    return { ok: false, error: "Không có quyền xác nhận thay ở cơ sở này" };
  }
  const r = await xacNhanThay({
    userId: p.data.userId,
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    lyDo: p.data.lyDo,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    now: new Date(),
  });
  if (r.ok) lamMoi();
  return r;
}

/**
 * P2.6 — người chốt kỳ MỜI những ai còn chưa xác nhận / cần xác nhận lại. Không lịch tự động (chính sách nhắc
 * chưa chốt): chỉ chạy khi bấm. Khoá chống trùng gắn VÂN TAY bảng công ⇒ bấm lại khi số liệu không đổi không kêu
 * chuông lần hai; số liệu đổi thì là lời mời mới.
 */
export async function moiXacNhanCongAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ centerId: z.string().min(1), ky }).safeParse(input);
  if (!p.success) return { ok: false, error: loi(p.error) };
  if (!(await checkPermission("hr_attendance:close-period", { centerId: p.data.centerId }))) {
    return { ok: false, error: "Không có quyền mời xác nhận công ở cơ sở này" };
  }
  const r = await nguoiCanMoiXacNhan({
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    now: new Date(),
  });
  if (!r.ok) return r;
  if (r.moi.length === 0) return { ok: true, note: "Mọi người đã xác nhận — không cần mời ai" };
  const kyVn = p.data.ky.split("-").reverse().join("/");
  for (const m of r.moi) {
    const dedupeKey = `xac-nhan-cong.moi:${p.data.centerId}:${p.data.ky}:${m.userId}:${m.vanTay.slice(0, 12)}`;
    await notifyStaff({
      userIds: [m.userId],
      dedupeKey,
      title: `Mời xác nhận bảng công tháng ${kyVn}`,
      body: "Xem bảng công ngày của bạn rồi bấm Xác nhận, hoặc gửi khiếu nại nếu có ngày sai.",
      href: `/teacher/bang-cong?ky=${p.data.ky}`,
      entityId: `${p.data.centerId}:${p.data.ky}`,
    });
    await phatZnsChamCong({
      loai: "MOI_XAC_NHAN",
      userId: m.userId,
      ky: p.data.ky,
      ketQua: null,
      dedupeKey,
    });
  }
  return { ok: true, note: `Đã mời ${r.moi.length} người xác nhận bảng công tháng ${kyVn}` };
}
