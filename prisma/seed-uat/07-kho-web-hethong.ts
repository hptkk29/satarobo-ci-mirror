// prisma/seed-uat/07-kho-web-hethong.ts — kho vật tư, lớp trải nghiệm, chuyển lớp,
// đề thi/ngân hàng câu hỏi, khảo sát, nội dung website, nhật ký hệ thống.
//
// Màn được nuôi: /inventory/* · /trial-classes · /chuyen-lop · /exams · /questions ·
// /khao-sat · /tin-tuc · /jobs · /email-logs · /tich-hop · /bao-cao/trial
//
// Đây là nhóm "vòng ngoài": ít người dùng hằng ngày nhưng vẫn phải có dữ liệu,
// nếu không mở màn ra là trắng trơn và người nghiệm thu tưởng chức năng hỏng.
import {
  db, buoc, xong, chance, int, makeRng, ngay, pick, taoThieu, tenNguoi, uid, MOI_CO_SO,
  type CoId, type CoSo, type Uat,
} from "./_common";
import type { Prisma } from "@prisma/client";

export async function seedKhoWebHeThong(coSo: CoSo[], uat: Uat) {
  const rng = makeRng(7007);

  // ── Kho: nhập / xuất / kiểm kê ─────────────────────────────────────────────
  buoc("Kho vật tư");
  const vatTu = await db.inventoryItem.findMany({
    where: { itemCode: { startsWith: "VT-" } },
    select: { id: true, name: true, pricePerUnit: true },
  });
  const nhapXuat: CoId<Prisma.StockMovementCreateManyInput>[] = [];
  let mi = 0;
  for (const cs of coSo) {
    for (const vt of vatTu) {
      // Mỗi vật tư ở mỗi cơ sở: 1 lần nhập + 1–3 lần xuất dùng cho lớp.
      mi += 1;
      const soNhap = int(rng, 30, 200);
      nhapXuat.push({
        id: uid("kho", cs.code, mi, "in"),
        itemId: vt.id,
        centerId: cs.centerId,
        type: "RECEIPT",
        quantity: soNhap,
        unitPrice: vt.pricePerUnit,
        totalCost: (vt.pricePerUnit ?? 0) * soNhap,
        performedById: uat.giaovu.employeeId,
        performedAt: ngay(-int(rng, 30, 120)),
        referenceNote: "Nhập đầu kỳ",
      });
      for (let k = 0; k < int(rng, 1, 3); k++) {
        nhapXuat.push({
          id: uid("kho", cs.code, mi, "out", k),
          itemId: vt.id,
          centerId: cs.centerId,
          type: chance(rng, 0.85) ? "ISSUE" : "ADJUSTMENT_DECREASE",
          quantity: int(rng, 1, 12),
          performedById: uat.giaovu.employeeId,
          performedAt: ngay(-int(rng, 1, 30)),
          referenceNote: pick(rng, ["Cấp cho lớp", "Thay linh kiện hỏng", "Kiểm kê thiếu"]),
        });
      }
    }
  }
  const nKho = await taoThieu(
    nhapXuat,
    (ids) => db.stockMovement.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.stockMovement.createMany({ data, skipDuplicates: true }),
  );

  const kiemKe: CoId<Prisma.InventoryAuditCreateManyInput>[] = [];
  for (const cs of coSo) {
    for (let i = 1; i <= MOI_CO_SO; i++) {
      kiemKe.push({
        id: uid("kiemke", cs.code, i),
        auditCode: `KK-${cs.code}-${String(i).padStart(3, "0")}`,
        centerId: cs.centerId,
        // Ca biên: phiên kiểm kê CÒN DỞ → màn kiểm kê có việc đang làm.
        status: i <= MOI_CO_SO - 6 ? "COMPLETED" : "DRAFT",
        totalItems: vatTu.length,
        totalAdjusted: int(rng, 0, 5),
        totalIncreases: int(rng, 0, 3),
        totalDecreases: int(rng, 0, 3),
        performedById: uat.giaovu.employeeId,
        performedAt: i <= MOI_CO_SO - 6 ? ngay(-int(rng, 5, 90)) : null,
        notes: i <= MOI_CO_SO - 6 ? "Kiểm kê định kỳ." : "Đang kiểm, chưa chốt.",
      });
    }
  }
  const nKk = await taoThieu(
    kiemKe,
    (ids) => db.inventoryAudit.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.inventoryAudit.createMany({ data, skipDuplicates: true }),
  );
  xong("Kho", { nhập_xuất: nKho, phiên_kiểm_kê: nKk });

  // ── Lớp trải nghiệm ────────────────────────────────────────────────────────
  buoc("Lớp trải nghiệm + học viên thử");
  const lopThu: CoId<Prisma.TrialClassV2CreateManyInput>[] = [];
  /** id lớp → ngày khai giảng (lệch so với mốc), để sinh buổi bên dưới. */
  const lechTheoLop = new Map<string, number>();
  for (const cs of coSo) {
    // 50 lớp trải nghiệm mỗi cơ sở — đủ cho màn Lớp trải nghiệm và báo cáo học thử.
    for (let i = 1; i <= MOI_CO_SO; i++) {
      const lech = i <= Math.round(MOI_CO_SO * 0.6) ? -int(rng, 1, 45) : int(rng, 2, 25);
      lechTheoLop.set(uid("lopthu", cs.code, i), lech);
      lopThu.push({
        id: uid("lopthu", cs.code, i),
        code: `TRIAL-${cs.code}-${String(i).padStart(3, "0")}`,
        name: `Lớp trải nghiệm ${i} — ${cs.name}`,
        type: "TRIAL",
        centerId: cs.centerId,
        startDate: ngay(lech),
        startTime: pick(rng, ["08:30", "14:00", "17:30"]),
        endTime: pick(rng, ["10:00", "15:30", "19:00"]),
        capacity: int(rng, 8, 14),
        sessionCount: 1,
        teacherId: cs.key === "CS1" ? uat.giaovien.id : null,
        status: lech < 0 ? "COMPLETED" : "OPEN",
      });
    }
  }
  const nLt = await taoThieu(
    lopThu,
    (ids) => db.trialClassV2.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.trialClassV2.createMany({ data, skipDuplicates: true }),
  );

  // BUỔI của lớp trải nghiệm.
  //
  // Thiếu bảng này thì màn "Học viên Trial" của giáo viên LUÔN RỖNG, dù lớp và ghi danh
  // đã có: đường đọc (getTeacherTrialTable) tìm `TrialClassSession` theo teacherId rồi
  // mới lấy `TrialEnrollment` có `scheduledSessionId` trỏ vào đó. Bộ seed trước 03/09
  // không sinh buổi nào và cũng không set `scheduledSessionId`, nên QA vòng 1 không
  // nghiệm thu được vé BUG-036 — trang chỉ ra "Chưa có suất Trial nào".
  //
  // `sessionCount: 1` nên mỗi lớp đúng MỘT buổi, rơi vào ngày khai giảng của lớp.
  const buoiThu: CoId<Prisma.TrialClassSessionCreateManyInput>[] = [];
  for (const lop of lopThu) {
    const lech = lechTheoLop.get(String(lop.id)) ?? 0;
    buoiThu.push({
      id: uid("buoithu", String(lop.id).replace("uat-lopthu-", "")),
      trialClassId: String(lop.id),
      seq: 1,
      date: ngay(lech),
      startTime: String(lop.startTime),
      endTime: String(lop.endTime),
      // Giữ cùng giáo viên với lớp: đường đọc chấp nhận CẢ HAI (buổi hoặc lớp), khai ở
      // đây cho khớp thực tế là người dạy buổi trải nghiệm chính là người phụ trách lớp.
      teacherId: lop.teacherId ?? null,
      status: lech < 0 ? "COMPLETED" : "SCHEDULED",
    });
  }
  const nBt = await taoThieu(
    buoiThu,
    (ids) => db.trialClassSession.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.trialClassSession.createMany({ data, skipDuplicates: true }),
  );

  // Ghi danh học thử: lấy con của lead đang ở nhánh học thử của phễu.
  const conLead = await db.leadChild.findMany({
    // Nhánh học thử của phễu. DANG_HOC_THU (TRIAL_IN_PROGRESS cũ) không có ở đây vì
    // 02-crm.ts không sinh bậc đó — thêm vào chỉ tốn một điều kiện không bao giờ khớp.
    where: { id: { startsWith: "uat-leadchild-" }, lead: { status: { in: ["DA_HEN_HOC_THU", "DA_HOC_THU", "CHO_QUYET_DINH", "DA_DANG_KY"] } } },
    select: { id: true, lead: { select: { centerId: true } } },
    take: 120,
  });
  const ghiDanhThu: CoId<Prisma.TrialEnrollmentCreateManyInput>[] = [];
  for (const [i, c] of conLead.entries()) {
    const lop = lopThu.find((l) => l.centerId === c.lead.centerId);
    if (!lop) continue;
    const buoi = buoiThu.find((b) => b.trialClassId === String(lop.id));
    if (!buoi) continue;
    // HAI DẠNG GHI DANH — seed phải sinh cả hai, và dạng MẶC ĐỊNH phải chiếm đa số.
    //
    // ⚠️ BẢN SEED 03/09 GÁN CỨNG `scheduledSessionId` cho MỌI ghi danh — để màn Trial
    // của site GV thôi rỗng khi nghiệm thu. Đó là chữa TRIỆU CHỨNG: từ 28/08 (gỡ
    // auto-gán buổi) MỌI ghi danh tạo qua giao diện admin đều mang **null** — và chính
    // `in: [...]` không khớp null mới là gốc làm bảng rỗng (vá ở `8b3fdad3`).
    //
    // Seed gán cứng thì dữ liệu UAT KHÔNG CÒN GIỐNG PROD, và đúng cái lỗi vừa vá sẽ
    // vô hình ở lượt nghiệm thu sau. Nay: ~1/5 ghim một buổi (đường dời lịch),
    // còn lại null = học toàn bộ buổi — đúng tỉ lệ thực tế.
    const ghimBuoi = chance(rng, 0.2);
    ghiDanhThu.push({
      id: uid("gdthu", i),
      trialClassId: String(lop.id),
      scheduledSessionId: ghimBuoi ? String(buoi.id) : null,
      leadChildId: c.id,
      status: chance(rng, 0.6) ? "COMPLETED" : chance(rng, 0.8) ? "ACTIVE" : "WITHDRAWN",
      summaryNote: pick(rng, ["Con hào hứng, phụ huynh muốn đăng ký.", "Con còn rụt rè, cần thêm buổi.", "Phụ huynh cân nhắc thêm."]),
      addedById: uat.giaovu.id,
    });
  }
  const nGdt = await taoThieu(
    ghiDanhThu,
    (ids) => db.trialEnrollment.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.trialEnrollment.createMany({ data, skipDuplicates: true }),
  );
  xong("Học thử", { lớp: nLt, buổi: nBt, ghi_danh: nGdt });

  // ── Yêu cầu chuyển lớp / cơ sở ─────────────────────────────────────────────
  buoc("Yêu cầu chuyển lớp");
  const gds = await db.enrollment.findMany({
    where: { id: { startsWith: "uat-gd-" }, status: { in: ["STUDYING", "ACTIVE"] } },
    select: { studentId: true, classId: true, centerId: true, courseId: true },
    take: 60,
  });
  const lopDich = await db.class.findMany({
    where: { id: { startsWith: "uat-lop-" }, status: { in: ["ACTIVE", "RECRUITING"] } },
    select: { id: true, centerId: true, courseId: true },
  });
  const ycChuyen: CoId<Prisma.StudentTransferRequestCreateManyInput>[] = [];
  for (const [i, g] of gds.slice(0, 40).entries()) {
    const dich = lopDich.find((l) => l.courseId === g.courseId && l.id !== g.classId && l.centerId === g.centerId);
    // ~40% CÒN CHỜ DUYỆT, và một phần KHÔNG có lớp đích (danh sách chờ).
    const st: Prisma.StudentTransferRequestCreateManyInput["status"] =
      chance(rng, 0.4) ? "PENDING" : chance(rng, 0.6) ? "APPROVED" : chance(rng, 0.5) ? "WAITLISTED" : "REJECTED";
    ycChuyen.push({
      id: uid("ycchuyen", i),
      studentId: g.studentId,
      fromClassId: g.classId,
      fromCenterId: g.centerId,
      toClassId: st === "WAITLISTED" ? null : (dich?.id ?? null),
      toCenterId: g.centerId,
      status: st,
      reason: pick(rng, ["Trùng lịch học thêm", "Gia đình chuyển nhà", "Muốn học cùng bạn", "Đổi ca cho hợp giờ làm của bố mẹ"]),
      requestedById: uat.giaovu.id,
      decidedById: st === "PENDING" || st === "WAITLISTED" ? null : uat.giamdoc.id,
      decidedAt: st === "PENDING" || st === "WAITLISTED" ? null : ngay(-int(rng, 1, 20)),
      createdAt: ngay(-int(rng, 2, 40)),
    });
  }
  const nYcc = await taoThieu(
    ycChuyen,
    (ids) => db.studentTransferRequest.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.studentTransferRequest.createMany({ data, skipDuplicates: true }),
  );
  xong("Yêu cầu chuyển lớp", nYcc);

  // ── Ngân hàng câu hỏi + đề thi ─────────────────────────────────────────────
  buoc("Câu hỏi + đề thi");
  const bai = await db.lesson.findMany({ select: { id: true, curriculumId: true }, take: 40 });
  const cauHoi: CoId<Prisma.QuestionCreateManyInput>[] = [];
  for (let i = 0; i < 200; i++) {
    const l = bai[i % Math.max(1, bai.length)];
    cauHoi.push({
      id: uid("cauhoi", i),
      questionCode: `CH-${String(i + 1).padStart(4, "0")}`,
      type: pick(rng, ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const),
      text: pick(rng, [
        "Cảm biến siêu âm dùng để làm gì?",
        "Muốn xe rẽ trái thì bánh nào quay nhanh hơn?",
        "Vòng lặp dùng khi nào?",
        "Nêu 2 quy tắc an toàn khi dùng pin sạc.",
        "Bộ phận nào truyền chuyển động từ động cơ ra bánh xe?",
      ]),
      difficulty: pick(rng, ["EASY", "MEDIUM", "HARD"] as const),
      points: 1,
      lessonId: l?.id ?? null,
      authorId: uat.daotao.employeeId,
      isPublic: true,
    });
  }
  const nCh = await taoThieu(
    cauHoi,
    (ids) => db.question.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.question.createMany({ data, skipDuplicates: true }),
  );

  const lopActive = await db.class.findMany({
    where: { id: { startsWith: "uat-lop-" }, status: "ACTIVE" },
    select: { id: true, name: true },
    take: 50,
  });
  const deThi: CoId<Prisma.ExamCreateManyInput>[] = lopActive.map((l, i) => ({
    id: uid("dethi", i),
    examCode: `DT-${String(i + 1).padStart(4, "0")}`,
    title: `Kiểm tra giữa khoá — ${l.name}`,
    classId: l.id,
    durationMinutes: 30,
    totalPoints: 10,
    passingScore: 5,
    status: chance(rng, 0.6) ? "PUBLISHED" : "DRAFT",
    createdById: uat.daotao.employeeId,
  }));
  const nDt = await taoThieu(
    deThi,
    (ids) => db.exam.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.exam.createMany({ data, skipDuplicates: true }),
  );
  xong("Đề thi", { câu_hỏi: nCh, đề: nDt });

  // ── Khảo sát ───────────────────────────────────────────────────────────────
  buoc("Khảo sát");
  const ks: CoId<Prisma.SurveyCreateManyInput>[] = [];
  for (const cs of coSo) {
    for (const [i, m] of (["AFTER_TRIAL", "MID_COURSE", "END_COURSE"] as const).entries()) {
      ks.push({
        id: uid("khaosat", cs.code, i),
        title: `Khảo sát ${m === "AFTER_TRIAL" ? "sau buổi học thử" : m === "MID_COURSE" ? "giữa khoá" : "cuối khoá"} — ${cs.name}`,
        description: "Phụ huynh cho trung tâm biết cảm nhận để cải thiện chất lượng.",
        milestone: m,
        centerId: cs.centerId,
        isActive: true,
        createdById: uat.marketing.id,
      });
    }
  }
  const nKs = await taoThieu(
    ks,
    (ids) => db.survey.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.survey.createMany({ data, skipDuplicates: true }),
  );
  xong("Khảo sát", nKs);

  // ── Nội dung website ───────────────────────────────────────────────────────
  buoc("Tin tức + tuyển dụng + cảm nhận");
  const TIN = [
    "Sata Robo khai giảng khoá Sata 2 tại cơ sở Hoàng Diệu",
    "Học viên Sata Robo đạt giải Nhì cuộc thi RoboSim thành phố",
    "5 lý do nên cho trẻ học lập trình robot từ tiểu học",
    "Ngày hội Robot: sân chơi cho hơn 200 em nhỏ Đà Nẵng",
    "Hướng dẫn phụ huynh đồng hành cùng con khi học STEM",
    "Sata Robo hợp tác cùng trường tiểu học Nguyễn Văn Trỗi",
    "Bộ học cụ ZM Robo Explorer có gì mới?",
    "Câu chuyện của bé Minh Khang: từ nhút nhát đến đội trưởng nhóm",
  ];
  // Nhân bản mẫu tiêu đề cho đủ ~50 bài — màn Tin tức cần đủ dòng để thấy phân trang.
  const TIN_DAY = Array.from({ length: 50 }, (_, i) => `${TIN[i % TIN.length]}${i >= TIN.length ? ` (phần ${Math.floor(i / TIN.length) + 1})` : ""}`);
  const tin: CoId<Prisma.NewsCreateManyInput>[] = TIN_DAY.map((t, i) => ({
    id: uid("tin", i),
    slug: `uat-tin-${i + 1}`,
    title: t,
    excerpt: `${t}. Bài viết dữ liệu UAT phục vụ nghiệm thu.`,
    content: `## ${t}\n\nNội dung mẫu cho môi trường nghiệm thu. Đoạn này chỉ để màn tin tức có bài đọc được, không phải nội dung marketing thật.\n\n- Ý chính thứ nhất\n- Ý chính thứ hai\n- Ý chính thứ ba`,
    category: pick(rng, ["Tin trung tâm", "Kiến thức", "Sự kiện", "Câu chuyện học viên"]),
    isPublished: !chance(rng, 0.2),
    isFeatured: i < 3,
    publishedAt: ngay(-int(rng, 1, 120)),
  }));
  const nTin = await taoThieu(
    tin,
    (ids) => db.news.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.news.createMany({ data, skipDuplicates: true }),
  );

  const VIEC_LAM = [
    ["Giáo viên Robotics (toàn thời gian)", "Đứng lớp Sata 1–4, soạn giáo án theo giáo trình có sẵn."],
    ["Trợ giảng bán thời gian", "Hỗ trợ giáo viên trong buổi học, chuẩn bị học cụ."],
    ["Tư vấn tuyển sinh", "Chăm sóc phụ huynh, tư vấn lộ trình học cho con."],
    ["Nhân viên marketing", "Lên nội dung mạng xã hội, phối hợp chạy quảng cáo."],
    ["Kế toán tổng hợp", "Theo dõi thu chi, công nợ học phí."],
    ["Giáo vụ cơ sở", "Xếp lớp, theo dõi điểm danh, chăm sóc học viên."],
  ];
  const VIEC_DAY = Array.from({ length: 50 }, (_, i) => VIEC_LAM[i % VIEC_LAM.length]!);
  const viec: CoId<Prisma.JobPostingCreateManyInput>[] = VIEC_DAY.map(([t, d], i) => ({
    id: uid("tuyendung", i),
    title: i < VIEC_LAM.length ? t! : `${t} — đợt ${Math.floor(i / VIEC_LAM.length) + 1}`,
    slug: `uat-tuyen-dung-${i + 1}`,
    description: `${d}\n\nQuyền lợi: lương thoả thuận, đào tạo nội bộ, môi trường trẻ.`,
    department: pick(rng, ["Đào tạo", "Kinh doanh", "Marketing", "Kế toán", "Vận hành"]),
    location: pick(rng, ["Đà Nẵng — CS1", "Đà Nẵng — CS2", "Hội sở"]),
    type: pick(rng, ["Toàn thời gian", "Bán thời gian"]),
    openings: int(rng, 1, 3),
    status: i % 5 === 4 ? "CLOSED" : "OPEN",
    contactEmail: "tuyendung@satarobo.vn",
  }));
  const nViec = await taoThieu(
    viec,
    (ids) => db.jobPosting.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.jobPosting.createMany({ data, skipDuplicates: true }),
  );

  const cn: CoId<Prisma.TestimonialCreateManyInput>[] = [];
  for (let i = 0; i < 50; i++) {
    const ten = tenNguoi(rng, chance(rng, 0.7) ? "FEMALE" : "MALE");
    cn.push({
      id: uid("camnhan", i),
      name: ten,
      role: pick(rng, ["Phụ huynh bé lớp 3", "Phụ huynh bé lớp 5", "Phụ huynh bé lớp 2", "Phụ huynh bé lớp 7"]),
      avatar: ten.split(" ").pop()?.charAt(0) ?? "P",
      avatarColor: pick(rng, ["#F97316", "#7C3AED", "#0EA5E9", "#16A34A"]),
      content: pick(rng, [
        "Con đi học về là khoe robot, tự tin hẳn lên.",
        "Giáo viên tận tâm, báo cáo tiến độ đều đặn.",
        "Học phí xứng đáng, con học được cách tư duy chứ không chỉ lắp ráp.",
        "Trung tâm gần nhà, giờ học linh hoạt cho gia đình.",
      ]),
    });
  }
  const nCn = await taoThieu(
    cn,
    (ids) => db.testimonial.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.testimonial.createMany({ data, skipDuplicates: true }),
  );
  xong("Website", { tin_tức: nTin, tuyển_dụng: nViec, cảm_nhận: nCn });

  // ── Nhật ký hệ thống ───────────────────────────────────────────────────────
  buoc("Nhật ký email + tích hợp");
  const mail: CoId<Prisma.EmailLogCreateManyInput>[] = [];
  for (let i = 0; i < 80; i++) {
    // ~10% GỬI LỖI → màn nhật ký email có dòng đỏ để soi.
    const loi = chance(rng, 0.1);
    mail.push({
      id: uid("email", i),
      toEmail: `ph.uat${i}@example.com`,
      toName: tenNguoi(rng, "FEMALE"),
      subject: pick(rng, ["Xác nhận ghi danh", "Nhắc đóng học phí", "Báo cáo tiến độ tháng", "Thông báo nghỉ lễ"]),
      bodyText: "Nội dung email dữ liệu UAT.",
      bodyHtml: "<p>Nội dung email dữ liệu UAT.</p>",
      triggerType: pick(rng, ["ENROLLMENT_CONFIRM", "PAYMENT_REMINDER", "PROGRESS_REPORT", "SYSTEM"]),
      status: loi ? "FAILED" : "SENT",
      failureReason: loi ? "Hòm thư không tồn tại (550)" : null,
      sentAt: loi ? null : ngay(-int(rng, 1, 60)),
      createdAt: ngay(-int(rng, 1, 60)),
    });
  }
  const nMail = await taoThieu(
    mail,
    (ids) => db.emailLog.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.emailLog.createMany({ data, skipDuplicates: true }),
  );

  const tichHop: CoId<Prisma.IntegrationLogCreateManyInput>[] = [];
  for (let i = 0; i < 60; i++) {
    const loi = chance(rng, 0.12);
    tichHop.push({
      id: uid("tichhop", i),
      provider: pick(rng, ["SEPAY", "ZALO_ZNS", "MISA", "META_CAPI", "RESEND"]),
      action: pick(rng, ["webhook.receive", "message.send", "invoice.push", "event.forward"]),
      status: loi ? "FAILED" : "SUCCESS",
      errorMessage: loi ? "Hết hạn token, cần cấp lại" : null,
      createdAt: ngay(-int(rng, 1, 45)),
    });
  }
  const nTh = await taoThieu(
    tichHop,
    (ids) => db.integrationLog.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.integrationLog.createMany({ data, skipDuplicates: true }),
  );
  xong("Nhật ký", { email: nMail, tích_hợp: nTh });
}
