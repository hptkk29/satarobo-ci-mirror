// prisma/seed-lms/crm.ts — Seed phễu CRM: Lead → LeadChild → (học thử V2) →
// convert → Student + Enrollment + Order + OrderItem + OrderInstallment + Payment + Receipt.
//
// BẤT BIẾN TIỀN (memory payment-double-count / mutual-exclusive): kế hoạch trả góp là
// nguồn sự thật "đã nộp". Ở đây Σ Payment CONFIRMED == Σ OrderInstallment PAID cho mỗi đơn
// (mỗi installment PAID có ĐÚNG 1 Payment CONFIRMED tương ứng — KHÔNG sinh khoản thừa).
import type { LeadStatus, PrismaClient } from "@prisma/client";
import type { SeedConfig } from "./_config";
import {
  CENTERS,
  OPERATING_CENTERS,
  batchCreate,
  chance,
  genGender,
  genName,
  genPhone,
  pad,
  pick,
  rand,
  weightedPick,
} from "./_lib";

const NOW = new Date("2026-07-03T00:00:00Z");
const DAY = 86400_000;
const MB_PRICE = [9990000, 12000000, 15000000];

type Stage = "NEW" | "CONSULTING" | "TRIAL" | "AWAITING" | "ENROLLED" | "LOST" | "NURTURING";
const STAGE_WEIGHTS: (readonly [Stage, number])[] = [
  ["NEW", 0.15],
  ["CONSULTING", 0.22],
  ["TRIAL", 0.23],
  ["AWAITING", 0.1],
  ["ENROLLED", 0.2],
  ["LOST", 0.07],
  ["NURTURING", 0.03],
];
// Kiểu là LeadStatus chứ không phải string: cả file đẩy dữ liệu qua `unknown[]` rồi
// `as never`, nên bảng ánh xạ này là chỗ DUY NHẤT tsc còn canh được giá trị enum. Để
// `string` như trước thì enum đổi mà seed vẫn xanh, chỉ chết lúc chạy createMany.
const STAGE_STATUS: Record<Stage, LeadStatus> = {
  NEW: "MOI",
  CONSULTING: "DANG_TU_VAN",
  TRIAL: "DANG_HOC_THU",
  AWAITING: "CHO_QUYET_DINH",
  ENROLLED: "DA_DANG_KY",
  LOST: "DA_MAT",
  NURTURING: "DANG_NUOI_DUONG",
};

