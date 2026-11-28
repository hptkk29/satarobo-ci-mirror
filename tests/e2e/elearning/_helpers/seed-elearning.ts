import { bamNoiDungBai } from "../../../../lib/elearning/ban-noi-dung";
import { db } from "../../../../lib/db";
// ⚠️ Import TĨNH. `await import("@/lib/...")` chết ở bộ nạp của Playwright với
// "Cannot use import statement outside a module" — nó biên dịch tệp spec chứ không
// cắm loader cho lượt nạp lúc chạy. Và đi đường DẪN TƯƠNG ĐỐI như dòng `db` ngay
// trên: bí danh `@/` tsc hiểu, nhưng bộ nạp lúc chạy thì chưa chắc.
import { ensureHandlersRegistered } from "../../../../lib/events/register";
import { dispatchPendingEvents } from "../../../../lib/events/dispatcher";
import { chayVongDoiChungNhan } from "../../../../lib/elearning/cron-cert-expiry";
import { onCapChungNhan } from "../../../../lib/elearning/_handlers/issue-certificate";
import {
  assertTestDb,
  seedOrg,
  seedRoles,
  seedUser,
} from "../../_helpers/seed";

/**
 * SEED cho e2e khu đào tạo nội bộ — dựng đủ một VÒNG HỌC THẬT.
 *
 * ⚠️ Helper này tồn tại vì hai spec e2e duy nhất của khu (`employee-gate`,
 * `host-routing`) đều là `fixme` — chúng được viết TRƯỚC phần hiện thực theo luật
 * Nền Hệ thống #5 và chưa ai gỡ. Tức job CI `e2e-elearning` chạy mỗi lần, xanh mỗi
 * lần, và **chưa từng mở một trang e-learning nào bằng trình duyệt**.
 *
 * Đó đúng là loại hỏng mà bản kiểm 27/08 phát hiện: mã chạy đúng, 6009 test đơn vị
 * xanh, mà không ai đi hết được một vòng — vì cái duy nhất kiểm được "đi hết vòng"
 * lại đang `fixme`.
 *
 * ⚠️ Mọi hàm ở đây gọi `assertTestDb()` trước khi ghi. Trỏ nhầm vào Supabase là mất
 * dữ liệu thật.
 */

const P = "E2E_EL_";
const HOC_VIEN_EMAIL = "e2e-el-hocvien@satarobo.vn";
const DAO_TAO_EMAIL = "e2e-el-daotao@satarobo.vn";
export const KHONG_HO_SO_EMAIL = "e2e-el-khonghoso@satarobo.vn";
export const DA_NGHI_EMAIL = "e2e-el-danghi@satarobo.vn";

export type BoDuLieu = {
  hocVienEmail: string;
  hocVienId: string;
  daoTaoEmail: string;
  daoTaoId: string;
  courseId: string;
  enrollmentId: string;
  baiDocId: string;
  baiBuoiId: string;
  assignmentId: string;
};

/** Xoá sạch dữ liệu của chính bộ e2e này — KHÔNG đụng dữ liệu khác. */
export async function donDuLieuCu(): Promise<void> {
  assertTestDb();
  // Vai gán tay của hai tài khoản e2e — dọn trước, nếu không lần chạy sau upsert
  // vào một `orgUnitId` cũ đã bị `seedOrg` dựng lại với id khác.
  const cu = await db.user.findMany({
    where: {
      email: {
        in: [HOC_VIEN_EMAIL, DAO_TAO_EMAIL, KHONG_HO_SO_EMAIL, DA_NGHI_EMAIL],
      },
    },
    select: { id: true },
  });
  if (cu.length > 0) {
    const ids = cu.map((u) => u.id);
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    // ⚠️ Phải xoá cả DÒNG XÁC NHẬN CHÍNH SÁCH. Nó nằm ngoài mọi bản ghi có tiền tố
    // `E2E_EL_`, nên vòng dọn theo tiền tố không chạm tới — và lần chạy thứ hai sẽ
    // thấy người học đã đồng ý sẵn, tức ca "cổng đồng ý chặn người mới" xanh giả:
    // xanh vì cổng không còn chặn, chứ không phải vì cổng đúng.
    await db.trnPolicyAcceptance.deleteMany({ where: { userId: { in: ids } } });
  }
  // Xoá theo THỨ TỰ PHỤ THUỘC, con trước cha. Xoá ngược là va khoá ngoại và cả
  // hàm dừng giữa chừng, để lại một nửa dữ liệu cũ cho lần chạy sau.
  const khoa = await db.trnCourse.findMany({
    where: { code: { startsWith: P } },
    select: { id: true },
  });
  const ids = khoa.map((k) => k.id);
  if (ids.length > 0) {
    const bai = await db.trnLesson.findMany({
      where: { module: { courseId: { in: ids } } },
      select: { id: true },
    });
    const baiIds = bai.map((b) => b.id);
    // Lượt thi + câu trả lời của khoá chuyển-bài (xem `dungKhoaChuyenBai`) — con trước cha, và TRƯỚC khi xoá bài vì bài QUIZ trỏ đề.
    await db.trnExamAnswer.deleteMany({ where: { attempt: { exam: { title: { startsWith: P } } } } });
    await db.trnExamAttempt.deleteMany({ where: { exam: { title: { startsWith: P } } } });
    await db.trnLessonProgress.deleteMany({ where: { lessonId: { in: baiIds } } });
    await db.trnSubmission.deleteMany({ where: { lessonId: { in: baiIds } } });
    await db.trnReminder.deleteMany({
      where: { enrollment: { courseId: { in: ids } } },
    });
    await db.trnCertificate.deleteMany({ where: { courseId: { in: ids } } });
    await db.trnEnrollment.deleteMany({ where: { courseId: { in: ids } } });
    await db.trnCourseVersionLesson.deleteMany({
      where: { version: { courseId: { in: ids } } },
    });
    await db.trnCourseVersion.deleteMany({ where: { courseId: { in: ids } } });
    await db.trnLesson.deleteMany({ where: { id: { in: baiIds } } });
    await db.trnModule.deleteMany({ where: { courseId: { in: ids } } });
    await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
    await db.trnCourse.deleteMany({ where: { id: { in: ids } } });
  }
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: P } } });
}

/**
 * Dựng: 2 tài khoản (người học + Đào tạo) có hồ sơ nhân sự ACTIVE · 1 khoá đã xuất
 * bản với 1 bài ĐỌC bắt buộc + 1 bài BUỔI TRỰC TIẾP bắt buộc · 1 lượt giao · 1 lượt
 * ghi danh.
 *
 * ⚠️ Hồ sơ nhân sự là BẮT BUỘC, không phải chi tiết: layout khu chặn mọi tài khoản
 * không có `Employee` ACTIVE (QĐ-CDA-10). Thiếu nó thì spec đỏ ở trang từ chối, và
 * người đọc sẽ đi tìm lỗi ở chỗ khác.
 */
