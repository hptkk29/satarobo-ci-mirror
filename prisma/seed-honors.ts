import { PrismaClient, HonorCategory, Department } from "@prisma/client";

export async function seedHonors(db: PrismaClient) {
  console.log("👥 Seeding Employees + Hall of Fame data...");

  // ─── SitePageContent (settings) ──────────────────────────────────────────────
  const settingsData = [
    { pageKey: "honors", contentKey: "hero-title", contentValue: "Vinh danh nhân sự xuất sắc" },
    { pageKey: "honors", contentKey: "hero-subtitle", contentValue: "Tri ân từ Ban Giám đốc Sata Robo" },
    {
      pageKey: "honors",
      contentKey: "ceo-quote",
      contentValue:
        "Mỗi thành công của Sata Robo đều mang dấu ấn của từng con người. Trang này là nơi chúng tôi gửi lời tri ân chân thành nhất tới những đồng đội đã cùng kiến tạo nên Sata Robo hôm nay.",
    },
    { pageKey: "honors", contentKey: "ceo-name", contentValue: "Hồ Đắc Phúc" },
    { pageKey: "honors", contentKey: "ceo-title", contentValue: "Tổng Giám đốc — Sata Robo" },
    { pageKey: "honors", contentKey: "ceo-avatar-url", contentValue: "" },
  ];

  for (const s of settingsData) {
    await db.sitePageContent.upsert({
      where: { pageKey_contentKey: { pageKey: s.pageKey, contentKey: s.contentKey } },
      update: { contentValue: s.contentValue },
      create: s,
    });
  }
  console.log(`   ✓ ${settingsData.length} page settings`);

  // ─── Employees (5 nhân sự + CEO) ─────────────────────────────────────────────
  const employeesData = [
    {
      employeeCode: "SR.NV.001",
      fullName: "Hồ Đắc Phúc",
      jobTitle: "Tổng Giám đốc",
      department: Department.BAN_GIAM_DOC,
      bio: "Founder & CEO Sata Robo. Đam mê công nghệ giáo dục và tin rằng Robotics có thể thay đổi cách trẻ em Việt Nam tiếp cận STEM.",
      isActive: true,
      isPublic: true,
      isCEO: true,
      displayOrder: 0,
    },
    {
      employeeCode: "SR.NV.E001",
      fullName: "Lê Minh Tâm",
      jobTitle: "Trưởng phòng Đào tạo",
      department: Department.DAO_TAO,
      joinedAt: new Date("2021-03-01"),
      isActive: true,
      isPublic: true,
      displayOrder: 1,
    },
    {
      employeeCode: "SR.NV.E002",
      fullName: "Nguyễn Thị Mai",
      jobTitle: "Trưởng phòng Marketing",
      department: Department.MARKETING,
      joinedAt: new Date("2023-09-01"),
      isActive: true,
      isPublic: true,
      displayOrder: 2,
    },
    {
      employeeCode: "SR.NV.E003",
      fullName: "Trần Văn Hoà",
      jobTitle: "Senior Robotics Coach",
      department: Department.DAO_TAO,
      joinedAt: new Date("2022-04-01"),
      isActive: true,
      isPublic: true,
      displayOrder: 3,
    },
    {
      employeeCode: "SR.NV.E004",
      fullName: "Phạm Quốc Anh",
      jobTitle: "Lập trình viên cao cấp",
      department: Department.IT,
      joinedAt: new Date("2024-01-01"),
      isActive: true,
      isPublic: true,
      displayOrder: 4,
    },
    {
      employeeCode: "SR.NV.E005",
      fullName: "Vũ Thị Lan",
      jobTitle: "Chuyên viên Tuyển sinh",
      department: Department.KINH_DOANH,
      joinedAt: new Date("2024-04-01"),
      isActive: true,
      isPublic: true,
      displayOrder: 5,
    },
  ];

  // Ensure exactly 1 CEO: clear all isCEO flag first
  await db.employee.updateMany({ where: { isCEO: true }, data: { isCEO: false } });

  const employees: Record<string, { id: string }> = {};
  for (const empData of employeesData) {
    const emp = await db.employee.upsert({
      where: { employeeCode: empData.employeeCode },
      update: empData,
      create: empData,
    });
    employees[empData.fullName] = emp;
  }
  console.log(`   ✓ ${employeesData.length} employees (1 CEO + 5 honored)`);

  // ─── Honors — link qua employeeId, dùng snapshot ─────────────────────────────
  const honorsData = [
    {
      slug: "le-minh-tam-grand-champion-2026-q1",
      employeeId: employees["Lê Minh Tâm"].id,
      jobTitleAtTime: "Trưởng phòng Đào tạo",
      yearsAtTime: 5,
      category: HonorCategory.GRAND_CHAMPION,
      awardName: "Grand Champion 2026 Q1",
      awardedAt: new Date("2026-04-01"),
      awardQuarter: "Q1/2026",
      shortBio:
        "Dẫn dắt 12 giáo viên xây dựng giáo trình Robosim Master và đưa Sata Robo trở thành đối tác chiến lược của 8 trường K-12 tại Đà Nẵng.",
      story: `Năm 2021, khi Sata Robo mới có 3 giáo viên và 1 cơ sở duy nhất, Lê Minh Tâm là người đầu tiên gia nhập đội ngũ đào tạo với niềm tin "robotics có thể thay đổi cách trẻ em Việt Nam học STEM".

5 năm sau, dưới sự dẫn dắt của Tâm:
- Đội ngũ đào tạo mở rộng từ 3 lên 12 giáo viên chính thức
- Giáo trình Robosim Master được xây dựng từ con số 0, đến nay được 8 trường K-12 sử dụng
- 24 học viên đạt giải Cuộc thi RoboSim 2026 — kết quả cao nhất từ trước đến nay
- Mở rộng chương trình ra 4 cơ sở tại Đà Nẵng

"Tâm không chỉ là một trưởng phòng giỏi — anh là người thầy của thầy. Mọi giáo viên Sata Robo đều có một phần của Tâm trong cách họ giảng dạy hôm nay." — Hồ Đắc Phúc, CEO`,
      pullQuote:
        "Robotics không phải là việc dạy trẻ điều khiển máy móc. Đó là dạy trẻ cách tư duy có hệ thống — và điều đó thay đổi cả cuộc đời các em.",
      achievements: `- Xây dựng giáo trình Robosim Master từ con số 0
- Mở rộng đội ngũ giáo viên từ 3 lên 12 người
- Đào tạo 24 học viên đạt giải RoboSim 2026
- Đối tác chiến lược với 8 trường K-12 tại Đà Nẵng
- 5 năm liên tục là Top Performer của Sata Robo`,
      isFeatured: true,
      displayOrder: 1,
    },
    {
      slug: "nguyen-thi-mai-impact-2025-q4",
      employeeId: employees["Nguyễn Thị Mai"].id,
      jobTitleAtTime: "Trưởng phòng Marketing",
      yearsAtTime: 3,
      category: HonorCategory.IMPACT,
      awardName: "Impact Award 2025 Q4",
      awardedAt: new Date("2026-01-15"),
      awardQuarter: "Q4/2025",
      shortBio:
        "Xây dựng chiến dịch marketing đưa nhận diện thương hiệu Sata Robo lên top 3 trong lĩnh vực Robotics giáo dục tại Đà Nẵng.",
      story: `Tháng 9/2023, Mai gia nhập Sata Robo khi công ty chỉ có 200 followers trên Facebook và gần như không có nhận diện ngoài Đà Nẵng.

Sau 2 năm, chiến lược content "Mẹ Dặn Con Mỗi Ngày" của Mai đã giúp:
- Fanpage chính Sata Robo: 200 → 12,000+ followers
- 38 kênh vệ tinh phụ huynh + học viên với tổng 50,000+ reach mỗi tuần
- Top 3 nhận diện thương hiệu Robotics giáo dục tại Đà Nẵng (khảo sát PA 2025)
- Đưa CPL (chi phí mỗi lead) từ 250k giảm xuống còn 85k

Marketing tại Sata Robo dưới thời Mai không chỉ là "chạy ads" — đó là kể câu chuyện về trẻ em Việt Nam và những gì các em có thể làm được với robotics.`,
      pullQuote:
        "Một mẹ nói với tôi: 'Con tôi đăng ký Sata Robo vì xem video bé Bin đam mê quá.' Đó là khoảnh khắc tôi biết mình đã làm đúng.",
      achievements: `- Tăng followers fanpage chính từ 200 lên 12,000+
- Xây dựng 38 kênh vệ tinh phụ huynh + học viên với 50K+ reach/tuần
- Giảm CPL từ 250k xuống 85k
- Top 3 nhận diện thương hiệu Robotics tại Đà Nẵng`,
      isFeatured: false,
      displayOrder: 2,
    },
    {
      slug: "tran-van-hoa-growth-2025-q3",
      employeeId: employees["Trần Văn Hoà"].id,
      jobTitleAtTime: "Senior Robotics Coach",
      yearsAtTime: 4,
      category: HonorCategory.GROWTH,
      awardName: "Growth Award 2025 Q3",
      awardedAt: new Date("2025-10-15"),
      awardQuarter: "Q3/2025",
      shortBio:
        "Từ thực tập sinh năm 2022 trở thành Senior Coach dẫn dắt đội tuyển Sata Robo giành 7 giải tại Cuộc thi WRC khu vực Đông Nam Á 2025.",
      story: `Hoà gia nhập Sata Robo năm 2022 với tư cách thực tập sinh — chưa từng cầm một bộ lego robot nào trước đó.

3 năm sau, hành trình của Hoà là minh chứng cho văn hoá "ai cũng có thể phát triển" tại Sata Robo:
- 2022: Thực tập sinh, học từ con số 0
- 2023: Trợ giảng, được khách hàng yêu mến nhất khoá đó
- 2024: Giảng viên chính thức
- 2025: Senior Robotics Coach, dẫn đội tuyển Sata Robo

Tại WRC khu vực Đông Nam Á 2025 — Hoà cùng 4 học viên Sata Robo đem về 7 giải thưởng, trong đó có 1 huy chương vàng cá nhân.

"Hoà chứng minh rằng tại Sata Robo, không ai bị bỏ lại phía sau. Chỉ cần bạn có tinh thần học hỏi, chúng tôi sẽ đi cùng bạn cả chặng đường." — Lê Minh Tâm, Trưởng phòng Đào tạo`,
      pullQuote:
        "Ngày đầu gia nhập, tôi không biết robot là gì. Ngày hôm nay, tôi dạy trẻ con cách chế tạo robot. Sata Robo không thay đổi tôi — Sata Robo tin vào tôi.",
      achievements: `- Thực tập sinh → Senior Coach trong 3 năm
- Dẫn đội WRC khu vực Đông Nam Á 2025 — 7 giải thưởng
- 1 huy chương vàng cá nhân tại WRC 2025
- Được học viên đánh giá 4.9/5 sao liên tục 4 quý`,
      isFeatured: false,
      displayOrder: 3,
    },
    {
      slug: "pham-quoc-anh-spark-2025-q2",
      employeeId: employees["Phạm Quốc Anh"].id,
      jobTitleAtTime: "Lập trình viên cao cấp",
      yearsAtTime: 2,
      category: HonorCategory.SPARK,
      awardName: "Spark Award 2025 Q2",
      awardedAt: new Date("2025-07-15"),
      awardQuarter: "Q2/2025",
      shortBio:
        "Tự phát triển platform RoboSim mô phỏng cuộc thi 3D — tài sản công nghệ độc quyền giúp Sata Robo dẫn đầu thị trường luyện thi.",
      story: `Đầu năm 2024, Sata Robo có vấn đề: học viên muốn luyện thi RoboSim nhưng không có phần mềm mô phỏng nào miễn phí.

Quốc Anh — khi đó vừa nhận việc 6 tháng — đề xuất tự phát triển platform mô phỏng riêng.

3 tháng sau, RoboSim Master Platform ra đời:
- Mô phỏng đầy đủ 3 sa bàn thi chính thức
- Real-time simulation, có thể chạy trên trình duyệt
- 4,000+ học viên đã sử dụng để luyện thi
- Tiết kiệm hàng tỷ đồng chi phí phần cứng cho phụ huynh

"Quốc Anh không hỏi 'ai sẽ làm việc này?' — Quốc Anh hỏi 'tôi có thể bắt đầu khi nào?'. Đó là tinh thần SPARK." — Hồ Đắc Phúc, CEO`,
      pullQuote:
        "Tôi không build platform để được công nhận. Tôi build vì thấy 200 đứa trẻ không có phần mềm luyện thi. Đơn giản vậy thôi.",
      achievements: `- Tự phát triển RoboSim Master Platform từ con số 0 trong 3 tháng
- 4,000+ học viên sử dụng platform luyện thi
- Tài sản công nghệ độc quyền của Sata Robo
- Sản phẩm được TW Đoàn đánh giá cao`,
      isFeatured: false,
      displayOrder: 4,
    },
    {
      slug: "vu-thi-lan-spark-2025-q1",
      employeeId: employees["Vũ Thị Lan"].id,
      jobTitleAtTime: "Chuyên viên Tuyển sinh",
      yearsAtTime: 1,
      category: HonorCategory.SPARK,
      awardName: "Spark Award 2025 Q1",
      awardedAt: new Date("2025-04-15"),
      awardQuarter: "Q1/2025",
      shortBio:
        "Đề xuất + triển khai chương trình 'Buổi học thử 1-1 miễn phí' giúp tỷ lệ chuyển đổi lead tăng từ 12% lên 31% trong 3 tháng.",
      story: `Lan gia nhập Sata Robo tháng 4/2024 với vai trò Chuyên viên Tuyển sinh. Chỉ sau 6 tháng, Lan nhận ra một insight quan trọng:

"Phụ huynh không cam kết đăng ký khoá học vì họ chưa thực sự thấy con mình làm được."

Lan đề xuất chương trình "Buổi học thử 1-1 miễn phí" — phụ huynh đưa con đến cơ sở, học 1 buổi thật 1 kèm 1, sau đó quyết định đăng ký.

Kết quả sau 3 tháng:
- Tỷ lệ chuyển đổi từ lead → enrollment: 12% → 31%
- 180+ phụ huynh đăng ký sau buổi thử
- Mô hình được áp dụng tại cả 2 cơ sở

Đây là minh chứng cho tinh thần SPARK — không sợ thử nghiệm cái mới, không sợ thất bại, và luôn lắng nghe khách hàng.`,
      pullQuote:
        "Phụ huynh không nói 'không' với khoá học. Phụ huynh nói 'không' khi họ chưa thấy đủ. Việc của tôi là cho họ thấy.",
      achievements: `- Tỷ lệ chuyển đổi lead → enrollment: 12% → 31%
- 180+ enrollment mới trong 3 tháng
- Mô hình "Học thử 1-1 miễn phí" áp dụng tại cả 2 cơ sở
- Spark Award Q1/2025`,
      isFeatured: false,
      displayOrder: 5,
    },
  ];

  for (const honor of honorsData) {
    await db.honor.upsert({
      where: { slug: honor.slug },
      update: honor,
      create: honor,
    });
  }
  console.log(`   ✓ ${honorsData.length} honors linked to employees`);

  // ─── TimelineItem (giữ nguyên từ Phase 4.4.1) ───────────────────────────────
  const timelineData = [
    {
      occurredAt: new Date("2020-06-15"),
      title: "Thành lập Sata Robo",
      description:
        "Hồ Đắc Phúc và 2 đồng sự khởi nghiệp Công ty Cổ phần Công nghệ Giáo dục Sata Robo tại Đà Nẵng. Sứ mệnh: đưa Robotics & STEM giáo dục đến gần hơn với trẻ em Việt Nam.",
      displayOrder: 1,
    },
    {
      occurredAt: new Date("2021-09-10"),
      title: "Mở cơ sở thứ 2 — Sơn Trà",
      description:
        "Sau 1 năm vận hành thành công cơ sở chính tại Hải Châu, Sata Robo mở rộng cơ sở thứ 2 tại Sơn Trà — đánh dấu bước phát triển từ startup thành chuỗi giáo dục đa cơ sở.",
      displayOrder: 2,
    },
    {
      occurredAt: new Date("2023-07-20"),
      title: "Học viên đạt giải WRC khu vực ASEAN",
      description:
        "Đội tuyển Sata Robo gồm 3 học viên đầu tiên đại diện Việt Nam tham gia Cuộc thi World Robot Olympiad (WRO) khu vực Đông Nam Á. Kết quả: 2 huy chương đồng — minh chứng cho chất lượng đào tạo.",
      displayOrder: 3,
    },
    {
      occurredAt: new Date("2024-03-05"),
      title: "Ra mắt RoboSim Master Platform",
      description:
        "Sata Robo công bố platform mô phỏng cuộc thi RoboSim đầu tiên tại Việt Nam — tài sản công nghệ độc quyền giúp 4,000+ học viên luyện thi mà không cần phần cứng đắt tiền.",
      displayOrder: 4,
    },
    {
      occurredAt: new Date("2025-08-15"),
      title: "Mở rộng 4 cơ sở tại Đà Nẵng",
      description:
        "Sata Robo khai trương trụ sở chính tại 258 Lê Thanh Nghị và mở thêm 3 cơ sở tại 60 Lê Lợi, 269 Điện Biên Phủ, 232 Nguyễn Phước Lan — phủ khắp Hải Châu, Thanh Khê và Cẩm Lệ, Đà Nẵng.",
      displayOrder: 5,
    },
    {
      occurredAt: new Date("2026-04-01"),
      title: "RoboSim 2026 — 24 giải thưởng",
      description:
        "Học viên Sata Robo đem về 24 giải thưởng tại Cuộc thi RoboSim 2026 toàn quốc — kết quả cao nhất từ trước đến nay, trong đó có 5 huy chương vàng và 8 huy chương bạc.",
      displayOrder: 6,
    },
  ];

  for (const item of timelineData) {
    const existing = await db.timelineItem.findFirst({
      where: { occurredAt: item.occurredAt, title: item.title },
    });
    if (!existing) {
      await db.timelineItem.create({ data: item });
    } else {
      await db.timelineItem.update({ where: { id: existing.id }, data: item });
    }
  }
  console.log(`   ✓ ${timelineData.length} timeline items (2020-2026)`);

  console.log("✅ Hall of Fame seed complete");
}
