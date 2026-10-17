// Import lớp trải nghiệm từ Excel — MỖI DÒNG LÀ MỘT LỚP CHO MỘT NGÀY.
//
// Chủ dự án 22/09/2026: "có thể import bằng file excel được, check mẫu import các excel
// khác rồi làm tương tự". Khuôn chép từ `app/api/admin/import/rooms/route.ts`.
//
// ⚠️ CỔNG KHUNG GIỜ CHẠY Ở ĐÂY NỮA, không chỉ ở form. Đây là đường đẻ ra NHIỀU lớp nhất
// một lúc, nên cũng là đường mà một lỗi khung giờ nhân lên nhiều nhất. Dùng CHUNG
// `khungChoNgay` + `kiemKhungLop` với form — bản kiểm thứ hai là bản sẽ lệch.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { revalidatePath } from "next/cache";
import { createTrialClass } from "@/lib/trial/service";
import { layCauHinhKhung } from "@/lib/trial/khung-gio-db";
import {
  khungChoNgay,
  kiemKhungLop,
  TEN_THU,
  THU_KHOA,
} from "@/lib/trial/khung-gio-mo-lop";
import { vnWeekday } from "@/lib/time/vn";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const RowSchema = z.object({
  centerSlug: z.string().trim().min(1, "Thiếu centerSlug"),
  date: z.string().trim().regex(YMD, "Ngày phải dạng YYYY-MM-DD"),
  startTime: z.string().trim().regex(HHMM, "Giờ bắt đầu phải dạng HH:MM"),
  endTime: z.string().trim().regex(HHMM, "Giờ kết thúc phải dạng HH:MM"),
  courseSlug: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v && String(v).trim() ? String(v).trim() : null)),
  name: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const t = v ? String(v).trim() : "";
      return t.length > 0 ? t.slice(0, 120) : null;
    }),
});

type ImportError = { row: number; error: string };

/**
 * "YYYY-MM-DD" → mốc UTC 00:00 của NGÀY VN, khớp cột `@db.Date`.
 *
 * KHÔNG `new Date(str)`: hàm đó đọc múi giờ tiến trình — Vercel chạy UTC còn máy dev
 * +07, nên cùng một file Excel sẽ ra hai ngày khác nhau ở hai nơi.
 */
