import { withCron } from "@/lib/cron/handler";
import { db } from "@/lib/db";
import { chayDoiSoatLuotQuaHan } from "@/lib/online-thi/doi-soat-luot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// V8.45 · ONLINE EXAM P0 — mỗi 1 phút. Tự chốt lượt thi Online QUÁ HẠN (dueAt + 60 s) từ nháp đã ACK: có nháp ⇒ chấm (cùng đường với nộp), không nháp ⇒ EXPIRED; tự luận/sản phẩm ⇒ chờ chấm tay.
// IDEMPOTENT, SKIP LOCKED (an toàn hai worker), CHẠY BÙ (quét mọi lượt quá hạn còn tồn, không chờ sự kiện), phân trang theo lô 200 × tối đa 20 vòng. KHÔNG ghi thay đổi quyền.
// Không phụ thuộc cờ ELEARNING_ONLINE_ENABLED: lượt đã tồn tại thì phải được chốt kể cả khi giao diện tắt.
export const GET = withCron("online-thi-doi-soat", async () => {
  const r = await chayDoiSoatLuotQuaHan(db, { now: () => new Date() });
  console.info(`[online-thi-doi-soat] vòng ${r.soVong} · đã chốt ${r.daChot} · hết hạn không nháp ${r.hetHanKhongNhap} · bỏ qua(khoá) ${r.boQua} · lỗi ${r.loi.length} · còn lại ${r.conLai}`);
  return { ok: true, data: { soVong: r.soVong, daChot: r.daChot, hetHanKhongNhap: r.hetHanKhongNhap, boQua: r.boQua, loi: r.loi.slice(0, 20), conLai: r.conLai } };
});