export async function dungVongHoc(): Promise<BoDuLieu> {
  assertTestDb();
  await donDuLieuCu();

  // ⚠️ PHẢI seed cây đơn vị THẬT và gán vai — không bịa `centerId` cho xong.
  //
  // Lần đầu viết helper này tôi đặt một chuỗi bịa (`"e2e-el-cs"`) — không trỏ
  // vào `Center` nào. Kết quả: trang chủ render đúng, nav đúng, nhưng danh sách khoá
  // RỖNG — `TrnEnrollment` nằm trong `SCOPED_MODELS` và KHÔNG phải
  // `NULL_IS_GLOBAL`, nên `scopedDb` lọc sạch với một actor không thấy cơ sở nào.
  //
  // Đúng một lỗi mà e2e sinh ra để bắt: mọi test đơn vị vẫn xanh vì chúng truyền
  // `db` giả, còn người thật thì mở ra thấy trang trống.
  await seedOrg(["HO", "CS1"]);
  await seedRoles();
  const cs1 = await db.orgUnit.findUniqueOrThrow({
    where: { code: "CS1" },
    select: { id: true, centerId: true },
  });
  if (!cs1.centerId) throw new Error("seedOrg không gắn Center cho CS1");

  const hocVien = await seedUser({
    email: HOC_VIEN_EMAIL,
    name: "E2E Người học",
    role: "TEACHER",
  });
  const daoTao = await seedUser({
    email: DAO_TAO_EMAIL,
    name: "E2E Đào tạo",
    role: "TRAINING",
  });

  // ⚠️ Quan hệ đi từ phía `User.employeeId`, KHÔNG phải `Employee.userAccountId`:
  // `Employee.userAccount` là quan hệ NGƯỢC (`@relation("UserEmployee")`), không có
  // cột. Nối sai chiều thì hồ sơ tạo ra nhưng tài khoản vẫn không có hồ sơ, và cổng
  // layout từ chối — spec đỏ ở một trang không liên quan tới thứ đang kiểm.
  for (const { u, ma } of [
    { u: hocVien, ma: `${P}HV` },
    { u: daoTao, ma: `${P}DT` },
  ]) {
    const nv = await db.employee.upsert({
      where: { employeeCode: ma },
      update: {
        isActive: true,
        status: "ACTIVE",
        centerId: cs1.centerId,
        orgUnitId: cs1.id,
      },
      create: {
        employeeCode: ma,
        fullName: `E2E ${ma}`,
        jobTitle: "Nhân viên",
        department: "DAO_TAO",
        isActive: true,
        status: "ACTIVE",
        // ⚠️ PHẢI gắn cơ sở. `Employee` nằm trong `SCOPED_MODELS` và KHÔNG phải
        // `NULL_IS_GLOBAL`, nên hồ sơ `centerId = null` TÀNG HÌNH với mọi người xem
        // cấp cơ sở — ma trận đào tạo render đẹp nhưng thiếu hẳn người, không lỗi nào.
        //
        // (Trên prod `centerId = null` là nhân sự Hội sở, thiết kế đúng — nhưng bộ
        // e2e này dựng người của CS1, nên để null là mô tả sai việc thật.)
        centerId: cs1.centerId,
        orgUnitId: cs1.id,
      },
      select: { id: true },
    });
    await db.user.update({
      where: { id: u.id },
      data: { employeeId: nv.id, centerId: cs1.centerId },
    });
  }

  // Gán vai tại CS1 để `buildActor` cho ra `visibleCenterIds = [CS1]`. Không có
  // dòng này thì actor không thấy cơ sở nào và mọi lượt đọc scoped trả về rỗng.
  for (const { u, vai } of [
    { u: hocVien, vai: "TEACHER" },
    { u: daoTao, vai: "TRAINING" },
  ]) {
    const rd = await db.roleDef.findUnique({
      where: { code: vai },
      select: { id: true },
    });
    if (!rd) continue;
    await db.userOrgRole.upsert({
      where: {
        userId_orgUnitId_roleId: {
          userId: u.id,
          orgUnitId: cs1.id,
          roleId: rd.id,
        },
      },
      update: { status: "ACTIVE" },
      create: {
        userId: u.id,
        orgUnitId: cs1.id,
        roleId: rd.id,
        status: "ACTIVE",
        // Cột NOT NULL: mọi lần gán vai phải ghi AI gán. Trong e2e thì chính người
        // được gán — không có người thứ ba nào trong kịch bản.
        grantedById: u.id,
      },
    });
  }

  const khoa = await db.trnCourse.create({
    data: {
      code: `${P}KHOA`,
      slug: `${P.toLowerCase()}khoa`,
      title: "E2E Khoá an toàn lao động",
      status: "PUBLISHED",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
    },
    select: { id: true },
  });

  const chuong = await db.trnModule.create({
    data: { courseId: khoa.id, title: "Chương 1", orderIndex: 0 },
    select: { id: true },
  });

  const baiDoc = await db.trnLesson.create({
    data: {
      moduleId: chuong.id,
      title: "Bài đọc mở đầu",
      kind: "READ",
      orderIndex: 0,
      contentMd: "Nội dung bài đọc dùng cho e2e. ".repeat(40),
      minReadSeconds: 1,
    },
    select: { id: true },
  });

  const baiBuoi = await db.trnLesson.create({
    data: {
      moduleId: chuong.id,
      title: "Buổi thực hành tại xưởng",
      kind: "LIVE_SESSION",
      orderIndex: 1,
    },
    select: { id: true },
  });

  // ⚠️ Cờ "bài bắt buộc" nằm trên BẢN CHỐT PHIÊN BẢN, không trên chính bài. Thiếu
  // bản chốt thì `cuonTienDoKhoa` đếm 0 bài bắt buộc và khoá không bao giờ hoàn
  // thành — một spec đỏ mà nguyên nhân nằm cách đó ba tệp.
  const phienBan = await db.trnCourseVersion.create({
    data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED" },
    select: { id: true },
  });
  await db.trnCourseVersionLesson.createMany({
    data: [
      {
        versionId: phienBan.id,
        lessonId: baiDoc.id,
        required: true,
        orderIndex: 0,
        // `contentHash` ghim nội dung tại thời điểm chốt phiên bản (BR-013). Trong
        // e2e chỉ cần một giá trị ổn định.
        contentHash: "e2e-hash-doc",
      },
      {
        versionId: phienBan.id,
        lessonId: baiBuoi.id,
        required: true,
        orderIndex: 1,
        contentHash: "e2e-hash-buoi",
      },
    ],
  });

  const luotGiao = await db.trnAssignment.create({
    data: {
      title: `${P}Giao khoá an toàn`,
      // ⚠️ `TrnAssignment` trỏ nội dung bằng CẶP `contentType` + `contentId` (cột
      // trần, ba đích có thể là bài/khoá/lộ trình) — không có cột `courseId`.
      contentType: "COURSE",
      contentId: khoa.id,
      audienceMode: "STATIC",
      status: "ACTIVE",
      allowLate: true,
      // Luật hoàn thành: cột NOT NULL. E2E dùng luật mặc định "xong mọi bài bắt buộc".
      completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" },
      centerId: cs1.centerId,
      orgUnitId: cs1.id,
      createdByUserId: daoTao.id,
    },
    select: { id: true },
  });

  const han = new Date(Date.now() + 30 * 86_400_000);
  const ghiDanh = await db.trnEnrollment.create({
    data: {
      courseId: khoa.id,
      userId: hocVien.id,
      assignmentId: luotGiao.id,
      cycle: 1,
      status: "NOT_STARTED",
      dueAt: han,
      dueAtOriginal: han,
      centerId: cs1.centerId,
      orgUnitId: cs1.id,
      source: "ASSIGNMENT",
      // ⚠️ Ảnh chụp tại thời điểm giao — báo cáo đọc CỘT NÀY, không join sống sang
      // `Employee`. Join sống thì một lần chuyển phòng ban sẽ ĐỔI HỒI TỐ mọi báo cáo
      // cũ, và không ai giải thích được vì sao bản in lại ra số khác.
      snapJobTitle: "Nhân viên",
    },
    select: { id: true },
  });

  return {
    hocVienEmail: HOC_VIEN_EMAIL,
    hocVienId: hocVien.id,
    daoTaoEmail: DAO_TAO_EMAIL,
    daoTaoId: daoTao.id,
    courseId: khoa.id,
    enrollmentId: ghiDanh.id,
    baiDocId: baiDoc.id,
    baiBuoiId: baiBuoi.id,
    assignmentId: luotGiao.id,
  };
}

