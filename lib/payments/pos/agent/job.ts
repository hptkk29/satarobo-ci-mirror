import "server-only";
// lib/payments/pos/agent/job.ts — "ĐỒNG BỘ NGAY" cho một lượt sale bấm Kiểm tra (`PosCheckJob`, GĐ4 POS). §6.3.
//
// ⚠️ KHÔNG `$transaction` ở tệp này (lưới [POS4-W9]): `choJobXong` chờ tối đa 8″ SAU khi `giuLuotKiem` đã
// commit và TRƯỚC khi `xuLyKetQuaPos` mở pha tiền — mỗi lượt hỏi là MỘT câu đơn, không giữ khoá đơn, khoá
// dòng hay kết nối nào trong lúc chờ.
import { db } from "@/lib/db";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { laThoiDiemCoMui } from "../kieu";
import { JOB_SONG_MS } from "./hop-dong";

/** Cửa sổ lùi của phiếu (khớp `CUA_SO_LUI_MS` của provider): agent quét từ lúc tạo phiếu − 5′. */
const LUI_QUET_MS = 5 * 60_000;
/** Trần job trả cho agent một lượt (hợp đồng §4.3). */
const TRAN_JOB_TRA = 20;

/**
 * Một job PENDING / phiếu (T18) — rà đối kháng RV-06 ĐẢO vế "dùng lại job trẻ": job PENDING CŨ của phiếu (mọi
 * agent, mọi tuổi) ⇒ EXPIRED (bị THAY), rồi tạo job MỚI mang `createdAt` = lúc bấm này. Dùng lại job mà agent ĐÃ
 * lấy là để một lượt đồng bộ bắt đầu TRƯỚC lần quẹt mới đóng nó ⇒ lượt bấm sau đọc dữ liệu cũ, vượt T6 ("cho quẹt
 * lại" khi khách vừa quẹt thành công — ca [POS4-RV-06b]). Bấm dồn đã bị cửa sổ 5″ của GĐ2 chặn TRƯỚC khi tới đây,
 * nên số job / phiếu vẫn nhỏ. Job bị thay KHÔNG vào chuông "agent không trả lời" (`hetHanJobCu` chỉ nhặt PENDING).
 * `centerId` = cơ sở của phiếu — đặt TƯỜNG MINH, scopedDb không che write.
 */
export async function datJobKiem(x: {
  intent: { id: string; centerId: string; createdAt: Date };
  agentId: string;
  now: Date;
}): Promise<{ id: string }> {
  await db.posCheckJob.updateMany({
    where: { intentId: x.intent.id, status: "PENDING" },
    data: { status: "EXPIRED" },
  });
  const moi = await db.posCheckJob.create({
    data: {
      intentId: x.intent.id,
      agentId: x.agentId,
      centerId: x.intent.centerId,
      status: "PENDING",
      tuLuc: new Date(x.intent.createdAt.getTime() - LUI_QUET_MS),
      createdAt: x.now,
    },
    select: { id: true },
  });
  return { id: moi.id };
}

/**
 * Chờ job DONE tối đa `hanMs`, hỏi DB mỗi `nhipMs` (tối đa 8 000 / 400 + 1 = 21 câu đơn). `ngu` +
 * `dongHoDonDieu` TIÊM VÀO (test chạy không đồng hồ thật — luật 19). Job EXPIRED / biến mất ⇒ thôi chờ.
 */
export async function choJobXong(
  jobId: string,
  o: { hanMs: number; nhipMs: number; ngu: (ms: number) => Promise<void>; dongHoDonDieu: () => number },
): Promise<boolean> {
  const t0 = o.dongHoDonDieu();
  for (;;) {
    const j = await db.posCheckJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (j?.status === "DONE") return true;
    if (!j || j.status === "EXPIRED") return false;
    const conLai = o.hanMs - (o.dongHoDonDieu() - t0);
    if (conLai <= 0) return false;
    await o.ngu(Math.min(o.nhipMs, conLai));
  }
}

