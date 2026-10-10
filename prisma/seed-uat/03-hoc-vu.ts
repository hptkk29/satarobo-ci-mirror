// prisma/seed-uat/03-hoc-vu.ts — XƯƠNG SỐNG: phụ huynh, học viên, lớp, ghi danh,
// buổi học, điểm danh, nhận xét buổi.
//
// Gần như mọi màn còn lại đều treo vào bộ này, nên nó chạy TRƯỚC tài chính/LMS/CSKH.
//
// Màn được nuôi: /students · /students/tai-khoan · /classes · /class-groups ·
// /enrollments · /sessions · /attendance · /hoc-ba · /report-cards · /media ·
// /teachers · /chuyen-lop · portal phụ huynh · site giáo viên.
//
// BA CA BIÊN CỐ Ý TRỘN VÀO
//  1. Ghi danh mang trạng thái `ACTIVE` — ĐÚNG loại đã gây bug 21/08 ("bấm nghỉ
//     học mà lớp vẫn còn tên"). Nó là mặc định của schema và là thứ hai đường
//     convert lead sinh ra, nên dữ liệu UAT phải có nó, nếu không nghiệm thu sẽ
//     xanh giả.
//  2. Lớp ĐÃ ĐẦY (sĩ số = maxStudents) để thử chặn gán thêm và nút chuyển lớp.
//  3. Học viên nghỉ học / bảo lưu, và một em nghỉ học NHƯNG VẪN còn trong lớp —
//     đúng hiện trạng dữ liệu cũ mà bản vá phải dọn được.
import {
  db, buoc, xong, chance, int, makeRng, ngay, ngayGio, ngaySinh, pick, sdt,
  taoThieu, tenNguoi, uid, MOI_CO_SO,
  type CoId, type CoSo, type Uat,
} from "./_common";
import { rosterStatuses } from "../../lib/enrollment-scope";
import { raiTheoThu } from "./lich";
import type { Prisma } from "@prisma/client";

const TRUONG = ["TH Nguyễn Văn Trỗi", "TH Phan Thanh", "TH Hoàng Văn Thụ", "TH Lê Lai",
  "THCS Nguyễn Huệ", "THCS Trưng Vương", "TH Núi Thành", "TH Trần Cao Vân"];
const QUAN = ["Hải Châu", "Thanh Khê", "Sơn Trà", "Ngũ Hành Sơn", "Liên Chiểu", "Cẩm Lệ"];
const NHAN_XET = [
  "Con tập trung tốt, lắp đúng ngay lần đầu.",
  "Còn lúng túng ở bước nối dây, cần nhắc lại buổi sau.",
  "Rất tích cực phát biểu, giúp bạn cùng nhóm.",
  "Hoàn thành nhiệm vụ sớm, xin làm thêm phần nâng cao.",
  "Hơi mất tập trung nửa cuối buổi.",
  "Tiến bộ rõ so với buổi trước.",
];
const DU_AN = ["Xe dò vạch", "Cánh tay gắp", "Xe vượt địa hình", "Robot phân loại",
  "Xe điều khiển từ xa", "Robot tránh vật cản"];
const THU_HOC = [
  { label: "T3 - T5", days: [2, 4], gio: "17:30", het: "19:00" },
  { label: "T2 - T6", days: [1, 5], gio: "18:00", het: "19:30" },
  { label: "T7 sáng", days: [6], gio: "08:00", het: "10:00" },
  { label: "CN sáng", days: [0], gio: "08:30", het: "10:30" },
  { label: "T7 chiều", days: [6], gio: "14:00", het: "16:00" },
];

