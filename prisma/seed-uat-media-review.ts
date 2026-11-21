// prisma/seed-uat-media-review.ts — ảnh chờ duyệt cho tài khoản UAT quản lý cơ sở.
//
// Dựng dữ liệu để nghiệm thu màn /duyet-media (MEDIA-REVIEW 26/08). Mặc định nhắm
// `uat.giamdoc@satarobo.vn` (CENTER_MANAGER · CS1) — người này chỉ thấy buổi của CƠ SỞ
// MÌNH, nên seed vào cơ sở khác là màn vẫn trống.
//
//   pnpm exec tsx prisma/seed-uat-media-review.ts --dry-run
//   pnpm exec tsx prisma/seed-uat-media-review.ts
//   pnpm exec tsx prisma/seed-uat-media-review.ts --clean       # gỡ đúng phần seed này
//   pnpm exec tsx prisma/seed-uat-media-review.ts --email=... --days=7 --sessions=10
//
// ⚠️ TẠO CẢ HAI DÒNG như đường tải lên thật (`createDraftMediaBatch`):
//   • `ClassSessionMedia` DRAFT — bản ghi GIAO cho phụ huynh (đường cũ vẫn đang chạy)
//   • `MediaAsset` PENDING       — hàng chờ duyệt kiểu mới, nối bằng `legacyMediaId`
// Thiếu dòng cũ thì duyệt xong nút "Chọn ảnh" ở phiếu nhận xét vẫn trống ⇒ nghiệm thu
// chuỗi upload → duyệt → chọn ảnh sẽ đứt ở khâu cuối mà không rõ vì sao.
//
// Idempotent: mọi dòng mang id tiền tố `uatmr-`, chạy lại chỉ bỏ qua dòng đã có.
import { PrismaClient } from "@prisma/client";

// DIRECT_URL (session pooler): transaction pooler dùng lại tên prepared statement giữa
// các kết nối ⇒ script chạy dài đâm `42P05 prepared statement "s0" already exists`.
const db = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const PREFIX = "uatmr-";
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const CLEAN = argv.includes("--clean");
const arg = (k: string, d: string) =>
  argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const EMAIL = arg("email", "uat.giamdoc@satarobo.vn");
/** Nhìn lại bao nhiêu ngày để chọn buổi. */
const DAYS = Number(arg("days", "10"));
/** Số buổi được seed ảnh. */
const HOW_MANY = Number(arg("sessions", "9"));

/** Số ảnh mỗi buổi — cố ý lệch nhau để lưới không đều, giống lớp thật. */
const COUNTS = [8, 12, 5, 14, 6, 10, 3, 9, 7];