/** `GET /jobs` — job PENDING trẻ (≤ 2′) của CHÍNH agent, cũ trước, tối đa 20 (hợp đồng §4.3). */
export async function docJobChoAgent(
  agentId: string,
  now: Date,
): Promise<{ id: string; createdAt: string; scanFrom: string }[]> {
  const ds = await db.posCheckJob.findMany({
    where: { agentId, status: "PENDING", createdAt: { gte: new Date(now.getTime() - JOB_SONG_MS), lte: now } },
    orderBy: { createdAt: "asc" },
    take: TRAN_JOB_TRA,
    select: { id: true, createdAt: true, tuLuc: true },
  });
  return ds.map((j) => ({ id: j.id, createdAt: gioVN(j.createdAt), scanFrom: gioVN(j.tuLuc) }));
}

/**
 * `windowTo` của lô (chuỗi `YYYY-MM-DD HH:mm:ss` GIỜ VN — hợp đồng §4.4) ⇒ mốc tuyệt đối. Ghép offset +07:00 TƯỜNG
 * MINH (không phụ thuộc TZ máy chủ). Không đọc được ⇒ `null` ⇒ không DONE job nào (fail-closed).
 *
 * Rà đối kháng bản gộp (RVG-04): "đọc được" = ngày / giờ CÓ THẬT, so lại từng thành phần (`laThoiDiemCoMui` — bài học
 * V3 của GĐ3). Mã TRƯỚC chỉ hỏi `Date.parse` ⇒ V8 CUỘN "2026-02-30" thành 02/03 và nhận "24:00" ⇒ một mốc vô lý thành
 * cận trên cửa sổ (đóng job / ghi "dữ liệu đã đọc tới") thay vì `null`.
 */
export function mocCuaSoDen(windowTo: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(windowTo)) return null;
  const iso = `${windowTo.replace(" ", "T")}+07:00`;
  return laThoiDiemCoMui(iso) ? new Date(iso) : null;
}

/**
 * Lô `final:true` đã ghi xong ⇒ DONE các job agent gửi kèm — CHỈ job PENDING của CHÍNH agent (job agent khác
 * bị bỏ qua — [POS4-JOB-04]) VÀ tạo KHÔNG MUỘN HƠN cận trên cửa sổ lượt này đã quét (rà đối kháng RV-06: cửa sổ
 * không phủ lúc sale bấm ⇒ lượt này có thể thiếu chính lần quẹt sale đang hỏi; job GIỮ PENDING ⇒ T6 trả "chưa trả
 * lời kịp", lượt sau của agent đóng nó). Biên `≤`, không dung sai (dung sai nào cũng là nới về phía nguy hiểm).
 * Gọi SAU `nhapLoPos(` (lưới [POS4-W8]).
 */
export async function danhDauJobXong(agentId: string, jobIds: readonly string[], windowTo: string, now: Date): Promise<number> {
  const den = mocCuaSoDen(windowTo);
  if (jobIds.length === 0 || den === null) return 0;
  const r = await db.posCheckJob.updateMany({
    where: { id: { in: [...jobIds] }, agentId, status: "PENDING", createdAt: { lte: den } },
    data: { status: "DONE", doneAt: now },
  });
  return r.count;
}

/** Cron giám sát: PENDING > 2′ ⇒ EXPIRED. Trả các job vừa hết hạn (để báo agent không trả lời). */
export async function hetHanJobCu(now: Date): Promise<{ id: string; agentId: string; createdAt: Date }[]> {
  const cu = await db.posCheckJob.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - JOB_SONG_MS) } },
    select: { id: true, agentId: true, createdAt: true },
    take: 500,
  });
  if (cu.length === 0) return [];
  await db.posCheckJob.updateMany({ where: { id: { in: cu.map((j) => j.id) }, status: "PENDING" }, data: { status: "EXPIRED" } });
  return cu;
}
