/**
 * EL-04 — NHẬP 50 BÀI HƯỚNG DẪN CÓ SẴN làm nội dung mồi.
 *
 *   pnpm tsx scripts/elearning-import-guides.ts                       # rà soát, KHÔNG ghi
 *   pnpm tsx scripts/elearning-import-guides.ts --apply --da-ra-soat  # ghi thật
 *
 * ⚠️ DI TRÚ MỘT CHIỀU. Sau lần nhập đầu, DB là nguồn: người soạn sửa bài TRONG hệ
 * thống, không sửa `guides.generated.ts`. Chạy lại script sẽ GHI ĐÈ nội dung đã
 * sửa bằng bản trong tệp — nên chỉ chạy lại khi thật sự muốn thế.
 *
 * ─── Vì sao có bước rà bảo mật BẮT BUỘC ──────────────────────────────────────
 * 50 bài này là tài liệu vận hành nội bộ, nhưng chúng được viết cho ba site khác
 * nhau và chưa ai đọc lại chúng với con mắt "cái gì không được lọt ra danh mục
 * tự chọn". Khoá ra mắt có thể chứa bảng giá, chính sách ưu đãi, chuẩn ngạch
 * lương. Nên `--apply` KHÔNG chạy nếu thiếu `--da-ra-soat`: người vận hành phải
 * đọc bản in rà soát trước, và cờ đó là chữ ký của họ.
 */
import fs from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { ADMIN_GUIDES } from "../app/(admin)/admin/huong-dan/_content/guides.generated";
import { PORTAL_GUIDES } from "../app/(portal)/portal/huong-dan/_content/guides.generated";
import { TEACHER_GUIDES } from "../app/(teacher)/teacher/huong-dan/_content/guides.generated";
import { computeMinReadSeconds } from "../lib/elearning/reading";

function resolveDbUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  const pick = (k: string) =>
    env.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
  const url = pick("DIRECT_URL") ?? pick("DATABASE_URL");
  if (!url) throw new Error("Không đọc được DIRECT_URL/DATABASE_URL từ .env");
  return url;
}

const db = new PrismaClient({ datasources: { db: { url: resolveDbUrl() } } });
const APPLY = process.argv.includes("--apply");
const DA_RA_SOAT = process.argv.includes("--da-ra-soat");

type Bai = {
  slug: string;
  order: number;
  title: string;
  category: string;
  description?: string;
  body: string;
};

const BO = [
  { ma: "EL-HD-ADMIN", ten: "Hướng dẫn sử dụng trang quản trị", bai: ADMIN_GUIDES as Bai[] },
  { ma: "EL-HD-PORTAL", ten: "Hướng dẫn sử dụng cổng phụ huynh", bai: PORTAL_GUIDES as Bai[] },
  { ma: "EL-HD-TEACHER", ten: "Hướng dẫn sử dụng site giáo viên", bai: TEACHER_GUIDES as Bai[] },
];

/**
 * Dấu hiệu nội dung có thể NHẠY CẢM. Cố ý rộng và cố ý gây báo thừa: bỏ sót một
 * bài chứa bảng giá đắt hơn nhiều so với việc người vận hành đọc thêm vài dòng.
 */
const DAU_HIEU: Array<[string, RegExp]> = [
  ["bảng giá / học phí", /học phí|bảng giá|đơn giá|chiết khấu/i],
  ["lương / ngạch bậc", /lương|ngạch|bậc lương|phụ cấp|thưởng doanh số/i],
  ["chính sách ưu đãi", /ưu đãi|khuyến mãi|voucher|hoa hồng/i],
  ["thông tin cá nhân", /CCCD|căn cước|số điện thoại phụ huynh|địa chỉ nhà/i],
];

function raSoat(bai: Bai): string[] {
  return DAU_HIEU.filter(([, re]) => re.test(bai.body)).map(([ten]) => ten);
}

