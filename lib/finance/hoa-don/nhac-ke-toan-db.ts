import "server-only";
import { db } from "@/lib/db";
import { resolveActorUncached } from "@/lib/auth/actor";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { actionCenterScope } from "@/lib/lms/report-card-core";
import { notifyStaff } from "@/lib/notifications/notify";
import { laHoaDonBat } from "./feature";
import { napHangChoHoaDon } from "./hang-cho";
import { QUYEN_KE_TOAN_HOA_DON } from "./quyen";
import { demChoTheoCoSo, dungThongBaoNhac, NGAN_NHAC, type NguoiNhanNhac } from "./nhac-ke-toan";

// lib/finance/hoa-don/nhac-ke-toan-db.ts — NGƯỜI CHẠY chuông nhắc kế toán hằng ngày (PLAN Q-mở 7).
// Gọi từ cron `payment-reconcile` (một lượt/ngày). Quyết định đếm + chia người nhận ở `nhac-ke-toan.ts`.
//
// Bốn nhịp:
//   0. cờ `billing.hoaDonEnabled` TẮT ⇒ DỪNG, không tra gì (màn tắt thì chuông trỏ vào trang 404);
//   1. nạp hàng chờ bằng CHÍNH loader của màn (`napHangChoHoaDon`) với SYSTEM_ACTOR — thấy mọi cơ sở,
//      `canViewPii: false` (không cần PII để đếm). Ngăn của dòng KHÔNG phụ thuộc actor (`chonNgan` chỉ
//      đọc trạng thái lần thu) nên số đếm trùng với tab "Chờ xuất" mà kế toán mở ra;
//   2. cơ sở của đơn — MỘT câu (`DongHangCho` chỉ mang tên cơ sở, không mang centerId);
//   3. người nhận: ai giữ vai có `payments:confirm` (v2) → dựng actor THẬT của họ → phạm vi
//      `actionCenterScope` — CÙNG phép hỏi `coQuyenKeToanTaiCoSo` mà nút xác nhận trên màn dùng.
//
// ⚠️ CHI PHÍ nhịp 1: loader nạp CẢ hàng chờ (đơn ứng viên + khoản + phiếu + hoá đơn còn hiệu lực + giao
// dịch chưa khớp), y như một lượt mở màn của kế toán Hội sở — một lần mỗi ngày. Đổi lấy việc KHÔNG viết
// lại luật "chờ xuất" (viết lại là có ngày chuông báo 5 mà tab mở ra 3). Nếu hàng chờ phình tới mức
// màn cũng chậm thì sửa loader, cron hưởng theo.
// ⚠️ Nhịp 3 dựng actor từng người (mỗi người vài câu song song): số kế toán có `payments:confirm` là
// hàng chục, không phải hàng nghìn. Người chỉ có vai v1 tĩnh (`User.roles`, chạy ở local/CI) KHÔNG
// nhận — v1 không có phạm vi cơ sở theo quyền, đoán phạm vi là gửi nhầm cơ sở. Prod chạy v2.
// ⚠️ Vai hưởng QUA VỊ TRÍ (`loadPositionRoleRows`) không vào tập ứng viên ở nhịp 3 (chỉ quét
// `UserOrgRole`) — ghi nhận là giới hạn; hôm nay kế toán được gán vai trực tiếp.

export type KetQuaNhacKeToan = {
  /** `CO_TAT` = cờ màn hoá đơn tắt, không tra gì. `null` = đã chạy. */
  boQua: "CO_TAT" | null;
  choXuat: number;
  coSo: number;
  thongBao: number;
  notified: number;
};

async function timKeToan(now: Date): Promise<NguoiNhanNhac[]> {
  const vai = await db.rolePermission.findMany({
    where: { action: QUYEN_KE_TOAN_HOA_DON },
    select: { roleId: true },
  });
  if (vai.length === 0) return [];
  const gan = await db.userOrgRole.findMany({
    where: {
      roleId: { in: vai.map((r) => r.roleId) },
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    select: { userId: true },
  });
  if (gan.length === 0) return [];
  // Người đã nghỉ vẫn có thể còn dòng vai ACTIVE — chỉ giữ tài khoản còn hoạt động (khuôn payment-reconcile).
  const conLam = await db.user.findMany({
    where: { id: { in: [...new Set(gan.map((g) => g.userId))] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const actors = await Promise.all(conLam.map((u) => resolveActorUncached(u.id)));
  return actors.map((a) => ({ userId: a.userId, phamVi: actionCenterScope(a, QUYEN_KE_TOAN_HOA_DON) }));
}

export async function nhacKeToanHoaDon(now: Date): Promise<KetQuaNhacKeToan> {
  const rong: KetQuaNhacKeToan = { boQua: null, choXuat: 0, coSo: 0, thongBao: 0, notified: 0 };
  if (!(await laHoaDonBat())) return { ...rong, boQua: "CO_TAT" };

  const { dong } = await napHangChoHoaDon(SYSTEM_ACTOR, { canViewPii: false });
  const cho = dong.filter((d) => NGAN_NHAC.includes(d.ngan));
  if (cho.length === 0) return rong;

  const don = await db.order.findMany({
    where: { id: { in: [...new Set(cho.map((d) => d.orderId))] } },
    select: { id: true, centerId: true },
  });
  const coSoCuaDon = new Map<string, string>();
  for (const d of don) if (d.centerId) coSoCuaDon.set(d.id, d.centerId);

  const dem = demChoTheoCoSo(cho, coSoCuaDon);
  const tb = dungThongBaoNhac({ dem, nguoiNhan: await timKeToan(now), ngay: now.toISOString().slice(0, 10) });

  let notified = 0;
  for (const t of tb) {
    notified += await notifyStaff(t);
  }
  return {
    boQua: null,
    choXuat: dem.reduce((s, d) => s + d.soLanThu, 0),
    coSo: dem.length,
    thongBao: tb.length,
    notified,
  };
}