function ngayVnSangUtc(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // CÙNG khoá với form tạo lớp và với trang `/lop-trial/moi`. Để khoá khác ở đây là mở
  // một cửa sau: Sale không bấm được nút "Tạo lớp" nhưng dán được một file Excel.
  if (!(await checkPermission("trials:create-class"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = (body as { rows?: unknown[] })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Không có dữ liệu" }, { status: 400 });
  }
  // Trần thấp hơn các màn import khác (5000) có chủ đích: mỗi dòng ở đây sinh ra một
  // BẢN GHI LỚP + một mã lớp lấy từ bộ đếm trong transaction, không phải một dòng danh
  // mục. Một file 5000 dòng là 5000 lượt `nextSeq` nối đuôi nhau.
  if (rows.length > 500) {
    return NextResponse.json({ error: "Tối đa 500 lớp một lần" }, { status: 400 });
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const cauHinh = await layCauHinhKhung();

  // Hình dạng từng dòng trước, tra DB sau — tra cả nghìn slug cho những dòng vốn đã hỏng
  // là tốn công vô ích.
  const buoc1 = rows.map((raw, i) => {
    const r = RowSchema.safeParse(raw);
    return r.success
      ? ({ ok: true as const, row: i + 2, data: r.data })
      : ({
          ok: false as const,
          row: i + 2,
          error: r.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
        });
  });

  // 23/09 — cột cơ sở nhận SLUG hoặc MÃ (CS1): người vận hành nhớ "CS1", không ai nhớ
  // `co-so-nguyen-huu-tho`. Mã so KHÔNG phân biệt hoa thường; slug khớp trước nếu trùng.
  const slugs = [...new Set(buoc1.flatMap((r) => (r.ok ? [r.data.centerSlug] : [])))];
  const centers = slugs.length
    ? await sdb.center.findMany({
        where: {
          OR: [{ slug: { in: slugs } }, { code: { in: slugs.map((s) => s.toUpperCase()) } }],
        },
        select: { id: true, slug: true, code: true },
      })
    : [];
  const idTheoSlug = new Map<string, string>();
  for (const c of centers) if (c.code) idTheoSlug.set(`ma:${c.code.toUpperCase()}`, c.id);
  for (const c of centers) idTheoSlug.set(`slug:${c.slug}`, c.id);
  const timCoSo = (v: string) =>
    idTheoSlug.get(`slug:${v}`) ?? idTheoSlug.get(`ma:${v.toUpperCase()}`);

  const khoaSlugs = [...new Set(buoc1.flatMap((r) => (r.ok && r.data.courseSlug ? [r.data.courseSlug] : [])))];
  const khoas = khoaSlugs.length
    ? await sdb.course.findMany({ where: { slug: { in: khoaSlugs } }, select: { id: true, slug: true } })
    : [];
  const khoaTheoSlug = new Map(khoas.map((c) => [c.slug, c.id]));

  const errors: ImportError[] = [];
  const hopLe: { row: number; centerId: string; courseId: string | null; name: string | null; ngay: Date; startTime: string; endTime: string }[] = [];

  for (const r of buoc1) {
    if (!r.ok) {
      errors.push({ row: r.row, error: r.error });
      continue;
    }
    const centerId = timCoSo(r.data.centerSlug);
    if (!centerId) {
      errors.push({ row: r.row, error: `Không có cơ sở với mã hoặc slug "${r.data.centerSlug}"` });
      continue;
    }
    // Cách ly cơ sở ở ĐƯỜNG GHI: `scopedDb` chỉ tự lọc phép ĐỌC. Thiếu vế này thì Quản
    // lý CS1 dán được một file mở lớp cho CS2.
    if (!passesScope("TrialClassV2", { centerId }, actor)) {
      errors.push({ row: r.row, error: "Bạn không có quyền mở lớp tại cơ sở này" });
      continue;
    }
    if (r.data.courseSlug && !khoaTheoSlug.has(r.data.courseSlug)) {
      errors.push({ row: r.row, error: `Không có khoá với slug "${r.data.courseSlug}"` });
      continue;
    }

    const ngay = ngayVnSangUtc(r.data.date);
    if (!ngay) {
      errors.push({ row: r.row, error: "Ngày không hợp lệ" });
      continue;
    }

    const khung = khungChoNgay(ngay, cauHinh);
    if (!khung.ok) {
      errors.push({ row: r.row, error: khung.loi });
      continue;
    }
    const kiem = kiemKhungLop({
      khungHopLe: khung.giaTri,
      startTime: r.data.startTime,
      endTime: r.data.endTime,
      tenThu: TEN_THU[THU_KHOA[vnWeekday(ngay)]!] ?? "Ngày này",
    });
    if (!kiem.ok) {
      errors.push({ row: r.row, error: kiem.loi });
      continue;
    }

    hopLe.push({
      row: r.row,
      centerId,
      courseId: r.data.courseSlug ? (khoaTheoSlug.get(r.data.courseSlug) ?? null) : null,
      name: r.data.name,
      ngay,
      startTime: r.data.startTime,
      endTime: r.data.endTime,
    });
  }

  // Tạo TUẦN TỰ, không `Promise.all`: `createTrialClass` lấy mã lớp từ bộ đếm dùng chung
  // (`nextSeq`) trong transaction — chạy song song là tranh nhau cùng một khoá đếm.
  let created = 0;
  for (const h of hopLe) {
    const res = await createTrialClass({
      centerId: h.centerId,
      courseId: h.courseId,
      name: h.name,
      configId: null,
      startDate: h.ngay,
      startTime: h.startTime,
      endTime: h.endTime,
      actorId: session.user.id,
    });
    if (res?.ok) created += 1;
    else errors.push({ row: h.row, error: res?.error ?? "Tạo lớp thất bại" });
  }

  revalidatePath("/lop-trial");
  return NextResponse.json({ created, updated: 0, skipped: 0, errors });
}