/** Dòng tiến độ của MỘT bài trong MỘT lượt — để khẳng định server đã nhận nhịp đo (`null` = chưa có dòng nào). */
export async function tienDoBai(enrollmentId: string, lessonId: string) {
  return db.trnLessonProgress.findUnique({
    where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
    select: { readSeconds: true, status: true },
  });
}

/** Trạng thái lượt ghi danh — để khẳng định vòng đã KHÉP ở tầng dữ liệu. */
export async function trangThaiGhiDanh(enrollmentId: string) {
  return db.trnEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { status: true, progressPercent: true, startedAt: true },
  });
}

/**
 * Hai tài khoản cho cổng hồ sơ nhân sự (EL-01 · AC8–AC9).
 *
 * Tách khỏi `dungVongHoc()` vì chúng phải KHÔNG qua được cổng — trộn vào bộ vòng học
 * thì mỗi lần dựng lại phải nhớ chừa chúng ra, và quên một lần là cổng mất test.
 *
 * ⚠️ Gọi SAU `dungVongHoc()`: hàm này không tự dọn, còn `donDuLieuCu()` bên trong
 * `dungVongHoc()` thì có xoá hai tài khoản này.
 */
export async function dungTaiKhoanNgoaiCong(): Promise<{
  khongHoSoEmail: string;
  daNghiEmail: string;
}> {
  assertTestDb();

  // (a) Có tài khoản staff hợp lệ nhưng KHÔNG có dòng `Employee` nào.
  await seedUser({
    email: KHONG_HO_SO_EMAIL,
    name: "E2E Không hồ sơ",
    role: "TEACHER",
  });

  // (b) CÓ hồ sơ nhưng đã nghỉ. Đây là đường THU HỒI truy cập khi có người nghỉ
  // việc — đo prod 20/08/2026: 0 bản ghi RESIGNED, 0 TERMINATED, tức đường này
  // chưa từng chạy thật. Dựng cả `isActive: false` lẫn `status: "RESIGNED"` vì cổng
  // đòi CẢ HAI đúng mới cho qua; kiểm một cột thì nửa còn lại không ai canh.
  const nghi = await seedUser({
    email: DA_NGHI_EMAIL,
    name: "E2E Đã nghỉ",
    role: "TEACHER",
  });
  const hoSo = await db.employee.upsert({
    where: { employeeCode: `${P}NGHI` },
    update: { isActive: false, status: "RESIGNED" },
    create: {
      employeeCode: `${P}NGHI`,
      fullName: "E2E Đã nghỉ",
      jobTitle: "Nhân viên",
      department: "DAO_TAO",
      isActive: false,
      status: "RESIGNED",
    },
    select: { id: true },
  });
  await db.user.update({
    where: { id: nghi.id },
    data: { employeeId: hoSo.id },
  });

  return { khongHoSoEmail: KHONG_HO_SO_EMAIL, daNghiEmail: DA_NGHI_EMAIL };
}

/**
 * Chạy hàng đợi sự kiện rồi trả về chứng nhận của lượt ghi danh (EL-16).
 *
 * ⚠️ Gọi `dispatchPendingEvents` THẬT chứ không gọi thẳng handler: phần dễ hỏng
 * nhất của đường này không nằm trong handler mà ở chỗ NỐI — sự kiện có được phát
 * không, handler có được đăng ký không. Gọi thẳng handler là bỏ qua đúng hai mắt
 * xích đó, và cả hai đều đã từng đứt trong module này.
 */
export async function chungNhanCuaLuot(enrollmentId: string) {
  assertTestDb();
  ensureHandlersRegistered();
  // ⚠️ `flagOn: true` TƯỜNG MINH, và kiểm kết quả.
  //
  // `dispatchPendingEvents` trả `{ skipped: true }` rồi im nếu cờ tắt. Không ép cờ
  // và không kiểm thì test xanh vì KHÔNG CÓ GÌ CHẠY — đúng kiểu xanh giả đã để job
  // `e2e-elearning` chạy hàng tháng mà chưa từng mở một trang nào.
  const kq = await dispatchPendingEvents({ batchSize: 50, flagOn: true });
  if ("skipped" in kq && kq.skipped) throw new Error("hàng đợi sự kiện bị bỏ qua");
  return db.trnCertificate.findUnique({
    where: { enrollmentId },
    select: {
      id: true,
      certCode: true,
      verifyToken: true,
      validUntil: true,
      status: true,
      snapFullName: true,
      snapEmployeeCode: true,
      courseVersionId: true,
    },
  });
}

/**
 * PHÁT LẠI sự kiện hoàn thành cho handler cấp chứng nhận — đúng thứ `dispatch-events` làm khi handler ném lỗi
 * giữa chừng và sự kiện được thử lại.
 *
 * ⚠️ `chungNhanCuaLuot` KHÔNG thay được hàm này: nó chạy hàng đợi, mà hàng đợi đã rỗng (sự kiện đã
 * PROCESSED) nên gọi lại là KHÔNG CHẠY handler nào — ca "chạy lại không cấp thêm" xanh vì không có gì chạy
 * (rà soát đối kháng 24/10/2026). Ở đây gọi THẲNG handler nhiều lần với cùng payload.
 */
export async function phatLaiSuKienHoanThanh(enrollmentId: string, soLan = 2): Promise<void> {
  assertTestDb();
  for (let i = 0; i < soLan; i++) {
    await onCapChungNhan({
      id: `e2e-replay-${enrollmentId}-${i}`,
      type: "elearning.enrollment.completed",
      payload: { enrollmentId },
    });
  }
}

/** Đếm chứng nhận của một lượt — dùng để kiểm chống trùng. */
/**
 * Số thông báo "được cấp chứng nhận" của MỘT chứng nhận cụ thể — đo đường nối handler → chuông.
 * Đếm theo `dedupeKey` đầy đủ (không theo tiền tố + người): các lượt chạy trước để lại thông báo của chứng nhận CŨ.
 */
export async function demThongBaoCapChungNhan(userId: string, certificateId: string): Promise<number> {
  assertTestDb();
  return db.staffNotification.count({ where: { userId, dedupeKey: `el.cap-cn:${certificateId}` } });
}

export async function demChungNhan(enrollmentId: string): Promise<number> {
  assertTestDb();
  return db.trnCertificate.count({ where: { enrollmentId } });
}

