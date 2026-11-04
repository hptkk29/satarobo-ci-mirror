"use server";
// Server Action của tab Chính sách (PR8). MỎNG có chủ đích: auth → quyền → điều phối (`lib/hoa-hong/chinh-sach-hanh-dong`) →
// làm mới trang. Mọi luật nghiệp vụ (guardrail, bất biến phiên bản đã dùng, trần) nằm ở service PR4 — action không viết lại.
//
// Khuôn mỗi action (luật cứng Nền Hệ thống #1 — kiểm quyền NGAY ĐẦU hàm, trước khi chạm bất cứ thứ gì):
//   1. auth()  2. assertPermission(<key>)  3. resolveActor  4. gọi điều phối.
// Hai quyền TÁCH NHAU (05 §1.2): `commission_policies:manage` soạn/lưu/huỷ nháp; `commission_policies:activate` kích hoạt.
// Người soạn không tự kích hoạt được trừ khi được cấp cả hai.
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { assertPermission } from "@/lib/auth/check-permission";
import {
  huyBanNhap,
  kichHoatPhienBan,
  kiemHangRao,
  luuNhap,
  type DauVaoLuuNhap,
  type KetQuaKichHoat,
  type KetQuaLuuNhap,
} from "@/lib/hoa-hong/chinh-sach-hanh-dong";
import type { NguoiThaoTac } from "@/lib/hoa-hong/chinh-sach-service";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import type { KetQuaThuTinh } from "@/lib/hoa-hong/mo-phong";
import { thuTinhPhienBan } from "@/lib/hoa-hong/mo-phong-hanh-dong";

const KHONG_QUYEN_SOAN = "Bạn không có quyền soạn chính sách hoa hồng (commission_policies:manage).";
const KHONG_QUYEN_XEM = "Bạn không có quyền xem chính sách hoa hồng (commission_policies:view).";
const KHONG_QUYEN_THU_TINH = "Bạn không có quyền thử tính chính sách hoa hồng (commission_policies:manage).";
const KHONG_QUYEN_KICH_HOAT = "Bạn không có quyền kích hoạt chính sách hoa hồng (commission_policies:activate).";
const CHUA_DANG_NHAP = "Chưa đăng nhập.";
const ENGINE_TAT = "Hoa hồng theo nguồn chưa được bật.";

type Loi = { ok: false; loi: []; chung: string };
const tuChoi = (chung: string): Loi => ({ ok: false, loi: [], chung });

/**
 * Cờ `hoaHong.engineBat` (cờ gác CẢ tab Chính sách — tab 404 khi tắt, 05 §1.5): màn đóng thì đường GHI cũng đóng. Hỏi SAU cổng quyền để người không có quyền
 * không biết cờ đang bật hay tắt; lỗi đọc cờ ⇒ coi là TẮT (fail-closed) — một lời gọi thẳng không được lách màn 404.
 */
async function engineDangBat(): Promise<boolean> {
  try {
    return await laEngineHoaHongBat();
  } catch {
    return false;
  }
}

function nguoiTu(user: { id: string; name?: string | null; email?: string | null }): NguoiThaoTac {
  return { userId: user.id, ten: user.name ?? user.email ?? user.id };
}

function lamMoi(policyId?: string | null) {
  revalidatePath("/nguon-hoa-hong/chinh-sach");
  if (policyId) revalidatePath(`/nguon-hoa-hong/chinh-sach/${policyId}`);
}

export async function luuNhapAction(vao: DauVaoLuuNhap): Promise<KetQuaLuuNhap> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_policies:manage");
  } catch {
    return tuChoi(KHONG_QUYEN_SOAN);
  }
  if (!(await engineDangBat())) return tuChoi(ENGINE_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await luuNhap({ actor, nguoi: nguoiTu(session.user), now: new Date(), vao });
  if (r.ok) lamMoi(r.policyId);
  return r;
}

export async function kiemHangRaoAction(versionId: string) {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_policies:view");
  } catch {
    return tuChoi(KHONG_QUYEN_XEM);
  }
  if (!(await engineDangBat())) return tuChoi(ENGINE_TAT);
  const actor = await resolveActor(session.user.id);
  return kiemHangRao({ actor, now: new Date(), versionId });
}

/** `updatedAtDaThay` = mốc `updatedAt` của bản nháp mà người duyệt đã thấy khi bấm; nháp bị sửa sau mốc ấy thì KHÔNG kích hoạt. */
export async function kichHoatAction(vao: { versionId: string; xacNhanLyDo: string | null; updatedAtDaThay: string }): Promise<KetQuaKichHoat> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_policies:activate");
  } catch {
    return tuChoi(KHONG_QUYEN_KICH_HOAT);
  }
  if (!(await engineDangBat())) return tuChoi(ENGINE_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await kichHoatPhienBan({ actor, nguoi: nguoiTu(session.user), now: new Date(), versionId: vao.versionId, xacNhanLyDo: vao.xacNhanLyDo, updatedAtDaThay: vao.updatedAtDaThay });
  if (r.ok) lamMoi();
  return r;
}

export async function huyNhapAction(vao: { versionId: string; lyDo: string }) {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_policies:manage");
  } catch {
    return tuChoi(KHONG_QUYEN_SOAN);
  }
  if (!(await engineDangBat())) return tuChoi(ENGINE_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await huyBanNhap({ actor, nguoi: nguoiTu(session.user), now: new Date(), versionId: vao.versionId, lyDo: vao.lyDo });
  if (r.ok) lamMoi();
  return r;
}

/**
 * THỬ TÍNH (04 §14): CHỈ ĐỌC — không ghi sổ, không làm mới trang. Quyền `commission_policies:manage` (cùng key với nút "Chạy thử" mà bước
 * Thử tính vẽ — luật 12: vẽ bằng key nào thì máy chủ hỏi đúng key đó). Dữ liệu client gửi lên không được tin: ép kiểu trước khi xuống tầng dưới.
 */
export async function thuTinhAction(vao: { versionId: string; tuNgay: string | null; denNgay: string | null; orgUnitId: string | null }): Promise<KetQuaThuTinh> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_policies:manage");
  } catch {
    return tuChoi(KHONG_QUYEN_THU_TINH);
  }
  if (!(await engineDangBat())) return tuChoi(ENGINE_TAT);
  const chuoiHoacNull = (x: unknown): string | null | undefined => (x === null ? null : typeof x === "string" ? x : undefined);
  const tuNgay = chuoiHoacNull(vao?.tuNgay);
  const denNgay = chuoiHoacNull(vao?.denNgay);
  const orgUnitId = chuoiHoacNull(vao?.orgUnitId);
  if (typeof vao?.versionId !== "string" || vao.versionId === "" || tuNgay === undefined || denNgay === undefined || orgUnitId === undefined) {
    return { ok: false, chung: "Dữ liệu gửi lên không đúng dạng — tải lại trang rồi thử lại." };
  }
  const actor = await resolveActor(session.user.id);
  return thuTinhPhienBan({ actor, now: new Date(), versionId: vao.versionId, tuNgay, denNgay, orgUnitId });
}