async function main() {
  console.log(
    APPLY
      ? "⚠️  CHẾ ĐỘ GHI THẬT\n"
      : "🔍 RÀ SOÁT — không ghi gì. Đọc xong thêm --apply --da-ra-soat để nhập.\n",
  );

  const tong = BO.reduce((s, b) => s + b.bai.length, 0);
  console.log(`Tổng: ${tong} bài từ ${BO.length} bộ\n`);

  // ── Bước 1: RÀ BẢO MẬT ────────────────────────────────────────────────────
  let soNghiNgo = 0;
  for (const bo of BO) {
    const nghiNgo = bo.bai
      .map((b) => ({ b, co: raSoat(b) }))
      .filter((x) => x.co.length > 0);
    if (nghiNgo.length === 0) continue;
    soNghiNgo += nghiNgo.length;
    console.log(`── ${bo.ma} — ${nghiNgo.length}/${bo.bai.length} bài cần đọc lại ──`);
    for (const { b, co } of nghiNgo) {
      console.log(`   ${b.slug} — ${b.title}`);
      console.log(`      dấu hiệu: ${co.join(" · ")}`);
    }
    console.log();
  }
  if (soNghiNgo === 0) {
    console.log("✅ Không bài nào chạm dấu hiệu nhạy cảm.\n");
  } else {
    console.log(
      `⚠️  ${soNghiNgo} bài chạm dấu hiệu. Đọc lại từng bài trước khi nhập.\n` +
        "   Bài nào thật sự nhạy cảm thì SỬA NỘI DUNG hoặc bỏ khỏi đợt nhập —\n" +
        "   KHÔNG nâng securityLevel để né, vì mức cao chỉ giới hạn AI THẤY chứ\n" +
        "   không xoá nội dung khỏi bài.\n",
    );
  }

  if (!APPLY) {
    console.log("🔍 Chưa ghi gì.");
    return;
  }
  if (!DA_RA_SOAT) {
    console.log(
      "⛔ Thiếu --da-ra-soat. Cờ đó là chữ ký xác nhận bạn ĐÃ ĐỌC bản rà soát ở\n" +
        "   trên. Không có nó thì --apply không chạy — có chủ đích.",
    );
    process.exitCode = 1;
    return;
  }

  // ── Bước 2: NHẬP ──────────────────────────────────────────────────────────
  const owner = await db.user.findFirst({
    where: { deletedAt: null, role: { not: "PARENT" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) throw new Error("Không có tài khoản nhân sự nào để làm chủ sở hữu");

  for (const bo of BO) {
    const course = await db.trnCourse.upsert({
      where: { code: bo.ma },
      update: { title: bo.ten, deletedAt: null },
      create: {
        code: bo.ma,
        slug: bo.ma.toLowerCase(),
        title: bo.ten,
        summary: "Nội dung mồi, di trú một chiều từ bộ hướng dẫn có sẵn.",
        status: "PUBLISHED",
        publishedAt: new Date(),
        securityLevel: "INTERNAL",
        // FAIL-CLOSED ghi tường minh: khoá mới không tự hiện với ai.
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        catalogRuleJson: Prisma.DbNull,
        ownerUserId: owner.id,
        // NULL = áp toàn công ty — hướng dẫn dùng hệ thống đúng là của cả công ty.
        centerId: null,
        orgUnitId: null,
      },
      select: { id: true },
    });

    // Chương = `category`, giữ ĐÚNG thứ tự xuất hiện đầu tiên trong tệp. Không
    // sort theo bảng chữ cái: thứ tự trong tệp là thứ tự người viết chủ ý dạy.
    const chuong: string[] = [];
    for (const b of bo.bai) if (!chuong.includes(b.category)) chuong.push(b.category);

    const moduleIdTheoTen = new Map<string, string>();
    for (const [i, ten] of chuong.entries()) {
      const m = await db.trnModule.upsert({
        where: { courseId_orderIndex: { courseId: course.id, orderIndex: i } },
        update: { title: ten },
        create: { courseId: course.id, title: ten, orderIndex: i },
        select: { id: true },
      });
      moduleIdTheoTen.set(ten, m.id);
    }

    // Thứ tự bài TRONG chương phải liên tục từ 0: `order` trong tệp là thứ tự
    // TOÀN BỘ site, không phải trong chương, nên dùng thẳng sẽ vỡ khoá
    // `@@unique([moduleId, orderIndex])` ngay khi hai chương có bài cùng số.
    const demTheoChuong = new Map<string, number>();
    for (const b of [...bo.bai].sort((a, c) => a.order - c.order)) {
      const moduleId = moduleIdTheoTen.get(b.category) as string;
      const idx = demTheoChuong.get(b.category) ?? 0;
      demTheoChuong.set(b.category, idx + 1);

      await db.trnLesson.upsert({
        where: { moduleId_orderIndex: { moduleId, orderIndex: idx } },
        update: {
          title: b.title,
          contentMd: b.body,
          sourceGuideSlug: b.slug,
          // Tính LẠI mỗi lần nhập là đúng ở đây (nội dung vừa thay), nhưng sau đó
          // trang đọc chỉ ĐỌC cột này — không tính lại theo từng lượt xem.
          minReadSeconds: computeMinReadSeconds(b.body),
          deletedAt: null,
        },
        create: {
          moduleId,
          title: b.title,
          orderIndex: idx,
          kind: "READ",
          contentMd: b.body,
          sourceGuideSlug: b.slug,
          minReadSeconds: computeMinReadSeconds(b.body),
        },
      });
    }

    const soBai = await db.trnLesson.count({
      where: { module: { courseId: course.id } },
    });
    console.log(`✅ ${bo.ma}: ${chuong.length} chương · ${soBai} bài`);
  }

  console.log(
    "\n⚠️ TỪ ĐÂY DB LÀ NGUỒN. Sửa bài trong hệ thống, đừng sửa guides.generated.ts —\n" +
      "   chạy lại script này sẽ GHI ĐÈ nội dung đã sửa bằng bản trong tệp.",
  );
}

main()
  .catch((e) => {
    console.error("❌ import-guides:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