/** Đẩy hạn hiệu lực của chứng nhận về QUÁ KHỨ — để chạy được vòng hết hạn. */
export async function datHanChungNhan(
  enrollmentId: string,
  validUntil: Date,
): Promise<void> {
  assertTestDb();
  await db.trnCertificate.update({
    where: { enrollmentId },
    data: { validUntil, status: "VALID" },
  });
}

/** Chạy vòng đời hết hiệu lực (việc 5 của cron nhắc). */
export async function chayVongHetHan(now: Date) {
  assertTestDb();
  return chayVongDoiChungNhan(now, { nhacBat: true });
}

/** Đếm lượt ghi danh của một người trên một khoá — kiểm chống đẻ lượt trùng. */
export async function demLuotGhiDanh(
  userEmail: string,
  courseSlug: string,
): Promise<{ tong: number; vongCaoNhat: number }> {
  assertTestDb();
  const u = await db.user.findUnique({
    where: { email: userEmail },
    select: { id: true },
  });
  const k = await db.trnCourse.findUnique({
    where: { slug: courseSlug },
    select: { id: true },
  });
  if (!u || !k) return { tong: 0, vongCaoNhat: 0 };
  const ds = await db.trnEnrollment.findMany({
    where: { userId: u.id, courseId: k.id },
    select: { cycle: true },
  });
  return {
    tong: ds.length,
    vongCaoNhat: ds.reduce((m, x) => Math.max(m, x.cycle), 0),
  };
}

/** Trạng thái chứng nhận đọc thẳng từ DB. */
export async function trangThaiChungNhan(enrollmentId: string) {
  assertTestDb();
  return db.trnCertificate.findUnique({
    where: { enrollmentId },
    select: { status: true, validUntil: true, verifyToken: true },
  });
}

const MA_KHOA_CHUYEN_BAI = `${P}KHOA_CHUYEN_BAI`;

export type BoChuyenBai = {
  courseId: string;
  enrollmentId: string;
  baiDocAId: string;
  baiDocBId: string;
  baiDocCId: string;
  baiThiId: string;
  examId: string;
  tenBaiDocA: string;
  tenBaiDocC: string;
  tenBaiThi: string;
};

/**
 * Khoá THỨ HAI cho ca "đọc rồi chuyển bài nhanh": 3 bài ĐỌC (đủ dài để phải cuộn; mỗi ca dùng một bài riêng để ca nào cũng
 * xanh khi chạy một mình) + 1 bài KIỂM TRA hai câu trắc nghiệm.
 *
 * Tách khỏi `dungVongHoc()` để KHÔNG đổi các ca cũ (đếm khoá, hoàn thành khoá…): cả ba bài `required: false` nên luật hoàn
 * thành "xong mọi bài bắt buộc" của khoá chính không bị chạm, và khoá này được dọn ngay sau nhóm ca (`donKhoaChuyenBai`).
 * Gọi SAU `dungVongHoc()` (cần người học + cơ sở đã dựng).
 */
export async function dungKhoaChuyenBai(d: BoDuLieu): Promise<BoChuyenBai> {
  assertTestDb();
  await donKhoaChuyenBai();
  const ghiDanhChinh = await db.trnEnrollment.findUniqueOrThrow({
    where: { id: d.enrollmentId },
    select: { centerId: true, orgUnitId: true },
  });

  const khoa = await db.trnCourse.create({
    data: {
      code: MA_KHOA_CHUYEN_BAI,
      slug: MA_KHOA_CHUYEN_BAI.toLowerCase(),
      title: "E2E Khoá chuyển bài",
      status: "PUBLISHED",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
    },
    select: { id: true },
  });
  const chuong = await db.trnModule.create({
    data: { courseId: khoa.id, title: "Chương chuyển bài", orderIndex: 0 },
    select: { id: true },
  });

  // Đủ dài để KHÔNG vừa một màn hình 720px ⇒ "đã cuộn tới cuối" là hành động THẬT của người học, không đúng sẵn.
  const dai = "Đoạn nội dung dùng cho ca chuyển bài nhanh. ".repeat(220);
  const baiA = await db.trnLesson.create({
    data: { moduleId: chuong.id, title: "E2E Bài đọc A", kind: "READ", orderIndex: 0, contentMd: dai, minReadSeconds: 1 },
    select: { id: true },
  });
  const baiB = await db.trnLesson.create({
    data: { moduleId: chuong.id, title: "E2E Bài đọc B", kind: "READ", orderIndex: 1, contentMd: dai, minReadSeconds: 1 },
    select: { id: true },
  });

  const baiC = await db.trnLesson.create({
    data: { moduleId: chuong.id, title: "E2E Bài đọc C", kind: "READ", orderIndex: 3, contentMd: dai, minReadSeconds: 1 },
    select: { id: true },
  });

  const cau = (i: number) => ({ id: `q-${i}`, type: "single", question: `Câu ${i}`, options: ["A", "B"], correctIndex: 1 });
  const q1 = await db.trnQuestion.create({
    data: { bankPath: `${P}chuyen-bai`, type: "SINGLE", stem: "E2E Câu một: chọn B", contentJson: cau(1), defaultPoints: 1 },
    select: { id: true },
  });
  const q2 = await db.trnQuestion.create({
    data: { bankPath: `${P}chuyen-bai`, type: "SINGLE", stem: "E2E Câu hai: chọn B", contentJson: cau(2), defaultPoints: 1 },
    select: { id: true },
  });
  const de = await db.trnExam.create({
    data: { title: `${P}Đề chuyển bài`, durationMin: 30, passScore: 2, maxScore: 2, maxAttempts: 3, isActive: true },
    select: { id: true },
  });
  await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q1.id, orderIndex: 0, points: 1 } });
  await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q2.id, orderIndex: 1, points: 1 } });
  const baiThi = await db.trnLesson.create({
    data: { moduleId: chuong.id, title: "E2E Bài kiểm tra", kind: "QUIZ", orderIndex: 2, examId: de.id },
    select: { id: true },
  });

  const phienBan = await db.trnCourseVersion.create({
    data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED" },
    select: { id: true },
  });
  await db.trnCourseVersionLesson.createMany({
    data: [baiA, baiB, baiThi, baiC].map((b, i) => ({
      versionId: phienBan.id,
      lessonId: b.id,
      required: false,
      orderIndex: i,
      contentHash: `e2e-hash-chuyen-bai-${i}`,
    })),
  });

  const han = new Date(Date.now() + 30 * 86_400_000);
  const ghiDanh = await db.trnEnrollment.create({
    data: {
      courseId: khoa.id,
      userId: d.hocVienId,
      cycle: 1,
      status: "NOT_STARTED",
      dueAt: han,
      dueAtOriginal: han,
      centerId: ghiDanhChinh.centerId,
      orgUnitId: ghiDanhChinh.orgUnitId,
      source: "ASSIGNMENT",
      snapJobTitle: "Nhân viên",
    },
    select: { id: true },
  });

  return {
    courseId: khoa.id,
    enrollmentId: ghiDanh.id,
    baiDocAId: baiA.id,
    baiDocBId: baiB.id,
    baiDocCId: baiC.id,
    baiThiId: baiThi.id,
    examId: de.id,
    tenBaiDocA: "E2E Bài đọc A",
    tenBaiDocC: "E2E Bài đọc C",
    tenBaiThi: "E2E Bài kiểm tra",
  };
}

