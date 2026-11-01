// FL W0-PERM — ma trận quyền tĩnh permissions.ts (pure, không DB).
// Phủ: TRAINING (Đào tạo) quản lý LMS; TEACHER/CENTER_MANAGER mất quyền sửa LMS
// nhưng giữ quyền xem + chấm; ACCOUNTANT mất students:edit (QĐ-T4).
import { describe, it, expect } from "vitest";
import { can, PERMISSIONS, ALL_ACTIONS } from "@/lib/auth/permissions";

describe("permissions matrix — FL W0 TRAINING role", () => {
  it("TRAINING biên soạn nội dung LMS", () => {
    expect(can("TRAINING", "curriculum:create")).toBe(true);
    expect(can("TRAINING", "curriculum:edit")).toBe(true);
    expect(can("TRAINING", "curriculum:delete")).toBe(true);
    expect(can("TRAINING", "curriculum:view")).toBe(true);
    expect(can("TRAINING", "training:manage")).toBe(true);
    expect(can("TRAINING", "questions:author")).toBe(true);
    expect(can("TRAINING", "questions:edit")).toBe(true);
    expect(can("TRAINING", "questions:delete")).toBe(true);
    expect(can("TRAINING", "assignments:create")).toBe(true);
    expect(can("TRAINING", "assignments:edit")).toBe(true);
    expect(can("TRAINING", "assignments:delete")).toBe(true);
    expect(can("TRAINING", "assignments:grade")).toBe(true);
    expect(can("TRAINING", "documents:upload")).toBe(true);
    expect(can("TRAINING", "documents:delete")).toBe(true);
    expect(can("TRAINING", "exams:create")).toBe(true);
    expect(can("TRAINING", "exams:edit")).toBe(true);
    expect(can("TRAINING", "exams:delete")).toBe(true);
    expect(can("TRAINING", "exams:grade")).toBe(true);
    // Chỉnh chương trình học (curriculum + khóa học + gói combo) = CHỈ Đào tạo + SUPER_ADMIN (24/07).
    expect(can("TRAINING", "courses:create")).toBe(true);
    expect(can("TRAINING", "courses:edit")).toBe(true);
    expect(can("TRAINING", "courses:delete")).toBe(true);
    expect(can("TRAINING", "curriculum:edit")).toBe(true);
    expect(can("TRAINING", "course-packages:edit")).toBe(true);
    expect(can("TRAINING", "teaching-materials:view-own-class")).toBe(true);
  });

  it("TRAINING KHOÁ CHẶT 24/07: chỉ curriculum+LMS+duyệt học bạ — KHÔNG xem HV/lớp toàn hệ thống, KHÔNG tài chính/HR/lead", () => {
    // Bỏ 24/07 — Đào tạo hết thấy học viên cả 2 cơ sở (Toại về đúng CS1).
    // ⚠️ 23/08 (chủ dự án): `classes:view-all` ĐÃ TRẢ LẠI — Đào tạo nay quản lý toàn
    // bộ GV nên phải nhìn mọi lớp để xếp người đi dạy. `students:view-all` GIỮ NGUYÊN
    // trạng gỡ: quản GV không kéo theo quyền xem danh sách học viên toàn hệ thống.
    expect(can("TRAINING", "students:view-all")).toBe(false);
    expect(can("TRAINING", "classes:view-all")).toBe(true);
    // Bỏ 24/07 — báo cáo đào tạo / đánh giá GV / cấu hình học thử / sửa học bạ.
    expect(can("TRAINING", "reports:training")).toBe(false);
    expect(can("TRAINING", "evaluations:manage")).toBe(false);
    expect(can("TRAINING", "trials:config")).toBe(false);
    expect(can("TRAINING", "report-cards:manage")).toBe(false);
    // GIỮ — duyệt học bạ + chìa khoá LMS (training:manage gác SCORM/curriculum-edit).
    expect(can("TRAINING", "report-cards:review")).toBe(true);
    expect(can("TRAINING", "training:manage")).toBe(true);
    // không tài chính / HR / lead
    expect(can("TRAINING", "payments:manage")).toBe(false);
    expect(can("TRAINING", "payroll:view")).toBe(false);
    expect(can("TRAINING", "employees:create")).toBe(false);
    expect(can("TRAINING", "leads:view-all")).toBe(false);
    expect(can("TRAINING", "students:edit")).toBe(false);
  });

  it("18/08 — Đào tạo ĐỌC được nhận xét buổi học, nhưng KHÔNG vì thế mà mở lại module Lớp/Buổi", () => {
    // Ngoại lệ hẹp của đợt khoá 24/07: chủ dự án yêu cầu "admin hoặc đào tạo xem
    // được hết đánh giá, nhận xét các buổi học trong lớp, của từng học viên".
    expect(can("TRAINING", "session-feedback:view-all")).toBe(true);
    // Ranh giới: nếu ai đó "tiện tay" cấp sessions:* / attendance:* cho Đào tạo thì
    // test này đỏ — quyền đọc nhận xét KHÔNG được biến thành quyền quản BUỔI HỌC.
    expect(can("TRAINING", "sessions:view")).toBe(false);
    expect(can("TRAINING", "sessions:edit")).toBe(false);
    expect(can("TRAINING", "attendance:view")).toBe(false);
  });

  it("23/08 — Đào tạo quản lý toàn bộ GV: xếp GV cho lớp chính + lớp trải nghiệm", () => {
    // Chủ dự án 23/08: "role đào tạo bây giờ sẽ là người quản lý toàn bộ giáo viên,
    // nên sẽ thấy toàn bộ lớp để sắp xếp giáo viên đến dạy các lớp chính hoặc trial".
    expect(can("TRAINING", "classes:view-all")).toBe(true);
    // Gán GV/trợ giảng cho lớp chính đi chung `updateClass` — không có action hẹp hơn.
    expect(can("TRAINING", "classes:edit")).toBe(true);
    expect(can("TRAINING", "trials:view")).toBe(true);
    expect(can("TRAINING", "trials:assign-teacher")).toBe(true);
    // Ranh giới còn lại của LỚP CHÍNH: xếp người đi dạy ≠ mở/đóng lớp.
    expect(can("TRAINING", "classes:create")).toBe(false);
    expect(can("TRAINING", "classes:delete")).toBe(false);
    // ⚠️ `trials:manage` từng là false ở đây (ranh giới 23/08) — xem bài kế tiếp,
    // chủ dự án ĐẢO 08/09. Bỏ dòng cũ chứ không sửa thành true tại chỗ, để bài mới
    // là nơi DUY NHẤT phát biểu ranh giới hiện hành.
    expect(can("TRAINING", "trials:config")).toBe(false);
  });

  it("08/09 — ĐẢO: Đào tạo FULL quyền trong màn Lớp Trial", () => {
    // Chủ dự án 08/09/2026: "chỉnh cho role đào tạo được sử dụng full quyền trong màn
    // lớp trial". Quyết định này ra SAU ranh giới 23/08 nên thắng (luật CLAUDE.md:
    // quyết định ký sau thắng bản trước).
    //
    // "FULL quyền màn lớp trial" = ĐÚNG BỘ khoá mà `/admin/lop-trial/**` gác, đo bằng
    // grep `checkPermission` trên chính thư mục đó — không suy rộng ra khoá lân cận.
    expect(can("TRAINING", "trials:view")).toBe(true); // 3 trang đều gác bằng khoá này
    expect(can("TRAINING", "trials:manage")).toBe(true); // 8/11 action + trang /moi
    expect(can("TRAINING", "trials:attendance")).toBe(true); // điểm danh + hoàn tất buổi
    expect(can("TRAINING", "trials:override-capacity")).toBe(true); // xếp vượt sĩ số
    expect(can("TRAINING", "trials:assign-teacher")).toBe(true); // đã có từ 23/08

    // HAI khoá CỐ Ý không kèm — chúng KHÔNG thuộc màn này:
    //   · trials:config   — cấu hình số buổi, màn khác; QLCS giữ theo QĐ-T3b.
    //   · trials:feedback — chấm phiếu nằm trọn ở site giáo viên. Màn lop-trial chỉ ĐỌC
    //     phiếu đã chấm, và quyền đọc là `trials:view` (lop-trial/[id]/page.tsx:60-61).
    expect(can("TRAINING", "trials:config")).toBe(false);
    expect(can("TRAINING", "trials:feedback")).toBe(false);
  });
});

