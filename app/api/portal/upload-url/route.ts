import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuid } from "uuid";
import { auth } from "@/lib/auth";
import { getR2Client, getR2Bucket, getPublicUrl } from "@/lib/storage/r2-client";
import { UPLOAD_CONFIG, validateFile } from "@/lib/storage/upload-config";
import { getSetting } from "@/lib/settings/service";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/portal/upload-url — Phase T2.4
// Presigned URL cho PHỤ HUYNH (PARENT) nộp bài tập của con. Chỉ cho ảnh/tài
// liệu, lưu vào prefix uploads/submissions. Tách hoàn toàn route admin.
const PORTAL_CATEGORIES = ["image", "document"] as const;
type PortalCategory = (typeof PORTAL_CATEGORIES)[number];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "PARENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // SEC-M08: rate-limit presign theo parent (chống loop presign→PUT multi-GB cost-DoS).
  // fail-soft (Upstash→memory). 30 presign/phút/parent rộng cho nộp vài file bài tập.
  const rl = await rateLimit({
    key: `upload-presign:parent:${session.user.id}`,
    max: 30,
    windowMs: 60_000,
  });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Bạn thao tác quá nhanh — thử lại sau." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { category, filename, mimeType, sizeBytes } = (body ?? {}) as {
    category?: PortalCategory;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
  };

  if (!category || !filename || !mimeType || typeof sizeBytes !== "number") {
    return NextResponse.json(
      { error: "Thiếu category/filename/mimeType/sizeBytes" },
      { status: 400 },
    );
  }
  if (!PORTAL_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: "Chỉ nộp được ảnh hoặc tài liệu" },
      { status: 400 },
    );
  }

  const maxSize = UPLOAD_CONFIG[category].maxSize;
  if (sizeBytes > maxSize) {
    return NextResponse.json(
      { error: `File quá lớn. Tối đa ${Math.round(maxSize / 1024 / 1024)}MB.` },
      { status: 413 },
    );
  }
  const validationError = validateFile(category, filename, mimeType, sizeBytes);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const safeName =
    filename
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "file";
  const datePrefix = new Date().toISOString().slice(0, 7);
  const key = `uploads/submissions/${datePrefix}/${safeName}-${uuid().slice(0, 8)}${ext}`;

  try {
    // Chỉ ký Content-Type (xem ghi chú A1 ở admin/upload-url): không ký
    // Metadata/ContentLength để tránh 403 SignatureDoesNotMatch khi browser PUT.
    const command = new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      ContentType: mimeType,
    });
    const ttl = await getSetting("storage.presignTtlSec");
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: ttl });
    return NextResponse.json({
      uploadUrl,
      publicUrl: getPublicUrl(key),
      key,
      expiresIn: ttl,
    });
  } catch (err) {
    console.error("[portal upload-url]", err);
    return NextResponse.json(
      { error: "Không tạo được link tải lên. Thử lại." },
      { status: 500 },
    );
  }
}
