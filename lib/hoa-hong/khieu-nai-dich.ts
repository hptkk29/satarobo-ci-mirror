// lib/hoa-hong/khieu-nai-dich.ts — ĐÍCH của một khiếu nại: "dòng của mình" hoặc "khoản thu có quan hệ". CHỈ ĐỌC.
//
// Nguồn: docs/source-commission/05 §1.2 (`laDongCuaToi`, `coTheKhieuNaiKhoanThu`), 04 §15, 02 §9.5.
//
// ── Hai cổng, MỘT câu lỗi ─────────────────────────────────────────────────────────────────────────────────
// "Không tồn tại", "của người khác" và "không có quan hệ" đều ném CÙNG mã `KHONG_TIM_THAY_DICH` với CÙNG câu chữ: câu khác nhau là cho người
// khiếu nại dò xem khoản thu / dòng hoa hồng của người khác có tồn tại không (ca `[NHH-DSP-02b]` so hai thông báo bằng `toBe`).
//
// ── Điều đã quyết khi 05 §1.2 mơ hồ ─────────────────────────────────────────────────────────────────────────
// 05 §1.2 đòi vế (a) "khoản nằm trong tầm nhìn `scopedDb` của actor" cho khoản thu. Hiện thực thay (a) bằng "khoản thuộc THỰC THU" (còn hiệu lực).
// Lý do: tầm nhìn cơ sở chặn đúng người cần khiếu nại — người giới thiệu là nhân sự cơ sở khác, chủ lead CS1 của đơn CS2 (ca "lead CS1, đơn
// CS2" của COM-10, 02 §11.1). Cổng cách ly ở đây là vế (b) QUAN HỆ, không phải cơ sở. Nếu chủ dự án muốn giữ (a) nguyên văn thì đó là một dòng
// `passesScope` ở `coTheKhieuNaiKhoanThu` — ghi vào sổ quyết định.
import type { Prisma, PrismaClient } from "@prisma/client";

import { findAttendedTrialForLeadChild } from "@/lib/crm/trial-teacher-commission";
import { docNguonChoHoaHong } from "@/lib/nguon/doc-nguon-hoa-hong";

import type { DichKhieuNai } from "./khieu-nai-dau-vao";
import { quanHeVoiKhoan, type QuanHe } from "./khieu-nai-quan-he";
import { HoaHongError } from "./kieu";
import { kyTuNhienCua } from "./but-toan";
import { conThucThu, docKhoan } from "./nap-khoan";
import { docCoSoCuaKhoan } from "./quet-khoan";

type Khach = PrismaClient | Prisma.TransactionClient;

/** Câu DUY NHẤT cho mọi lý do "không khiếu nại được đích này" — không lộ đích có tồn tại hay không. */
export const CAU_KHONG_TIM_THAY_DICH = "Không tìm thấy dòng hoa hồng hoặc khoản thu để khiếu nại.";
const khongTimThay = () => new HoaHongError("KHONG_TIM_THAY_DICH", CAU_KHONG_TIM_THAY_DICH);

export type DichDaXacDinh = {
  dich: DichKhieuNai;
  transactionId: string | null;
  paymentId: string | null;
  centerId: string;
  orgUnitId: string;
  /** Kỳ hiệu lực của đích ("YYYY-MM") — cho thông báo ("khiếu nại về dòng kỳ 2026-10"); không phải kỳ ghi sổ. */
  ky: string;
  /** Quan hệ đã xác lập (chỉ có với đích KHOẢN THU). */
  quanHe: QuanHe[];
};

/** Dòng sổ của CHÍNH người này (người hưởng loại USER). */
export async function laDongCuaToi(
  client: Khach,
  userId: string,
  transactionId: string,
): Promise<{ id: string; paymentId: string | null; centerId: string; orgUnitId: string; naturalPeriod: string } | null> {
  if (!userId) return null;
  return client.commissionTransaction.findFirst({
    where: { id: transactionId, beneficiaryKind: "USER", beneficiaryUserId: userId },
    select: { id: true, paymentId: true, centerId: true, orgUnitId: true, naturalPeriod: true },
  });
}

/**
 * Khoản thu "lẽ ra tôi được hưởng" (05 §1.2): khoản còn thuộc thực thu ∧ người này có QUAN HỆ với lead/đơn của khoản. Trả `null` khi không
 * khiếu nại được — vì BẤT KỲ lý do nào (cùng một kết quả cho người gọi).
 */
