// GET /api/admin/bao-luu/tep/<reserveId>?loai=don|minh-chung&i=<số thứ tự minh chứng> — xem đơn/minh chứng bảo lưu.
//
// Quyền `bao-luu:view` + hồ sơ phải nằm trong tầm nhìn cơ sở của người xem (`scopedDb` — StudentReserve ∈
// SCOPED_MODELS). Thứ tự: đăng nhập → quyền → hồ sơ trong tầm nhìn → khoá HỢP LỆ → kho cấu hình → AUDIT →
// ký GET 120 giây → redirect 302 no-store. Audit ném ⇒ 503 và KHÔNG ký (khuôn `tai-ve` của hoá đơn).
//
// ⚠️ Hồ sơ ngoài tầm nhìn trả 404, KHÔNG 403 — không lộ sự tồn tại.
// ⚠️ `kyUrlTaiVeBaoLuu` NÉM khi khoá sai hình dạng: lớp chặn cuối nếu một đường ghi nào đó từng nhận khoá
// tuỳ ý từ trình duyệt — không có nó thì người dùng nhét khoá của object khác vào hồ sơ rồi xin URL ký.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { khoBaoLuuDaCauHinh, kyUrlTaiVeBaoLuu } from "@/lib/bao-luu/kho-tep";
import { laKhoaTepBaoLuu } from "@/lib/bao-luu/tep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** URL ký sống 2 phút — đủ để trình duyệt bắt đầu tải, không đủ để thành đường dẫn chia sẻ. */
const TTL_GIAY = 120;

const loi = (status: number, thongDiep: string) =>
  NextResponse.json({ error: thongDiep }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ reserveId: string }> }) {
  const session = await auth();
  if (!session?.user) return loi(401, "Chưa đăng nhập");
  if (!(await checkPermission("bao-luu:view"))) return loi(403, "Không có quyền xem tệp bảo lưu");

  const q = new URL(req.url).searchParams;
  const loai = q.get("loai") ?? "don";
  if (loai !== "don" && loai !== "minh-chung") return loi(400, "Loại tệp không hợp lệ");
  const chiSo = Number(q.get("i") ?? "0");

  const { reserveId } = await params;
  const actor = await resolveActor(session.user.id);
  // findUnique trên model scoped lọc hậu kỳ bằng passesScope ⇒ select PHẢI kèm centerId.
  const hs = await scopedDb(actor).studentReserve.findUnique({
    where: { id: reserveId },
    select: { id: true, centerId: true, orgUnitId: true, studentId: true, applicationFileKey: true, evidenceFileKeys: true },
  });
  if (!hs) return loi(404, "Không tìm thấy hồ sơ bảo lưu");

  let khoa: string | null | undefined;
  if (loai === "don") {
    khoa = hs.applicationFileKey;
  } else {
    if (!Number.isInteger(chiSo) || chiSo < 0) return loi(400, "Số thứ tự minh chứng không hợp lệ");
    khoa = hs.evidenceFileKeys[chiSo];
  }
  if (!khoa) return loi(404, loai === "don" ? "Hồ sơ chưa có đơn đính kèm" : "Không có minh chứng này");
  if (!laKhoaTepBaoLuu(khoa)) {
    console.error("[bao-luu] khoá tệp trong hồ sơ KHÔNG đúng hình dạng — từ chối ký:", hs.id);
    return loi(404, "Tệp không hợp lệ");
  }

  if (!khoBaoLuuDaCauHinh()) return loi(503, "Kho tệp bảo lưu chưa cấu hình — báo người vận hành");

  try {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id },
      module: "students",
      entityType: "StudentReserve",
      entityId: hs.id,
      action: "TAI_TEP_BAO_LUU",
      // KHÔNG chép khoá tệp hay URL: nhật ký là nơi nhiều người đọc được hơn kho tệp.
      newValues: { loai, studentId: hs.studentId },
      orgUnitId: hs.orgUnitId,
    });
  } catch (err) {
    console.error("[bao-luu] KHÔNG ghi được AuditLog — từ chối cấp liên kết tải:", err);
    return loi(503, "Không ghi được nhật ký nên chưa xem được tệp. Vui lòng thử lại.");
  }

  let url: string;
  try {
    url = await kyUrlTaiVeBaoLuu(khoa, TTL_GIAY);
  } catch (err) {
    console.error("[bao-luu] ký URL tải thất bại:", err);
    return loi(503, "Kho tệp bảo lưu đang lỗi. Vui lòng thử lại.");
  }
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
