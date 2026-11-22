import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuid } from "uuid";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import { getPublicUrl, getR2Bucket, getR2Client } from "@/lib/storage/r2-client";

export const runtime = "nodejs";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function getExtension(filename: string): string {
  return filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
}

function extensionFromMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return "";
}

function safeBaseName(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function validateImage(file: File): string | null {
  if (!ALLOWED_MIMES.has(file.type)) {
    return "Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc GIF.";
  }

  const ext = getExtension(file.name) || extensionFromMime(file.type);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return "Đuôi file không hợp lệ. Chỉ hỗ trợ .jpg, .jpeg, .png, .webp, .gif.";
  }

  if (file.size > MAX_SIZE_BYTES) {
    return "Ảnh quá lớn. Tối đa 5MB.";
  }

  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    await assertPermission("news:create");
  } catch {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Body không hợp lệ. Cần multipart/form-data." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: "Thiếu file ảnh." },
      { status: 400 },
    );
  }

  const validationError = validateImage(file);
  if (validationError) {
    return NextResponse.json(
      { success: false, error: validationError },
      { status: file.size > MAX_SIZE_BYTES ? 413 : 400 },
    );
  }

  const ext = getExtension(file.name) || extensionFromMime(file.type);
  const datePrefix = new Date().toISOString().slice(0, 7);
  const key = `news/content/${datePrefix}/${safeBaseName(file.name) || "image"}-${uuid().slice(0, 8)}${ext}`;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        Body: bytes,
        ContentType: file.type,
      }),
    );

    const url = getPublicUrl(key);
    return NextResponse.json({ success: true, url, publicUrl: url, key });
  } catch (err) {
    console.error("[news upload-image] R2 put failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Không thể upload ảnh. Vui lòng thử lại.",
      },
      { status: 500 },
    );
  }
}