export async function coTheKhieuNaiKhoanThu(
  client: Khach,
  userId: string,
  paymentId: string,
): Promise<{ centerId: string; orgUnitId: string; ky: string; quanHe: QuanHe[] } | null> {
  if (!userId || !paymentId) return null;
  const p = await docKhoan(client, paymentId);
  if (!p || !conThucThu(p)) return null;

  const leadId = p.order?.leadId ?? null;
  const [lead, nguon, trial] = await Promise.all([
    leadId ? client.lead.findUnique({ where: { id: leadId }, select: { convertedById: true, adminId: true, assignedToId: true } }) : Promise.resolve(null),
    leadId ? docNguonChoHoaHong(client, leadId) : Promise.resolve(null),
    p.order?.leadChildId ? findAttendedTrialForLeadChild(client as never, p.order.leadChildId) : Promise.resolve(null),
  ]);
  const nv = nguon?.referrerEmployeeId
    ? await client.user.findFirst({ where: { employeeId: nguon.referrerEmployeeId }, select: { id: true } })
    : null;

  const quanHe = quanHeVoiKhoan(userId, {
    lead,
    referrerParentUserId: nguon?.referrerParentUserId ?? null,
    referrerEmployeeUserId: nv?.id ?? null,
    gvTrialUserId: trial?.teacherUserId ?? null,
  });
  if (quanHe.length === 0) return null;

  const co = await docCoSoCuaKhoan(client, p);
  if ("thieu" in co) return null;
  return { centerId: co.co.centerId, orgUnitId: co.co.orgUnitId, ky: kyTuNhienCua(p.paidDate), quanHe };
}

/**
 * Xác định đích để TẠO khiếu nại. Ném `KHONG_TIM_THAY_DICH` (một câu) cho mọi lý do không hợp lệ, ngoại trừ một ca người khiếu nại ĐÃ có quan
 * hệ và đã biết khoản đó: khoản thu đã có dòng của chính họ ⇒ `DA_CO_DONG_CUA_BAN` (chỉ đường sang khiếu nại dòng đó).
 */
export async function docDichDeTao(client: Khach, userId: string, dich: DichKhieuNai): Promise<DichDaXacDinh> {
  if (dich.loai === "DONG") {
    const d = await laDongCuaToi(client, userId, dich.id);
    if (!d) throw khongTimThay();
    return { dich, transactionId: d.id, paymentId: null, centerId: d.centerId, orgUnitId: d.orgUnitId, ky: d.naturalPeriod, quanHe: [] };
  }
  const k = await coTheKhieuNaiKhoanThu(client, userId, dich.id);
  if (!k) throw khongTimThay();
  const coDong = await client.commissionTransaction.count({ where: { paymentId: dich.id, beneficiaryKind: "USER", beneficiaryUserId: userId } });
  if (coDong > 0) {
    throw new HoaHongError("DA_CO_DONG_CUA_BAN", "Khoản thu này đã có dòng hoa hồng của bạn — hãy khiếu nại trực tiếp dòng đó.");
  }
  return { dich, transactionId: null, paymentId: dich.id, centerId: k.centerId, orgUnitId: k.orgUnitId, ky: k.ky, quanHe: k.quanHe };
}

/**
 * Khiếu nại đã duyệt theo cách "sửa nguồn" có ĐÓNG được chưa: đã có dòng `SOURCE_CORRECTION` của khoản thu sinh ra sau lúc khiếu nại được GỬI
 * chưa. MỘT hàm cho service đóng (`dongKhieuNaiDoiNguon`) và cho màn (nút "Đóng" có sáng hay không) — hai chỗ tự đếm là hai luật.
 * Mốc là `createdAt` của khiếu nại (giờ DB) chứ không phải `decidedAt` (giờ ứng dụng): so hai đồng hồ khác nhau thì lệch vài mili-giây là đủ để
 * một dòng đúng bị coi là "cũ".
 */
export async function demDongDoiNguonSauKhiGui(
  client: Khach,
  d: { paymentId: string | null; transactionId: string | null; createdAt: Date },
): Promise<{ khoanThu: string | null; soDong: number }> {
  const paymentId =
    d.paymentId ??
    (d.transactionId ? ((await client.commissionTransaction.findUnique({ where: { id: d.transactionId }, select: { paymentId: true } }))?.paymentId ?? null) : null);
  if (!paymentId) return { khoanThu: null, soDong: 0 };
  const soDong = await client.commissionTransaction.count({ where: { entryKind: "SOURCE_CORRECTION", paymentId, createdAt: { gte: d.createdAt } } });
  return { khoanThu: paymentId, soDong };
}
