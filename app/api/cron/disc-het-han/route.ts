import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { vongDoiClaimedStore, vongDoiStore } from "@/lib/disc/store-prisma";
import { chayHetHan, chayHetHanClaimed, hanLuuClaimedNgay } from "@/lib/disc/vong-doi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// DISC F-07 — bài CHƯA nhận quá `retainUntil` ⇒ EXPIRED + xoá nội dung trẻ (DiscSubject, điểm, email, mã băm).
// Hàng ngày. KHÔNG gác bằng cờ DISC_ENABLED: tắt tính năng không được làm dừng việc xoá dữ liệu trẻ đã
// hết hạn (nếu không, tắt cờ = dữ liệu nằm lại vô thời hạn). Idempotent: chạy lại không làm gì thêm.
// Phản hồi chỉ có SỐ ĐẾM — không id, không SĐT.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const now = new Date();
    const data = await chayHetHan({ store: vongDoiStore, now });
    // Bài ĐÃ NHẬN: chỉ hết hạn khi người vận hành ĐẶT `DISC_HAN_LUU_CLAIMED_NGAY` (quyết định pháp lý) — mặc định TẮT.
    const claimed = await chayHetHanClaimed({ store: vongDoiClaimedStore, now, hanNgay: hanLuuClaimedNgay() });
    return NextResponse.json({ ok: true, data: { ...data, claimed } });
  } catch (e) {
    // P3: crontab có thể cài TRƯỚC khi người vận hành chạy tay migration 20261114* ⇒ bảng chưa có ⇒ không có gì để xoá.
    // Chỉ nuốt ĐÚNG lỗi "bảng/quan hệ Disc* không tồn tại"; mọi lỗi khác (mất kết nối, quyền, lỗi mã) vẫn 500.
    if (laLoiBangDiscChuaCo(e)) return NextResponse.json({ ok: true, data: { skipped: "CHUA_MIGRATE" } });
    return NextResponse.json({ ok: false, error: "disc-het-han that bai" }, { status: 500 });
  }
}

function laLoiBangDiscChuaCo(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = (e.meta ?? {}) as { table?: unknown; code?: unknown; message?: unknown };
  if (e.code === "P2021") return /Disc/.test(String(meta.table ?? e.message));
  if (e.code === "P2010") return meta.code === "42P01" && /Disc/.test(String(meta.message ?? e.message));
  return false;
}
