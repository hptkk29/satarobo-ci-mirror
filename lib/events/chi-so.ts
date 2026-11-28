// lib/events/chi-so.ts — V8.29: CHỈ SỐ GIÁM SÁT dispatcher DomainEvent (CHỈ ĐỌC). Dùng cho script vận hành (`scripts/ops/dispatcher-metrics.ts`) và truy vấn SQL chạy tay ở TEST/PROD.
// Mọi con số lấy từ BẢNG DomainEvent bằng đồng hồ của DB (`now()`); riêng «lần dispatcher chạy thành công gần nhất» DB không biết (cron chạy mà không có sự kiện nào) nên
// người gọi truyền vào từ NGUỒN NGOÀI: UAT = `status.json` của dispatcher-runner; TEST/PROD = dòng cuối của tệp log cron trên máy chủ (`dispatch-events 200`).
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Một câu duy nhất (bản chạy tay ở TEST/PROD đọc ĐÚNG văn bản này — `[DSP-13]` ghim tệp `docs/mobile-integration/ops-dispatcher/dispatcher-chi-so.sql`).
 * Quét giới hạn: hàng chưa xong (PENDING/PROCESSING/FAILED) + hàng 24 giờ gần nhất — không đọc cả lịch sử.
 */
export const CHI_SO_SQL = `SELECT
  count(*) FILTER (WHERE "status" = 'PENDING')::int AS pending,
  count(*) FILTER (WHERE "status" = 'PROCESSING')::int AS processing,
  count(*) FILTER (WHERE "status" = 'FAILED')::int AS failed,
  count(*) FILTER (WHERE "status" = 'PENDING' AND "attempts" > 0)::int AS dang_retry,
  COALESCE(sum(GREATEST("attempts" - 1, 0)) FILTER (WHERE "createdAt" >= now() - interval '24 hours'), 0)::int AS so_lan_retry_24h,
  COALESCE(EXTRACT(EPOCH FROM (now() - min("createdAt") FILTER (WHERE "status" = 'PENDING'))), 0)::float8 AS tuoi_pending_lau_nhat_giay,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(COALESCE("heartbeatAt", "claimedAt", "createdAt")) FILTER (WHERE "status" = 'PROCESSING'))), 0)::float8 AS giay_khong_nhip_tim_lau_nhat,
  (percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("processedAt" - "claimedAt")) * 1000)
    FILTER (WHERE "status" = 'DONE' AND "claimedAt" IS NOT NULL AND "processedAt" IS NOT NULL AND "processedAt" >= now() - interval '24 hours'))::float8 AS p95_xu_ly_ms,
  count(*) FILTER (WHERE "status" = 'DONE' AND "claimedAt" IS NOT NULL AND "processedAt" IS NOT NULL AND "processedAt" >= now() - interval '24 hours')::int AS mau_p95,
  max("processedAt") FILTER (WHERE "status" = 'DONE') AS xu_ly_xong_gan_nhat
FROM "DomainEvent"
WHERE "status" IN ('PENDING', 'PROCESSING', 'FAILED') OR "createdAt" >= now() - interval '24 hours'`;

export type ChiSoDispatcher = {
  pending: number;
  processing: number;
  failed: number;
  /** PENDING đã từng bị thử (attempts > 0) — đang chờ retry. */
  dangRetry: number;
  /** Σ max(attempts − 1, 0) trên sự kiện tạo trong 24 giờ qua. */
  soLanRetry24h: number;
  tuoiPendingLauNhatGiay: number;
  /** Lâu nhất kể từ nhịp tim (hoặc claimedAt, hoặc createdAt với hàng cũ) của một sự kiện PROCESSING — lớn ⇒ worker treo/sập. */
  giayKhongNhipTimLauNhat: number;
  /** p95 (processedAt − claimedAt) của sự kiện DONE trong 24 giờ; null nếu chưa có mẫu (hàng cũ chưa có claimedAt không tính). */
  p95XuLyMs: number | null;
  mauP95: number;
  xuLyXongGanNhat: string | null;
};

type Hang = {
  pending: number;
  processing: number;
  failed: number;
  dang_retry: number;
  so_lan_retry_24h: number;
  tuoi_pending_lau_nhat_giay: number;
  giay_khong_nhip_tim_lau_nhat: number;
  p95_xu_ly_ms: number | null;
  mau_p95: number;
  xu_ly_xong_gan_nhat: Date | null;
};