describe("permissions matrix — đọc nhận xét buổi học (session-feedback:view-all)", () => {
  it("QLCS + GV + Admin đọc được; các vai ngoài chuyên môn thì không", () => {
    expect(can("SUPER_ADMIN", "session-feedback:view-all")).toBe(true);
    expect(can("CENTER_MANAGER", "session-feedback:view-all")).toBe(true);
    expect(can("TEACHER", "session-feedback:view-all")).toBe(true);
    // Nội dung nhận xét học viên không phải việc của Sale/Kế toán/HR/Marketing.
    expect(can("SALES_CSM", "session-feedback:view-all")).toBe(false);
    expect(can("ACCOUNTANT", "session-feedback:view-all")).toBe(false);
    expect(can("HR", "session-feedback:view-all")).toBe(false);
    expect(can("MARKETING", "session-feedback:view-all")).toBe(false);
    expect(can("PARENT", "session-feedback:view-all")).toBe(false);
  });
});

describe("permissions matrix — TEACHER mất quyền sửa LMS, giữ xem + chấm", () => {
  it("TEACHER KHÔNG còn quyền biên soạn LMS", () => {
    expect(can("TEACHER", "curriculum:create")).toBe(false);
    expect(can("TEACHER", "curriculum:edit")).toBe(false);
    expect(can("TEACHER", "curriculum:delete")).toBe(false);
    expect(can("TEACHER", "questions:author")).toBe(false);
    expect(can("TEACHER", "questions:edit")).toBe(false);
    expect(can("TEACHER", "questions:delete")).toBe(false);
    expect(can("TEACHER", "assignments:create")).toBe(false);
    expect(can("TEACHER", "assignments:edit")).toBe(false);
    expect(can("TEACHER", "assignments:delete")).toBe(false);
    expect(can("TEACHER", "documents:upload")).toBe(false);
    expect(can("TEACHER", "documents:delete")).toBe(false);
    expect(can("TEACHER", "exams:create")).toBe(false);
    expect(can("TEACHER", "exams:edit")).toBe(false);
    expect(can("TEACHER", "exams:delete")).toBe(false);
    expect(can("TEACHER", "training:manage")).toBe(false);
  });

  it("TEACHER GIỮ quyền xem LMS + chấm bài/đề + tài liệu lớp mình", () => {
    expect(can("TEACHER", "curriculum:view")).toBe(true);
    expect(can("TEACHER", "questions:view")).toBe(true);
    expect(can("TEACHER", "assignments:view")).toBe(true);
    expect(can("TEACHER", "assignments:grade")).toBe(true);
    expect(can("TEACHER", "documents:view")).toBe(true);
    expect(can("TEACHER", "exams:view")).toBe(true);
    expect(can("TEACHER", "exams:grade")).toBe(true);
    expect(can("TEACHER", "teaching-materials:view-own-class")).toBe(true);
    // quyền lớp ngoài LMS giữ nguyên
    expect(can("TEACHER", "attendance:mark")).toBe(true);
    expect(can("TEACHER", "report-cards:manage")).toBe(true);
  });
});

