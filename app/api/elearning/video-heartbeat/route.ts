import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { ok, fail } from "@/lib/api/response";
import { ghiNhipXem } from "@/lib/elearning/video-heartbeat";
import { gianhKhoaPhat } from "@/lib/elearning/play-lock";
import { nhipXemSchema, HTTP_CUA_LOI } from "@/lib/elearning/video-heartbeat-contract";

/**
 * EL-12b — NHỊP XEM VIDEO. Route Handler, KHÔNG phải Server Action.
 *
 * Cùng hai lý do đã ghi ở `reading-heartbeat/route.ts`: `runAction` ghi audit vô
 * điều kiện (nhịp 15 giây × mỗi người đang xem sẽ nhấn chìm những dòng audit thật
 * sự cần đọc), và `navigator.sendBeacon` — cách DUY NHẤT gửi được nhịp cuối lúc rời
 * trang — chỉ POST tới một URL chứ không gọi được Server Action.
 *
 * ⚠️ Mã HTTP lấy từ `HTTP_CUA_LOI` trong hợp đồng, KHÔNG khai lại ở đây. Khai lại
 * là dựng bảng thứ hai cho cùng một sự thật, và ngày hai bảng lệch nhau thì trình
 * phát xử một mã theo nghĩa cũ còn máy chủ trả nó theo nghĩa mới — không ai thấy,
 * vì cả hai vẫn "chạy".
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }

  // `sendBeacon` gửi Blob/text và không luôn set Content-Type JSON ⇒ đọc text rồi
  // tự parse. `req.json()` thẳng sẽ ném đúng vào nhịp cuối lúc rời trang — tức mất
  // chính cái nhịp mà `sendBeacon` sinh ra để cứu.
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return fail("VALIDATION", "Nội dung gửi lên không hợp lệ");
  }

  const parsed = nhipXemSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", {
      field: issue?.path[0] ? String(issue.path[0]) : undefined,
    });
  }

  const actor = await resolveActor(session.user.id);

  // Khoá phát giành ở TẦNG NÀY, không ở tầng ghi: tầng ghi phải test được mà không
  // dựng Redis, và một hàm vừa chạm DB vừa chạm Redis là hai lý do hỏng trong một
  // chỗ. Kết quả (kể cả "không có khoá dùng chung") truyền xuống nguyên vẹn.
  const khoaPhat = await gianhKhoaPhat({
    userId: actor.userId,
    // Vé phát là định danh phiên sẵn có — mỗi lần mở trình phát ký một vé mới, nên
    // hai tab của cùng một người mang hai vé khác nhau. Không phải đẻ thêm khái
    // niệm "sessionId" thứ hai chỉ để phân biệt đúng thứ vé đã phân biệt được.
    sessionId: parsed.data.ve,
  });

  const kq = await ghiNhipXem({
    actor,
    ...parsed.data,
    now: new Date(),
    khoaPhat,
  });

  if (!kq.ok) {
    // Hai mã KHÔNG thuộc hợp đồng nhịp xem — chúng là lỗi chung của mọi đường ghi
    // e-learning, nên tách nhánh trước rồi mới tra bảng. Gộp lại bằng `?? 400` thì
    // một mã mới thêm vào hợp đồng mà quên khai HTTP sẽ im lặng thành 400, và trình
    // phát coi nó là "dữ liệu gửi sai" thay vì trạng thái cần xử.
    if (kq.code === "PERMISSION_DENIED") return fail(kq.code, kq.message, { status: 403 });
    if (kq.code === "NOT_FOUND") return fail(kq.code, kq.message, { status: 404 });
    return fail(kq.code, kq.message, { status: HTTP_CUA_LOI[kq.code] });
  }
  return ok(kq.data);
}
