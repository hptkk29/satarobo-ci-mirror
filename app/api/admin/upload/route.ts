import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuid } from "uuid";
import { getR2Client, getR2Bucket, getPublicUrl } from "@/lib/storage/r2-client";
import { UPLOAD_CONFIG, UploadCategory, validateFile } from "@/lib/storage/upload-config";

export const runtime = "nodejs";

// POST /api/admin/upload  (multipart/form-data: file, category)
// Server-side proxy upload → R2. Tránh hoàn toàn CORS browser→R2 (browser chỉ
// POST same-origin). Dùng cho ImageUploader (Kits/Products...). Lưu ý: nền tảng
// serverless (Vercel) giới hạn body request (~4.5MB); file lớn hơn nên dùng
// luồng presigned + CORS R2.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allowedRoles = ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING", "TEACHER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body không hợp lệ (cần multipart/form-data)" }, { status: 400 });
  }

  const file = form.get("file");
  const category = (form.get("category") as string | null) ?? "image";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu file" }, { status: 400 });
  }
  if (!UPLOAD_CONFIG[category as UploadCategory]) {
    return NextResponse.json({ error: "Category không hợp lệ" }, { status: 400 });
  }
  const cat = category as UploadCategory;

  const maxSize = UPLOAD_CONFIG[cat].maxSize;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `File quá lớn. Tối đa ${Math.round(maxSize / 1024 / 1024)}MB.` },
      { status: 413 },
    );
  }
  const validationError = validateFile(cat, file.name, file.type, file.size);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const config = UPLOAD_CONFIG[cat];
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const safeName = file.name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const datePrefix = new Date().toISOString().slice(0, 7);
  const key = `${config.folder}/${datePrefix}/${safeName || "file"}-${uuid().slice(0, 8)}${ext}`;

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
    return NextResponse.json({ publicUrl: getPublicUrl(key), key });
  } catch (err) {
    console.error("[upload proxy] R2 put failed:", err);
    return NextResponse.json(
      { error: "Không lưu được file lên kho. Kiểm tra cấu hình R2 (env)." },
      { status: 500 },
    );
  }
}