describe("permissions matrix — CENTER_MANAGER chỉ XEM LMS", () => {
  it("CENTER_MANAGER mất quyền sửa LMS", () => {
    expect(can("CENTER_MANAGER", "curriculum:create")).toBe(false);
    expect(can("CENTER_MANAGER", "curriculum:edit")).toBe(false);
    expect(can("CENTER_MANAGER", "curriculum:delete")).toBe(false);
    expect(can("CENTER_MANAGER", "questions:author")).toBe(false);
    expect(can("CENTER_MANAGER", "questions:edit")).toBe(false);
    expect(can("CENTER_MANAGER", "questions:delete")).toBe(false);
    expect(can("CENTER_MANAGER", "assignments:create")).toBe(false);
    expect(can("CENTER_MANAGER", "assignments:edit")).toBe(false);
    expect(can("CENTER_MANAGER", "assignments:delete")).toBe(false);
    expect(can("CENTER_MANAGER", "documents:upload")).toBe(false);
    expect(can("CENTER_MANAGER", "documents:delete")).toBe(false);
    expect(can("CENTER_MANAGER", "exams:create")).toBe(false);
    expect(can("CENTER_MANAGER", "exams:edit")).toBe(false);
    expect(can("CENTER_MANAGER", "exams:delete")).toBe(false);
    expect(can("CENTER_MANAGER", "training:manage")).toBe(false);
  });

  it("CENTER_MANAGER KHÔNG còn quyền LMS (chủ dự án chốt 03/08) nhưng giữ quyền vận hành", () => {
    // ⚠️ ĐẢO chốt 24/07 ("CM giữ mọi *:view LMS"). 03/08 chủ dự án yêu cầu chặn hẳn
    // phần LMS ở vai Quản lý cơ sở — họ vận hành lớp, không soạn/duyệt học liệu.
    expect(can("CENTER_MANAGER", "curriculum:view")).toBe(false);
    expect(can("CENTER_MANAGER", "questions:view")).toBe(false);
    expect(can("CENTER_MANAGER", "assignments:view")).toBe(false);
    expect(can("CENTER_MANAGER", "documents:view")).toBe(false);
    expect(can("CENTER_MANAGER", "exams:view")).toBe(false);
    expect(can("CENTER_MANAGER", "courses:view")).toBe(false);
    // Gói bán = giá, không phải học liệu → GIỮ (luồng tạo đơn cần).
    expect(can("CENTER_MANAGER", "course-packages:view")).toBe(true);
    expect(can("CENTER_MANAGER", "teaching-materials:view-own-class")).toBe(false);
    // Chấm bài vẫn giữ: đó là việc vận hành lớp, không phải soạn học liệu.
    expect(can("CENTER_MANAGER", "assignments:grade")).toBe(true);
    expect(can("CENTER_MANAGER", "exams:grade")).toBe(true);
    // Học bạ phải CÒN — màn đó gác [curriculum:view | students:view-own-class].
    expect(can("CENTER_MANAGER", "students:view-own-class")).toBe(true);
    // Quyền ngoài LMS giữ nguyên.
    expect(can("CENTER_MANAGER", "classes:create")).toBe(true);
    // 03/08 — tiền: chỉ XEM đối soát, không quản lý (Hoàn tiền/Phương thức TT chặn).
    expect(can("CENTER_MANAGER", "payments:view")).toBe(true);
    expect(can("CENTER_MANAGER", "payments:manage")).toBe(false);
    // 03/08 — hồ sơ nhân sự/giáo viên, nhật ký, cấu hình: rút khỏi vai này.
    expect(can("CENTER_MANAGER", "employees:view-all")).toBe(false);
    expect(can("CENTER_MANAGER", "audit-logs:view")).toBe(false);
    expect(can("CENTER_MANAGER", "settings:view")).toBe(false);
    // 03/08 — vẫn bàn giao/chuyển lead, chỉ mất màn CẤU HÌNH chia lead.
    expect(can("CENTER_MANAGER", "leads:assign")).toBe(true);
    expect(can("CENTER_MANAGER", "leads:assign-config")).toBe(false);
    // 24/07 — CM KHÔNG chỉnh chương trình.
    expect(can("CENTER_MANAGER", "courses:create")).toBe(false);
    expect(can("CENTER_MANAGER", "courses:edit")).toBe(false);
    expect(can("CENTER_MANAGER", "course-packages:edit")).toBe(false);
  });
});

