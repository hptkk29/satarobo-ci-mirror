import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  getR2Client,
  getR2Bucket,
  getR2PublicUrl,
} from "@/lib/storage/r2-client";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";

// DELETE /api/admin/upload-delete
// Xoá file khỏi R2. Chỉ cho phép xoá file dưới prefix "uploads/" để tránh
// xoá nhầm asset hệ thống. Chỉ SUPER_ADMIN và CENTER_MANAGER được phép.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowedRoles = ["SUPER_ADMIN", "CENTER_MANAGER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url, key: rawKey } = (body ?? {}) as { url?: string; key?: string };

  const publicUrl = getR2PublicUrl();

  let key: string;
  if (rawKey) {
    key = rawKey.startsWith("/") ? rawKey.slice(1) : rawKey;
  } else if (url) {
    if (!url.startsWith(publicUrl)) {
      return NextResponse.json(
        { error: "URL không thuộc R2 bucket của Sata Robo" },
        { status: 400 },
      );
    }
    key = url.slice(publicUrl.length + 1);
  } else {
    return NextResponse.json(
      { error: "Phải có url hoặc key" },
      { status: 400 },
    );
  }

  if (!key.startsWith("uploads/")) {
    return NextResponse.json(
      { error: "Chỉ cho phép xoá file trong /uploads/" },
      { status: 400 },
    );
  }

  try {
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
      }),
    );
    // SEC-M07: audit xoá object R2 (truy vết ai xoá key nào). Lưu ý: key R2 phân theo
    // LOẠI file (uploads/images|documents|…), KHÔNG theo cơ sở — asset admin dùng chung
    // (honors/news…), không phải submission center-scoped → không suy được owner-center
    // từ key. Audit là lớp truy vết khả thi ở mô hình key hiện tại.
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "storage",
      entityType: "R2Object",
      entityId: key,
      action: "DELETE",
      oldValues: { key },
    });
    return NextResponse.json({ success: true, key });
  } catch (err) {
    console.error("Failed to delete from R2:", err);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 },
    );
  }
}
