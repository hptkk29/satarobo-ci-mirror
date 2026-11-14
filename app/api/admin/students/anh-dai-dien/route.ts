import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getR2Bucket } from "@/lib/storage/r2-client";
import {
  TOI_DA_BYTE_ANH_DAI_DIEN as TOI_DA_BYTE,
  dayAnhDaiDienLenR2,
  docChuKyAnh,
} from "@/lib/students/anh-dai-dien-tai-len";
import { validateFile } from "@/lib/storage/upload-config";

export const runtime = "nodejs";

// POST /api/admin/students/anh-dai-dien  (multipart/form-data: file)
// Ảnh đại diện học viên (25/09/2026) → R2, trả `{ url }`. Lưu vào hồ sơ là việc của
// Server Action `datAnhDaiDienHocVien` (`app/(admin)/admin/students/[id]/_anh-dai-dien-actions.ts`),
// và action đó CHỈ nhận đúng khuôn khoá dựng ở đây — đổi khuôn thì đổi cả hai.
//
// Khác `/api/admin/upload` (danh mục ảnh chung):
//   · quyền theo HỒ SƠ HỌC VIÊN (`students:edit` hoặc `students:create` — form tạo mới
//     cũng chọn ảnh), không theo danh sách vai cứng;
//   · chỉ JPG/PNG/WEBP — không GIF động cho một ô ảnh đại diện;
//   · tối đa 4MB, KHÔNG phải 10MB của danh mục `image`: Vercel cắt body request ở ~4,5MB,
//     nên hứa 10MB là để người dùng nhận một lỗi 413 trần của nền tảng thay vì câu này;
//   · đọc CHỮ KÝ ĐẦU FILE, không tin `file.type` trình duyệt khai. Tên khoá + Content-Type
//     lấy theo loại THẬT — tên gốc của file không đi vào khoá (không cần, và là PII).

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const duocTai =
    (await checkPermission("students:edit")) || (await checkPermission("students:create"));
  if (!duocTai) {
    return NextResponse.json({ error: "Bạn không có quyền sửa hồ sơ học viên" }, { status: 403 });
  }

  // Kho chưa cấu hình ⇒ nói rõ NGAY, trước khi nhận file (không để người dùng chờ tải
  // lên rồi mới nhận lỗi chung chung).
  try {
    getR2Bucket();
  } catch {
    return NextResponse.json(
      { error: "Kho ảnh (R2) chưa được cấu hình trên môi trường này — liên hệ quản trị." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body không hợp lệ (cần multipart/form-data)" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu file ảnh" }, { status: 400 });
  }
  if (file.size > TOI_DA_BYTE) {
    return NextResponse.json({ error: "Ảnh quá lớn. Tối đa 4MB." }, { status: 413 });
  }
  // Cùng bộ kiểm của danh mục `image` (MIME + đuôi) như `/api/admin/upload`...
  const loiChung = validateFile("image", file.name, file.type, file.size);
  if (loiChung) return NextResponse.json({ error: loiChung }, { status: 400 });

  // ...rồi siết thêm: đọc chữ ký THẬT. File `.png` mà ruột là HTML/SVG bị chặn ở đây.
  const bytes = Buffer.from(await file.arrayBuffer());
  const loai = docChuKyAnh(bytes);
  if (!loai) {
    return NextResponse.json(
      { error: "Chỉ nhận ảnh JPG, PNG hoặc WEBP (tối đa 4MB)." },
      { status: 400 },
    );
  }

  let url: string;
  try {
    url = await dayAnhDaiDienLenR2(bytes, loai);
  } catch (err) {
    console.error("[anh-dai-dien] R2 put failed:", err);
    return NextResponse.json(
      { error: "Không lưu được ảnh lên kho — thử lại sau." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url });
}