/** Dọn đúng khoá chuyển-bài (không đụng khoá chính của `dungVongHoc`). */
export async function donKhoaChuyenBai(): Promise<void> {
  assertTestDb();
  const khoa = await db.trnCourse.findUnique({ where: { code: MA_KHOA_CHUYEN_BAI }, select: { id: true } });
  if (khoa) {
    const bai = await db.trnLesson.findMany({ where: { module: { courseId: khoa.id } }, select: { id: true } });
    const baiIds = bai.map((b) => b.id);
    await db.trnLessonProgress.deleteMany({ where: { lessonId: { in: baiIds } } });
    await db.trnCertificate.deleteMany({ where: { courseId: khoa.id } });
    await db.trnReminder.deleteMany({ where: { enrollment: { courseId: khoa.id } } });
    await db.trnEnrollment.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: khoa.id } } });
    await db.trnCourseVersion.deleteMany({ where: { courseId: khoa.id } });
  }
  await db.trnExamAnswer.deleteMany({ where: { attempt: { exam: { title: { startsWith: `${P}Đề chuyển bài` } } } } });
  await db.trnExamAttempt.deleteMany({ where: { exam: { title: { startsWith: `${P}Đề chuyển bài` } } } });
  if (khoa) {
    await db.trnLesson.deleteMany({ where: { module: { courseId: khoa.id } } });
    await db.trnModule.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourse.delete({ where: { id: khoa.id } });
  }
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: `${P}Đề chuyển bài` } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: `${P}Đề chuyển bài` } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: `${P}chuyen-bai` } });
}

/** Đặt chính sách hiện đáp án của một đề — để e2e đo CẢ hai phía (chưa được xem / được xem). */
export async function datChinhSachXemDapAn(examId: string, policy: "NEVER" | "AFTER_EACH_ATTEMPT" | "AFTER_LAST_ATTEMPT"): Promise<void> {
  assertTestDb();
  await db.trnExam.update({ where: { id: examId }, data: { showAnswerPolicy: policy } });
}

/** Đặt thời gian giãn cách giữa hai lượt thi của một đề (giờ). 0 = không giãn cách. */
export async function datGianCachThi(examId: string, gio: number): Promise<void> {
  assertTestDb();
  await db.trnExam.update({ where: { id: examId }, data: { cooldownHours: gio } });
}

/** Ép kết quả đạt/chưa đạt của lượt NỘP gần nhất (để e2e đo cả hai phía của liên kết chứng nhận mà không phụ thuộc cách chấm). */
export async function datKetQuaLuotGanNhat(userId: string, examId: string, passed: boolean): Promise<void> {
  assertTestDb();
  const l = await db.trnExamAttempt.findFirst({ where: { userId, examId, status: { not: "IN_PROGRESS" } }, orderBy: { attemptNo: "desc" }, select: { id: true } });
  if (!l) throw new Error("chưa có lượt đã nộp");
  await db.trnExamAttempt.update({ where: { id: l.id }, data: { passed } });
}

/** Cấp một chứng nhận (còn hiệu lực) cho lượt học — mang `centerId/orgUnitId` của lượt (thiếu thì `scopedDb` ẩn nó). Trả số hiệu. */
export async function capChungNhanThu(enrollmentId: string): Promise<string> {
  assertTestDb();
  const e = await db.trnEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, select: { courseId: true, userId: true, centerId: true, orgUnitId: true } });
  const pb = (await db.trnCourseVersion.findFirst({ where: { courseId: e.courseId }, select: { id: true } })) ?? (await db.trnCourseVersion.create({ data: { courseId: e.courseId, major: 9, minor: 0, status: "PUBLISHED" }, select: { id: true } }));
  const certCode = `${P}CNKT-${enrollmentId.slice(-6)}`;
  await db.trnCertificate.create({
    data: { certCode, verifyToken: certCode.toLowerCase(), userId: e.userId, courseId: e.courseId, courseVersionId: pb.id, enrollmentId, status: "VALID", snapFullName: "E2E", snapEmployeeCode: "NV", centerId: e.centerId, orgUnitId: e.orgUnitId },
  });
  return certCode;
}

export async function goChungNhanThu(enrollmentId: string): Promise<void> {
  assertTestDb();
  await db.trnCertificate.deleteMany({ where: { enrollmentId } });
}

/** Lượt thi của một người trên một đề (mới nhất) — kèm câu trả lời đã lưu, để khẳng định trạng thái làm bài KHÔNG mất. */
export async function luotThiCua(userId: string, examId: string) {
  assertTestDb();
  return db.trnExamAttempt.findFirst({
    where: { userId, examId },
    orderBy: { attemptNo: "desc" },
    select: {
      status: true,
      attemptNo: true,
      answers: { select: { selectedChoiceIds: true, examQuestion: { select: { orderIndex: true } } } },
    },
  });
}

// ── P2: dữ liệu cho ba tab "Khoá của tôi" ─────────────────────────────────────────────────────────────────────────────
const MA_KHOA_TAB = `${P}TAB`;

export type BoKhoaTheoTab = {
  tenQuaHan: string;
  tenDaXong: string;
  tenCanLam: string;
  /** Lượt "đã xong" — có gia hạn (dueAt > dueAtOriginal) kèm lý do và ngày hoàn thành. */
  enrollmentDaXongId: string;
};

/**
 * Hai khoá thêm cho người học: MỘT quá hạn (dueAt quá khứ), MỘT đã xong. Khoá chính của `dungVongHoc()` (NOT_STARTED, hạn
 * tương lai) là khoá "cần làm". Gọi SAU `dungVongHoc()`; dọn bằng `donKhoaTheoTab()`.
 */
