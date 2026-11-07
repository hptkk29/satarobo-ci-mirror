// prisma/seed-uat/06-cskh-nhansu.ts — chăm sóc phụ huynh + nhân sự/chấm công.
//
// Màn được nuôi: /parent-requests · /parent-feedback · /notifications ·
// /canh-bao-rui-ro · /cham-soc-hv · /satacoin · /sinh-nhat · /khao-sat ·
// /cham-cong* · /don-tu · cổng phụ huynh (yêu cầu, thông báo, đánh giá).
//
// CA BIÊN CỐ Ý
//  · yêu cầu phụ huynh CÒN CHỜ XỬ LÝ → `uat.giaovu` có việc tồn;
//  · cảnh báo rủi ro mức CAO chưa xử lý → màn cảnh báo có dòng đỏ;
//  · đơn từ nhân sự CHỜ DUYỆT → `uat.giamdoc` / `uat.nhansu` có việc;
//  · có ngày quên chấm công ra (chỉ có CHECK_IN) → màn chấm công lộ dòng thiếu.
import {
  db, buoc, xong, chance, int, makeRng, ngay, ngayGio, pick, taoThieu, uid,
  type CoId, type CoSo, type Uat,
} from "./_common";
import type { Prisma } from "@prisma/client";

const YEU_CAU = [
  "Xin phép cho con nghỉ buổi tới vì gia đình có việc.",
  "Nhờ trung tâm sắp xếp học bù buổi con vắng tuần trước.",
  "Gia đình muốn chuyển con sang lớp cuối tuần.",
  "Xin bảo lưu một tháng vì con đi công tác cùng bố mẹ.",
  "Nhờ giáo viên kèm thêm phần lập trình cho con.",
  "Xin đổi giờ học sang ca chiều.",
];
const DANH_GIA = [
  "Con rất thích đi học, về nhà kể chuyện robot suốt.",
  "Giáo viên nhiệt tình, phản hồi nhanh qua Zalo.",
  "Mong trung tâm gửi ảnh buổi học đều hơn.",
  "Cơ sở vật chất tốt, phòng học sạch.",
  "Học phí hơi cao so với mặt bằng nhưng chất lượng ổn.",
];
const THONG_BAO = [
  ["Lịch nghỉ lễ Quốc khánh", "Trung tâm nghỉ ngày 02/09, các lớp học bù vào tuần kế tiếp."],
  ["Thông báo khai giảng khoá mới", "Khoá Sata 2 khai giảng đầu tháng tới, phụ huynh đăng ký sớm để giữ chỗ."],
  ["Nhắc đóng học phí đợt 2", "Phụ huynh vui lòng hoàn tất học phí đợt 2 trước buổi thứ 6."],
  ["Ngày hội Robot Sata", "Mời phụ huynh và các con tham dự ngày hội cuối tháng."],
  ["Bảo trì phòng học", "Phòng 3 tạm nghỉ để bảo trì, lớp chuyển sang phòng 5."],
];

/** Loại đơn đi kèm lý do HỢP với nó — xem chú thích ở chỗ dùng. */
const LOAI_DON = [
  { kind: "LEAVE", lyDo: ["Việc gia đình", "Khám sức khoẻ định kỳ", "Con ốm"] },
  { kind: "OT", lyDo: ["Dạy bù cuối tuần", "Chuẩn bị hội thi robot", "Trực sự kiện mở lớp"] },
  { kind: "LATE_EARLY", lyDo: ["Kẹt xe", "Đưa con đi khám", "Về sớm có việc gia đình"] },
  { kind: "SUB_TEACH", lyDo: ["Dạy thay đồng nghiệp", "Nhận lớp giúp giáo viên nghỉ ốm"] },
  { kind: "SHIFT_SWAP", lyDo: ["Đổi ca với đồng nghiệp", "Hoán ca để đi học nghiệp vụ"] },
  { kind: "TIMESHEET_FIX", lyDo: ["Quên chấm công ra", "Máy chấm công lỗi", "Quên chấm công vào"] },
] as const satisfies readonly { kind: Prisma.WorkRequestCreateManyInput["kind"]; lyDo: readonly string[] }[];

