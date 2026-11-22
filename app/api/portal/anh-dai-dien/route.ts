import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { rateLimit } from "@/lib/rate-limit";
import { assertOwnsStudent, dangOCheDoHocSinh } from "@/lib/portal/session";
import { getR2Bucket } from "@/lib/storage/r2-client";
import { validateFile } from "@/lib/storage/upload-config";
import {
  TOI_DA_BYTE_ANH_DAI_DIEN,
  dayAnhDaiDienLenR2,
  docChuKyAnh,
} from "@/lib/students/anh-dai-dien-tai-len";

export const runtime = "nodejs";

// POST /api/portal/anh-dai-dien  (multipart/form-data: studentId, file)
// PHỤ HUYNH tự đổi ảnh đại diện cho con mình [chủ dự án chốt 12/11/2026]. Ghi vào cột
// `Student.avatarUrl` — CHÍNH cột mà hồ sơ học viên ở admin ghi — nên ảnh đi theo con sang
// site học viên, site giáo viên và (sau này) bảng vinh danh mà không phải chép ở đâu.
//
// Quyền: CHỈ phụ huynh sở hữu học viên (`assertOwnsStudent`: role PARENT + `parentUserId` khớp),
// và KHÔNG ở chế độ học sinh (em tự đổi ảnh là ngoài yêu cầu). `studentId` đi trong BODY, không
// trên URL. Khoá R2 chỉ chứa uuid — không có studentId, không có tên file gốc (PII).
// Cùng bộ kiểm ảnh với route admin: MIME + đuôi, rồi đọc CHỮ KÝ THẬT, tối đa 4MB.

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (session.user.role !== "PARENT" || (await dangOCheDoHocSinh())) {
    return NextResponse.json({ error: "Chỉ phụ huynh mới đổi được ảnh của con" }, { status: 403 });
  }

  // Chặn tải dồn dập (mỗi lượt đọc tới 4MB + ghi R2): 10 lượt / 10 phút / phụ huynh, cùng kiểu với `upload-url` (fail-soft Upstash → memory).
  const rl = await rateLimit({ key: `portal-avatar:${session.user.id}`, max: 10, windowMs: 10 * 60_000 });
  if (!rl.success) return NextResponse.json({ error: "Ba mẹ thao tác quá nhanh — thử lại sau ít phút." }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body không hợp lệ (cần multipart/form-data)" }, { status: 400 });
  }
  const studentId = form.get("studentId");
  const file = form.get("file");
  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Thiếu học viên" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu file ảnh" }, { status: 400 });
  }
  // Sở hữu kiểm TRƯỚC khi đọc file: người lạ không được tốn băng thông của kho.
  if (!(await assertOwnsStudent(studentId))) {
    return NextResponse.json({ error: "Không tìm thấy học viên" }, { status: 404 });
  }
  if (file.size > TOI_DA_BYTE_ANH_DAI_DIEN) {
    return NextResponse.json({ error: "Ảnh quá lớn. Tối đa 4MB." }, { status: 413 });
  }
  const loiChung = validateFile("image", file.name, file.type, file.size);
  if (loiChung) return NextResponse.json({ error: loiChung }, { status: 400 });

  try {
    getR2Bucket();
  } catch {
    return NextResponse.json({ error: "Kho ảnh chưa được cấu hình — liên hệ trung tâm." }, { status: 503 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const loai = docChuKyAnh(bytes);
  if (!loai) {
    return NextResponse.json({ error: "Chỉ nhận ảnh JPG, PNG hoặc WEBP (tối đa 4MB)." }, { status: 400 });
  }

  let url: string;
  try {
    url = await dayAnhDaiDienLenR2(bytes, loai);
  } catch (err) {
    console.error("[portal/anh-dai-dien] R2 put failed:", err);
    return NextResponse.json({ error: "Không lưu được ảnh lên kho — thử lại sau." }, { status: 502 });
  }

  // `updateMany` kèm điều kiện sở hữu: ghi KHÔNG đi qua portalDb nên phải tự chặn (portalDb chỉ che ĐỌC).
  const res = await db.student.updateMany({
    where: { id: studentId, parentUserId: session.user.id, deletedAt: null },
    data: { avatarUrl: url },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Không tìm thấy học viên" }, { status: 404 });
  }

  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Phụ huynh" },
    module: "students",
    entityType: "Student",
    entityId: studentId,
    action: "PARENT_SET_AVATAR",
    // Chỉ ghi TÊN cột đã đổi, không ghi URL (URL không phải bí mật nhưng không cần có trong vết).
    newValues: { field: "avatarUrl" },
  }).catch((e) => console.error("[portal/anh-dai-dien] audit:", e));

  return NextResponse.json({ url });
}