export async function dungKhoaTheoTab(d: BoDuLieu): Promise<BoKhoaTheoTab> {
  assertTestDb();
  await donKhoaTheoTab();
  const chinh = await db.trnEnrollment.findUniqueOrThrow({
    where: { id: d.enrollmentId },
    select: { centerId: true, orgUnitId: true, courseId: true },
  });
  const tenChinh = await db.trnCourse.findUniqueOrThrow({ where: { id: chinh.courseId }, select: { title: true } });
  const mot = async (hau: string, ten: string, status: "OVERDUE" | "COMPLETED", dueAt: Date, tienDo: number): Promise<string> => {
    const khoa = await db.trnCourse.create({
      data: {
        code: `${MA_KHOA_TAB}_${hau}`,
        slug: `${MA_KHOA_TAB}_${hau}`.toLowerCase(),
        title: ten,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const chuong = await db.trnModule.create({ data: { courseId: khoa.id, title: "Chương", orderIndex: 0 }, select: { id: true } });
    const bai = await db.trnLesson.create({
      data: { moduleId: chuong.id, title: `${ten} — bài 1`, kind: "READ", orderIndex: 0, contentMd: "Nội dung.", minReadSeconds: 1 },
      select: { id: true },
    });
    const gd = await db.trnEnrollment.create({
      data: {
        courseId: khoa.id,
        userId: d.hocVienId,
        cycle: 1,
        status,
        dueAt,
        dueAtOriginal: status === "COMPLETED" ? new Date(dueAt.getTime() - 14 * 86_400_000) : dueAt,
        extensionReason: status === "COMPLETED" ? "Sự cố hệ thống ngày 01/11" : null,
        progressPercent: tienDo,
        completedAt: status === "COMPLETED" ? new Date(Date.now() - 3 * 86_400_000) : null,
        centerId: chinh.centerId,
        orgUnitId: chinh.orgUnitId,
        source: "ASSIGNMENT",
        snapJobTitle: "Nhân viên",
      },
      select: { id: true },
    });
    // Bài đã có ghi nhận tiến độ ⇒ "Dữ liệu của tôi" có dòng để đo (đọc 150 giây, cuộn 100%).
    if (status === "COMPLETED") {
      await db.trnLessonProgress.create({
        data: { enrollmentId: gd.id, userId: d.hocVienId, lessonId: bai.id, status: "DONE", readSeconds: 150, scrollMaxPct: 100, verifiedAt: new Date() },
      });
    }
    return gd.id;
  };
  await mot("QH", "E2E Khoá đã quá hạn", "OVERDUE", new Date(Date.now() - 5 * 86_400_000), 20);
  const daXongId = await mot("DX", "E2E Khoá đã hoàn thành", "COMPLETED", new Date(Date.now() + 10 * 86_400_000), 100);
  return { tenQuaHan: "E2E Khoá đã quá hạn", tenDaXong: "E2E Khoá đã hoàn thành", tenCanLam: tenChinh.title, enrollmentDaXongId: daXongId };
}

/** Đồng ý chính sách theo dõi thay người học (đường e2e KHÔNG đo cổng này — `vong-hoc` đã đo). Dọn bởi `donDuLieuCu()`. */
export async function chapNhanChinhSach(userId: string): Promise<void> {
  assertTestDb();
  await db.trnPolicyAcceptance.upsert({
    where: { userId_policyKey_policyVersion: { userId, policyKey: "elearning.learning-tracking", policyVersion: process.env.ELEARNING_POLICY_VERSION?.trim() || "v1" } },
    update: { revokedAt: null },
    create: { userId, policyKey: "elearning.learning-tracking", policyVersion: process.env.ELEARNING_POLICY_VERSION?.trim() || "v1" },
  });
}

/** Giảng viên (Đào tạo) tick "đã dự" cho người học ở một bài — dựng đúng DẤU mà màn người học đọc. */
export async function danhDauDiemDanh(o: { enrollmentId: string; lessonId: string; userId: string; giangVienId: string }): Promise<void> {
  assertTestDb();
  await db.trnLessonProgress.upsert({
    where: { enrollmentId_lessonId: { enrollmentId: o.enrollmentId, lessonId: o.lessonId } },
    update: { status: "DONE", attendanceMarkedByUserId: o.giangVienId, attendanceMarkedAt: new Date() },
    create: { enrollmentId: o.enrollmentId, userId: o.userId, lessonId: o.lessonId, status: "DONE", attendanceMarkedByUserId: o.giangVienId, attendanceMarkedAt: new Date() },
  });
}

export async function xoaDiemDanh(enrollmentId: string, lessonId: string): Promise<void> {
  assertTestDb();
  await db.trnLessonProgress.deleteMany({ where: { enrollmentId, lessonId } });
}

export type BoThongBao = { tieuDeChuaDoc: string; tieuDeDaDoc: string };

/** Hai thông báo cho người học: một CHƯA đọc, một ĐÃ đọc. Dọn bằng `donKhoaTheoTab()` (theo tiền tố dedupeKey). */
export async function dungThongBaoTheoTab(d: BoDuLieu): Promise<BoThongBao> {
  assertTestDb();
  await db.staffNotification.deleteMany({ where: { userId: d.hocVienId, dedupeKey: { startsWith: `${P}TB:` } } });
  const tieuDeChuaDoc = "E2E thông báo chưa đọc";
  const tieuDeDaDoc = "E2E thông báo đã đọc";
  await db.staffNotification.create({
    data: { userId: d.hocVienId, category: "e2e", title: tieuDeChuaDoc, body: "Nội dung chưa đọc", dedupeKey: `${P}TB:1` },
  });
  await db.staffNotification.create({
    data: { userId: d.hocVienId, category: "e2e", title: tieuDeDaDoc, body: "Nội dung đã đọc", dedupeKey: `${P}TB:2`, readAt: new Date() },
  });
  return { tieuDeChuaDoc, tieuDeDaDoc };
}

export async function donKhoaTheoTab(): Promise<void> {
  assertTestDb();
  await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: `${P}TB:` } } });
  const khoa = await db.trnCourse.findMany({ where: { code: { startsWith: `${MA_KHOA_TAB}_` } }, select: { id: true } });
  const ids = khoa.map((k) => k.id);
  if (ids.length === 0) return;
  await db.trnReminder.deleteMany({ where: { enrollment: { courseId: { in: ids } } } });
  await db.trnCertificate.deleteMany({ where: { courseId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { courseId: { in: ids } } });
  await db.trnCourseVersion.deleteMany({ where: { courseId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { module: { courseId: { in: ids } } } });
  await db.trnModule.deleteMany({ where: { courseId: { in: ids } } });
  await db.trnCourse.deleteMany({ where: { id: { in: ids } } });
}

export type BoChungNhan = {
  /** Của người học, sắp hết hạn (15 ngày). */
  maSapHet: string;
  /** Của người học, khoá có lượt HỌC LẠI đang mở. */
  maHocLai: string;
  tenKhoaHocLai: string;
  enrollmentHocLaiId: string;
  /** Của NGƯỜI KHÁC (Đào tạo) — người học KHÔNG được xem. */
  maNguoiKhac: string;
  /** Mã tra cứu công khai (32 ký tự base64url) của chứng nhận `maSapHet`. */
  tokenCongKhai: string;
};

/** Chứng nhận cho `dungKhoaTheoTab`: gọi SAU nó. Dọn bằng `donKhoaTheoTab()`. */
export async function dungChungNhanTheoTab(d: BoDuLieu, k: BoKhoaTheoTab): Promise<BoChungNhan> {
  assertTestDb();
  const chinh = await db.trnEnrollment.findUniqueOrThrow({
    where: { id: d.enrollmentId },
    select: { centerId: true, orgUnitId: true },
  });
  const luotDX = await db.trnEnrollment.findUniqueOrThrow({
    where: { id: k.enrollmentDaXongId },
    select: { courseId: true },
  });
  const phienBan = await db.trnCourseVersion.create({
    data: { courseId: luotDX.courseId, major: 1, minor: 0, status: "PUBLISHED" },
    select: { id: true },
  });
  const lan = Date.now().toString(36).toUpperCase();
  const cert = (userId: string, enrollmentId: string, courseId: string, versionId: string, ma: string, ten: string, validUntil: Date | null) =>
    db.trnCertificate.create({
      data: {
        certCode: ma,
        // 32 ký tự base64url như `taoVerifyToken()` — trang xác minh công khai từ chối token sai định dạng.
        verifyToken: `e2e${lan}${ma.slice(-1)}`.padEnd(32, "x").slice(0, 32),
        userId,
        courseId,
        courseVersionId: versionId,
        enrollmentId,
        validUntil,
        status: "VALID",
        snapFullName: ten,
        snapEmployeeCode: "NV-E2E",
        // Chứng nhận thật luôn mang hai cột này; thiếu ⇒ `scopedDb` ẩn nó khỏi chính chủ.
        centerId: chinh.centerId,
        orgUnitId: chinh.orgUnitId,
      },
    });
  const maSapHet = `SR.CN.E2E.${lan}1`;
  await cert(d.hocVienId, k.enrollmentDaXongId, luotDX.courseId, phienBan.id, maSapHet, "Học Viên E2E", new Date(Date.now() + 15 * 86_400_000));

  // Chứng nhận của NGƯỜI KHÁC trên cùng khoá.
  const luotB = await db.trnEnrollment.create({
    data: {
      courseId: luotDX.courseId,
      userId: d.daoTaoId,
      cycle: 1,
      status: "COMPLETED",
      source: "ASSIGNMENT",
      centerId: chinh.centerId,
      orgUnitId: chinh.orgUnitId,
      snapJobTitle: "Đào tạo",
      progressPercent: 100,
      completedAt: new Date(),
    },
    select: { id: true },
  });
  const maNguoiKhac = `SR.CN.E2E.${lan}2`;
  await cert(d.daoTaoId, luotB.id, luotDX.courseId, phienBan.id, maNguoiKhac, "Đào Tạo E2E", null);

  // Khoá có lượt HỌC LẠI: lượt chu kỳ 1 đã xong + chứng nhận; lượt chu kỳ 2 đang mở.
  const tenKhoaHocLai = "E2E Khoá học lại";
  const khoaRL = await db.trnCourse.create({
    data: {
      code: `${MA_KHOA_TAB}_RL`,
      slug: `${MA_KHOA_TAB}_RL`.toLowerCase(),
      title: tenKhoaHocLai,
      status: "PUBLISHED",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
    },
    select: { id: true },
  });
  const pbRL = await db.trnCourseVersion.create({ data: { courseId: khoaRL.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
  const mk = (cycle: number, status: "COMPLETED" | "NOT_STARTED") =>
    db.trnEnrollment.create({
      data: {
        courseId: khoaRL.id,
        userId: d.hocVienId,
        cycle,
        status,
        dueAt: new Date(Date.now() + 40 * 86_400_000),
        dueAtOriginal: new Date(Date.now() + 40 * 86_400_000),
        completedAt: status === "COMPLETED" ? new Date(Date.now() - 86_400_000) : null,
        progressPercent: status === "COMPLETED" ? 100 : 0,
        centerId: chinh.centerId,
        orgUnitId: chinh.orgUnitId,
        source: "ASSIGNMENT",
        snapJobTitle: "Nhân viên",
      },
      select: { id: true },
    });
  const luot1 = await mk(1, "COMPLETED");
  const luot2 = await mk(2, "NOT_STARTED");
  const maHocLai = `SR.CN.E2E.${lan}3`;
  await cert(d.hocVienId, luot1.id, khoaRL.id, pbRL.id, maHocLai, "Học Viên E2E", null);
  return { maSapHet, maHocLai, tenKhoaHocLai, enrollmentHocLaiId: luot2.id, maNguoiKhac, tokenCongKhai: `e2e${lan}1`.padEnd(32, "x").slice(0, 32) };
}

// ── Bài tập (nộp bằng tệp) ────────────────────────────────────────────────────────────────────────────────────────────
const MA_KHOA_BAI_TAP = `${P}BAITAP`;

export type BoBaiTap = { courseId: string; enrollmentId: string; lessonId: string; submissionNhapId: string };

/** Dọn khoá bài tập (idempotent). */
export async function donKhoaBaiTap(): Promise<void> {
  assertTestDb();
  const khoa = await db.trnCourse.findUnique({ where: { code: MA_KHOA_BAI_TAP }, select: { id: true } });
  if (khoa) {
    const baiIds = (await db.trnLesson.findMany({ where: { module: { courseId: khoa.id } }, select: { id: true } })).map((b) => b.id);
    await db.trnSubmission.deleteMany({ where: { lessonId: { in: baiIds } } });
    await db.trnLessonProgress.deleteMany({ where: { lessonId: { in: baiIds } } });
    await db.trnReminder.deleteMany({ where: { enrollment: { courseId: khoa.id } } });
    await db.trnEnrollment.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: khoa.id } } });
    await db.trnCourseVersion.deleteMany({ where: { courseId: khoa.id } });
    await db.trnLesson.deleteMany({ where: { module: { courseId: khoa.id } } });
    await db.trnModule.deleteMany({ where: { courseId: khoa.id } });
    await db.trnCourse.delete({ where: { id: khoa.id } });
  }
  await db.trnRubricCriterion.deleteMany({ where: { rubric: { code: `${P}RB-BAITAP` } } });
  await db.trnRubric.deleteMany({ where: { code: `${P}RB-BAITAP` } });
}

