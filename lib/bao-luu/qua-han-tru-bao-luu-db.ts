import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CapHocVien } from "@/lib/bao-luu/dang-bao-luu";
import { docCapTheoDon } from "@/lib/bao-luu/dang-bao-luu-db";
import {
  giaoKhoang,
  hopNhatKhoang,
  tinhSoNgayQuaHanTruBaoLuu,
  type KhoangTamDung,
} from "@/lib/bao-luu/qua-han-tru-bao-luu";

// lib/bao-luu/qua-han-tru-bao-luu-db.ts — phần chạm DB của `soNgayQuaHanTruBaoLuu` (K19). Xem công thức + lý do ở `qua-han-tru-bao-luu.ts`.
//
// Mọi đường tính "đợt quá hạn bao nhiêu ngày" của SỔ CŨ và các cổng nợ đều đi qua đây — danh sách ở `qua-han-tru-bao-luu-wiring.test.ts` [KQH-W*].
//
// ⚠️ `db` TRẦN, cùng lý do `dang-bao-luu-db.ts`: đây là phép TRỪ khỏi số ngày nợ của phụ huynh; bị lọc theo tầm nhìn người xem thì khoảng bảo lưu ngoài tầm nhìn
// "biến mất" và cùng một đợt hiện số ngày khác nhau tuỳ ai mở màn (đúng lớp lỗi mà `lib/finance/debt.ts` đã cấm).
// ⚠️ HỎI THEO LÔ — một câu cho cả lô lượt bảo lưu (N+1 đã chết thật ở `backfill-orderitem-dry.ts`).

type Client = Prisma.TransactionClient | typeof db;

/** Trạng thái chứng tỏ hồ sơ ĐÃ TỪNG có hiệu lực (bé đã nghỉ thật). PENDING/APPROVED/REJECTED/CANCELLED chưa bao giờ. */
const DA_TUNG_HIEU_LUC = ["ACTIVE", "RESUME_PENDING", "OVERDUE", "NOTICE_SENT", "ENDED", "TERMINATED"] as const;

export type LuotDaHieuLuc = {
  studentId: string;
  enrollmentId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  isActive: boolean;
};

/**
 * MỌI lượt bảo lưu đã bắt đầu tới `homNay` của các học viên — kể cả ĐÃ KẾT THÚC (khác `docLuotCuaHocVien`, vốn chỉ lấy lượt còn hiệu lực): sau phục học vẫn phải biết bé
 * từng nghỉ bao lâu. Gồm cả hồ sơ cũ chưa `approvedAt` (đường tắt cũ, `isActive`) vì chúng cũng khiến bé không đi học thật.
 */
export async function docLuotDaHieuLuc(client: Client, studentIds: readonly string[], homNay: Date): Promise<LuotDaHieuLuc[]> {
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) return [];
  return client.studentReserve.findMany({
    where: {
      studentId: { in: ids },
      startedAt: { lte: homNay },
      OR: [{ status: { in: [...DA_TUNG_HIEU_LUC] } }, { isActive: true }],
    },
    select: { studentId: true, enrollmentId: true, startedAt: true, endedAt: true, isActive: true },
  });
}

/** Khoảng tạm dừng của MỘT bé (học viên × ghi danh). Cùng luật ghép với `dongNaoDangBaoLuu`: lượt "cả học viên" khớp mọi ghi danh, lượt một ghi danh chỉ khớp đúng nó. THUẦN. */
export function khoangCuaCap(cap: CapHocVien, luot: readonly LuotDaHieuLuc[]): KhoangTamDung[] {
  const ks: KhoangTamDung[] = [];
  for (const l of luot) {
    if (l.studentId !== cap.studentId) continue;
    if (l.enrollmentId !== null && l.enrollmentId !== cap.enrollmentId) continue;
    // Đang chạy ⇒ mở (`den = null`, tính tới hôm nay). Đã đóng ⇒ tới `endedAt`. Đóng mà thiếu `endedAt` (dữ liệu lệch) ⇒ khoảng rỗng, không đoán.
    ks.push({ tu: l.startedAt, den: l.endedAt ?? (l.isActive ? null : l.startedAt) });
  }
  return hopNhatKhoang(ks);
}

