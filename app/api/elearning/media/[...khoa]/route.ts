import { type NextRequest } from "next/server";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { fail } from "@/lib/api/response";
import { getR2Client } from "@/lib/storage/r2-client";
import { getElearningBucket } from "@/lib/storage/elearning-storage";
import { kiemVeMedia, khoaThuocBai } from "@/lib/elearning/media-ticket";
import { docRange, rangeChoR2 } from "@/lib/elearning/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EL-10 — PHÁT MEDIA ĐÀO TẠO, hỗ trợ HTTP Range.
//
// ⚠️ TRUYỀN DÒNG, tuyệt đối không nạp tệp vào RAM. Đường phát SCORM hiện tại làm
// `transformToByteArray()` + `Buffer.from` (`app/api/scorm/asset/[...path]/route.ts:80`)
// — với gói SCORM vài MB thì chịu được, với video 200MB thì mỗi lượt xem đồng
// thời ngốn ~2× dung lượng tệp và hàm chết. Đây là lý do route này tồn tại riêng
// thay vì dùng lại đường kia.
//
// ⚠️ `Cache-Control: no-store`. Đường SCORM đặt `private, max-age=3600` — cache
// SỐNG LÂU HƠN vé, nên tệp còn phát được sau khi vé hết hạn. Đừng chép lỗi đó.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ khoa: string[] }> },
) {
  const { khoa: manh } = await ctx.params;
  const khoa = (manh ?? []).join("/");

  const session = await auth();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }

  const ve = kiemVeMedia(req.nextUrl.searchParams.get("ve"));
  if (!ve.ok || !ve.ve) {
    return fail("TICKET_INVALID", "Vé phát không hợp lệ hoặc đã hết hạn", { status: 403 });
  }

  // Vé cấp cho AI thì người đó mới dùng được. Không kiểm thì một vé bị chia sẻ
  // cho phép cả phòng xem bằng một lượt cấp.
  if (ve.ve.userId !== session.user.id) {
    return fail("TICKET_INVALID", "Vé phát không dành cho tài khoản này", { status: 403 });
  }

  // Hàng rào cuối: khoá đến thẳng từ đường dẫn.
  if (!khoaThuocBai(khoa, ve.ve.lessonId)) {
    return fail("NOT_FOUND", "Không tìm thấy tệp", { status: 404 });
  }

  let bucket: string;
  try {
    bucket = getElearningBucket();
  } catch {
    // Cấu hình thiếu ⇒ KHÔNG rơi về bucket công khai. Xem `elearning-storage.ts`.
    return fail("STORAGE_UNCONFIGURED", "Kho media chưa được cấu hình", { status: 503 });
  }

  const s3 = getR2Client();

  // Hỏi dung lượng thật bằng `HeadObject`.
  //
  // ⚠️ KHÔNG dùng `GetObject` với `Range: "bytes=0-0"` cho việc này, dù nó cũng ra
  // đúng con số. Phản hồi của `GetObject` mang một LUỒNG; ở `runtime = "nodejs"`
  // luồng đó là một socket, và socket chỉ được trả về pool của SDK khi thân được
  // đọc hết hoặc `destroy()`. Lấy về rồi bỏ đó là **giữ một khe mỗi lượt xin
  // Range** — pool mặc định 50 khe, `keepAlive` bật, và SDK **không đặt hạn chờ**.
  //
  // Nó hỏng theo kiểu tệ nhất: request TREO, không phải 5xx. Chỉ số T1 của đặc tả
  // đếm tỉ lệ 5xx nên mù hoàn toàn với nó, và ngân sách "8 phiên phát đồng thời"
  // của chính ticket này lại tựa vào lúc nào phía R2 đóng nối rỗi — một hằng số
  // bên ngoài, không có trong đặc tả, không đọc được từ mã.
  //
  // Đổi sang `HeadObject` cũng bỏ luôn một vòng đi-về tới R2 trên mỗi lượt xin.
  // Tiền lệ trong kho: `app/(admin)/admin/scorm/_actions.ts:205`.
  let coTep: number;
  try {
    const dau = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: khoa }));
    coTep = Number(dau.ContentLength ?? 0);
  } catch {
    return fail("NOT_FOUND", "Không tìm thấy tệp", { status: 404 });
  }

  const kq = docRange(req.headers.get("range"), coTep);

  if (kq.loai === "khong-thoa-man") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": kq.contentRange, "Cache-Control": "no-store" },
    });
  }

  const doc = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: khoa,
      ...(kq.loai === "mot-phan" ? { Range: rangeChoR2(kq.start, kq.end) } : {}),
    }),
  );
  if (!doc.Body) return fail("NOT_FOUND", "Không đọc được tệp", { status: 404 });

  // ⚠️ `transformToWebStream()` — KHÔNG `transformToByteArray()`.
  const body = (doc.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream();

  const headers: Record<string, string> = {
    "Content-Type": doc.ContentType ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    // Trình duyệt không được đoán kiểu nội dung: một tệp lạ được đoán thành HTML
    // là một trang chạy trên chính origin này.
    "X-Content-Type-Options": "nosniff",
  };

  if (kq.loai === "mot-phan") {
    headers["Content-Range"] = kq.contentRange;
    headers["Content-Length"] = String(kq.contentLength);
    return new Response(body, { status: 206, headers });
  }

  headers["Content-Length"] = String(coTep);
  return new Response(body, { status: 200, headers });
}
