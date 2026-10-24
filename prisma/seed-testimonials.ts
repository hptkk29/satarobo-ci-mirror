import { PrismaClient } from "@prisma/client";

// Seed Testimonial từ dữ liệu LIVE inline của 3 component cảm nhận:
//  - components/legacy-laptrinhrobot/Testimonials.tsx  → courseSlug "laptrinhrobot"
//  - components/legacy-luyenthirobosim/Testimonials.tsx → courseSlug "luyenthirobosim"
//  - components/sections/testimonials.tsx (home)        → courseSlug "home"
// Idempotent: findFirst theo (name + content) → update, else create.
// Dữ liệu được COPY (literal) vào đây — KHÔNG import .tsx vào seed.

// ─── laptrinhrobot (video testimonials) ─────────────────────────────────────
const LAPTRINHROBOT = [
  {
    initials: "NA",
    name: "Anh Ngọc Anh",
    role: "Phụ huynh bạn Duy Tùng · Đà Nẵng",
    quote:
      '"Con học 3 tuần, từ chỗ không biết bắt đầu từ đâu đến khi thi thử đạt 85% điểm. Điều tôi thích nhất là AI chấm bài ngay — tôi biết chắc con hiểu bài trước khi học tiếp, khác hoàn toàn so với xem YouTube."',
    videoId: "anInoYFGrF0",
    avatarBg: "#5B2D8E",
  },
  {
    initials: "TS",
    name: "Anh Trường Sơn",
    role: "Phụ huynh bạn Minh Châu · Đà Nẵng",
    quote:
      '"Ban đầu lo con học Robotics sẽ khó theo. Nhưng sau vài buổi con đã hiểu cách robot nhận lệnh, biết sửa lỗi từng bước và hào hứng kể lại sản phẩm sau mỗi buổi học."',
    videoId: "bqB2c7AlSfE",
    avatarBg: "#7C3AED",
  },
  {
    initials: "MT",
    name: "Chị Mỹ Trang",
    role: "Phụ huynh bạn Gia Hân · Đà Nẵng",
    quote:
      '"Con thi Robotics năm ngoái không vào được vòng chung kết vì không có chiến lược. Năm nay học khóa này, con tự làm được bài tập và hiểu rõ cách sắp xếp thứ tự nhiệm vụ. Tự tin hơn hẳn khi bước vào phòng thi!"',
    videoId: "9MJFC4v8cbU",
    avatarBg: "#3D1A6E",
  },
];

// ─── luyenthirobosim (video testimonials) ───────────────────────────────────
const LUYENTHIROBOSIM = [
  {
    initials: "NA",
    name: "Anh Ngọc Anh",
    role: "Phụ huynh bạn Duy Tùng · Đà Nẵng",
    quote:
      '"Con học 3 tuần, từ chỗ không biết bắt đầu từ đâu đến khi thi thử đạt 85% điểm. Điều tôi thích nhất là AI chấm bài ngay — tôi biết chắc con hiểu bài trước khi học tiếp, khác hoàn toàn so với xem YouTube."',
    videoId: "anInoYFGrF0",
    avatarBg: "#5B2D8E",
  },
  {
    initials: "TS",
    name: "Anh Trường Sơn",
    role: "Phụ huynh bạn Minh Châu · Đà Nẵng",
    quote:
      '"Ban đầu lo con học online không hiệu quả. Nhưng 27.000 đồng mỗi buổi — rẻ hơn cả nửa cốc trà sữa — mà con tiến bộ rõ rệt sau 2 tuần. Con học hào hứng và làm được bài tập thực hành rất tốt."',
    videoId: "bqB2c7AlSfE",
    avatarBg: "#7C3AED",
  },
  {
    initials: "MT",
    name: "Chị Mỹ Trang",
    role: "Phụ huynh bạn Gia Hân · Đà Nẵng",
    quote:
      '"Con thi Robotics năm ngoái không vào được vòng chung kết vì không có chiến lược. Năm nay học khóa này, con tự làm được bài tập và hiểu rõ cách sắp xếp thứ tự nhiệm vụ. Tự tin hơn hẳn khi bước vào phòng thi!"',
    videoId: "9MJFC4v8cbU",
    avatarBg: "#3D1A6E",
  },
];