describe("permissions matrix — ACCOUNTANT (QĐ-T4)", () => {
  it("ACCOUNTANT KHÔNG sửa hồ sơ học viên", () => {
    expect(can("ACCOUNTANT", "students:edit")).toBe(false);
    // giữ các quyền tài chính
    expect(can("ACCOUNTANT", "payments:confirm")).toBe(true);
    expect(can("ACCOUNTANT", "students:view-all")).toBe(true);
  });

  it("students:edit vẫn giữ cho các role quản lý/bán hàng", () => {
    expect(can("SUPER_ADMIN", "students:edit")).toBe(true);
    expect(can("CENTER_MANAGER", "students:edit")).toBe(true);
    expect(can("SALES_CSM", "students:edit")).toBe(true);
  });
});

describe("permissions matrix — FL W0-NAV-2 QĐ-T3b (CM giữ trial-config + duyệt sửa bài qua action RIÊNG)", () => {
  it("trials:config — Super/Training/CM = true; KHÔNG trả qua training:manage", () => {
    expect(can("SUPER_ADMIN", "trials:config")).toBe(true);
    // 24/07 — cấu hình học thử gỡ khỏi Đào tạo (chỉ LMS), giữ ở QL cơ sở.
    expect(can("TRAINING", "trials:config")).toBe(false);
    expect(can("CENTER_MANAGER", "trials:config")).toBe(true);
    // CM vẫn KHÔNG có training:manage (W0 đã gỡ) — chỉ trả lại qua action riêng.
    expect(can("CENTER_MANAGER", "training:manage")).toBe(false);
    // vai khác không có
    expect(can("SALES_CSM", "trials:config")).toBe(false);
    expect(can("TEACHER", "trials:config")).toBe(false);
    expect(can("ACCOUNTANT", "trials:config")).toBe(false);
  });

  it("lesson-change:approve — Super/Training = true; CM/Sale/GV = false", () => {
    expect(can("SUPER_ADMIN", "lesson-change:approve")).toBe(true);
    expect(can("TRAINING", "lesson-change:approve")).toBe(true);
    // 03/08 — duyệt sửa giáo án là việc Đào tạo; CM đã rút khỏi toàn bộ phần LMS.
    expect(can("CENTER_MANAGER", "lesson-change:approve")).toBe(false);
    expect(can("SALES_CSM", "lesson-change:approve")).toBe(false);
    expect(can("TEACHER", "lesson-change:approve")).toBe(false);
  });
});

