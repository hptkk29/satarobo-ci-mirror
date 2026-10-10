// prisma/seed-uat/01-nen.ts — NỀN: những thứ mọi thứ khác trỏ vào.
//
// Không sinh 50 dòng mù quáng ở đây: phòng học, ngày nghỉ, phương thức thanh toán,
// giáo trình… là dữ liệu CẤU HÌNH. 50 phương thức thanh toán là rác, không phải
// nghiệm thu. Mỗi loại lấy số lượng đúng với đời thật; các bảng nghiệp vụ ở những
// bước sau mới chạy đủ 50 dòng mỗi cơ sở.
import {
  db, buoc, xong, int, makeRng, ngay, pick, uid,
  type CoSo,
} from "./_common";

export async function seedNen(coSo: CoSo[]) {
  const rng = makeRng(1001);

  // ── Khoá học ───────────────────────────────────────────────────────────────
  // DB chỉ có 2 khoá và CHƯA CÓ GIÁ (price null) ⇒ mọi màn tiền sẽ ra 0.
  buoc("Khoá học + giá");
  const KHOA = [
    { slug: "laptrinhrobot", name: "Lập trình Robot", price: 4_400_000, sessions: 11, grade: "K-9" },
    { slug: "luyenthirobosim", name: "Luyện thi RoboSim", price: 3_600_000, sessions: 9, grade: "3-9" },
    { slug: "sata-1", name: "Sata 1 — Nhập môn Robotics", price: 4_400_000, sessions: 11, grade: "1-3" },
    { slug: "sata-2", name: "Sata 2 — Cơ cấu chuyển động", price: 4_800_000, sessions: 12, grade: "2-4" },
    { slug: "sata-3", name: "Sata 3 — Cảm biến & điều khiển", price: 5_200_000, sessions: 12, grade: "3-5" },
    { slug: "sata-4", name: "Sata 4 — Lập trình khối", price: 5_600_000, sessions: 12, grade: "4-6" },
    { slug: "combo-1-2", name: "Combo Sata 1 & 2", price: 8_600_000, sessions: 23, grade: "1-4" },
  ];
  const courses: { id: string; slug: string; name: string; price: number; sessions: number }[] = [];
  for (const k of KHOA) {
    const c = await db.course.upsert({
      where: { slug: k.slug },
      update: { price: k.price, totalSessions: k.sessions, isActive: true },
      create: {
        slug: k.slug, name: k.name, price: k.price, totalSessions: k.sessions,
        isActive: true, isTeachable: true,
        description: `Khoá ${k.name} — khối lớp ${k.grade}. Dữ liệu UAT.`,
      },
      select: { id: true, slug: true, name: true },
    });
    courses.push({ ...c, price: k.price, sessions: k.sessions });
  }
  xong("Khoá học", courses.length);

  // ── Phòng học ──────────────────────────────────────────────────────────────
  buoc("Phòng học");
  let nRoom = 0;
  for (const cs of coSo) {
    for (let i = 1; i <= 6; i++) {
      await db.room.upsert({
        where: { centerId_code: { centerId: cs.centerId, code: `${cs.code}-P${i}` } },
        update: { status: "ACTIVE" },
        create: {
          code: `${cs.code}-P${i}`,
          name: `Phòng ${i} — ${cs.name}`,
          centerId: cs.centerId,
          capacity: pick(rng, [10, 12, 14, 16]),
          status: "ACTIVE",
        },
      });
      nRoom++;
    }
  }
  xong("Phòng học", nRoom);

  // ── Ngày nghỉ ──────────────────────────────────────────────────────────────
  buoc("Lịch nghỉ");
  const NGHI = [
    { d: 9, n: "Quốc khánh 02/09" },
    { d: 10, n: "Nghỉ bù Quốc khánh" },
    { d: 45, n: "Bảo trì cơ sở" },
    { d: 120, n: "Tết Dương lịch" },
    { d: 160, n: "Nghỉ Tết Nguyên đán (đợt 1)" },
    { d: 161, n: "Nghỉ Tết Nguyên đán (đợt 2)" },
  ];
  let nHoliday = 0;
  for (const [i, h] of NGHI.entries()) {
    const id = uid("holiday", i);
    await db.holiday.upsert({
      where: { id },
      update: { name: h.n, date: ngay(h.d) },
      // centerId null = nghỉ TOÀN HỆ THỐNG; 2 dòng cuối gắn riêng 1 cơ sở để
      // màn Lịch nghỉ có cả hai kiểu.
      create: {
        id, name: h.n, date: ngay(h.d),
        centerId: i >= 4 ? coSo[i - 4]!.centerId : null,
      },
    });
    nHoliday++;
  }
  xong("Lịch nghỉ", nHoliday);

  // ── Phương thức thanh toán ─────────────────────────────────────────────────
  buoc("Phương thức thanh toán");
  // 30/08/2026 — `centerId` nay là cột thật: null = DÙNG CHUNG mọi cơ sở, có giá trị =
  // CHỈ cơ sở đó thấy. Hai dòng BANK_CS1/BANK_CS2 vốn đã tách theo cơ sở bằng quy ước
  // đặt mã (vì `code` là @unique toàn cục), nay gắn đúng cơ sở để bộ UAT diễn được
  // chính cái phải nghiệm thu: Sale CS1 KHÔNG nhìn thấy "Chuyển khoản — CS2".
  const PTTT = [
    { code: "CASH", name: "Tiền mặt tại quầy", type: "CASH" as const, centerId: null },
    // 31/08 — phương thức chuyển khoản mang LUÔN tài khoản nhận tiền (nguồn dựng mã QR).
    // Hai cơ sở phải là hai tài khoản KHÁC nhau, bằng không bộ UAT không diễn được đúng
    // thứ phải nghiệm thu: QR đơn CS1 ra tài khoản CS1, đơn CS2 ra tài khoản CS2.
    {
      code: "BANK_CS1",
      name: "Chuyển khoản — CS1",
      type: "BANK_TRANSFER" as const,
      centerId: "co-so-nguyen-huu-tho",
      bank: { bin: "970415", acc: "1000000001", name: "CT CP CN GD SATA ROBO" },
    },
    {
      code: "BANK_CS2",
      name: "Chuyển khoản — CS2",
      type: "BANK_TRANSFER" as const,
      centerId: "co-so-hoang-dieu",
      bank: { bin: "970436", acc: "2000000002", name: "CT CP CN GD SATA ROBO" },
    },
    {
      code: "QR_SEPAY",
      name: "Quét QR (SePay)",
      type: "BANK_TRANSFER" as const,
      centerId: null,
      bank: { bin: "970422", acc: "3000000003", name: "CT CP CN GD SATA ROBO" },
    },
    { code: "VNPAY", name: "Cổng VNPAY", type: "VNPAY" as const, centerId: null },
    { code: "MOMO", name: "Ví MoMo", type: "WALLET" as const, centerId: null },
  ];
  // Cơ sở phải tồn tại trước (FK RESTRICT). Seed nền tạo cơ sở ở bước trên cùng file
  // này; vẫn lọc phòng ca chạy lại trên DB thiếu cơ sở — thà để null (dùng chung) còn
  // hơn cả bước seed đổ vì một khoá ngoại.
  const centerIds = new Set(
    (await db.center.findMany({ select: { id: true } })).map((c) => c.id),
  );
  for (const p of PTTT) {
    const centerId = p.centerId && centerIds.has(p.centerId) ? p.centerId : null;
    const bank =
      "bank" in p && p.bank
        ? {
            bankBin: p.bank.bin,
            bankAccountNumber: p.bank.acc,
            bankAccountName: p.bank.name,
          }
        : {};
    await db.paymentMethod.upsert({
      where: { code: p.code },
      update: { name: p.name, isActive: true, centerId, ...bank },
      create: {
        code: p.code,
        name: p.name,
        type: p.type,
        isActive: true,
        centerId,
        ...bank,
      },
    });
  }
  xong("Phương thức thanh toán", PTTT.length);

  // ── Giáo trình + bài học ───────────────────────────────────────────────────
  buoc("Giáo trình + bài học");
  let nLesson = 0;
  const lessonIds: Record<string, string[]> = {};
  for (const c of courses) {
    const cur = await db.curriculum.upsert({
      where: { courseId_version: { courseId: c.id, version: 1 } },
      update: { name: `Giáo trình ${c.name} v1`, isActive: true, status: "ACTIVE" },
      create: {
        courseId: c.id, version: 1, name: `Giáo trình ${c.name} v1`,
        isActive: true, status: "ACTIVE",
        description: `Bộ bài giảng chuẩn cho ${c.name}.`,
      },
      select: { id: true },
    });
    lessonIds[c.id] = [];
    for (let o = 1; o <= c.sessions; o++) {
      const l = await db.lesson.upsert({
        where: { curriculumId_order: { curriculumId: cur.id, order: o } },
        update: { title: `Buổi ${o} — ${TEN_BAI[(o - 1) % TEN_BAI.length]}` },
        create: {
          curriculumId: cur.id, order: o,
          title: `Buổi ${o} — ${TEN_BAI[(o - 1) % TEN_BAI.length]}`,
          description: `Nội dung buổi ${o} của ${c.name}.`,
          expectedOutput: `Cuối buổi học viên ${MUC_TIEU[(o - 1) % MUC_TIEU.length]}.`,
        },
        select: { id: true },
      });
      lessonIds[c.id]!.push(l.id);
      nLesson++;
    }
  }
  xong("Bài học", { giáo_trình: courses.length, bài: nLesson });

  // ── Tiêu chí học bạ ────────────────────────────────────────────────────────
  // ⚠️ Khoá KHÔNG có tiêu chí thì giáo viên không nhập được học bạ — màn học bạ
  // sẽ trống trơn dù có đủ lớp và học viên.
  buoc("Tiêu chí học bạ");
  const TIEU_CHI = [
    "Tư duy giải quyết vấn đề", "Kỹ năng lắp ráp cơ khí", "Lập trình & gỡ lỗi",
    "Làm việc nhóm", "Thuyết trình sản phẩm", "Tính kỷ luật & an toàn",
  ];
  let nTC = 0;
  for (const c of courses) {
    for (const [i, t] of TIEU_CHI.entries()) {
      const id = uid("rcc", c.slug, i);
      await db.reportCardCriterion.upsert({
        where: { id },
        update: { name: t, order: i + 1, active: true },
        create: { id, courseId: c.id, name: t, order: i + 1, active: true },
      });
      nTC++;
    }
  }
  xong("Tiêu chí học bạ", nTC);

  // ── Quy tắc SataCoin ───────────────────────────────────────────────────────
  buoc("Quy tắc SataCoin");
  const COIN = [
    { code: "DI_HOC_DUNG_GIO", label: "Đi học đúng giờ", amount: 5 },
    { code: "HOAN_THANH_BAI", label: "Hoàn thành bài tập về nhà", amount: 10 },
    { code: "SAN_PHAM_TOT", label: "Sản phẩm buổi học xuất sắc", amount: 20 },
    { code: "GIUP_BAN", label: "Giúp đỡ bạn trong nhóm", amount: 5 },
    { code: "GIOI_THIEU_BAN", label: "Giới thiệu bạn mới", amount: 50 },
    { code: "VI_PHAM_AN_TOAN", label: "Vi phạm quy tắc an toàn", amount: -10 },
  ];
  for (const c of COIN) {
    await db.sataCoinRule.upsert({
      where: { code: c.code },
      update: { label: c.label, amount: c.amount, isActive: true },
      create: { code: c.code, label: c.label, amount: c.amount, isActive: true },
    });
  }
  xong("Quy tắc SataCoin", COIN.length);

  // ── Học cụ / sản phẩm / tồn kho ────────────────────────────────────────────
  buoc("Học cụ, sản phẩm, vật tư kho");
  const KIT = [
    { slug: "zm-robo-starter", series: "ZM-S", title: "ZM Robo Starter" },
    { slug: "zm-robo-explorer", series: "ZM-E", title: "ZM Robo Explorer" },
    { slug: "zm-robo-pro", series: "ZM-P", title: "ZM Robo Pro" },
  ];
  for (const k of KIT) {
    await db.zMRoboKit.upsert({
      where: { slug: k.slug },
      update: { title: k.title },
      create: {
        slug: k.slug, series: k.series, title: k.title,
        subtitle: `Bộ học cụ ${k.title}`,
        shortDescription: `${k.title} — bộ học cụ dùng trong lớp Sata Robo.`,
        description: `Bộ ${k.title} gồm khung cơ khí, mạch điều khiển và cảm biến cơ bản.`,
        specs: { soChiTiet: int(rng, 120, 320), tuoi: "6+" },
        features: ["Khung nhôm định hình", "Mạch điều khiển 8 cổng", "Sạc USB-C"],
        highlights: ["An toàn cho trẻ", "Lắp không cần dụng cụ"],
      },
    });
  }
  const SP = [
    { sku: "SP-KIT-S", name: "Bộ học cụ ZM Robo Starter", price: 2_400_000, cat: "KIT_ROBOT" as const },
    { sku: "SP-KIT-E", name: "Bộ học cụ ZM Robo Explorer", price: 3_200_000, cat: "KIT_ROBOT" as const },
    { sku: "SP-KIT-P", name: "Bộ học cụ ZM Robo Pro", price: 4_800_000, cat: "KIT_ROBOT" as const },
    { sku: "SP-AO-DP", name: "Đồng phục Sata Robo", price: 250_000, cat: "ACCESSORY" as const },
    { sku: "SP-PIN-18650", name: "Pin sạc 18650 (cặp)", price: 120_000, cat: "CONSUMABLE" as const },
    { sku: "SP-CAM-BIEN", name: "Cảm biến siêu âm rời", price: 180_000, cat: "SENSOR" as const },
  ];
  for (const p of SP) {
    await db.product.upsert({
      where: { sku: p.sku },
      update: { name: p.name, salePrice: p.price, status: "ACTIVE" },
      create: {
        sku: p.sku, name: p.name, category: p.cat, salePrice: p.price,
        status: "ACTIVE", stockOnHand: int(rng, 4, 40), minThreshold: 5,
      },
    });
  }
  const VT = [
    { n: "Khung nhôm 20x20", c: "MECHANICAL" as const, u: "thanh" },
    { n: "Bánh xe omni", c: "MECHANICAL" as const, u: "cái" },
    { n: "Động cơ giảm tốc", c: "MOTOR" as const, u: "cái" },
    { n: "Mạch điều khiển 8 cổng", c: "MAINBOARD" as const, u: "cái" },
    { n: "Cảm biến hồng ngoại", c: "SENSOR" as const, u: "cái" },
    { n: "Cảm biến siêu âm", c: "SENSOR" as const, u: "cái" },
    { n: "Dây bus 4 chân", c: "WIRE" as const, u: "sợi" },
    { n: "Ốc M3 (hộp 100)", c: "MECHANICAL" as const, u: "hộp" },
    { n: "Pin 18650", c: "BATTERY" as const, u: "viên" },
    { n: "Sạc USB-C", c: "CONSUMABLE" as const, u: "cái" },
    { n: "Hộp đựng linh kiện", c: "TOOL" as const, u: "cái" },
    { n: "Tua vít 2 đầu", c: "TOOL" as const, u: "cái" },
  ];
  for (const [i, v] of VT.entries()) {
    const code = `VT-${String(i + 1).padStart(3, "0")}`;
    await db.inventoryItem.upsert({
      where: { itemCode: code },
      update: { name: v.n, category: v.c, unit: v.u },
      create: {
        itemCode: code, name: v.n, category: v.c, unit: v.u,
        pricePerUnit: int(rng, 15, 400) * 1000,
        defaultMinThreshold: int(rng, 5, 20),
        isActive: true,
      },
    });
  }
  xong("Kho", { học_cụ: KIT.length, sản_phẩm: SP.length, vật_tư: VT.length });

  // ── Pháp nhân ──────────────────────────────────────────────────────────────
  buoc("Pháp nhân");
  // `isPrimary` là UNIQUE (chỉ một pháp nhân chính) — nếu seed nền đã dựng rồi thì
  // đừng giành chỗ, chỉ bổ sung khi chưa có ai.
  const daCoChinh = await db.legalEntity.findFirst({ where: { isPrimary: true }, select: { id: true } });
  await db.legalEntity.upsert({
    where: { taxCode: "0402179999" },
    update: { legalName: "Công ty Cổ phần Công nghệ Giáo dục Sata Robo" },
    create: {
      taxCode: "0402179999",
      legalName: "Công ty Cổ phần Công nghệ Giáo dục Sata Robo",
      address: "211 Nguyễn Hữu Thọ, Đà Nẵng",
      isPrimary: !daCoChinh,
    },
  });
  xong("Pháp nhân", { đã_có_chính: daCoChinh ? 1 : 0 });

  return { courses, lessonIds };
}

const TEN_BAI = [
  "Làm quen bộ học cụ", "Khung xe và bánh dẫn động", "Động cơ và tốc độ",
  "Cảm biến chạm", "Cảm biến khoảng cách", "Rẽ hướng theo vạch",
  "Vòng lặp và điều kiện", "Tay gắp cơ khí", "Nhiệm vụ tổng hợp",
  "Thi đấu nhóm", "Tổng kết và trình bày", "Dự án mở rộng",
];

const MUC_TIEU = [
  "gọi đúng tên và công dụng từng chi tiết",
  "lắp được khung xe chạy thẳng ổn định",
  "điều chỉnh được tốc độ hai bánh",
  "lập trình phản ứng khi chạm vật cản",
  "đo và dùng khoảng cách để dừng xe",
  "cho xe bám vạch qua khúc cua",
  "dùng vòng lặp thay cho lệnh lặp tay",
  "lắp và điều khiển tay gắp",
  "ghép nhiều kỹ năng vào một nhiệm vụ",
  "phối hợp nhóm dưới áp lực thời gian",
  "trình bày được sản phẩm trước lớp",
  "tự đề xuất và làm một cải tiến nhỏ",
];