export async function seedCskhNhanSu(coSo: CoSo[], uat: Uat) {
  const rng = makeRng(6006);

  const hvs = await db.student.findMany({
    where: { id: { startsWith: "uat-hv-" } },
    select: { id: true, name: true, centerId: true, parentUserId: true, status: true, dateOfBirth: true },
  });
  const lops = await db.class.findMany({
    where: { id: { startsWith: "uat-lop-" }, status: { in: ["ACTIVE", "RECRUITING", "COMPLETED"] } },
    select: { id: true, centerId: true, name: true },
  });

  // ── Yêu cầu phụ huynh ──────────────────────────────────────────────────────
  buoc("Yêu cầu phụ huynh");
  const yc: CoId<Prisma.ParentRequestCreateManyInput>[] = [];
  for (const [i, hv] of hvs.entries()) {
    if (!chance(rng, 0.45)) continue;
    // ~45% CÒN CHỜ → giáo vụ có hàng đợi thật để nghiệm thu nút duyệt/từ chối.
    const st: Prisma.ParentRequestCreateManyInput["status"] =
      chance(rng, 0.45) ? "PENDING" : chance(rng, 0.75) ? "APPROVED" : "REJECTED";
    yc.push({
      id: uid("yc", i),
      studentId: hv.id,
      parentUserId: hv.parentUserId,
      type: pick(rng, ["ABSENCE", "MAKEUP", "TRANSFER_CLASS", "RESERVE", "OTHER"] as const),
      content: pick(rng, YEU_CAU),
      preferredDate: ngay(int(rng, 1, 21)),
      status: st,
      response: st === "PENDING" ? null : pick(rng, ["Đã sắp xếp, mời phụ huynh xem lịch mới.", "Rất tiếc lớp đích đã đầy."]),
      handledById: st === "PENDING" ? null : uat.giaovu.id,
      handledByName: st === "PENDING" ? null : (uat.giaovu.name ?? "Giáo vụ"),
      handledAt: st === "PENDING" ? null : ngay(-int(rng, 1, 20)),
      createdAt: ngay(-int(rng, 1, 60)),
    });
  }
  const nYc = await taoThieu(
    yc,
    (ids) => db.parentRequest.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.parentRequest.createMany({ data, skipDuplicates: true }),
  );

  // ── Đánh giá của phụ huynh ─────────────────────────────────────────────────
  const dg: CoId<Prisma.ParentFeedbackCreateManyInput>[] = [];
  for (const [i, hv] of hvs.entries()) {
    if (!chance(rng, 0.45)) continue;
    const sao = chance(rng, 0.75) ? int(rng, 4, 5) : int(rng, 2, 3);
    dg.push({
      id: uid("dgph", i),
      studentId: hv.id,
      studentName: hv.name,
      parentUserId: hv.parentUserId,
      rating: sao,
      content: pick(rng, DANH_GIA),
      // Đánh giá thấp mà CHƯA ai phản hồi = việc tồn của CSKH.
      adminResponse: sao >= 4 && chance(rng, 0.5) ? "Cảm ơn phụ huynh đã phản hồi!" : null,
      respondedById: sao >= 4 && chance(rng, 0.5) ? uat.giamdoc.id : null,
      createdAt: ngay(-int(rng, 1, 90)),
    });
  }
  const nDg = await taoThieu(
    dg,
    (ids) => db.parentFeedback.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.parentFeedback.createMany({ data, skipDuplicates: true }),
  );
  xong("Phụ huynh", { yêu_cầu: nYc, đánh_giá: nDg });

  // ── Thông báo ──────────────────────────────────────────────────────────────
  buoc("Thông báo");
  const tb: CoId<Prisma.NotificationCreateManyInput>[] = [];
  let ti = 0;
  for (const cs of coSo) {
    for (const [tieuDe, than] of THONG_BAO) {
      ti += 1;
      tb.push({
        id: uid("tb", cs.code, ti),
        title: `${tieuDe} — ${cs.name}`,
        body: than!,
        audience: "CENTER",
        centerId: cs.centerId,
        isPublished: true,
        publishedAt: ngay(-int(rng, 1, 45)),
        createdById: uat.giamdoc.id,
        createdByName: uat.giamdoc.name ?? "Quản lý cơ sở",
      });
    }
    // Thông báo theo LỚP — để cổng phụ huynh có tin riêng của lớp con mình.
    // Nâng lên cho màn Thông báo đủ ~50 dòng mỗi cơ sở (5 tin cơ sở + tin từng lớp).
    for (const lop of lops.filter((l) => l.centerId === cs.centerId).slice(0, 45)) {
      ti += 1;
      tb.push({
        id: uid("tb", cs.code, ti),
        title: `Nhắc lịch buổi tới — ${lop.name}`,
        body: "Phụ huynh nhắc con mang đủ bộ học cụ và đến sớm 10 phút.",
        audience: "CLASS",
        centerId: cs.centerId,
        classId: lop.id,
        isPublished: true,
        publishedAt: ngay(-int(rng, 1, 20)),
        createdById: uat.giaovu.id,
        createdByName: uat.giaovu.name ?? "Giáo vụ",
      });
    }
  }
  const nTb = await taoThieu(
    tb,
    (ids) => db.notification.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.notification.createMany({ data, skipDuplicates: true }),
  );
  xong("Thông báo", nTb);

  // ── Cảnh báo rủi ro + việc chăm sóc ────────────────────────────────────────
  buoc("Cảnh báo rủi ro + chăm sóc học viên");
  const cb: CoId<Prisma.StudentRiskAlertCreateManyInput>[] = [];
  const cs_task: CoId<Prisma.StudentCareTaskCreateManyInput>[] = [];
  for (const [i, hv] of hvs.entries()) {
    if (!chance(rng, 0.42)) continue;
    const mucDo = chance(rng, 0.25) ? "HIGH" : chance(rng, 0.5) ? "MEDIUM" : "LOW";
    const st: Prisma.StudentRiskAlertCreateManyInput["status"] =
      mucDo === "HIGH" ? (chance(rng, 0.7) ? "OPEN" : "ESCALATED") : chance(rng, 0.5) ? "OPEN" : "RESOLVED";
    const aid = uid("rui-ro", i);
    cb.push({
      id: aid,
      studentId: hv.id,
      centerId: hv.centerId,
      type: pick(rng, ["CONSECUTIVE_ABSENCE", "HIGH_ABSENCE", "MISSED_SUBMISSIONS",
        "NEEDS_SUPPORT", "NEARING_END_NO_RENEWAL", "OVERDUE_PAYMENT"] as const),
      severity: mucDo,
      status: st,
      detail: pick(rng, [
        "Vắng 3/5 buổi gần nhất.", "Chưa nộp 2 bài liên tiếp.",
        "Còn 2 buổi là hết khoá, chưa đăng ký tiếp.", "Học phí quá hạn 10 ngày.",
      ]),
      resolvedById: st === "RESOLVED" ? uat.sale1.id : null,
      resolvedAt: st === "RESOLVED" ? ngay(-int(rng, 1, 15)) : null,
      createdAt: ngay(-int(rng, 1, 40)),
    });
    if (st !== "RESOLVED") {
      cs_task.push({
        id: uid("cstask", i),
        studentId: hv.id,
        centerId: hv.centerId,
        riskAlertId: aid,
        assignedToId: hv.centerId === coSo[0]!.centerId ? uat.sale1.id : uat.sale2.id,
        title: pick(rng, ["Gọi hỏi thăm phụ huynh", "Nhắc đóng học phí", "Mời tái tục khoá tiếp", "Trao đổi tình hình học"]),
        dueAt: chance(rng, 0.4) ? ngay(-int(rng, 1, 8)) : ngay(int(rng, 1, 10)),
        status: "OPEN",
        createdById: uat.giamdoc.id,
      });
    }
  }
  const nCb = await taoThieu(
    cb,
    (ids) => db.studentRiskAlert.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.studentRiskAlert.createMany({ data, skipDuplicates: true }),
  );
  const nTask = await taoThieu(
    cs_task,
    (ids) => db.studentCareTask.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.studentCareTask.createMany({ data, skipDuplicates: true }),
  );
  xong("Rủi ro", { cảnh_báo: nCb, việc_chăm_sóc: nTask });

  // ── SataCoin ───────────────────────────────────────────────────────────────
  buoc("SataCoin");
  const coin: CoId<Prisma.SataCoinTransactionCreateManyInput>[] = [];
  for (const [i, hv] of hvs.entries()) {
    const soGd = int(rng, 0, 4);
    for (let k = 0; k < soGd; k++) {
      const thuong = chance(rng, 0.85);
      coin.push({
        id: uid("coin", i, k),
        studentId: hv.id,
        centerId: hv.centerId,
        amount: thuong ? pick(rng, [5, 10, 20, 50]) : -pick(rng, [10, 20]),
        type: thuong ? "EARN" : "ADJUST",
        reason: thuong
          ? pick(rng, ["Đi học đúng giờ", "Hoàn thành bài tập về nhà", "Sản phẩm buổi học xuất sắc", "Giúp đỡ bạn"])
          : "Vi phạm quy tắc an toàn",
        createdAt: ngay(-int(rng, 1, 90)),
      });
    }
  }
  const nCoin = await taoThieu(
    coin,
    (ids) => db.sataCoinTransaction.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.sataCoinTransaction.createMany({ data, skipDuplicates: true }),
  );
  xong("SataCoin", nCoin);

  // ── Chấm công ──────────────────────────────────────────────────────────────
  buoc("Chấm công + ca làm + đơn từ");
  const nhanVien = [uat.giaovien, uat.giaovu, uat.sale1, uat.sale2, uat.giamdoc];
  const cham: CoId<Prisma.EmployeeCheckinCreateManyInput>[] = [];
  const ca: CoId<Prisma.ShiftRegistrationCreateManyInput>[] = [];
  for (const [ni, nv] of nhanVien.entries()) {
    const centerId = nv.centerId ?? coSo[0]!.centerId;
    for (let d = 1; d <= 30; d++) {
      const ngayLech = -d;
      // Chủ nhật nghỉ.
      if ((d + 3) % 7 === 0) continue;
      cham.push({
        id: uid("cham", ni, d, "in"),
        userId: nv.id,
        userName: nv.name ?? nv.email ?? "Nhân viên",
        centerId,
        type: "CHECK_IN",
        checkedAt: ngayGio(ngayLech, 8, int(rng, 0, 25)),
        withinGeofence: true,
      });
      // Ca biên: ~8% ngày QUÊN chấm công ra → màn chấm công phải lộ ra dòng thiếu.
      if (!chance(rng, 0.08)) {
        cham.push({
          id: uid("cham", ni, d, "out"),
          userId: nv.id,
          userName: nv.name ?? nv.email ?? "Nhân viên",
          centerId,
          type: "CHECK_OUT",
          checkedAt: ngayGio(ngayLech, 17, int(rng, 0, 50)),
          withinGeofence: true,
        });
      }
      if (d <= 14) {
        ca.push({
          id: uid("ca", ni, d),
          userId: nv.id,
          centerId,
          date: ngay(ngayLech + 20),
          status: chance(rng, 0.15) ? "LEAVE_REQUESTED" : "REGISTERED",
          note: null,
        });
      }
    }
  }
  const nCham = await taoThieu(
    cham,
    (ids) => db.employeeCheckin.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.employeeCheckin.createMany({ data, skipDuplicates: true }),
  );
  const nCa = await taoThieu(
    ca,
    (ids) => db.shiftRegistration.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.shiftRegistration.createMany({ data, skipDuplicates: true }),
  );

  // ── Đơn từ ─────────────────────────────────────────────────────────────────
  const don: CoId<Prisma.WorkRequestCreateManyInput>[] = [];
  for (let i = 0; i < 60; i++) {
    const nv = nhanVien[i % nhanVien.length]!;
    // ~40% CHỜ DUYỆT → quản lý cơ sở và nhân sự có việc.
    const st: Prisma.WorkRequestCreateManyInput["status"] =
      chance(rng, 0.4) ? "PENDING" : chance(rng, 0.75) ? "APPROVED" : "REJECTED";
    // Loại đơn đi CÙNG lý do và cùng khoảng ngày hợp lệ của nó.
    //
    // Bản cũ bốc `kind` và `reason` bằng hai lượt pick ĐỘC LẬP, và `toDate` là một số
    // ngẫu nhiên riêng nên có thể rơi TRƯỚC `fromDate`. Trên UAT ra những dòng vô nghĩa
    // như "Đi muộn / Về sớm — Dạy thay đồng nghiệp — 26/07 → 22/08" (27 ngày đi muộn).
    // QA thấy form tạo đơn lại làm đúng nên xếp vào diện cần xác nhận (NV-005) — đúng,
    // dữ liệu đó không tạo được từ giao diện.
    const loai = pick(rng, LOAI_DON);
    // Bốn loại dưới gắn với MỘT ca làm việc ⇒ đúng một ngày. Nghỉ phép và tăng ca mới
    // có khoảng.
    const soNgay = ["LEAVE", "OT"].includes(loai.kind) ? int(rng, 0, 2) : 0;
    const tuNgay = -int(rng, 1, 30);
    don.push({
      id: uid("dontu", i),
      requesterId: nv.id,
      centerId: nv.centerId ?? coSo[0]!.centerId,
      kind: loai.kind,
      status: st,
      fromDate: ngay(tuNgay),
      toDate: ngay(tuNgay + soNgay),
      reason: pick(rng, loai.lyDo),
      reviewedById: st === "PENDING" ? null : uat.giamdoc.id,
      reviewedByName: st === "PENDING" ? null : (uat.giamdoc.name ?? "Quản lý cơ sở"),
      reviewedAt: st === "PENDING" ? null : ngay(-int(rng, 1, 10)),
      // Đơn phải được GỬI TRƯỚC ngày xin — TỐI THIỂU 1 ngày, không phải 0.
      //
      // ⚠️ `fromDate`/`toDate` là cột `@db.Date` còn `createdAt` là `timestamptz`.
      // `ngay()` trả 00:00 giờ VN = 17:00 UTC hôm trước, nên Prisma ghi vào cột Date
      // lấy phần ngày THEO UTC và ra sớm hơn ngày VN một ngày. Để lệch 0 ngày thì
      // `createdAt` (giữ mốc VN) đọc ra muộn hơn `fromDate` (đã lùi) đúng một ngày —
      // và bảng đơn từ hiện "ngày gửi sau ngày bắt đầu". Đo được 8/60 dòng sau lượt
      // seed đầu tiên ngày 03/09.
      createdAt: ngay(tuNgay - int(rng, 1, 7)),
    });
  }
  const nDon = await taoThieu(
    don,
    (ids) => db.workRequest.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.workRequest.createMany({ data, skipDuplicates: true }),
  );
  xong("Nhân sự", { chấm_công: nCham, ca_làm: nCa, đơn_từ: nDon });
}