// 17/09/2026 — ba tầng xếp giáo viên cho buổi trải nghiệm (chủ dự án chốt):
//   Đào tạo      → FULL, mọi cơ sở            → `trials:assign-teacher`
//   Quản lý cơ sở → GV của cơ sở mình          → `trials:assign-teacher-center`  ← khoá MỚI
//   Sale          → chỉ GV có ca phủ trọn giờ  → không khoá riêng (mặc định của màn)
//
// Vì sao khoá này phải tồn tại: trước nó, `PERMISSIONS` cấp cho CENTER_MANAGER và
// SALES_CSM CÙNG bộ `trials:*` dùng được (view · manage · attendance · override-capacity)
// ⇒ không có khoá nào để hỏi "người này là tầng cơ sở hay tầng Sale?", và cách duy nhất
// còn lại là `if (role === "CENTER_MANAGER")` — đúng thứ luật cứng #1 cấm (lint
// `no-inline-authz` = build fail).
describe("permissions matrix — 17/09 tầng QL cơ sở của việc xếp GV buổi trải nghiệm", () => {
  it("trials:assign-teacher-center = ĐÚNG hai vai {SUPER_ADMIN, CENTER_MANAGER}", () => {
    // So cả TẬP (không chỉ can() từng vai): thêm vai thứ ba vào map là xoá đúng ranh
    // giới mà khoá này sinh ra để vẽ — và một bài `can(X)===false` rời rạc sẽ không
    // bắt được vai mới nào đó chưa ai nghĩ tới.
    expect([...PERMISSIONS["trials:assign-teacher-center"]].sort()).toEqual([
      "CENTER_MANAGER",
      "SUPER_ADMIN",
    ]);
  });

  it("khoá phải nằm trong ALL_ACTIONS — nếu không thì mọi grant mang nó bị vứt IM LẶNG", () => {
    // `ALL_ACTIONS = Object.keys(PERMISSIONS)` và `buildActor()` lọc grant theo tập đó.
    // Khai ở union `Action` mà quên dòng map = khoá vô hình, không lỗi, không cảnh báo.
    expect(ALL_ACTIONS).toContain("trials:assign-teacher-center");
  });

  it("hai tầng KHÔNG giao nhau: Đào tạo giữ khoá toàn hệ thống, QL cơ sở giữ khoá cơ sở", () => {
    // Đào tạo: FULL (GĐ3 chốt câu 2) — và KHÔNG được cấp thêm khoá tầng cơ sở, vì
    // `trials:assign-teacher` đã bao trùm; cấp cả hai là làm khoá mới mất nghĩa.
    expect(can("TRAINING", "trials:assign-teacher")).toBe(true);
    expect(can("TRAINING", "trials:assign-teacher-center")).toBe(false);
    // Quản lý cơ sở: NGƯỢC LẠI. GĐ3 đã cố ý gỡ `trials:assign-teacher` khỏi vai này;
    // dòng dưới ghim việc đó để không ai "tiện tay" trả lại khi thêm khoá mới.
    expect(can("CENTER_MANAGER", "trials:assign-teacher-center")).toBe(true);
    expect(can("CENTER_MANAGER", "trials:assign-teacher")).toBe(false);
  });

  it("Sale/GV/Kế toán KHÔNG có khoá tầng cơ sở", () => {
    // SALES_CSM là vai quan trọng nhất trong bài này: nó có ĐỦ `trials:manage` +
    // `trials:attendance` + `trials:override-capacity` giống CENTER_MANAGER, nên nếu
    // ai đó cấp nhầm khoá mới cho Sale thì hai tầng lại dính làm một như trước 17/09.
    expect(can("SALES_CSM", "trials:assign-teacher-center")).toBe(false);
    expect(can("TEACHER", "trials:assign-teacher-center")).toBe(false);
    expect(can("ACCOUNTANT", "trials:assign-teacher-center")).toBe(false);
    expect(can("MARKETING", "trials:assign-teacher-center")).toBe(false);
    expect(can("PARENT", "trials:assign-teacher-center")).toBe(false);
  });
});

