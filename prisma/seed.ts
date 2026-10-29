import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedHonors } from "./seed-honors";
import { seedEmailTemplates } from "./seed-email-templates";
import { seedCoursePackageContent } from "./seed-coursepackage-content";
import { seedMarketingContent } from "./seed-marketing-content";
import { seedTestimonials } from "./seed-testimonials";
import { seedDepartments } from "./seed-departments";
import { seedOrgUnits } from "./seed-orgunit";
import { seedRoles } from "./seed-roles";
import { seedWorkingHours } from "./seed-working-hours";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Bắt đầu seed data...");

  // ─── Centers ─────────────────────────────────────────────────────────────────
  // 2 cơ sở operational match lib/locations.ts (211 NHT = HQ + 114 HD).
  // centersData[0] = HQ → dùng làm fallback cho FK orphan của các row khác.
  const centersData = [
    {
      id: "co-so-nguyen-huu-tho",
      code: "CS1",
      slug: "co-so-nguyen-huu-tho",
      name: "Trụ sở chính - Nguyễn Hữu Thọ",
      address: "211 Nguyễn Hữu Thọ",
      city: "Đà Nẵng",
      phone: "0837312860",
      email: "thongtin@satarobo.vn",
      isActive: true,
    },
    {
      id: "co-so-hoang-dieu",
      code: "CS2",
      slug: "co-so-hoang-dieu",
      name: "Cơ sở Hoàng Diệu",
      address: "114 Hoàng Diệu",
      city: "Đà Nẵng",
      phone: "0837312860",
      email: "thongtin@satarobo.vn",
      isActive: true,
    },
    {
      // Hội sở (back-office: HR/Kế toán/Marketing). Là đơn vị độc lập, KHÔNG
      // phải cơ sở vận hành public (không nằm trong lib/locations.ts). Cần có
      // trong Center để gán nhân sự HO + tạo tài khoản HO (đồng bộ OrgUnit code "HO").
      id: "hoi-so",
      code: "HO",
      slug: "hoi-so",
      name: "Hội sở",
      address: "Đà Nẵng",
      city: "Đà Nẵng",
      phone: "0837312860",
      email: "thongtin@satarobo.vn",
      isActive: true,
    },
  ];

  for (const data of centersData) {
    await db.center.upsert({
      where: { id: data.id },
      update: data,
      create: data,
    });
  }
  const validCenterIds = centersData.map((c) => c.id);

  // Re-point FK của User/Lead/Class/Student về HQ mới trước khi xoá cơ sở cũ
  // (relation onDelete mặc định Restrict, nên cần tay làm thế).
  const newHqId = centersData[0].id; // co-so-nguyen-huu-tho
  await db.user.updateMany({
    where: { centerId: { notIn: validCenterIds, not: null } },
    data: { centerId: newHqId },
  });
  await db.lead.updateMany({
    where: { centerId: { notIn: validCenterIds, not: null } },
    data: { centerId: newHqId },
  });
  await db.class.updateMany({
    where: { centerId: { notIn: validCenterIds, not: null } },
    data: { centerId: newHqId },
  });
  await db.student.updateMany({
    where: { centerId: { notIn: validCenterIds, not: null } },
    data: { centerId: newHqId },
  });
  // Employee.center has onDelete: SetNull — đặt về HQ luôn cho gọn
  await db.employee.updateMany({
    where: { centerId: { notIn: validCenterIds, not: null } },
    data: { centerId: newHqId },
  });

  const removedCenters = await db.center.deleteMany({
    where: { id: { notIn: validCenterIds } },
  });
  console.log(`✅ ${centersData.length} cơ sở đã tạo · removed ${removedCenters.count} cơ sở cũ`);

  // ─── Courses (Phase 4.UI.FIX.1) ──────────────────────────────────────────
  // Focus 2 khoá học chính. Loại bỏ 4 SP marketing + 2 legacy hyphenated slugs.
  const coursesData = [
    {
      slug: "laptrinhrobot",
      code: "LTR",
      name: "Lập trình Robot",
      type: "OFFLINE" as const,
      shortDescription:
        "Hệ thống các khoá học offline tại trung tâm bao gồm khoá luyện thi(dành cho học sinh từ lớp 3-8 đã có nền tảng với mong muốn luyện thi cấp tốc để thi đấu) và khoá học chuyên sâu (dành cho học sinh từ lớp 1-8 chưa có nền tảng với mong muốn học lập trình robot để phát triển tư duy lâu dài). ",
      description: `Khoá học Lập trình Robot là chương trình giáo dục STEM toàn diện dành cho học sinh từ lớp 1-8, giúp các em làm quen với:

- Tư duy logic và lập trình cơ bản
- Cấu trúc và nguyên lý hoạt động của robot
- Lập trình robot thực hành với kit chuyên dụng
- Phát triển tư duy giải quyết vấn đề

Chương trình được thiết kế bài bản từ cơ bản đến nâng cao, học viên sẽ tự tay xây dựng và lập trình các robot từ đơn giản đến phức tạp.`,
      priceDisplay: "Liên hệ tư vấn",
      duration: 180,
      durationDisplay: "12 tháng (48 buổi)",
      studentCount: 1200,
      displayOrder: 1,
      isActive: true,
      isPublished: true,
    },
    {
      slug: "luyenthirobosim",
      code: "LTRS",
      name: "Luyện thi Robosim",
      type: "HYBRID" as const,
      shortDescription:
        "Khoá tự học Online qua nền tảng SataWorld - Chuẩn bị thi đấu Robotics chuyên nghiệp (RoboSim) cho học sinh có nền tảng. Có hướng dẫn giải đề chi tiết dành cho đề thi vòng loại Robotics Quốc gia 2026.",
      description: `Luyện thi Robosim là chương trình dành cho học viên muốn vượt qua vòng loại Robotics Quốc gia 2026 để đến với vòng Khu vực được diễn ra vào tháng 9/2026.

Học viên sẽ được:
- Luyện tập trên nền tảng mô phỏng Robosim chuyên nghiệp
- Học chiến thuật giải quyết các challenge cuộc thi
- Phát triển kỹ năng làm việc nhóm trong team thi
- Hướng dẫn 1-1 bởi mentor có kinh nghiệm thi đấu

Chương trình phù hợp cho học sinh đã có nền tảng lập trình robot cơ bản.`,
      priceDisplay: "Liên hệ tư vấn",
      duration: 120,
      durationDisplay: "1-2 tháng",
      studentCount: 800,
      displayOrder: 2,
      isActive: true,
      isPublished: true,
    },
  ];

  for (const data of coursesData) {
    await db.course.upsert({
      where: { slug: data.slug },
      update: data,
      create: data,
    });
  }

  // Xoá courses không nằm trong list mới (sp1-4 + lap-trinh-robot/luyen-thi-robosim legacy).
  // deleteMany an toàn vì lúc seed chưa có Lead/Class/Enrollment ref tới chúng.
  const validSlugs = coursesData.map((c) => c.slug);
  const deleted = await db.course.deleteMany({
    where: { slug: { notIn: validSlugs } },
  });
  console.log(
    `✅ ${coursesData.length} khoá học chính · removed ${deleted.count} legacy/SP courses`,
  );

  // ─── ZMRobo Kits (Phase 4.UI.FIX.2) ─────────────────────────────────────
  // 3 bộ học cụ ZMROBO: Alpha (nhập môn) / Beta (thi đấu) / Intelligence Storm (AI nâng cao)
  const zmRoboKits = [
    {
      slug: "alpha",
      brand: "ZMROBO",
      series: "α-Series",
      code: null,
      title: "Alpha Set",
      subtitle: "Bộ NHẬP MÔN cho trẻ từ 6 tuổi",
      shortDescription:
        "Lập trình robot KHÔNG cần máy tính qua thẻ lệnh OID — 320-378 chi tiết, 7 cảm biến, Smart Hub. Phương pháp PBL.",
      description: `Alpha Set (α-Series) là bộ học cụ NHẬP MÔN dành cho trẻ em từ 6 tuổi trở lên, được thiết kế bởi ZMROBO — thương hiệu hàng đầu thế giới về Robotics giáo dục.

ĐẶC ĐIỂM NỔI BẬT:
- 320-378 chi tiết lắp ráp chính xác cao, an toàn tuyệt đối
- Lập trình KHÔNG cần máy tính qua thẻ lệnh OID (Optical Identification)
- 7 cảm biến đa dạng giúp robot tương tác với môi trường
- Smart Hub trung tâm điều khiển thông minh
- Áp dụng phương pháp PBL (Project-Based Learning)

PHÙ HỢP CHO:
- Trẻ em từ 6 tuổi mới bắt đầu làm quen với Robotics
- Phụ huynh muốn con tiếp xúc công nghệ sớm
- Trung tâm STEM, trường tiểu học (K1-K3)

THƯƠNG HIỆU:
ZMROBO (JoinMax Digital Technology Co., Ltd) - thành lập 2002, chuyên STEAM education với 300+ patents.`,
      priceDisplay: "Liên hệ tư vấn",
      isAvailable: true,
      specs: {
        pieces: "320-378 PCS",
        age: "6+ tuổi",
        level: "Nhập môn",
        controller: "Smart Hub 330",
        sensors: [
          "Cảm biến chạm",
          "Cảm biến góc nghiêng",
          "Cảm biến IR",
          "Cảm biến khoảng cách",
          "Cảm biến light",
          "Cảm biến màu sắc",
          "Cảm biến thẻ lệnh OID",
        ],
        programmingMethod: "OID Coding Cards (không cần máy tính)",
        teachingMethod: "PBL - Project-Based Learning",
      },
      features: [
        { icon: "Cpu", title: "Smart Hub thông minh", desc: "Bộ điều khiển trung tâm tích hợp cho robot" },
        { icon: "CreditCard", title: "Lập trình qua thẻ lệnh", desc: "Không cần máy tính - chỉ scan thẻ OID" },
        { icon: "Activity", title: "7 cảm biến đa dạng", desc: "Tương tác với môi trường: chạm, ánh sáng, màu, khoảng cách..." },
        { icon: "Puzzle", title: "320-378 chi tiết", desc: "Lắp ráp nhiều mô hình robot khác nhau" },
      ],
      highlights: [
        "Không cần máy tính — phù hợp trẻ mầm non, tiểu học",
        "7 cảm biến — robot có thể 'cảm nhận' môi trường",
        "Phương pháp PBL — học qua dự án sáng tạo",
        "An toàn tuyệt đối — chứng nhận quốc tế",
      ],
      mainImage: "",
      galleryImages: [],
      sourceUrl: "https://zmrobo.net/products/80",
      displayOrder: 1,
      isPublished: true,
    },
    {
      slug: "beta",
      brand: "ZMROBO",
      series: "β-Series",
      code: null,
      title: "Beta Set Core",
      subtitle: "Bộ THI ĐẤU chuyên nghiệp",
      shortDescription:
        "β-Series Core Set 133 PCS — Bộ kit thi đấu Robotics dành cho học viên đã có nền tảng từ Alpha Set. Race-style robot.",
      description: `Beta Set (β-Series Core Set) là bộ học cụ THI ĐẤU dành cho học viên đã hoàn thành Alpha Set hoặc đã có nền tảng Robotics cơ bản.

ĐẶC ĐIỂM NỔI BẬT:
- 133 chi tiết tinh gọn, tối ưu cho thi đấu
- Thiết kế Race-style robot - tốc độ và độ chính xác cao
- Phù hợp với các cuộc thi Robotics quốc gia và quốc tế
- Lắp ráp nhanh - thi đấu hiệu quả

PHÙ HỢP CHO:
- Học viên có nền tảng Robotics, hướng tới thi đấu
- Đội tuyển Robotics trường học, trung tâm
- Phụ huynh muốn con tham gia các cuộc thi RBT, RoboSim, WRO

CƠ HỘI THI ĐẤU:
- RBT2026 (RoboSim)
- WRO (World Robot Olympiad)
- Các cuộc thi nội bộ Sata Robo`,
      priceDisplay: "Liên hệ tư vấn",
      isAvailable: true,
      specs: {
        pieces: "133 PCS",
        age: "6+ tuổi",
        level: "Thi đấu",
        formFactor: "Race-style Robot",
        compatibility: "Tương thích Alpha Set",
        labelText: "β-Series Core Set",
      },
      features: [
        { icon: "Trophy", title: "Thiết kế thi đấu", desc: "Race-style robot, tốc độ và độ chính xác cao" },
        { icon: "Zap", title: "Lắp ráp nhanh", desc: "133 chi tiết tinh gọn, dễ thao tác" },
        { icon: "Target", title: "Cuộc thi quốc tế", desc: "Phù hợp WRO, RoboSim, RBT2026" },
        { icon: "Link2", title: "Tương thích Alpha", desc: "Sử dụng cùng hệ sinh thái ZMROBO" },
      ],
      highlights: [
        "Thiết kế tối ưu cho thi đấu",
        "Tham gia các cuộc thi quốc gia + quốc tế",
        "Lắp ráp nhanh, thao tác dễ",
        "Tương thích với Alpha Set",
      ],
      mainImage: "",
      galleryImages: [],
      sourceUrl: "https://zmrobo.net/products/89",
      displayOrder: 2,
      isPublished: true,
    },
    {
      slug: "intelligence-storm",
      brand: "ZMROBO",
      series: "Intelligence Storm",
      code: "JMC-NY-2108E",
      title: "Intelligence Storm",
      subtitle: "Bộ NÂNG CAO AI + Python + C",
      shortDescription:
        "JMC-NY-2108E 619 PCS — E6-RCU Smart Controller, 96 bài học/6 stages, lập trình Graphical + Python + C, AI image recognition.",
      description: `Intelligence Storm (mã JMC-NY-2108E) là bộ học cụ NÂNG CAO cao cấp nhất của ZMROBO, dành cho học sinh trung học và những ai muốn tiến sâu vào AI, Robotics và lập trình chuyên nghiệp.

ĐẶC ĐIỂM NỔI BẬT:
- 619 chi tiết lắp ráp robot nhiều hình dạng phức tạp
- E6-RCU Smart Controller (8 sensor ports + 4 motor ports)
- 96 bài học chia thành 6 stages + 32 extensions
- 3 ngôn ngữ lập trình: Graphical (kéo thả), Python, C
- AI: Image recognition, Gesture detection
- Custom Android OS với ZMROBO AI library

CHƯƠNG TRÌNH 6 STAGES:
Stage 1: Structural knowledge
Stage 2: Force transfer
Stage 3: Master controller
Stage 4: Sensors
Stage 5: Software programming
Stage 6: AI applications

PHÙ HỢP CHO:
- Học sinh THCS, THPT (lớp 6-12)
- Học viên đã hoàn thành Alpha + Beta Set
- Người yêu thích AI, lập trình Python, C
- Trường THCS/THPT, trung tâm STEM cao cấp`,
      priceDisplay: "Liên hệ tư vấn",
      isAvailable: true,
      specs: {
        pieces: "619 PCS",
        age: "6+ tuổi (lý tưởng 10+)",
        level: "Nâng cao",
        productCode: "JMC-NY-2108E",
        controller: "E6-RCU Smart Controller (8 sensor + 4 motor ports)",
        processor: "8-core processor",
        operatingSystem: "Custom Android",
        sensors: ["Ultrasonic", "PhotorElectric", "Light"],
        motors: ["Large Motor", "Medium Motor"],
        programming: ["Graphical Programming", "Python", "C"],
        aiFeatures: ["Image Recognition", "Gesture Detection", "ZMROBO AI Library"],
        curriculum: "96 lessons / 6 stages + 32 extensions",
      },
      features: [
        { icon: "Brain", title: "AI Image Recognition", desc: "Robot nhận diện hình ảnh, vật thể, khuôn mặt" },
        { icon: "Code", title: "Python + C Programming", desc: "Lập trình chuyên nghiệp với 3 ngôn ngữ" },
        { icon: "Cpu", title: "E6-RCU Controller", desc: "8-core processor, 8 sensor ports, 4 motor ports" },
        { icon: "BookOpen", title: "96 bài học có sẵn", desc: "6 stages + 32 extensions chuẩn quốc tế" },
      ],
      highlights: [
        "619 chi tiết - robot hình dạng phức tạp",
        "E6-RCU Controller next-gen - 8 cổng cảm biến",
        "3 ngôn ngữ: Graphical + Python + C",
        "AI: Image recognition + Gesture detection",
        "96 bài học có sẵn - 6 stages chuẩn quốc tế",
      ],
      mainImage: "",
      galleryImages: [],
      sourceUrl: "https://zmrobo.net/products/67",
      displayOrder: 3,
      isPublished: true,
    },
  ];

  for (const kit of zmRoboKits) {
    await db.zMRoboKit.upsert({
      where: { slug: kit.slug },
      update: kit,
      create: kit,
    });
  }
  const validKitSlugs = zmRoboKits.map((k) => k.slug);
  const removedKits = await db.zMRoboKit.deleteMany({
    where: { slug: { notIn: validKitSlugs } },
  });
  console.log(
    `✅ ${zmRoboKits.length} ZMRobo kits đã tạo · removed ${removedKits.count} kit cũ`,
  );

  // ─── SUPER_ADMIN ──────────────────────────────────────────────────────────────
  // 09/10/2026 — bỏ mật khẩu gõ cứng cho tài khoản SUPER_ADMIN do seed tạo. Mã nguồn được xuất
  // sang repo gương PUBLIC cho CI; chuỗi nằm ở đây là mật khẩu quản trị tối cao ai cũng đọc được,
  // và mỗi lần dựng DB mới (CI, workflow seed test, máy dev) nó lại tạo đúng tài khoản ấy.
  // `SEED_ADMIN_PASSWORD` có thì dùng; không có ⇒ mật khẩu NGẪU NHIÊN, KHÔNG in ra — tài khoản
  // tạo mới không đăng nhập được cho tới khi đặt lại. Không NÉM như seed UAT: `pnpm db:seed`
  // chạy cả trong CI smoke lẫn khi dựng DB máy dev. `update: {}` ⇒ tài khoản ĐÃ CÓ không đổi.
  const matKhauAdmin = process.env.SEED_ADMIN_PASSWORD || randomBytes(24).toString("base64url");
  const hashedPassword = await bcrypt.hash(matKhauAdmin, 12);
  // Email tài khoản admin do seed tạo — mặc định `admin@example.com` (không ghi email người thật
  // vào mã); đặt `SEED_ADMIN_EMAIL` để dùng địa chỉ khác.
  const emailAdmin = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const admin = await db.user.upsert({
    where: { email: emailAdmin },
    update: {},
    create: {
      email: emailAdmin,
      name: "Hồ Đắc Phúc",
      password: hashedPassword,
      role: "SUPER_ADMIN",
      centerId: "co-so-nguyen-huu-tho",
      isActive: true,
    },
  });
  console.log(`✅ Admin tạo xong: ${admin.email}`);

  // ─── RBAC động (A0-01/A0-02): OrgUnit tree + RoleDef + gán quyền cho admin ───
  // RC-A fix: không có UserOrgRole → resolveActor() ra scope rỗng → vỡ
  // addLeadChild / dropdown cơ sở / /classes. Gán SUPER_ADMIN @ HO cho admin
  // để actor là HO-level (thấy mọi center). Idempotent qua upsert.
  await seedOrgUnits(db);
  await seedRoles(db);
  const hoOrg = await db.orgUnit.findUnique({ where: { code: "HO" }, select: { id: true } });
  const superAdminRole = await db.roleDef.findUnique({
    where: { code: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (hoOrg && superAdminRole) {
    await db.userOrgRole.upsert({
      where: {
        userId_orgUnitId_roleId: {
          userId: admin.id,
          orgUnitId: hoOrg.id,
          roleId: superAdminRole.id,
        },
      },
      update: { status: "ACTIVE", effectiveTo: null },
      create: {
        userId: admin.id,
        orgUnitId: hoOrg.id,
        roleId: superAdminRole.id,
        status: "ACTIVE",
        grantedById: admin.id,
      },
    });
    console.log("✅ Gán SUPER_ADMIN @ HO cho admin (RC-A)");
  } else {
    console.warn("⚠️  Thiếu OrgUnit HO hoặc RoleDef SUPER_ADMIN — bỏ qua gán UserOrgRole");
  }


  // ─── Job Postings ─────────────────────────────────────────────────────────────
  // Removed in A5 (schema reshaped requirements/benefits TEXT → TEXT[], added
  // responsibilities/experienceLevel/workingHours/contact*). Repopulate via
  // /admin/jobs/new — the prior markdown content is incompatible with the new
  // bullet-array shape.
  // ─── Hall of Fame ─────────────────────────────────────────────────────────────
  await seedHonors(db);

  // ─── Email templates (Phase 5.13.1.FINAL) ───────────────────────────────────
  await seedEmailTemplates(db);

  // ─── CoursePackage detail content (Phase TD-1) ──────────────────────────────
  await seedCoursePackageContent(db);

  // ─── Marketing content: Promotion + Testimonial (hardcode remediation Đợt 5) ─
  await seedMarketingContent(db);
  await seedTestimonials(db);

  // ─── DepartmentDef (Track Department — phòng ban động) ──────────────────────
  await seedDepartments(db);

  // ─── Giờ làm việc mặc định toàn hệ thống (Q-C 19/08) ────────────────────────
  await seedWorkingHours(db);

  console.log("\n🎉 Seed hoàn tất!");
  console.log("─".repeat(50));
  console.log(`📧 Email:    ${emailAdmin}`);
  console.log("🔑 Password: env SEED_ADMIN_PASSWORD (không đặt ⇒ ngẫu nhiên, không in ra)");
  console.log("⚠️  Đổi mật khẩu ngay sau khi đăng nhập lần đầu!");
  console.log("─".repeat(50));
}

main()
  .catch((e) => {
    console.error("❌ Seed thất bại:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
