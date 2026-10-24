/**
 * Seed 1 GIÁO ÁN PDF (slide demo) cho 1 buổi của lớp test → GV xem slider ở "Tài liệu lớp tôi".
 *   pnpm tsx prisma/seed-test-slide.tsx
 * Yêu cầu: migration lesson_material_kind đã apply + R2 env (.env). KHÔNG dùng cho prod.
 * Tạo cả ClassSession nối lớp↔buổi để GV (trợ giảng) được phép trình chiếu.
 */
import { config as loadEnv } from "dotenv";
import React from "react";
import path from "path";
import {
  Document,
  Page,
  Text,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../lib/db";
import { getR2Client, getR2Bucket } from "../lib/storage/r2-client";
import { publishAndSwapLessonMaterial } from "../lib/scorm/publish";

// R2 creds thật ở .env.local; .env có thể chỉ là placeholder rỗng (Prisma auto-load .env
// trước). override:true để giá trị .env.local đè placeholder rỗng. r2-client lazy → kịp.
loadEnv({ path: ".env.local", override: true });

const TEST_CLASS_ID = "cmqqhcvoj00061ey49q5eqc20"; // CS1.SATA3.26.001

Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf"), fontWeight: "normal" },
    { src: path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

const slides = [
  { title: "Đèn tín hiệu giao thông", body: "Sata Robo — Dự án robot điều khiển đèn giao thông" },
  {
    title: "Mục tiêu buổi học",
    body: "• Hiểu chu kỳ đèn đỏ – vàng – xanh\n• Lập trình thời gian chờ\n• Lắp mạch 3 đèn LED",
  },
  {
    title: "Vật liệu cần chuẩn bị",
    body: "• Board điều khiển\n• 3 LED (đỏ / vàng / xanh)\n• Dây nối + điện trở",
  },
  {
    title: "Các bước thực hiện",
    body: "1) Lắp 3 đèn LED\n2) Viết chương trình điều khiển\n3) Nạp & chạy thử\n4) Hiệu chỉnh thời gian",
  },
  {
    title: "Tổng kết",
    body: "Hoàn thành mô hình đèn giao thông tự động.\nMở rộng: thêm nút bấm sang đường cho người đi bộ.",
  },
];

const s = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    backgroundColor: "#0f172a",
    color: "#ffffff",
    paddingVertical: 60,
    paddingHorizontal: 64,
    justifyContent: "center",
  },
  title: { fontSize: 30, fontWeight: "bold", color: "#fb923c", marginBottom: 24 },
  body: { fontSize: 18, lineHeight: 1.7, color: "#e2e8f0" },
  num: { position: "absolute", bottom: 28, right: 40, fontSize: 11, color: "#94a3b8" },
});

function Deck() {
  return (
    <Document>
      {slides.map((sl, i) => (
        <Page key={i} size="A4" orientation="landscape" style={s.page}>
          <Text style={s.title}>{sl.title}</Text>
          <Text style={s.body}>{sl.body}</Text>
          <Text style={s.num}>
            {i + 1} / {slides.length}
          </Text>
        </Page>
      ))}
    </Document>
  );
}

async function main() {
  const cls = await db.class.findUnique({
    where: { id: TEST_CLASS_ID },
    select: { id: true, name: true, courseId: true, centerId: true, curriculumId: true },
  });
  if (!cls) throw new Error("Không tìm thấy lớp test CS1.SATA3.26.001 — chạy db:seed/seed-test-parent trước.");

  // Khung chương trình ĐANG DÙNG của lớp → buổi đầu tiên (gắn slide).
  const curriculum =
    (cls.curriculumId
      ? await db.curriculum.findUnique({
          where: { id: cls.curriculumId },
          select: {
            lessons: {
              where: { archivedAt: null },
              orderBy: { order: "asc" },
              take: 1,
              select: { id: true, order: true, title: true },
            },
          },
        })
      : null) ??
    (await db.curriculum.findFirst({
      where: { courseId: cls.courseId, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: {
        lessons: {
          where: { archivedAt: null },
          orderBy: { order: "asc" },
          take: 1,
          select: { id: true, order: true, title: true },
        },
      },
    }));
  const lesson = curriculum?.lessons[0];
  if (!lesson) throw new Error("Khoá của lớp test chưa có buổi học — tạo giáo trình trước.");

  // ClassSession nối lớp ↔ buổi (gate trình chiếu cho GV trợ giảng). Idempotent.
  const existed = await db.classSession.findFirst({
    where: { classId: cls.id, lessonId: lesson.id },
    select: { id: true },
  });
  if (!existed) {
    await db.classSession.create({
      data: {
        classId: cls.id,
        lessonId: lesson.id,
        centerId: cls.centerId,
        date: new Date(),
        topic: lesson.title,
      },
    });
  }

  // Render PDF demo (slide).
  const pdf = await renderToBuffer(<Deck />);

  // Tạo row giáo án PDF → upload R2 → publish + thay bản cũ (helper thật, giữ invariant 1/buổi).
  const created = await db.scormPackage.create({
    data: {
      lessonId: lesson.id,
      name: "Slide demo — Đèn tín hiệu giao thông",
      kind: "PDF",
      version: 1,
      status: "UPLOADING",
      storagePrefix: "pending",
    },
    select: { id: true },
  });
  const storagePrefix = `scorm/${created.id}/`;
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: `${storagePrefix}source.pdf`,
      Body: pdf,
      ContentType: "application/pdf",
    }),
  );
  await db.scormPackage.update({
    where: { id: created.id },
    data: { storagePrefix, uploadKey: `${storagePrefix}source.pdf` },
  });
  await publishAndSwapLessonMaterial(created.id, lesson.id, {
    launchUrl: "source.pdf",
    scormVersion: null,
    sizeBytes: pdf.length,
    fileCount: slides.length,
  });

  console.log("✅ Đã seed giáo án PDF demo:");
  console.log(`   Lớp:   ${cls.name}`);
  console.log(`   Buổi:  Buổi ${lesson.order} — ${lesson.title}`);
  console.log(`   Slide: ${slides.length} trang (PDF)`);
  console.log("   Xem:   đăng nhập GV → /admin/teaching-materials → chọn lớp → Xem slide");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌ Seed slide lỗi:", e);
    await db.$disconnect();
    process.exit(1);
  });