async function main() {
  if (CLEAN) {
    if (DRY) {
      const a = await db.mediaAsset.count({ where: { id: { startsWith: PREFIX } } });
      const c = await db.classSessionMedia.count({ where: { id: { startsWith: PREFIX } } });
      console.log(`[dry-run] sẽ xoá ${a} MediaAsset + ${c} ClassSessionMedia`);
      return;
    }
    // MediaAsset trước: nó trỏ sang dòng cũ qua legacyMediaId.
    const a = await db.mediaAsset.deleteMany({ where: { id: { startsWith: PREFIX } } });
    const c = await db.classSessionMedia.deleteMany({ where: { id: { startsWith: PREFIX } } });
    const r = await db.sessionMediaReview.deleteMany({ where: { id: { startsWith: PREFIX } } });
    console.log(`Đã xoá ${a.count} MediaAsset · ${c.count} ClassSessionMedia · ${r.count} kết luận`);
    return;
  }

  const user = await db.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, name: true, centerId: true },
  });
  if (!user) throw new Error(`Không tìm thấy tài khoản ${EMAIL}`);
  if (!user.centerId) throw new Error(`${EMAIL} chưa gắn cơ sở — không suy được phạm vi`);
  console.log(`Tài khoản: ${user.name} (${EMAIL}) · cơ sở ${user.centerId}`);

  // Mốc ngày tính theo NGÀY LỊCH VN nhưng lưu ở UTC 00:00 (quy ước cột @db.Date).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today.getTime() - DAYS * 86400000);

  const sessions = await db.classSession.findMany({
    where: {
      centerId: user.centerId,
      status: { not: "CANCELLED" },
      date: { gte: from, lte: new Date(today.getTime() + 86400000 - 1) },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      classId: true,
      centerId: true,
      orgUnitId: true,
      date: true,
      actualTeacherId: true,
      substituteTeacherId: true,
      class: { select: { name: true, teacherId: true } },
    },
  });

  // Chỉ buổi CHƯA có kết luận và CHƯA có ảnh chờ — đừng chồng thêm lên buổi vốn đã có
  // việc, và đừng dựng lại buổi QLCS đã duyệt xong.
  const ids = sessions.map((s) => s.id);
  const [reviews, coAnh] = await Promise.all([
    db.sessionMediaReview.findMany({
      where: { classSessionId: { in: ids }, status: { not: "OPEN" } },
      select: { classSessionId: true },
    }),
    db.mediaAsset.groupBy({
      by: ["classSessionId"],
      where: { classSessionId: { in: ids }, status: "PENDING" },
      _count: { _all: true },
    }),
  ]);
  const daDong = new Set(reviews.map((r) => r.classSessionId));
  const daCoAnh = new Set(coAnh.map((c) => c.classSessionId));

  const chon = sessions
    .filter((s) => !daDong.has(s.id) && !daCoAnh.has(s.id))
    .slice(0, HOW_MANY);

  if (chon.length === 0) {
    console.log("Không còn buổi nào trống để seed — mọi buổi gần đây đã có ảnh hoặc đã duyệt.");
    return;
  }

  let tongAnh = 0;
  const theoNgay = new Map<string, number>();

  for (const [i, s] of chon.entries()) {
    const n = COUNTS[i % COUNTS.length]!;
    // GV đứng buổi đó — cột ⓘ ở thẻ lớp hỏi đúng người này khi ảnh có vấn đề.
    const gvId = s.actualTeacherId ?? s.substituteTeacherId ?? s.class?.teacherId ?? user.id;
    const gv = await db.user.findUnique({ where: { id: gvId }, select: { name: true } });
    const ngay = s.date.toISOString().slice(0, 10);
    theoNgay.set(ngay, (theoNgay.get(ngay) ?? 0) + n);

    for (let k = 0; k < n; k++) {
      const id = `${PREFIX}${s.id}-${k}`;
      // picsum: ảnh THẬT tải được, mỗi seed một ảnh khác nhau — lưới trông như lớp thật
      // chứ không phải 12 ô giống hệt.
      const url = `https://picsum.photos/seed/${PREFIX}${s.id}${k}/900/675`;
      if (DRY) continue;

      await db.classSessionMedia.upsert({
        where: { id },
        update: {},
        create: {
          id,
          classId: s.classId,
          classSessionId: s.id,
          fileUrl: url,
          fileName: `IMG_${String(k + 1).padStart(4, "0")}.jpg`,
          status: "DRAFT",
          isClassWide: false,
          takenAt: s.date,
          uploadedById: gvId,
          uploadedByName: gv?.name ?? "Giáo viên",
        },
      });
      await db.mediaAsset.upsert({
        where: { id },
        update: {},
        create: {
          id,
          centerId: s.centerId!,
          orgUnitId: s.orgUnitId,
          classId: s.classId,
          classSessionId: s.id,
          sessionDate: s.date,
          legacyMediaId: id,
          uploadedById: gvId,
          uploadedByName: gv?.name ?? "Giáo viên",
          type: "IMAGE",
          r2Key: url,
          status: "PENDING",
        },
      });
    }
    tongAnh += n;
    console.log(`  ${ngay} · ${s.class?.name ?? s.classId} — ${n} ảnh (GV: ${gv?.name ?? "?"})`);
  }

  console.log(
    `\n${DRY ? "[dry-run] " : ""}${tongAnh} ảnh vào ${chon.length} buổi, ` +
      `trải ${theoNgay.size} ngày. Mở /duyet-media bằng ${EMAIL} để duyệt.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