export async function seedHocVu(
  coSo: CoSo[],
  uat: Uat,
  nen: { courses: { id: string; slug: string; name: string; price: number; sessions: number }[]; lessonIds: Record<string, string[]> },
) {
  const rng = makeRng(3003);
  const SO_HV = Math.round(MOI_CO_SO * 2.5); // đủ dày để mỗi lớp có sĩ số thật
  const SO_LOP = MOI_CO_SO;

  // Khoá dùng để mở lớp (bỏ combo — combo không mở lớp riêng).
  const khoaDay = nen.courses.filter((c) => c.slug !== "combo-1-2");

  // ── Nhóm lớp ───────────────────────────────────────────────────────────────
  buoc("Nhóm lớp");
  const groups: CoId<Prisma.ClassGroupCreateManyInput>[] = [];
  for (const cs of coSo) {
    for (let i = 1; i <= 4; i++) {
      groups.push({
        id: uid("cgroup", cs.code, i),
        code: `${cs.code}-N${i}`,
        displayCode: `${cs.code}.N${i}`,
        name: `Nhóm ${i} — ${cs.name}`,
        centerId: cs.centerId,
        status: "ACTIVE",
      });
    }
  }
  const nGroup = await taoThieu(
    groups,
    (ids) => db.classGroup.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.classGroup.createMany({ data, skipDuplicates: true }),
  );
  xong("Nhóm lớp", nGroup);

  // ── Tài khoản phụ huynh + học viên ─────────────────────────────────────────
  buoc("Phụ huynh + học viên");
  const parents: CoId<Prisma.UserCreateManyInput>[] = [];
  const students: CoId<Prisma.StudentCreateManyInput>[] = [];
  const hvTheoCoSo: Record<string, { id: string; name: string; status: string }[]> = {};

  let stt = 0;
  for (const cs of coSo) {
    hvTheoCoSo[cs.key] = [];
    for (let i = 1; i <= SO_HV; i++) {
      stt += 1;
      const hvId = uid("hv", cs.code, i);
      const gt = chance(rng, 0.55) ? "MALE" : "FEMALE";
      const ten = tenNguoi(rng, gt);
      const tenPh = tenNguoi(rng, chance(rng, 0.7) ? "FEMALE" : "MALE");
      const phone = sdt(30_000_000 + stt);

      // Trạng thái: đa số đang học; phần còn lại là ca biên để nghiệm thu chạm tới.
      const r = rng();
      const st: "ACTIVE" | "PAUSED" | "GRADUATED" | "INACTIVE" =
        r < 0.8 ? "ACTIVE" : r < 0.88 ? "PAUSED" : r < 0.94 ? "GRADUATED" : "INACTIVE";

      // Cứ 8 em thì 1 em dùng chung phụ huynh với em liền trước (anh chị em ruột)
      // — màn "một phụ huynh nhiều con" và cổng phụ huynh cần ca này.
      const anhChiEm = i > 1 && i % 8 === 0;
      const phoneDung = anhChiEm ? sdt(30_000_000 + stt - 1) : phone;

      // 3 em đầu của CS1 gắn thẳng vào tài khoản `uat.phuhuynh` để cổng phụ huynh
      // có dữ liệu ngay khi đăng nhập.
      const laConUat = cs.key === "CS1" && i <= 3;
      let parentUserId: string | null = laConUat ? uat.phuhuynh.id : null;

      if (!laConUat && !anhChiEm && chance(rng, 0.55)) {
        const pid = uid("ph", cs.code, i);
        parents.push({
          id: pid,
          email: `ph.uat.${cs.code.toLowerCase()}.${i}@example.com`,
          name: tenPh,
          phone: phoneDung,
          role: "PARENT",
          roles: ["PARENT"],
          isActive: true,
          accountStatus: "ACTIVE",
          centerId: cs.centerId,
        });
        parentUserId = pid;
      }

      students.push({
        id: hvId,
        name: ten,
        studentCode: `${cs.code}.HV.${String(i).padStart(4, "0")}`,
        dateOfBirth: ngaySinh(rng, 6, 14),
        gender: gt,
        currentGrade: int(rng, 1, 9),
        school: pick(rng, TRUONG),
        parentName: anhChiEm ? "" : tenPh,
        parentPhone: phoneDung,
        parentEmail: chance(rng, 0.5) ? `ph.uat.${cs.code.toLowerCase()}.${i}@example.com` : null,
        parentRelation: chance(rng, 0.7) ? "Mẹ" : "Bố",
        district: pick(rng, QUAN),
        city: "Đà Nẵng",
        address: `${int(rng, 1, 300)} ${pick(rng, ["Nguyễn Hữu Thọ", "Hoàng Diệu", "Lê Duẩn", "Trần Phú", "Núi Thành"])}`,
        status: st,
        centerId: cs.centerId,
        parentUserId,
        enrollmentDate: ngay(-int(rng, 5, 300)),
        classGroupId: chance(rng, 0.5) ? uid("cgroup", cs.code, int(rng, 1, 4)) : null,
        createdAt: ngay(-int(rng, 5, 300)),
      });
      hvTheoCoSo[cs.key]!.push({ id: hvId, name: ten, status: st });
    }
  }
  // Anh chị em dùng chung SĐT thì lấy tên phụ huynh của em liền trước.
  for (let i = 0; i < students.length; i++) {
    if (students[i]!.parentName === "") {
      students[i]!.parentName = String(students[i - 1]?.parentName ?? "Phụ huynh");
      students[i]!.parentUserId = students[i - 1]?.parentUserId ?? null;
    }
  }

  const nParent = await taoThieu(
    parents,
    (ids) => db.user.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.user.createMany({ data, skipDuplicates: true }),
  );
  const nHv = await taoThieu(
    students,
    (ids) => db.student.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.student.createMany({ data, skipDuplicates: true }),
  );
  xong("Học viên", { phụ_huynh: nParent, học_viên: nHv });

  // ── Lớp ────────────────────────────────────────────────────────────────────
  buoc("Lớp học");
  type LopInfo = {
    id: string; cs: CoSo; courseId: string; soBuoi: number; status: string;
    batDau: number; slot: (typeof THU_HOC)[number]; max: number; giaKhoa: number;
  };
  const lops: CoId<Prisma.ClassCreateManyInput>[] = [];
  const lopInfo: LopInfo[] = [];

  for (const cs of coSo) {
    for (let i = 1; i <= SO_LOP; i++) {
      const id = uid("lop", cs.code, i);
      const khoa = pick(rng, khoaDay);
      const slot = pick(rng, THU_HOC);
      const max = pick(rng, [10, 12, 14, 16]);

      // Phân bố trạng thái: đang dạy · đã xong · tuyển sinh · lên kế hoạch · chờ duyệt · huỷ
      const r = i / SO_LOP;
      const status: "ACTIVE" | "COMPLETED" | "RECRUITING" | "PLANNED" | "PENDING_APPROVAL" | "CANCELLED" =
        r <= 0.3 ? "ACTIVE" : r <= 0.54 ? "COMPLETED" : r <= 0.74 ? "RECRUITING"
        : r <= 0.9 ? "PLANNED" : r <= 0.96 ? "PENDING_APPROVAL" : "CANCELLED";

      // Lớp đang dạy: khai giảng trong quá khứ. Lớp đã xong: xa hơn nữa.
      const batDau =
        status === "COMPLETED" ? -int(rng, 130, 220)
        : status === "ACTIVE" ? -int(rng, 15, 70)
        : status === "RECRUITING" ? int(rng, 5, 30)
        : int(rng, 20, 90);

      lops.push({
        id,
        classCode: `${cs.code}.${khoa.slug.toUpperCase().slice(0, 6)}.${String(i).padStart(3, "0")}`,
        name: `${khoa.name} — ${slot.label} (${cs.code}.${String(i).padStart(2, "0")})`,
        courseId: khoa.id,
        centerId: cs.centerId,
        classGroupId: uid("cgroup", cs.code, int(rng, 1, 4)),
        teacherId: cs.key === "CS1" ? uat.giaovien.id : null,
        roomId: null,
        schedule: slot.label,
        // Khai THỨ HỌC thật. Thiếu cột này thì không màn nào đối chiếu được nhãn lớp
        // ("T7 sáng") với ngày buổi học, và lệch nằm im (QA vòng 1, BUG-033).
        scheduleDays: slot.days,
        startTime: slot.gio,
        endTime: slot.het,
        startDate: ngay(batDau),
        endDate: ngay(batDau + khoa.sessions * 7),
        maxStudents: max,
        minStudents: 6,
        status,
        isActive: status === "ACTIVE" || status === "RECRUITING",
        approvedAt: ["ACTIVE", "COMPLETED"].includes(status) ? ngay(batDau - 3) : null,
        approvedByName: ["ACTIVE", "COMPLETED"].includes(status) ? (uat.giamdoc.name ?? "Quản lý cơ sở") : null,
        submittedForApprovalAt: status === "PENDING_APPROVAL" ? ngay(-int(rng, 1, 10)) : null,
        createdAt: ngay(batDau - 10),
      });
      lopInfo.push({ id, cs, courseId: khoa.id, soBuoi: khoa.sessions, status, batDau, slot, max, giaKhoa: khoa.price });
    }
  }
  const nLop = await taoThieu(
    lops,
    (ids) => db.class.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.class.createMany({ data, skipDuplicates: true }),
  );
  xong("Lớp học", nLop);

  // ── Ghi danh ───────────────────────────────────────────────────────────────
  buoc("Ghi danh");
  const enrolls: CoId<Prisma.EnrollmentCreateManyInput>[] = [];
  const rosterTheoLop = new Map<string, { hvId: string; status: string }[]>();

  for (const lop of lopInfo) {
    if (["PLANNED", "PENDING_APPROVAL", "CANCELLED"].includes(lop.status)) continue;
    const pool = hvTheoCoSo[lop.cs.key]!;

    // Ca biên: ~1/8 lớp đang dạy được xếp ĐẦY để thử chặn gán thêm.
    const dayLop = lop.status === "ACTIVE" && chance(rng, 0.12);
    const siSo = dayLop ? lop.max
      : lop.status === "RECRUITING" ? int(rng, 1, 5)
      : int(rng, 6, Math.max(7, lop.max - 2));

    const chon = new Set<number>();
    while (chon.size < Math.min(siSo, pool.length)) chon.add(int(rng, 0, pool.length - 1));

    const roster: { hvId: string; status: string }[] = [];
    let k = 0;
    for (const idx of chon) {
      k += 1;
      const hv = pool[idx]!;
      const eid = uid("gd", lop.cs.code, lop.id.slice(-3), k);

      let est: Prisma.EnrollmentCreateManyInput["status"];
      if (lop.status === "COMPLETED") est = chance(rng, 0.12) ? "WITHDREW" : "COMPLETED";
      else if (lop.status === "RECRUITING") est = chance(rng, 0.5) ? "PENDING" : "CONFIRMED";
      else {
        // Lớp đang dạy. ⚠️ CỐ Ý cho ~35% mang `ACTIVE` — trạng thái mặc định của
        // schema, thứ hai đường convert lead sinh ra, và là ca đã lộ bug 21/08.
        const rr = rng();
        est = rr < 0.35 ? "ACTIVE" : rr < 0.78 ? "STUDYING" : rr < 0.88 ? "CONFIRMED"
          : rr < 0.95 ? "PAUSED" : "WITHDREW";
      }
      // Học viên đã nghỉ học mà ghi danh vẫn còn sống = đúng dữ liệu hỏng cũ.
      if (hv.status === "INACTIVE" && chance(rng, 0.5) && lop.status === "ACTIVE") est = "ACTIVE";

      const gia = lop.giaKhoa;
      const giam = chance(rng, 0.25) ? Math.round(gia * pick(rng, [0.05, 0.1, 0.15])) : 0;

      enrolls.push({
        id: eid,
        studentId: hv.id,
        classId: lop.id,
        courseId: lop.courseId,
        centerId: lop.cs.centerId,
        status: est,
        saleId: lop.cs.key === "CS1" ? uat.sale1.id : uat.sale2.id,
        listPrice: gia,
        discountAmount: giam,
        discountType: giam ? "PERCENT" : null,
        finalPrice: gia - giam,
        tuition: gia - giam,
        enrolledAt: ngay(lop.batDau - int(rng, 1, 20)),
        confirmedAt: est === "PENDING" ? null : ngay(lop.batDau - int(rng, 0, 5)),
        startedAt: ["STUDYING", "ACTIVE", "COMPLETED", "PAUSED"].includes(String(est)) ? ngay(lop.batDau) : null,
        endedAt: ["COMPLETED", "WITHDREW"].includes(String(est)) ? ngay(lop.batDau + lop.soBuoi * 7) : null,
      });
      roster.push({ hvId: hv.id, status: String(est) });
    }
    rosterTheoLop.set(lop.id, roster);
  }
  const nGd = await taoThieu(
    enrolls,
    (ids) => db.enrollment.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.enrollment.createMany({ data, skipDuplicates: true }),
  );
  xong("Ghi danh", nGd);

  // ── Buổi học ───────────────────────────────────────────────────────────────
  buoc("Buổi học");
  const buois: CoId<Prisma.ClassSessionCreateManyInput>[] = [];
  type BuoiInfo = { id: string; lop: LopInfo; lech: number; quaKhu: boolean; seq: number };
  const buoiInfo: BuoiInfo[] = [];

  // ── Dữ liệu BẨN có chủ đích (06/09/2026) ──────────────────────────────────
  // Seed cũ sinh ra một thế giới quá sạch: đo trên `satarobo_test` được 609/609 buổi có
  // `lessonId`, 0 buổi huỷ, 0 lớp có bài trùng, và `Lesson.order` khớp hạng-theo-ngày ở
  // CẢ 609 buổi. Nghĩa là cả ba nhóm lỗi hiển thị của cổng phụ huynh (số buổi lấy từ
  // `Lesson.order`, khử trùng theo bài, bỏ buổi chưa gắn giáo án — xem
  // lib/portal/buoi-hoc.ts) đều KHÔNG THỂ tái hiện khi nghiệm thu tay. Seed che đúng
  // những lỗi mà prod gặp.
  //
  // Nay cố ý gieo ba hình dạng CÓ THẬT trên prod:
  //   · lớp chưa ghim giáo trình  → mọi buổi `lessonId = null`;
  //   · huỷ buổi rồi xếp bù       → hai buổi cùng `lessonId`, buổi trước CANCELLED
  //                                 (đúng thứ `cancelSession` tạo ra);
  //   · giáo viên quên chấm       → buổi quá khứ không có dòng điểm danh nào.
  // Tỷ lệ nhỏ nên các màn khác vẫn còn nhiều lớp "đẹp" để nghiệm thu bình thường.
  const lopKhongGiaoTrinh = new Set<string>();
  const lopCoBuoiBu = new Set<string>();
  const buoiQuenCham = new Set<string>();

  for (const lop of lopInfo) {
    if (!["ACTIVE", "COMPLETED"].includes(lop.status)) continue;
    if (chance(rng, 0.12)) lopKhongGiaoTrinh.add(lop.id);
    else if (chance(rng, 0.18)) lopCoBuoiBu.add(lop.id);
    const lessons = lopKhongGiaoTrinh.has(lop.id) ? [] : nen.lessonIds[lop.courseId] ?? [];
    // Rải buổi ĐÚNG THỨ của lớp. Bản cũ cộng cứng 7 ngày một và bỏ qua `slot.days`,
    // trong khi TÊN lớp lại ghép từ `slot.label` — nên lớp "T7 sáng" có 14 buổi rơi
    // vào thứ Tư và 0 buổi vào thứ Bảy (QA vòng 1, BUG-033).
    const ngayBuoi = raiTheoThu(lop.batDau, lop.slot.days, lop.soBuoi);
    for (let s = 0; s < lop.soBuoi; s++) {
      const lech = ngayBuoi[s] ?? lop.batDau + s * 7;
      const quaKhu = lech < 0;
      const id = uid("buoi", lop.cs.code, lop.id.slice(-3), s + 1);
      // Buổi bị huỷ: chọn buổi thứ 3 của lớp được đánh dấu, và chỉ khi nó đã qua —
      // huỷ một buổi tương lai thì không tạo được ca "hai buổi cùng bài, buổi trước
      // đã huỷ" mà trang học viên hay nuốt.
      const biHuy = lopCoBuoiBu.has(lop.id) && s === 2 && quaKhu;
      buois.push({
        id,
        classId: lop.id,
        date: ngayGio(lech, Number(lop.slot.gio.slice(0, 2)), Number(lop.slot.gio.slice(3))),
        lessonId: lessons[s] ?? null,
        topic: `Buổi ${s + 1}`,
        centerId: lop.cs.centerId,
        status: biHuy ? "CANCELLED" : quaKhu ? "COMPLETED" : "SCHEDULED",
        completedAt: !biHuy && quaKhu ? ngayGio(lech, 20) : null,
        ckAttendance: !biHuy && quaKhu,
        ckLessonConfirmed: !biHuy && quaKhu,
        ckFeedback: !biHuy && quaKhu && chance(rng, 0.7),
        ckMedia: !biHuy && quaKhu && chance(rng, 0.5),
      });
      if (biHuy) {
        // Buổi BÙ — y hệt `cancelSession` (lib/classes/adjust.ts) tạo ra: cùng
        // `lessonId`, cùng `topic`, xếp SAU buổi cuối của lớp.
        const lechBu = (ngayBuoi[lop.soBuoi - 1] ?? lop.batDau + lop.soBuoi * 7) + 7;
        const idBu = uid("buoi", lop.cs.code, lop.id.slice(-3), "bu", s + 1);
        buois.push({
          id: idBu,
          classId: lop.id,
          date: ngayGio(lechBu, Number(lop.slot.gio.slice(0, 2)), Number(lop.slot.gio.slice(3))),
          lessonId: lessons[s] ?? null,
          topic: `Buổi ${s + 1}`,
          centerId: lop.cs.centerId,
          status: lechBu < 0 ? "COMPLETED" : "SCHEDULED",
          completedAt: lechBu < 0 ? ngayGio(lechBu, 20) : null,
          ckAttendance: lechBu < 0,
          ckLessonConfirmed: lechBu < 0,
        });
        buoiInfo.push({ id: idBu, lop, lech: lechBu, quaKhu: lechBu < 0, seq: lop.soBuoi + 1 });
        continue; // buổi đã huỷ KHÔNG vào buoiInfo: không điểm danh, không nhận xét
      }
      // Giáo viên quên chấm điểm danh — có thật, và là lý do phải có trạng thái
      // "Chưa điểm danh" riêng thay vì mặc định coi như có mặt.
      if (quaKhu && chance(rng, 0.05)) buoiQuenCham.add(id);
      buoiInfo.push({ id, lop, lech, quaKhu, seq: s + 1 });
    }
  }
  const nBuoi = await taoThieu(
    buois,
    (ids) => db.classSession.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.classSession.createMany({ data, skipDuplicates: true }),
  );
  xong("Buổi học", nBuoi);

  // ── Điểm danh + nhận xét buổi ──────────────────────────────────────────────
  buoc("Điểm danh + nhận xét buổi");
  const diemDanh: CoId<Prisma.AttendanceCreateManyInput>[] = [];
  const nhanXet: CoId<Prisma.StudentSessionFeedbackCreateManyInput>[] = [];

  for (const b of buoiInfo) {
    if (!b.quaKhu) continue;
    if (buoiQuenCham.has(b.id)) continue; // buổi giáo viên quên chấm — cố ý để trống
    // ⚠️ ĐỪNG chép tay danh sách status ở đây. Bản cũ là
    //     ["STUDYING", "ACTIVE", "COMPLETED", "PAUSED"]
    // — THIẾU "CONFIRMED", mà chính vòng sinh ghi danh phía trên lại tạo CONFIRMED ở
    // khoảng 10% mỗi lớp. Hệ quả trên UAT: cứ mỗi lớp có vài em KHÔNG BAO GIỜ có bản
    // ghi điểm danh nào, nên màn điểm danh luôn ở trạng thái "còn thiếu người" và
    // KHÔNG THỂ lưu (ràng buộc phải chấm đủ cả lớp). QA vòng 1 đọc ra thành BUG-004
    // "trạng thái dữ liệu này không tạo được qua giao diện" — đúng, vì nó do seed đẻ
    // ra chứ không phải do ứng dụng.
    // `ket-khoa` = đang học + đã hoàn thành, khớp đúng tập cần có bản ghi điểm danh.
    const rosterOk = new Set<string>(rosterStatuses("ket-khoa"));
    const roster = (rosterTheoLop.get(b.lop.id) ?? []).filter((r) =>
      rosterOk.has(r.status),
    );
    for (const [j, r] of roster.entries()) {
      const rr = rng();
      const st: Prisma.AttendanceCreateManyInput["status"] =
        rr < 0.86 ? "PRESENT" : rr < 0.92 ? "LATE" : rr < 0.97 ? "ABSENT_EXCUSED" : "ABSENT_UNEXCUSED";
      diemDanh.push({
        id: uid("dd", b.id.replace("uat-buoi-", ""), j),
        sessionId: b.id,
        studentId: r.hvId,
        status: st,
        centerId: b.lop.cs.centerId,
        absenceReason: st.startsWith("ABSENT") ? pick(rng, ["Con ốm", "Gia đình bận", "Đi du lịch", "Trùng lịch học thêm"]) : null,
        makeupStatus: st === "ABSENT_EXCUSED" && chance(rng, 0.5) ? "NEEDS_MAKEUP" : "NONE",
        createdAt: ngayGio(b.lech, 20),
      });
      // Nhận xét buổi: chỉ ~60% buổi quá khứ có phiếu (đúng đời thật, và để màn
      // "việc chưa xong" của giáo viên có cái để nhắc).
      if (chance(rng, 0.6) && st !== "ABSENT_UNEXCUSED") {
        nhanXet.push({
          id: uid("nx", b.id.replace("uat-buoi-", ""), j),
          classSessionId: b.id,
          studentId: r.hvId,
          comment: pick(rng, NHAN_XET),
          rating: int(rng, 3, 5),
          projectName: pick(rng, DU_AN),
          createdById: uat.giaovien.id,
          createdAt: ngayGio(b.lech, 20, 30),
        });
      }
    }
  }
  const nDd = await taoThieu(
    diemDanh,
    (ids) => db.attendance.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.attendance.createMany({ data, skipDuplicates: true }),
  );
  const nNx = await taoThieu(
    nhanXet,
    (ids) => db.studentSessionFeedback.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.studentSessionFeedback.createMany({ data, skipDuplicates: true }),
  );
  xong("Điểm danh", { điểm_danh: nDd, nhận_xét: nNx });

  return { lopInfo, buoiInfo, hvTheoCoSo, rosterTheoLop, enrolls };
}
