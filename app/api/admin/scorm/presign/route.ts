// app/api/admin/scorm/presign/route.ts — R7-11: cấp presigned PUT cho zip SCORM.
//
// Browser PUT zip gốc trực tiếp lên R2 (không qua server). Server tạo bản ghi
// ScormPackage (UPLOADING) + ký URL. Sau khi client PUT xong gọi
// /api/admin/scorm/confirm để emit `scorm.uploaded` → pipeline giải nén chạy.
// Gate: SCORM_ENABLED + can(training:manage). Không qua scopedDb (gắn buổi qua
// lessonId, không có centerId).
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getR2Client, getR2Bucket } from "@/lib/storage/r2-client";
import { isScormEnabled } from "@/lib/flags";

const TRAINING_MANAGE = "training:manage";
const MAX_ZIP_BYTES = 200 * 1024 * 1024; // 200MB (đồng bộ pipeline ingest)
const PRESIGN_TTL_SEC = 600; // 10 phút đủ để PUT 1 file zip lớn

export async function POST(req: NextRequest) {
  // Gate flag — OFF → ẩn hoàn toàn (404, không lộ endpoint).
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

  const { lessonId, name, filename, sizeBytes } = (body ?? {}) as {
    lessonId?: string;
    name?: string;
    filename?: string;
    sizeBytes?: number;
  };

  if (!lessonId || !name || !filename || typeof sizeBytes !== "number") {
    return NextResponse.json(
      { error: "Thiếu trường: lessonId, name, filename, sizeBytes" },
      { status: 400 },
    );
  }
  if (!/\.zip$/i.test(filename)) {
    return NextResponse.json(
      { error: "Chỉ chấp nhận gói .zip" },
      { status: 400 },
    );
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_ZIP_BYTES) {
    const maxMB = Math.round(MAX_ZIP_BYTES / 1024 / 1024);
    return NextResponse.json(
      { error: `Gói quá lớn. Tối đa ${maxMB}MB.` },
      { status: 413 },
    );
  }

  // Nhóm 01 L1 — Lesson/ScormPackage = học liệu toàn cục (không center-scope),
  // scopedDb pass-through; dùng để sạch whitelist db trần.
  const sdb = scopedDb(await resolveActor(session.user.id));

  // Buổi phải tồn tại trước khi tạo gói (FK + tránh gói mồ côi).
  const lesson = await sdb.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true },
  });
  if (!lesson) {
    return NextResponse.json(
      { error: "Buổi học (lessonId) không tồn tại" },
      { status: 404 },
    );
  }

  try {
    // Tạo bản ghi UPLOADING trước → có id để dựng prefix R2 ổn định.
    const pkg = await sdb.scormPackage.create({
      data: {
        lessonId,
        name,
        storagePrefix: "", // điền sau khi có id
        status: "UPLOADING",
        uploadedById: session.user.id,
      },
      select: { id: true },
    });
    const storagePrefix = `scorm/${pkg.id}/`;
    const uploadKey = `${storagePrefix}_src/package.zip`;
    await sdb.scormPackage.update({
      where: { id: pkg.id },
      data: { storagePrefix, uploadKey },
    });

    // Chỉ ký Content-Type (browser PUT chỉ gửi header này; ký thừa → 403).
    const command = new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: uploadKey,
      ContentType: "application/zip",
    });
    const uploadUrl = await getSignedUrl(getR2Client(), command, {
      expiresIn: PRESIGN_TTL_SEC,
    });

    return NextResponse.json({
      packageId: pkg.id,
      uploadUrl,
      key: uploadKey,
      expiresIn: PRESIGN_TTL_SEC,
    });
  } catch (err) {
    console.error("SCORM presign failed:", err);
    return NextResponse.json(
      { error: "Không tạo được URL upload. Thử lại." },
      { status: 500 },
    );
  }
}