export async function docChiSoDispatcher(): Promise<ChiSoDispatcher> {
  const [h] = await db.$queryRaw<Hang[]>(Prisma.raw(CHI_SO_SQL));
  if (!h) throw new Error("không đọc được chỉ số DomainEvent");
  return {
    pending: Number(h.pending),
    processing: Number(h.processing),
    failed: Number(h.failed),
    dangRetry: Number(h.dang_retry),
    soLanRetry24h: Number(h.so_lan_retry_24h),
    tuoiPendingLauNhatGiay: Math.round(Number(h.tuoi_pending_lau_nhat_giay)),
    giayKhongNhipTimLauNhat: Math.round(Number(h.giay_khong_nhip_tim_lau_nhat)),
    p95XuLyMs: h.p95_xu_ly_ms === null ? null : Math.round(Number(h.p95_xu_ly_ms)),
    mauP95: Number(h.mau_p95),
    xuLyXongGanNhat: h.xu_ly_xong_gan_nhat ? new Date(h.xu_ly_xong_gan_nhat).toISOString() : null,
  };
}

export type MucCanhBao = "OK" | "WARN" | "CRIT";
export type KetQuaDanhGia = { muc: MucCanhBao; canhBao: string[] };

/** Ngưỡng mặc định (giây/ms). `nhipGiay` = nhịp cron của môi trường (UAT 60, PROD 60, TEST 300 — GIỮ nguyên khi nghiệm thu). */
export type NguongChiSo = { nhipGiay: number; pendingWarnGiay?: number; pendingCritGiay?: number; khongNhipTimCritGiay?: number; p95WarnMs?: number };

/**
 * THUẦN. `giayTuLanCronOkCuoi`: số giây kể từ lần dispatcher gọi THÀNH CÔNG gần nhất (nguồn ngoài); `null` = không có nguồn ⇒ bỏ qua kiểm này (và nói rõ).
 * Quy tắc: FAILED > 0 ⇒ WARN · PENDING cũ > max(3×nhịp, 10') ⇒ WARN, > max(6×nhịp, 30') ⇒ CRIT · PROCESSING không nhịp tim > 10' ⇒ CRIT ·
 * lần cron OK gần nhất > 3×nhịp ⇒ CRIT (dispatcher không chạy) · p95 xử lý > 30 s ⇒ WARN.
 */
export function danhGiaChiSo(c: ChiSoDispatcher, giayTuLanCronOkCuoi: number | null, n: NguongChiSo): KetQuaDanhGia {
  const canhBao: string[] = [];
  let muc: MucCanhBao = "OK";
  const nang = (m: MucCanhBao) => { if (m === "CRIT" || (m === "WARN" && muc === "OK")) muc = m; };
  const warnPending = n.pendingWarnGiay ?? Math.max(3 * n.nhipGiay, 600);
  const critPending = n.pendingCritGiay ?? Math.max(6 * n.nhipGiay, 1800);
  const critTreo = n.khongNhipTimCritGiay ?? 600;
  if (c.failed > 0) { canhBao.push(`${c.failed} sự kiện FAILED — đọc DomainEvent.lastError`); nang("WARN"); }
  if (c.tuoiPendingLauNhatGiay > critPending) { canhBao.push(`PENDING cũ nhất ${c.tuoiPendingLauNhatGiay}s > ${critPending}s — dispatcher không chạy hoặc quá tải`); nang("CRIT"); }
  else if (c.tuoiPendingLauNhatGiay > warnPending) { canhBao.push(`PENDING cũ nhất ${c.tuoiPendingLauNhatGiay}s > ${warnPending}s`); nang("WARN"); }
  if (c.processing > 0 && c.giayKhongNhipTimLauNhat > critTreo) { canhBao.push(`PROCESSING không nhịp tim ${c.giayKhongNhipTimLauNhat}s > ${critTreo}s — worker sập/treo (reaper sẽ thu hồi khi lease hết hạn)`); nang("CRIT"); }
  if (giayTuLanCronOkCuoi === null) canhBao.push("không có nguồn «lần dispatcher thành công gần nhất» — chưa kiểm được dispatcher có chạy");
  else if (giayTuLanCronOkCuoi > 3 * n.nhipGiay) { canhBao.push(`lần dispatcher thành công gần nhất cách đây ${giayTuLanCronOkCuoi}s > 3×nhịp (${3 * n.nhipGiay}s)`); nang("CRIT"); }
  if (c.p95XuLyMs !== null && c.p95XuLyMs > (n.p95WarnMs ?? 30_000)) { canhBao.push(`p95 xử lý ${c.p95XuLyMs}ms > ${n.p95WarnMs ?? 30_000}ms`); nang("WARN"); }
  return { muc, canhBao };
}
