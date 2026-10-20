// POST /api/admin/bao-luu/mau-don — xuất "Đơn đăng ký bảo lưu khóa học" (SR.QD.236.002) dạng .docx, đã điền sẵn.
//
// Body: { studentId, don } — `don` là CHÍNH bộ giá trị Sale thấy và sửa trong khối "Đơn bảo lưu" (xem `lib/bao-luu/mau-don.ts`).
// Route KHÔNG tính lại giá trị từ DB: tính lại thì tờ in trên màn và file Word có thể ghi hai nội dung khác nhau cho cùng một
// đơn. DB chỉ dùng để quyết ĐÚNG MẪU (cơ sở của học viên) và để chặn người ngoài tầm nhìn.
//
// Thứ tự cổng: đăng nhập → `bao-luu:create` → body hợp lệ → học viên trong tầm nhìn cơ sở (`scopedDb`; ngoài tầm ⇒ 404, không
// lộ sự tồn tại) → bảo lưu BẬT ở cơ sở học viên → cơ sở CÓ mẫu → AUDIT → điền .docx. Audit ném ⇒ 503 và KHÔNG trả file: tệp mang
// SĐT/email phụ huynh và tên trẻ em (khuôn `tep/[reserveId]`).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { LOI_CHUA_CO_MAU_DON, donBaoLuuSchema, mauTheoMaCoSo } from "@/lib/bao-luu/mau-don";
import { LoiMauDon, dienDonDocx, taiMauDocx } from "@/lib/bao-luu/mau-don-docx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const loi = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

const bodySchema = z.object({ studentId: z.string().min(1).max(64), don: donBaoLuuSchema });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return loi(401, "Chưa đăng nhập");
  if (!(await checkPermission("bao-luu:create"))) return loi(403, "Không có quyền lập hồ sơ bảo lưu");

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return loi(400, "Dữ liệu không hợp lệ");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return loi(400, parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  const { studentId, don } = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // findFirst trên model scoped ⇒ lọc theo cơ sở người xem. Ngoài tầm nhìn = không thấy = 404.
  const hv = await sdb.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { id: true, centerId: true, orgUnitId: true, studentCode: true },
  });
  if (!hv) return loi(404, "Không tìm thấy học viên");
  if (!(await laBaoLuuBat(hv.orgUnitId))) return loi(403, LOI_BAO_LUU_TAT);

  // Center là danh mục không scoped (sdb đi thẳng). Học viên chưa gắn cơ sở ⇒ không biết dùng mẫu nào ⇒ không đoán.
  const coSo = hv.centerId ? await sdb.center.findFirst({ where: { id: hv.centerId }, select: { code: true } }) : null;
  const ma = mauTheoMaCoSo(coSo?.code);
  if (!ma) return loi(422, LOI_CHUA_CO_MAU_DON);

  try {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id },
      module: "students",
      entityType: "Student",
      entityId: hv.id,
      action: "XUAT_DON_BAO_LUU",
      // KHÔNG chép nội dung đơn (SĐT, email, ngày sinh): nhật ký là nơi nhiều người đọc được hơn tệp.
      newValues: { mau: ma, dinhDang: "docx" },
      orgUnitId: hv.orgUnitId,
    });
  } catch (err) {
    console.error("[bao-luu] KHÔNG ghi được AuditLog — từ chối xuất đơn:", err);
    return loi(503, "Không ghi được nhật ký nên chưa xuất được đơn. Vui lòng thử lại.");
  }

  let docx: Buffer;
  try {
    docx = await dienDonDocx(await taiMauDocx(ma), don, ma);
  } catch (err) {
    console.error("[bao-luu] điền mẫu đơn thất bại:", err);
    return loi(500, err instanceof LoiMauDon ? "Mẫu đơn của cơ sở này đã đổi cấu trúc nên chưa điền được. Báo người vận hành." : "Không dựng được file đơn. Vui lòng thử lại.");
  }

  // Tên tệp ASCII (header không chứa dấu): mã học viên nếu có, không thì id.
  const tenTep = `don-bao-luu-${(hv.studentCode ?? hv.id).replace(/[^A-Za-z0-9_-]/g, "")}-${ma}.docx`;
  return new NextResponse(new Uint8Array(docx), {
    headers: {
      "Content-Type": DOCX,
      "Content-Disposition": `attachment; filename="${tenTep}"`,
      "Cache-Control": "no-store",
    },
  });
}
