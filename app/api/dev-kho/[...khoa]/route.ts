import { docKhoLocal, ghiKhoLocal, khoLocalDangBat, kiemUrlLocal } from "@/lib/mobile-api/kho-tep-rieng";

export const dynamic = "force-dynamic";

/**
 * TUYẾN CHỈ ĐỂ THỬ NGHIỆM CỤC BỘ — đóng vai kho đối tượng (PUT/GET) cho bộ điều hợp `local`. KHÔNG tồn tại với production: khi `MOBILE_UPLOAD_LOCAL_DIR` chưa đặt
 * hoặc NODE_ENV=production ⇒ 404. Mọi lời gọi phải mang chữ ký HMAC (hành động, khoá, hết hạn, loại) do máy chủ cấp.
 */
const TRAN_BYTE = 130 * 1024 * 1024;
const khong = () => new Response(null, { status: 404 });

async function xet(req: Request, ctx: { params: Promise<{ khoa: string[] }> }, act: "put" | "get") {
  if (!khoLocalDangBat()) return { loi: khong() };
  const { khoa } = await ctx.params;
  const key = khoa.join("/");
  const u = new URL(req.url);
  const e = Number(u.searchParams.get("e"));
  const c = u.searchParams.get("c") ?? "";
  if (u.searchParams.get("act") !== act || !kiemUrlLocal(act, key, e, c, u.searchParams.get("s") ?? "")) return { loi: new Response("forbidden", { status: 403 }) };
  return { key, c };
}

export async function PUT(req: Request, ctx: { params: Promise<{ khoa: string[] }> }): Promise<Response> {
  const r = await xet(req, ctx, "put");
  if (r.loi) return r.loi; // `"loi" in r` không thu hẹp được hợp hai dạng ⇒ GET/PUT trả `Response | undefined` (tích hợp A+E 25/11)
  if ((req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== r.c.toLowerCase()) return new Response("content-type", { status: 400 });
  const du = new Uint8Array(await req.arrayBuffer());
  if (du.byteLength > TRAN_BYTE) return new Response("too large", { status: 413 });
  await ghiKhoLocal(r.key, r.c, du);
  return new Response(null, { status: 200 });
}

export async function GET(req: Request, ctx: { params: Promise<{ khoa: string[] }> }): Promise<Response> {
  const r = await xet(req, ctx, "get");
  if (r.loi) return r.loi; // `"loi" in r` không thu hẹp được hợp hai dạng ⇒ GET/PUT trả `Response | undefined` (tích hợp A+E 25/11)
  const f = await docKhoLocal(r.key);
  if (!f) return khong();
  return new Response(new Uint8Array(f.du), { status: 200, headers: { "Content-Type": f.contentType ?? "application/octet-stream", "Content-Disposition": "attachment", "Cache-Control": "private, no-store" } });
}