describe("permissions matrix — FL W0-NAV-2 role hygiene (BA #07 3.C)", () => {
  it("SALES_CSM bỏ module dư (Buổi học/Điểm danh/Phòng học/Khoá dạy/Tuyển dụng/Tin tức)", () => {
    expect(can("SALES_CSM", "sessions:view")).toBe(false);
    expect(can("SALES_CSM", "attendance:view")).toBe(false);
    expect(can("SALES_CSM", "rooms:view")).toBe(false);
    expect(can("SALES_CSM", "courses:view")).toBe(false);
    expect(can("SALES_CSM", "jobs:view")).toBe(false);
    expect(can("SALES_CSM", "news:view")).toBe(false);
  });

  it("SALES_CSM GIỮ chức năng lõi (lead/tuyển sinh/HV/đăng ký/đơn/trial/gói học)", () => {
    expect(can("SALES_CSM", "leads:view-own")).toBe(true);
    expect(can("SALES_CSM", "students:view-all")).toBe(true);
    expect(can("SALES_CSM", "students:edit")).toBe(true);
    expect(can("SALES_CSM", "enrollments:create")).toBe(true);
    expect(can("SALES_CSM", "orders:view")).toBe(true);
    expect(can("SALES_CSM", "trials:manage")).toBe(true);
    expect(can("SALES_CSM", "course-packages:view")).toBe(true);
    expect(can("SALES_CSM", "parent-requests:manage")).toBe(true);
  });

  // G-A (biên bản chốt 4 cổng, 21/08/2026) — ghim Ý ĐỊNH của quyết định: cấp HẸP.
  // Nếu ai đó sau này "tiện tay" cấp orders:manage cho Sale thì test này đỏ.
  it("[G-A] SALES_CSM tạo được đơn nhưng KHÔNG quản trị đơn", () => {
    expect(can("SALES_CSM", "orders:create")).toBe(true);
    expect(can("SALES_CSM", "orders:manage")).toBe(false);
  });

  it("[G-A] mọi vai có orders:manage đều phải có orders:create (cổng tạo đơn đã đổi)", () => {
    for (const role of ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"] as const) {
      expect(can(role, "orders:manage")).toBe(true);
      // Cổng tạo đơn nay kiểm `orders:create`; thiếu dòng này là vai đó MẤT
      // chức năng tạo đơn đang dùng hằng ngày.
      expect(can(role, "orders:create")).toBe(true);
    }
  });

  it("ACCOUNTANT bỏ Khoá dạy + Tin tức; GIỮ tài chính + kho", () => {
    expect(can("ACCOUNTANT", "courses:view")).toBe(false);
    expect(can("ACCOUNTANT", "news:view")).toBe(false);
    // giữ tài chính + kiểm kê kho
    expect(can("ACCOUNTANT", "payments:confirm")).toBe(true);
    expect(can("ACCOUNTANT", "inventory:view")).toBe(true);
    expect(can("ACCOUNTANT", "inventory:audit")).toBe(true);
    expect(can("ACCOUNTANT", "payroll:view")).toBe(true);
  });

  it("Hygiene KHÔNG ảnh hưởng vai khác (GV/CM giữ sessions/attendance; HR/MKT giữ Tin tức)", () => {
    expect(can("TEACHER", "sessions:view")).toBe(true);
    expect(can("TEACHER", "attendance:view")).toBe(true);
    expect(can("CENTER_MANAGER", "rooms:view")).toBe(true);
    // 03/08 — CM đã rút khỏi phần LMS nên KHÔNG còn courses:view (xem test ở trên).
    expect(can("CENTER_MANAGER", "courses:view")).toBe(false);
    expect(can("HR", "news:view")).toBe(true);
    expect(can("MARKETING", "news:view")).toBe(true);
    expect(can("MARKETING", "courses:view")).toBe(true);
  });
});