/**
 * Một khoá riêng có MỘT bài `TASK` + khung chấm, và một lượt NHÁP đã mang sẵn một tệp (đúng thứ tải tệp lên kho tạo ra — e2e không có R2
 * nên không tải byte thật; đường tải lên được đo ở `[TS-UI-05]` và route `bai-nop/tep`). Gọi SAU `dungVongHoc()`.
 */
export async function dungKhoaBaiTap(d: BoDuLieu): Promise<BoBaiTap> {
  assertTestDb();
  await donKhoaBaiTap();
  const gdChinh = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const khoa = await db.trnCourse.create({
    data: { code: MA_KHOA_BAI_TAP, slug: `${P.toLowerCase()}bai-tap`, title: "E2E Khoá bài tập", status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
    select: { id: true },
  });
  const chuong = await db.trnModule.create({ data: { courseId: khoa.id, title: "E2E Chương bài tập", orderIndex: 0 }, select: { id: true } });
  const rb = await db.trnRubric.create({ data: { code: `${P}RB-BAITAP`, title: "E2E Khung bài tập", totalPoints: 12, passPoints: 8, status: "ACTIVE", ownerUserId: d.daoTaoId }, select: { id: true } });
  await db.trnRubricCriterion.create({ data: { rubricId: rb.id, label: "Đủ nội dung", weight: 100, orderIndex: 0, levelsJson: [{ points: 0, label: "Thiếu" }, { points: 4, label: "Đủ" }] } });
  const bai = await db.trnLesson.create({ data: { moduleId: chuong.id, title: "E2E Bài tập nộp tệp", kind: "TASK", orderIndex: 0, rubricId: rb.id }, select: { id: true } });
  const pb = await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
  await db.trnCourseVersionLesson.create({ data: { versionId: pb.id, lessonId: bai.id, required: false, orderIndex: 0, contentHash: "e2e-hash-bai-tap" } });
  const han = new Date(Date.now() + 30 * 86_400_000);
  const gd = await db.trnEnrollment.create({
    data: { courseId: khoa.id, userId: d.hocVienId, cycle: 1, status: "NOT_STARTED", dueAt: han, dueAtOriginal: han, centerId: gdChinh.centerId, orgUnitId: gdChinh.orgUnitId, source: "ASSIGNMENT", snapJobTitle: "Nhân viên" },
    select: { id: true },
  });
  const nhap = await db.trnSubmission.create({
    data: {
      lessonId: bai.id,
      enrollmentId: gd.id,
      userId: d.hocVienId,
      attemptNo: 1,
      status: "DRAFT",
      rubricId: rb.id,
      attachmentsJson: [{ key: "e2e/day-thu.pdf", name: "day-thu.pdf", mime: "application/pdf", size: 2 * 1024 * 1024 }],
      centerId: gdChinh.centerId as string,
      orgUnitId: gdChinh.orgUnitId as string,
    },
    select: { id: true },
  });
  return { courseId: khoa.id, enrollmentId: gd.id, lessonId: bai.id, submissionNhapId: nhap.id };
}

export async function luotNopCua(userId: string, lessonId: string) {
  assertTestDb();
  return db.trnSubmission.findMany({ where: { userId, lessonId }, orderBy: { attemptNo: "asc" }, select: { status: true, attemptNo: true, contentText: true, submittedAt: true, dueGradeAt: true } });
}

/** Gỡ tệp khỏi một lượt nháp (để đo ca "chưa chữ, chưa tệp"). */
export async function db_xoaTepNhap(submissionId: string): Promise<void> {
  assertTestDb();
  await db.trnSubmission.update({ where: { id: submissionId }, data: { attachmentsJson: [] } });
}

// ── P5a: Soạn khoá — danh sách tab + màn duyệt ───────────────────────────────────────────────────────────────────────
const MA_KHOA_DUYET = `${P}DUYET`;
const MA_KHOA_NHAP = `${P}NHAP`;

export type BoKhoaDuyet = { duyetId: string; nhapId: string; tenDuyet: string; tenNhap: string; tenBaiMoi: string };

export async function donKhoaDuyet(): Promise<void> {
  assertTestDb();
  const khoa = await db.trnCourse.findMany({ where: { code: { in: [MA_KHOA_DUYET, MA_KHOA_NHAP] } }, select: { id: true } });
  const ids = khoa.map((k) => k.id);
  await db.trnCourseVersionLesson.deleteMany({ where: { version: { courseId: { in: ids } } } });
  await db.trnCourseVersion.deleteMany({ where: { courseId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { module: { courseId: { in: ids } } } });
  await db.trnModule.deleteMany({ where: { courseId: { in: ids } } });
  await db.trnCourse.deleteMany({ where: { id: { in: ids } } });
}

/** Khoá "chờ duyệt" (đã xuất bản v1.0 + bản v1.1 chờ duyệt do `d.daoTaoId` gửi, có bài mới/bài sửa) và khoá "nháp" (chưa gửi). */
export async function dungKhoaDuyet(d: BoDuLieu): Promise<BoKhoaDuyet> {
  assertTestDb();
  await donKhoaDuyet();
  const mk = async (code: string, title: string, status: "DRAFT" | "PUBLISHED") =>
    db.trnCourse.create({
      data: { code, slug: code.toLowerCase().replace(/_/g, "-"), title, status, visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
  const duyet = await mk(MA_KHOA_DUYET, "E2E Khoá chờ duyệt", "PUBLISHED");
  const nhap = await mk(MA_KHOA_NHAP, "E2E Khoá nháp", "DRAFT");
  const ch = await db.trnModule.create({ data: { courseId: duyet.id, title: "E2E Chương duyệt", orderIndex: 0 }, select: { id: true } });
  const bai = (moduleId: string, i: number, title: string, md: string) =>
    db.trnLesson.create({ data: { moduleId, title, kind: "READ", orderIndex: i, contentMd: md, minReadSeconds: 10 }, select: { id: true } });
  const b1 = await bai(ch.id, 1, "E2E Bài giữ nguyên", "giữ");
  const b2 = await bai(ch.id, 2, "E2E Bài đã sửa", "bản cũ");
  const v1 = await db.trnCourseVersion.create({ data: { courseId: duyet.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date("2026-11-01T03:00:00.000Z") }, select: { id: true } });
  for (const [l, i] of [[b1.id, 1], [b2.id, 2]] as const) {
    const row = await db.trnLesson.findUniqueOrThrow({ where: { id: l } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v1.id, lessonId: l, orderIndex: i, required: true, contentHash: bamNoiDungBai(row) } });
  }
  await db.trnLesson.update({ where: { id: b2.id }, data: { contentMd: "bản MỚI" } });
  const b3 = await bai(ch.id, 3, "E2E Bài mới thêm", "mới");
  const v2 = await db.trnCourseVersion.create({
    data: { courseId: duyet.id, major: 1, minor: 1, status: "PENDING_REVIEW", submittedByUserId: d.daoTaoId, submittedAt: new Date("2026-11-17T03:00:00.000Z") },
    select: { id: true },
  });
  for (const [l, i] of [[b1.id, 1], [b2.id, 2], [b3.id, 3]] as const) {
    const row = await db.trnLesson.findUniqueOrThrow({ where: { id: l } });
    await db.trnCourseVersionLesson.create({ data: { versionId: v2.id, lessonId: l, orderIndex: i, required: true, contentHash: bamNoiDungBai(row) } });
  }
  return { duyetId: duyet.id, nhapId: nhap.id, tenDuyet: "E2E Khoá chờ duyệt", tenNhap: "E2E Khoá nháp", tenBaiMoi: "E2E Bài mới thêm" };
}

export async function trangThaiBanCuaKhoa(courseId: string) {
  assertTestDb();
  return db.trnCourseVersion.findMany({ where: { courseId }, orderBy: [{ major: "asc" }, { minor: "asc" }], select: { major: true, minor: true, status: true, approvedAt: true, publishedAt: true } });
}

/** Hạn (ms) của một lượt ghi danh — để e2e đo gia hạn hàng loạt. */
export async function hanCuaGhiDanh(enrollmentId: string): Promise<number | null> {
  assertTestDb();
  const e = await db.trnEnrollment.findUnique({ where: { id: enrollmentId }, select: { dueAt: true } });
  return e?.dueAt ? e.dueAt.getTime() : null;
}

// ── P5b: lượt giao ĐÃ ĐÓNG (suy từ ghi danh đã xong) ─────────────────────────────────────────────────────────────────
const TEN_LUOT_DONG = `${P}Lượt giao đã xong hết`;

export async function donLuotGiaoDaDong(): Promise<void> {
  assertTestDb();
  const l = await db.trnAssignment.findMany({ where: { title: TEN_LUOT_DONG }, select: { id: true } });
  const ids = l.map((x) => x.id);
  await db.trnEnrollment.deleteMany({ where: { assignmentId: { in: ids } } });
  await db.trnAssignment.deleteMany({ where: { id: { in: ids } } });
}

/** Một lượt giao ACTIVE mà MỌI ghi danh đã COMPLETED ⇒ phải rơi vào tab "Đã đóng". Trả tên lượt giao. */
export async function dungLuotGiaoDaDong(d: BoDuLieu): Promise<{ ten: string }> {
  assertTestDb();
  await donLuotGiaoDaDong();
  const gd = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const lg = await db.trnAssignment.create({
    data: {
      title: TEN_LUOT_DONG,
      contentType: "COURSE",
      contentId: d.courseId,
      audienceMode: "STATIC",
      status: "ACTIVE",
      allowLate: true,
      completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" },
      centerId: gd.centerId,
      orgUnitId: gd.orgUnitId,
      createdByUserId: d.daoTaoId,
    },
    select: { id: true },
  });
  await db.trnEnrollment.create({
    data: {
      courseId: d.courseId,
      userId: d.hocVienId,
      cycle: 9,
      status: "COMPLETED",
      source: "ASSIGNMENT",
      assignmentId: lg.id,
      completedAt: new Date(),
      centerId: gd.centerId,
      orgUnitId: gd.orgUnitId,
      snapJobTitle: "Nhân viên",
    },
  });
  return { ten: TEN_LUOT_DONG };
}
