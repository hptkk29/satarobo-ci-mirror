import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isElearningOnlineEnabled } from "@/lib/flags";
import { docBaiHocThu, docChiTietCongKhai, docKhoaCongKhai, locCongKhaiSchema } from "./danh-muc-cong-khai";

/**
 * E-LEARNING ONLINE — LỚP HTTP của API đọc danh mục công khai (hợp đồng §4). Route handler chỉ gọi các hàm ở đây để test được không cần Next.
 *
 * - Cờ `ELEARNING_ONLINE_ENABLED` TẮT ⇒ 404 trống (như chưa có API).
 * - Chỉ GET. Không cookie, không phiên, không đọc `Authorization` — mọi người nhận cùng một phản hồi ⇒ cache công khai được.
 * - Lỗi đầu vào ⇒ 400 mã `THAM_SO_KHONG_HOP_LE`. Không tìm thấy / không công khai / bài trả phí ⇒ CÙNG một 404 `KHONG_TIM_THAY`.
 * - Hình dạng phản hồi: `{ ok: true, data }` hoặc `{ ok: false, error: { code, message } }` (khuôn chung của repo).
 */

const CACHE = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } as const;
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

const loi = (status: number, code: string, message: string) => NextResponse.json({ ok: false, error: { code, message } }, { status, headers: KHONG_LUU });
const tat = () => new NextResponse(null, { status: 404, headers: KHONG_LUU });

export async function xuLyDanhSach(url: URL, now: Date = new Date()): Promise<NextResponse> {
  if (!isElearningOnlineEnabled()) return tat();
  const tho = Object.fromEntries(url.searchParams.entries());
  const p = locCongKhaiSchema.safeParse(tho);
  if (!p.success) return loi(400, "THAM_SO_KHONG_HOP_LE", p.error.issues[0]?.message ?? "Tham số không hợp lệ");
  const kq = await docKhoaCongKhai(db, p.data, now);
  return NextResponse.json({ ok: true, data: { khoa: kq.khoa, tong: kq.tong, trang: p.data.trang ?? 1, coTrang: p.data.coTrang ?? 12 } }, { headers: CACHE });
}

export async function xuLyChiTiet(slug: string, now: Date = new Date()): Promise<NextResponse> {
  if (!isElearningOnlineEnabled()) return tat();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return loi(404, "KHONG_TIM_THAY", "Không tìm thấy khoá");
  const k = await docChiTietCongKhai(db, slug, now);
  if (!k) return loi(404, "KHONG_TIM_THAY", "Không tìm thấy khoá");
  return NextResponse.json({ ok: true, data: k }, { headers: CACHE });
}

export async function xuLyHocThu(slug: string, bai: string): Promise<NextResponse> {
  if (!isElearningOnlineEnabled()) return tat();
  if (!/^[a-z0-9-]{1,120}$/.test(slug) || !/^[A-Za-z0-9_-]{1,64}$/.test(bai)) return loi(404, "KHONG_TIM_THAY", "Không tìm thấy bài học thử");
  const b = await docBaiHocThu(db, slug, bai);
  if (!b) return loi(404, "KHONG_TIM_THAY", "Không tìm thấy bài học thử");
  return NextResponse.json({ ok: true, data: b }, { headers: CACHE });
}