describe("permissions matrix — #17 học bạ sau phát hành (câu 55, Toại 06/07)", () => {
  it("TRAINING (Đào tạo) CHỈ duyệt học bạ (report-cards:review) — 24/07 gỡ manage (không sửa/tạo)", () => {
    expect(can("TRAINING", "report-cards:manage")).toBe(false);
    expect(can("TRAINING", "report-cards:review")).toBe(true);
  });

  it("CENTER_MANAGER giữ report-cards:manage + review (QL cơ sở duyệt/phát hành)", () => {
    expect(can("CENTER_MANAGER", "report-cards:manage")).toBe(true);
    expect(can("CENTER_MANAGER", "report-cards:review")).toBe(true);
  });

  it("SUPER_ADMIN có cả hai", () => {
    expect(can("SUPER_ADMIN", "report-cards:manage")).toBe(true);
    expect(can("SUPER_ADMIN", "report-cards:review")).toBe(true);
  });

  it("TEACHER GIỮ report-cards:manage (viết DRAFT) nhưng KHÔNG có review (không sửa sau phát hành)", () => {
    expect(can("TEACHER", "report-cards:manage")).toBe(true);
    expect(can("TEACHER", "report-cards:review")).toBe(false);
  });

  it("vai không liên quan không có report-cards:*", () => {
    expect(can("SALES_CSM", "report-cards:review")).toBe(false);
    expect(can("ACCOUNTANT", "report-cards:manage")).toBe(false);
    expect(can("PARENT", "report-cards:review")).toBe(false);
  });
});