export async function seedCrm(db: PrismaClient, cfg: SeedConfig): Promise<void> {
  // ── PaymentMethods (master) ──
  const pmSpecs = [
    { code: "CASH", name: "Tiền mặt", type: "CASH" },
    { code: "BANK_TRANSFER", name: "Chuyển khoản", type: "BANK_TRANSFER" },
    { code: "VNPAY", name: "VNPAY", type: "VNPAY" },
    { code: "TINGEE", name: "Tingee", type: "TINGEE" },
  ];
  const pmIds: Record<string, string> = {};
  for (const pm of pmSpecs) {
    const row = await db.paymentMethod.upsert({
      where: { code: pm.code },
      update: { name: pm.name },
      create: { code: pm.code, name: pm.name, type: pm.type as never, canBuyCourse: true },
      select: { id: true },
    });
    pmIds[pm.code] = row.id;
  }

  // ── Sales users + classes theo cơ sở (để gán/convert) ──
  const salesUsers = await db.user.findMany({
    where: { roles: { has: "SALES_CSM" } },
    select: { id: true, centerId: true },
  });
  const admin = await db.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const salesByCenter: Record<string, string[]> = { [CENTERS.CS1]: [], [CENTERS.CS2]: [] };
  for (const u of salesUsers) if (u.centerId && salesByCenter[u.centerId]) salesByCenter[u.centerId]!.push(u.id);
  const anySales = salesUsers.map((u) => u.id).concat(admin ? [admin.id] : []);
  const salesFor = (center: string, i: number): string => {
    const pool = salesByCenter[center]!.length ? salesByCenter[center]! : anySales;
    return pool.length ? pool[i % pool.length]! : admin!.id;
  };

  const classesByCenter: Record<string, { id: string; courseId: string }[]> = {
    [CENTERS.CS1]: [],
    [CENTERS.CS2]: [],
  };
  const activeClasses = await db.class.findMany({
    where: { status: "ACTIVE", centerId: { in: [...OPERATING_CENTERS] } },
    select: { id: true, courseId: true, centerId: true },
    take: 5000,
  });
  for (const c of activeClasses) if (c.centerId && classesByCenter[c.centerId]) classesByCenter[c.centerId]!.push({ id: c.id, courseId: c.courseId });
  const courses = await db.course.findMany({ select: { id: true, name: true } });
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  // ── TrialProgramConfig ──
  const trialCfg = await db.trialProgramConfig.upsert({
    where: { id: "slms-trialcfg" },
    update: { sessionCount: 3, active: true },
    create: { id: "slms-trialcfg", name: "Học thử 3 buổi (seed)", sessionCount: 3, active: true },
    select: { id: true },
  });

  // ── Accumulators ──
  const leads: unknown[] = [];
  const leadChildren: unknown[] = [];
  const activities: unknown[] = [];
  const tasks: unknown[] = [];
  const notes: unknown[] = [];
  const trialClasses: unknown[] = [];
  const trialSessions: unknown[] = [];
  const trialEnrollments: unknown[] = [];
  const trialAttendances: unknown[] = [];
  const trialHistories: unknown[] = [];
  const cStudents: unknown[] = [];
  const cEnrollments: unknown[] = [];
  const orders: unknown[] = [];
  const orderItems: unknown[] = [];
  const installments: unknown[] = [];
  const payments: unknown[] = [];
  const receipts: unknown[] = [];

  // Cấp phát lớp trải nghiệm theo cơ sở (capacity 8, 3 buổi past).
  const TRIAL_CAP = 8;
  const trialAlloc: Record<string, { id: string; count: number; seq: number }[]> = {
    [CENTERS.CS1]: [],
    [CENTERS.CS2]: [],
  };
  const trialSeq: Record<string, number> = { [CENTERS.CS1]: 0, [CENTERS.CS2]: 0 };
  function getTrialClass(center: string): { id: string; sessionIds: string[] } {
    const list = trialAlloc[center]!;
    let cur = list[list.length - 1];
    if (!cur || cur.count >= TRIAL_CAP) {
      trialSeq[center]!++;
      const code = center === CENTERS.CS1 ? "CS1" : "CS2";
      const id = `slms-tcl-${code}-${pad(trialSeq[center]!, 3)}`;
      cur = { id, count: 0, seq: trialSeq[center]! };
      list.push(cur);
      const start = new Date(NOW.getTime() - 21 * DAY);
      const sessionIds: string[] = [];
      trialClasses.push({
        id,
        code: `TRIAL-${code}-${pad(trialSeq[center]!, 3)}`,
        name: `Lớp trải nghiệm ${code}.${pad(trialSeq[center]!, 3)}`,
        centerId: center,
        startDate: start,
        startTime: "17:30",
        endTime: "19:00",
        capacity: TRIAL_CAP,
        status: "RUNNING",
        configId: trialCfg.id,
        sessionCount: 3,
      });
      for (let s = 1; s <= 3; s++) {
        const sid = `${id}-s${s}`;
        sessionIds.push(sid);
        trialSessions.push({
          id: sid,
          trialClassId: id,
          seq: s,
          date: new Date(start.getTime() + (s - 1) * 7 * DAY),
          startTime: "17:30",
          endTime: "19:00",
          status: "COMPLETED",
        });
      }
      (cur as { sessionIds?: string[] }).sessionIds = sessionIds;
    }
    cur.count++;
    return { id: cur.id, sessionIds: (cur as unknown as { sessionIds: string[] }).sessionIds };
  }

  for (let i = 1; i <= cfg.crmLeads; i++) {
    const center = pick(OPERATING_CENTERS);
    const pGender = genGender();
    const parentName = genName(pGender);
    const phone = genPhone();
    const leadId = `slms-lead-${pad(i, 5)}`;
    const stage = weightedPick(STAGE_WEIGHTS);
    const assignedToId = salesFor(center, i);
    const createdAt = new Date(NOW.getTime() - rand(1, 90) * DAY);
    const lastAct = new Date(createdAt.getTime() + rand(0, 5) * DAY);

    const isConverted = stage === "ENROLLED";
    const hasTrial = stage === "TRIAL" || stage === "AWAITING";

    leads.push({
      id: leadId,
      parentName,
      phone,
      email: chance(0.5) ? `${leadId}@seed.satarobo.test` : null,
      centerId: center,
      status: STAGE_STATUS[stage],
      source: pick(["Messenger", "Facebook Ads", "Zalo", "Website", "Giới thiệu", "Hotline"]),
      utmSource: pick(["facebook", "google", "zalo", "direct"]),
      consentMarketing: chance(0.7),
      assignedToId,
      assignedAt: createdAt,
      firstContactAt: stage === "NEW" ? null : new Date(createdAt.getTime() + DAY),
      qualifiedAt: stage === "NEW" ? null : createdAt,
      lastActivityAt: lastAct,
      convertedById: isConverted ? assignedToId : null,
      convertedAt: isConverted ? new Date(createdAt.getTime() + rand(7, 30) * DAY) : null,
      createdAt,
    });

    // 1-2 con
    const nChild = weightedPick([[1, 0.6], [2, 0.4]] as const);
    const childIds: string[] = [];
    for (let c = 0; c < nChild; c++) {
      const g = genGender();
      const age = rand(6, 13);
      const lcId = `slms-lc-${pad(i, 5)}-${c}`;
      childIds.push(lcId);
      leadChildren.push({
        id: lcId,
        leadId,
        fullName: `${parentName.split(" ")[0]} ${genName(g).split(" ").slice(1).join(" ")}`,
        ageYears: age,
        gender: g,
        gradeLevel: `Lớp ${Math.max(1, age - 5)}`,
        interestedCenterId: center,
        trialStatus: isConverted ? "ATTENDED" : hasTrial ? "IN_PROGRESS" : "NONE",
      });
    }

    // Activities + task + note
    const nAct = rand(1, 3);
    for (let k = 0; k < nAct; k++) {
      activities.push({
        id: `slms-la-${pad(i, 5)}-${k}`,
        leadId,
        actorId: assignedToId,
        actorName: "Sale seed",
        type: pick(["CALL", "MESSAGE", "NOTE"]),
        content: pick(["Gọi tư vấn khoá học", "Nhắn Zalo gửi bảng giá", "PH quan tâm lớp cuối tuần", "Hẹn học thử"]),
        createdAt: new Date(createdAt.getTime() + k * DAY),
      });
    }
    if (stage !== "LOST" && stage !== "ENROLLED" && chance(0.6)) {
      tasks.push({
        id: `slms-lt-${pad(i, 5)}`,
        leadId,
        assignedToId,
        assignedToName: "Sale seed",
        title: pick(["Gọi lại chốt lịch học thử", "Follow-up sau tư vấn", "Gửi ưu đãi tháng"]),
        dueAt: new Date(NOW.getTime() + rand(1, 7) * DAY),
        status: "OPEN",
      });
    }
    if (chance(0.4)) {
      notes.push({
        id: `slms-note-${pad(i, 5)}`,
        leadId,
        authorId: assignedToId,
        content: pick(["PH bận, hẹn gọi lại chiều", "Con thích robot, cần lớp gần nhà", "Chốt học thử thứ 7"]),
      });
    }

    // Học thử (V2) cho TRIAL/AWAITING
    if (hasTrial) {
      for (let c = 0; c < childIds.length; c++) {
        const tcl = getTrialClass(center);
        const teId = `slms-te-${pad(i, 5)}-${c}`;
        trialEnrollments.push({
          id: teId,
          trialClassId: tcl.id,
          leadChildId: childIds[c],
          status: stage === "AWAITING" ? "COMPLETED" : "ACTIVE",
          summaryNote: stage === "AWAITING" ? "Con học tốt, PH đang cân nhắc đăng ký." : null,
          addedById: assignedToId,
        });
        let attended = 0;
        for (let s = 0; s < tcl.sessionIds.length; s++) {
          const present = chance(0.85);
          if (present) attended++;
          trialAttendances.push({
            id: `slms-ta-${teId}-${s}`,
            trialSessionId: tcl.sessionIds[s],
            trialEnrollmentId: teId,
            status: present ? "PRESENT" : "ABSENT",
          });
        }
        trialHistories.push({
          id: `slms-th-${pad(i, 5)}-${c}`,
          leadChildId: childIds[c],
          trialClassId: tcl.id,
          centerId: center,
          totalSessions: 3,
          attendedCount: attended,
          outcome: stage === "AWAITING" ? "PENDING" : "PENDING",
        });
      }
    }

    // Convert (ENROLLED): Student + Enrollment + Order + Item + Installment + Payment + Receipt
    if (isConverted) {
      const classPool = classesByCenter[center]!;
      if (classPool.length === 0) continue; // không có lớp ở cơ sở → bỏ qua phần tài chính
      const klass = pick(classPool);
      const stuId = `slms-cst-${pad(i, 5)}`;
      const g = genGender();
      cStudents.push({
        id: stuId,
        name: `${parentName.split(" ")[0]} ${genName(g).split(" ").slice(1).join(" ")}`,
        studentCode: `HVC-${pad(i, 6)}`,
        gender: g,
        currentGrade: rand(1, 8),
        status: "ACTIVE",
        centerId: center,
        preferredCenterId: center,
        parentName,
        parentPhone: phone,
        parentRelation: pGender === "MALE" ? "Bố" : "Mẹ",
        enrollmentDate: new Date(createdAt.getTime() + 14 * DAY),
      });

      const finalPrice = pick(MB_PRICE);
      const enrId = `slms-cenr-${pad(i, 5)}`;
      cEnrollments.push({
        id: enrId,
        studentId: stuId,
        classId: klass.id,
        courseId: klass.courseId,
        centerId: center,
        status: "STUDYING",
        leadChildId: childIds[0],
        listPrice: finalPrice,
        finalPrice,
        tuition: finalPrice,
        enrolledAt: new Date(createdAt.getTime() + 14 * DAY),
        confirmedAt: new Date(createdAt.getTime() + 15 * DAY),
      });

      const orderId = `slms-ord-${pad(i, 5)}`;
      const orderPaidAt = new Date(createdAt.getTime() + 15 * DAY);
      const pmCode = pick(["CASH", "BANK_TRANSFER"]);
      orders.push({
        id: orderId,
        code: `ORD-2607-${pad(i, 6)}`,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: parentName,
        customerPhone: phone,
        studentId: stuId,
        leadId,
        centerId: center,
        paymentMethodId: pmIds[pmCode],
        subtotal: finalPrice,
        totalAmount: finalPrice,
        paidAt: orderPaidAt,
        confirmedByUserId: assignedToId,
        confirmedAt: orderPaidAt,
      });
      orderItems.push({
        id: `slms-oit-${pad(i, 5)}`,
        orderId,
        type: "COURSE_ENROLLMENT",
        enrollmentId: enrId,
        itemName: courseName.get(klass.courseId) ?? "Khoá học",
        quantity: 1,
        unitPrice: finalPrice,
        totalPrice: finalPrice,
      });

      // Kế hoạch trả góp = nguồn sự thật. 60% trả đủ 1 đợt; 40% trả góp 2 đợt (đợt 1 đã thu).
      const full = chance(0.6);
      const dot1 = full ? finalPrice : Math.round(finalPrice / 2);
      installments.push({
        id: `slms-ins-${pad(i, 5)}-1`,
        orderId,
        soDot: 1,
        amount: dot1,
        status: "PAID",
        paidAt: orderPaidAt,
        recordedById: assignedToId,
      });
      if (!full) {
        installments.push({
          id: `slms-ins-${pad(i, 5)}-2`,
          orderId,
          soDot: 2,
          amount: finalPrice - dot1,
          status: "PENDING",
          dueDate: new Date(orderPaidAt.getTime() + 30 * DAY),
        });
      }
      // ĐÚNG 1 Payment CONFIRMED cho phần đã thu (== Σ installment PAID = dot1).
      const payId = `slms-pay-${pad(i, 5)}`;
      payments.push({
        id: payId,
        orderId,
        enrollmentId: enrId,
        amount: dot1,
        method: pmCode,
        paidDate: orderPaidAt,
        saleStatus: "COLLECT_CONFIRMED",
        accountantStatus: "CONFIRMED",
        recordedById: assignedToId,
        confirmedById: admin?.id ?? assignedToId,
        confirmedAt: orderPaidAt,
        centerId: center,
      });
      receipts.push({
        id: `slms-rcp-${pad(i, 5)}`,
        code: `RCP-${center === CENTERS.CS1 ? "CS1" : "CS2"}-26-${pad(i, 6)}`,
        enrollmentId: enrId,
        paymentId: payId,
        issuedById: admin?.id ?? assignedToId,
        status: "ACTIVE",
      });
    }
  }

  // Chèn theo dependency order.
  await batchCreate("leads", leads, (b) => db.lead.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("lead-children", leadChildren, (b) => db.leadChild.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("lead-activities", activities, (b) => db.leadActivity.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("lead-tasks", tasks, (b) => db.leadTask.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("lead-notes", notes, (b) => db.note.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("trial-classes", trialClasses, (b) => db.trialClassV2.createMany({ data: b as never, skipDuplicates: true }), 500);
  await batchCreate("trial-sessions", trialSessions, (b) => db.trialClassSession.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("trial-enrollments", trialEnrollments, (b) => db.trialEnrollment.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("trial-attendances", trialAttendances, (b) => db.trialAttendance.createMany({ data: b as never, skipDuplicates: true }), 2000);
  await batchCreate("trial-histories", trialHistories, (b) => db.leadTrialHistory.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("converted-students", cStudents, (b) => db.student.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("converted-enrollments", cEnrollments, (b) => db.enrollment.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("orders", orders, (b) => db.order.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("order-items", orderItems, (b) => db.orderItem.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("installments", installments, (b) => db.orderInstallment.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("payments", payments, (b) => db.payment.createMany({ data: b as never, skipDuplicates: true }), 1000);
  await batchCreate("receipts", receipts, (b) => db.receipt.createMany({ data: b as never, skipDuplicates: true }), 1000);

  console.log(
    `✅ CRM: ${leads.length} lead · ${leadChildren.length} con · ${trialClasses.length} lớp thử · ` +
      `${trialEnrollments.length} ghi danh thử · ${orders.length} đơn · ${payments.length} payment · ${receipts.length} receipt`,
  );
}