/** Khoảng tạm dừng của một ĐƠN = những ngày MỌI bé của đơn cùng bảo lưu. `cap = null` (không suy được bé) hoặc rỗng ⇒ không có khoảng nào. THUẦN. */
export function khoangCuaDon(cap: readonly CapHocVien[] | null, luot: readonly LuotDaHieuLuc[]): KhoangTamDung[] {
  if (!cap || cap.length === 0) return [];
  return giaoKhoang(cap.map((c) => khoangCuaCap(c, luot)));
}

/** Theo ĐƠN — cho sổ cũ `OrderInstallment` (chỉ có mức đơn). Đơn không có khoảng nào ⇒ KHÔNG có khoá trong Map. */
export async function docKhoangTheoDon(
  orderIds: readonly string[],
  homNay: Date,
  client: Client = db,
): Promise<Map<string, KhoangTamDung[]>> {
  const capTheoDon = await docCapTheoDon(orderIds, client);
  const sv = new Set<string>();
  for (const cap of capTheoDon.values()) for (const c of cap ?? []) sv.add(c.studentId);
  const luot = await docLuotDaHieuLuc(client, [...sv], homNay);
  const ra = new Map<string, KhoangTamDung[]>();
  if (luot.length === 0) return ra;
  for (const [orderId, cap] of capTheoDon) {
    const k = khoangCuaDon(cap, luot);
    if (k.length > 0) ra.set(orderId, k);
  }
  return ra;
}

/** Theo DÒNG HÀNG — cho sổ mới `PaymentRequest` (đợt gắn dòng hàng ⇒ gắn bé). Dòng chưa nối bé ⇒ không có khoảng (fail-closed: không trừ nhầm). */
export async function docKhoangTheoDong(
  orderItemIds: readonly string[],
  homNay: Date,
  client: Client = db,
): Promise<Map<string, KhoangTamDung[]>> {
  const ids = [...new Set(orderItemIds)];
  const ra = new Map<string, KhoangTamDung[]>();
  if (ids.length === 0) return ra;
  const dong = await client.orderItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, enrollmentId: true, studentId: true, enrollment: { select: { studentId: true } } },
  });
  const capTheoDong = new Map<string, CapHocVien>();
  for (const d of dong) {
    const studentId = d.enrollment?.studentId ?? d.studentId;
    if (studentId) capTheoDong.set(d.id, { studentId, enrollmentId: d.enrollmentId });
  }
  const luot = await docLuotDaHieuLuc(client, [...new Set([...capTheoDong.values()].map((c) => c.studentId))], homNay);
  if (luot.length === 0) return ra;
  for (const [id, cap] of capTheoDong) {
    const k = khoangCuaCap(cap, luot);
    if (k.length > 0) ra.set(id, k);
  }
  return ra;
}

/**
 * HÀM DÙNG CHUNG theo chữ chủ dự án chốt (K19): số ngày quá hạn của một đợt, trừ thời gian bảo lưu của ghi danh. Dùng cho một đợt lẻ; chỗ nào có LÔ đợt thì dùng
 * `docKhoang*` một lần rồi `tinhSoNgayQuaHanTruBaoLuu` — gọi hàm này trong vòng lặp là N+1.
 */
export async function soNgayQuaHanTruBaoLuu(
  hanDot: Date,
  homNay: Date,
  enrollmentId: string,
  client: Client = db,
): Promise<number> {
  const gd = await client.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true, studentId: true } });
  if (!gd) return tinhSoNgayQuaHanTruBaoLuu(hanDot, homNay, []);
  const luot = await docLuotDaHieuLuc(client, [gd.studentId], homNay);
  return tinhSoNgayQuaHanTruBaoLuu(hanDot, homNay, khoangCuaCap({ studentId: gd.studentId, enrollmentId: gd.id }, luot));
}
