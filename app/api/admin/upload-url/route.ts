import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuid } from "uuid";
import { getR2Client, getR2Bucket, getPublicUrl } from "@/lib/storage/r2-client";
import {
  UPLOAD_CONFIG,
  UploadCategory,
  validateFile,
} from "@/lib/storage/upload-config";
import { getSetting } from "@/lib/settings/service";

// POST /api/admin/upload-url
// Sinh presigned URL để browser PUT trực tiếp lên R2 (không qua server).
// Server validate role + file rules TRƯỚC khi ký URL.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TEACHER added in Phase E4 so teachers can upload teaching materials
  // (documents/videos/audio for their lessons).
  // TRAINING added 31/07 — Đào tạo quản lý toàn bộ LMS nên phải upload được học liệu.
  const allowedRoles = ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING", "TEACHER", "TRAINING"];
  // B4 (02/08): SALES_CSM chỉ được ký category IMAGE — canPublishToClass (media/actions.ts)
  // đã cho Sale phụ trách lớp upload ảnh lớp, nhưng list này chặn ngay bước presign nên
  // Sale thấy canUpload=true mà mọi file đều 403 (R7-09 chết từ bước ký). Giới hạn image
  // enforce SAU khi parse body (bên dưới) vì category lúc này chưa đọc.
  //
  // ⚠️ 11/08 — `session.user.role` là enum v1 SỐ ÍT: vai chỉ có ở RBAC v2 (Giáo vụ =
  // CENTER_CLASS_MANAGER) không bao giờ khớp list trên nên chết 403 tại đây, trước cả
  // khi tới Server Action. Mở thêm đường theo QUYỀN (media:upload-draft = được đưa ảnh
  // vào kho lớp) và cũng chỉ cho category IMAGE — họ không upload học liệu.
  const isSalesImageOnly = session.user.role === "SALES_CSM";
  const isRoleAllowed = allowedRoles.includes(session.user.role);
  const isDraftUploaderImageOnly =
    !isRoleAllowed && !isSalesImageOnly && (await checkPermission("media:upload-draft"));
  const imageOnly = isSalesImageOnly || isDraftUploaderImageOnly;
  // 26/09/2026 — BLĐ đính kèm VĂN BẢN GỐC của chính sách khuyến mãi (PDF bản ký/ảnh chụp).
  // Vai Giám đốc (`GIAM_DOC`) chỉ có ở RBAC v2 nên không bao giờ khớp `allowedRoles` v1 — cùng
  // bẫy 11/08 ở trên, cùng cách vá: mở theo QUYỀN, và chỉ cho tài liệu + ảnh, không video/âm thanh.
  const isPolicyDocUploader =
    !isRoleAllowed && !imageOnly && (await checkPermission("promotions:manage"));
  if (!isRoleAllowed && !imageOnly && !isPolicyDocUploader) {
    return NextResponse.json(
      { error: "Forbidden: insufficient permissions" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { category, filename, mimeType, sizeBytes } = (body ?? {}) as {
    category?: UploadCategory;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
  };

  if (!category || !filename || !mimeType || typeof sizeBytes !== "number") {
    return NextResponse.json(
      {
        error:
          "Missing required fields: category, filename, mimeType, sizeBytes",
      },
      { status: 400 },
    );
  }

  if (!UPLOAD_CONFIG[category]) {
    return NextResponse.json(
      {
        error: `Category không hợp lệ. Cho phép: ${Object.keys(UPLOAD_CONFIG).join(", ")}`,
      },
      { status: 400 },
    );
  }

  // B4: Sale phụ trách lớp chỉ upload ẢNH lớp — các category khác (học liệu…) giữ nguyên 403.
  // 11/08: vai góp ảnh vào kho (Marketing/Giáo vụ qua media:upload-draft) cùng giới hạn.
  if (isPolicyDocUploader && category !== "document" && category !== "image") {
    return NextResponse.json(
      { error: "Forbidden: chỉ được tải văn bản (PDF/Word) hoặc ảnh chụp văn bản" },
      { status: 403 },
    );
  }
  if (imageOnly && category !== "image") {
    return NextResponse.json(
      { error: "Forbidden: vai này chỉ được upload ảnh (category image)" },
      { status: 403 },
    );
  }

  // Size check returns 413 (Payload Too Large) — RFC-correct, separates size
  // from MIME/extension issues that stay 400.
  const maxSize = UPLOAD_CONFIG[category].maxSize;
  if (sizeBytes > maxSize) {
    const maxMB = Math.round(maxSize / 1024 / 1024);
    return NextResponse.json(
      { error: `File quá lớn. Tối đa ${maxMB}MB.` },
      { status: 413 },
    );
  }

  const validationError = validateFile(category, filename, mimeType, sizeBytes);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const config = UPLOAD_CONFIG[category];
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const safeName = filename
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  const datePrefix = new Date().toISOString().slice(0, 7);
  const uniqueId = uuid().slice(0, 8);
  const key = `${config.folder}/${datePrefix}/${safeName || "file"}-${uniqueId}${ext}`;

  try {
    // CHỈ ký Content-Type. KHÔNG ký Metadata (x-amz-meta-*) hay ContentLength:
    // browser PUT chỉ gửi Content-Type nên các header đã-ký-nhưng-không-gửi sẽ
    // làm R2 trả 403 SignatureDoesNotMatch → xhr báo "Lỗi mạng khi upload" (A1).
    const command = new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      ContentType: mimeType,
    });

    const ttl = await getSetting("storage.presignTtlSec");
    const uploadUrl = await getSignedUrl(getR2Client(), command, {
      expiresIn: ttl,
    });

    return NextResponse.json({
      uploadUrl,
      publicUrl: getPublicUrl(key),
      key,
      expiresIn: ttl,
    });
  } catch (err) {
    console.error("Failed to generate presigned URL:", err);
    return NextResponse.json(
      { error: "Failed to generate upload URL. Try again." },
      { status: 500 },
    );
  }
}