// ─── home (marquee, no video) ───────────────────────────────────────────────
const HOME = [
  {
    name: "Chị Nguyễn Thị Hà",
    role: "PH bé Tom (8 tuổi)",
    body: "Con học SP1 Robosim được 3 tháng. Từ ghét toán giờ con say mê logic, tự code đèn nháy. Tuyệt vời!",
    location: "Hải Châu, Đà Nẵng",
  },
  {
    name: "Anh Trần Văn Đức",
    role: "PH bé Bin (10 tuổi)",
    body: "Lớp 1:8 tại cơ sở Hoà Khánh, GV nhiệt tình. Con đã đoạt giải Robothon cấp tỉnh tháng trước.",
    location: "Liên Chiểu, Đà Nẵng",
  },
  {
    name: "Cô Lê Hoài Anh",
    role: "Hiệu trưởng TH ABC",
    body: "Sata Robo triển khai Lab STEM cho trường rất chuyên nghiệp. GV được training kỹ, HS rất hào hứng.",
    location: "Sơn Trà, Đà Nẵng",
  },
  {
    name: "Chị Phạm Mai Linh",
    role: "PH bé Mít (7 tuổi)",
    body: "Học online qua Robosim tiện cực kỳ! Không phải đưa con đi đâu, GV vẫn theo sát con từng buổi.",
    location: "Cẩm Lệ, Đà Nẵng",
  },
  {
    name: "Anh Hoàng Quốc Bảo",
    role: "PH bé Bống (12 tuổi)",
    body: "Con đậu vòng quốc gia WRO 2025! Cảm ơn các thầy cô đã định hướng đúng đắn cho con.",
    location: "Thanh Khê, Đà Nẵng",
  },
  {
    name: "Chị Vũ Thuỳ Dương",
    role: "PH bé An (9 tuổi)",
    body: "Giá hợp lý, con vui mỗi buổi. Khoá K2 con đã làm được robot nhặt rác hoàn chỉnh!",
    location: "Ngũ Hành Sơn, Đà Nẵng",
  },
  {
    name: "Anh Đỗ Văn Hùng",
    role: "PH bé Khánh (11 tuổi)",
    body: "Đã thử 2 trung tâm khác trước khi tìm Sata Robo. Đây là nơi duy nhất con không bỏ giữa chừng.",
    location: "Hải Châu, Đà Nẵng",
  },
  {
    name: "Chị Bùi Thị Lan",
    role: "PH bé Khoa (8 tuổi)",
    body: "Cô Trang tư vấn rất tâm huyết, đúng nhu cầu của con. Đăng ký 12 tháng luôn không hối hận.",
    location: "Hoà Vang, Đà Nẵng",
  },
];

// Strip 1 cặp dấu " bao quanh nếu có.
function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1);
  }
  return t;
}

// initial = chữ cái đầu của từ cuối trong tên (khớp initialOf ở home component).
function initialOf(name: string): string {
  const last = name.split(" ").slice(-1)[0];
  return last ? last.charAt(0) : "S";
}

type TestimonialSeed = {
  name: string;
  role: string;
  location: string;
  rating: number;
  avatar: string;
  avatarColor: string;
  content: string;
  videoId: string | null;
  courseSlug: string;
};

function buildRows(): TestimonialSeed[] {
  const rows: TestimonialSeed[] = [];

  const mapVideo = (
    src: { initials: string; name: string; role: string; quote: string; videoId: string; avatarBg: string }[],
    courseSlug: string,
  ) =>
    src.forEach((t) => {
      rows.push({
        name: t.name,
        role: t.role,
        location: "Đà Nẵng",
        rating: 5,
        avatar: t.initials,
        avatarColor: t.avatarBg,
        content: stripQuotes(t.quote),
        videoId: t.videoId,
        courseSlug,
      });
    });

  mapVideo(LAPTRINHROBOT, "laptrinhrobot");
  mapVideo(LUYENTHIROBOSIM, "luyenthirobosim");

  HOME.forEach((t) => {
    rows.push({
      name: t.name,
      role: t.role,
      location: t.location,
      rating: 5,
      avatar: initialOf(t.name),
      avatarColor: "from-orange-400 to-purple-500",
      content: t.body,
      videoId: null,
      courseSlug: "home",
    });
  });

  return rows;
}

export async function seedTestimonials(db: PrismaClient) {
  console.log("💬 Seeding testimonials (laptrinhrobot + luyenthirobosim + home)...");

  const rows = buildRows();
  let order = 0;
  for (const r of rows) {
    const existing = await db.testimonial.findFirst({
      where: { name: r.name, content: r.content },
      select: { id: true },
    });
    const data = { ...r, displayOrder: order, isPublished: true };
    if (existing) {
      await db.testimonial.update({ where: { id: existing.id }, data });
    } else {
      await db.testimonial.create({ data });
    }
    order++;
  }

  console.log(`✅ Testimonials: ${rows.length} bản ghi`);
}

// Cho phép chạy độc lập: tsx prisma/seed-testimonials.ts
if (require.main === module) {
  const db = new PrismaClient();
  seedTestimonials(db)
    .catch((e) => {
      console.error("❌ Seed testimonials thất bại:", e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
