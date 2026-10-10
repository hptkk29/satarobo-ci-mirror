// app/api/admin/scorm/confirm/route.ts — R7-11: chốt upload zip → khởi pipeline.
//
// Client gọi sau khi PUT zip lên R2 xong (qua presigned URL). Emit `scorm.uploaded`
// → dispatcher chạy onScormUploaded (giải nén + manifest + upload R2 → TESTING).
// dedupeKey theo packageId → bấm 2 lần / retry không sinh job trùng.
// Gate: SCORM_ENABLED + can(training:manage).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { publishEvent } from "@/lib/events/publish";
import { isScormEnabled } from "@/lib/flags";

const TRAINING_MANAGE = "training:manage";

export async function POST(req: NextRequest) {
  if (!isScormEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission(TRAINING_MANAGE))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { packageId } = (body ?? {}) as { packageId?: string };
  if (!packageId) {
    return NextResponse.json({ error: "Thiếu packageId" }, { status: 400 });
  }

  // Nhóm 01 L1 — ScormPackage = học liệu toàn cục (không center-scope),
  // scopedDb pass-through; dùng để sạch whitelist db trần.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const pkg = await sdb.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, status: true, uploadKey: true },
  });
  if (!pkg) {
    return NextResponse.json({ error: "Gói không tồn tại" }, { status: 404 });
  }
  if (!pkg.uploadKey) {
    return NextResponse.json(
      { error: "Gói chưa có zip upload" },
      { status: 409 },
    );
  }

  await publishEvent(
    "scorm.uploaded",
    { packageId },
    { dedupeKey: `scorm.uploaded:${packageId}` },
  );

  return NextResponse.json({ ok: true, packageId, status: "PROCESSING" });
}