describe("permissions matrix — sanity", () => {
  it("teaching-materials:view-own-class tồn tại trong matrix", () => {
    expect(ALL_ACTIONS).toContain("teaching-materials:view-own-class");
    // 03/08 — CM rút khỏi phần LMS; tài liệu lớp còn Đào tạo + GV.
    expect(PERMISSIONS["teaching-materials:view-own-class"]).toEqual(
      expect.arrayContaining(["SUPER_ADMIN", "TRAINING", "TEACHER"]),
    );
    expect(PERMISSIONS["teaching-materials:view-own-class"]).not.toContain("CENTER_MANAGER");
  });

  it("PARENT không có quyền admin nào", () => {
    expect(can("PARENT", "curriculum:view")).toBe(false);
    expect(can("PARENT", "students:view-all")).toBe(false);
  });
});

// #01 shadow-compare: can() v2 (lib/auth/can.ts) bypass mọi action khi
// `actor.isSuperAdmin`. Nếu matrix v1 thiếu SUPER_ADMIN ở một action nào đó thì
// mỗi lần admin chạm call-site đó là một dòng RbacShadowDiff (v1=false, v2=true)
// → cổng `isSafeToEnableRbacV2` (đếm thô, không whitelist) không bao giờ về 0.
// Trước bản vá 09/07 có 4 action rơi vào bẫy này: leads:view-own,
// students:view-own-class, classes:view-own, enrollments:view-own.
describe("permissions matrix — SUPER_ADMIN phủ toàn bộ action (khớp bypass v2)", () => {
  // US-05 chat (08/08/2026) — ngoại lệ DUY NHẤT, có chủ đích: Admin KHÔNG gửi CHAT
  // (US-15 AC4 — chế độ xem của Admin là chỉ đọc; permissions.md ô "Gửi CHAT/Admin").
  // v2 bypass vẫn true cho SUPER_ADMIN ⇒ chốt chặn thật là participant-check trong
  // action (US-06); v1 deny để pin ý định. Lệch v1/v2 ở đây được CHẤP NHẬN — admin
  // không có UI gửi CHAT nên shadow-compare không phát sinh diff từ traffic thật.
  // ⚠️ Danh sách này KHÔNG được phình ra nếu không có quyết định tương đương US-15 AC4.
  const NGOAI_LE_CHI_DOC = new Set<string>(["chat:send"]);

  it("mọi action trong ALL_ACTIONS đều cấp cho SUPER_ADMIN (trừ ngoại lệ chỉ-đọc)", () => {
    const thieu = ALL_ACTIONS.filter(
      (a) => !NGOAI_LE_CHI_DOC.has(a) && !PERMISSIONS[a].includes("SUPER_ADMIN"),
    );
    expect(thieu).toEqual([]);
  });

  it("can(SUPER_ADMIN, *) = true với mọi action ngoài ngoại lệ", () => {
    for (const a of ALL_ACTIONS) {
      if (NGOAI_LE_CHI_DOC.has(a)) continue;
      expect(can("SUPER_ADMIN", a)).toBe(true);
    }
  });

  it("ngoại lệ đúng là deny ở v1 (không thừa dòng)", () => {
    for (const a of NGOAI_LE_CHI_DOC) {
      expect({ action: a, superAdminV1: can("SUPER_ADMIN", a as (typeof ALL_ACTIONS)[number]) }).toEqual({
        action: a,
        superAdminV1: false,
      });
    }
  });
});
