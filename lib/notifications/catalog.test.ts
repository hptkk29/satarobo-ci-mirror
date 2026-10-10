import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyNotification,
  catalogPrefixes,
  isNotiGroupKey,
  notiGroupLabel,
  NOTI_GROUPS,
} from "./catalog";
import { PENDING_SYNC_TYPES, pendingSyncKey } from "./pending-sync";

// Danh sách này là ẢNH CHỤP mọi dedupeKey đang được sinh thật trong repo (audit 19/08/2026).
// Nó tồn tại để bắt đúng một lỗi: thêm nguồn sinh thông báo mới mà quên khai vào catalog ⇒
// thông báo đó rơi về "Hệ thống / P3", nằm chót panel và không ai nhìn thấy.
// Thêm producer mới → thêm một dòng ở đây VÀ một dòng trong catalog.
const KHOA_DANG_CHAY: ReadonlyArray<[key: string, file: string]> = [
  ["class.session_changed:evt1", "lib/_handlers/r7-notifications.ts"],
  ["class.cancelled:evt1", "lib/_handlers/r7-notifications.ts"],
  ["lead.trialAttended:lead1", "lib/_handlers/r7-notifications.ts"],
  ["session.taught:s1", "lib/_handlers/r7-lifecycle.ts"],
  ["trial.assigned:te1", "lib/_handlers/trial-notif.ts"],
  ["trial.schedule_changed:t1:2026-08-19T00:00:00.000Z", "lib/_handlers/trial-schedule-notif.ts"],
  ["trial.evaluated:te1:ts1", "lib/_handlers/trial-eval-notif.ts"],
  // Các khoá dưới đi qua helper `notifyTrialTeacherAssigned` (lib/trial/service.ts) nhưng
  // dedupeKey do NƠI GỌI dựng — ghi đúng nơi gọi để lần sau còn tìm ra.
  //
  // ⚠️ 14/09/2026 — GỠ hai dòng `trial-v1.assigned:` và `trial-class.assigned:`. Ảnh chụp này
  // vốn đã NÓI SAI: hai tệp nó trỏ tới (`app/(admin)/admin/trials/actions.ts` và
  // `app/(admin)/admin/trial-classes/_actions.ts`) KHÔNG còn tồn tại, mà ca test chỉ hỏi
  // "khoá có được khai trong catalog không" nên vẫn xanh. Một ảnh chụp trỏ vào tệp đã xoá thì
  // không còn là ảnh chụp của hiện thực — nó chỉ giữ cho một mục chết sống mãi trong danh mục,
  // và chính mục chết đó bày ra màn cấu hình thành công tắc không nối vào đâu.
  ["lead.moi_nhieu:u1:1789400000000", "lib/lead/assign-lead.ts"],
  ["trial-session.assigned:ts1", "lib/trial/service.ts"],
  ["trial-enroll.assigned:te1", "lib/trial/service.ts"],
  // 14/09 — ba khoá của luồng SỬA / DỜI NGƯỜI DẠY / HUỶ buổi trải nghiệm. Chúng sinh thật từ
  // trước nhưng chưa từng được khai, nên rơi về "Hệ thống / P3" trong chuông và không hiện ở
  // màn cấu hình đẩy. Sổ `WebPushOutbox` prod ngày 13/09 ghi đúng ba khoá này.
  ["trial-session.updated:ts1:1789321086280", "app/(admin)/admin/lop-trial/_actions.ts"],
  ["trial-session.moved-out:ts1:1789321086280", "app/(admin)/admin/lop-trial/_actions.ts"],
  ["trial-session.cancelled:ts1", "app/(admin)/admin/lop-trial/_actions.ts"],
  // 14/09 — báo Đào tạo khi thêm buổi mà KHÔNG chọn giáo viên (đường mặc định của form).
  ["trial.cho-phan-cong:ts1", "lib/trial/notify-training.ts"],
  ["conversation.message_posted:m1", "lib/_handlers/conversation-notif.ts"],
  // 26/09 — hoá đơn điện tử: khách không có email ⇒ báo sale gửi Zalo.
  ["hoa-don.khong-email:hd1", "lib/finance/hoa-don/gui-email.ts"],
  // 27/09 — GĐ 8: email hoá đơn hỏng hẳn ⇒ báo phía sale + kế toán đã bấm gửi (khoá riêng).
  ["hoa-don.gui-loi:g1", "lib/finance/hoa-don/gui-email.ts"],
  ["hoa-don.gui-loi:g1:ke-toan", "lib/finance/hoa-don/gui-email.ts"],
  // 28/09 — PLAN Q-mở 7: chuông hằng ngày "lần thu chờ xuất hoá đơn" (cron payment-reconcile).
  ["hoa-don.cho-xuat:cs1:2026-09-28", "lib/finance/hoa-don/nhac-ke-toan.ts"],
  ["hoa-don.cho-xuat:tong:2026-09-28", "lib/finance/hoa-don/nhac-ke-toan.ts"],
  // 13/10 — khiếu nại hoa hồng (05 §3): tạo ⇒ báo HR; quyết định ⇒ báo người khiếu nại.
  ["hoa-hong.khieu-nai-moi:kn1", "lib/hoa-hong/khieu-nai-gui-thong-bao.ts"],
  ["hoa-hong.khieu-nai-ket-qua:kn1", "lib/hoa-hong/khieu-nai-gui-thong-bao.ts"],
  ["reserve.expired:r1:2026-08-19", "app/api/cron/reserve-expiry/route.ts"],
  ["reserve-expiry:r1", "lib/students/reserve-expiry.ts"],
  ["payment-reconcile:unmatched:2026-08-19", "app/api/cron/payment-reconcile/route.ts"],
  ["payment-reconcile:overdue-partial:2026-08-19", "app/api/cron/payment-reconcile/route.ts"],
  ["sla:first_touch:lead1", "lib/crm/sla.ts"],
  ["sla:idle24:lead1", "lib/crm/sla.ts"],
  ["cost-unconfirmed:2026-08", "lib/crm/marketing-alerts.ts"],
  ["report-missing:2026-08", "lib/crm/marketing-alerts.ts"],
  ["media_review.overdue:s:s1:2026-08-25", "lib/lms/media-review-overdue-run.ts"],
  ["media_review.overdue:c:cls1:2026-08-24:2026-08-25", "lib/lms/media-review-overdue-run.ts"],
  ["session.substitute:s1", "lib/lms/session-teacher-notify.ts"],
  ["session.close-reminder:s1", "lib/lms/session-teacher-notify.ts"],
  ["intake-failing:facebook:2026-08-19-10", "lib/lead/intake/health.ts"],
  ["intake-silent:zalo:2026-08-19", "lib/lead/intake/health.ts"],
  ["parent_request.created:pr1", "lib/portal/parent-request-notify.ts"],
  ["parent_request.reminder:pr1", "lib/portal/parent-request-notify.ts"],
  ["attendance.edited:s1", "lib/notify/attendance.ts"],
  ["birthday:g1", "lib/students/birthday-notify.ts"],
  // GĐ6 — nhắc Sale trước buổi trải nghiệm (2 mốc: 1 ngày và 2 giờ).
  ["trial.reminder:1-ngay:e1:s1", "lib/trial/nhac-buoi.ts"],
  ["trial.reminder:2-gio:e1:s1", "lib/trial/nhac-buoi.ts"],
  // V2-d (17/09) — mốc thứ ba nhắc GIÁO VIÊN (~1 tiếng trước), và nhánh leo thang khi tới
  // mốc mà buổi vẫn chưa ai dạy. Hai tiền tố RIÊNG: `trial.reminder-gv:` không được để rơi
  // vào `trial.reminder:` (khác người nhận, khác nội dung), và `trial.cho-phan-cong-gap:`
  // không được trùng `trial.cho-phan-cong:` (trùng là ĐÈ mất tin gốc lúc tạo buổi).
  ["trial.reminder-gv:1-gio:s1", "lib/trial/nhac-buoi.ts"],
  ["trial.cho-phan-cong-gap:s1", "lib/trial/nhac-buoi.ts"],
  ["trial.gv-vang:ts1", "lib/trial/bao-gv-vang.ts"],
  ["khuyen-mai.ban-hanh:cs1", "lib/khuyen-mai/chinh-sach.ts"],
  ["khuyen-mai.thu-hoi:cs1", "lib/khuyen-mai/chinh-sach.ts"],
  // 07/10/2026 — ca dạy bù báo giáo viên (lib/hoc-bu/bao-gv.ts).
  ["hoc-bu.ca-moi:case1", "lib/hoc-bu/bao-gv.ts"],
  ["hoc-bu.them-hv:case1:1791300000000", "lib/hoc-bu/bao-gv.ts"],
  ["hoc-bu.huy:case1", "lib/hoc-bu/bao-gv.ts"],
  // 06/10/2026 — GĐ1 POS [POS1-NT-01]: tiền phiếu gộp chia xong ⇒ báo sale phụ trách (mọi DA_CHIA,
  // cả QR chuyển khoản); ba khoá báo admin của phiếu thu thẻ.
  ["phieu-gop.da-chia:bt1:b1", "lib/payments/sau-da-chia.ts"],
  ["pos.bao-admin:i1", "lib/payments/pos/phieu-pos.ts"],
  ["pos.loi-ket-noi:i1:2026-10-06T10", "lib/payments/pos/xu-ly-ket-qua.ts"],
  ["pos.chua-xac-dinh:i1:2026-10-06T10", "lib/payments/pos/xu-ly-ket-qua.ts"],
  // 06/10/2026 — GĐ2 POS: lỗi kết nối khi máy TỰ kiểm (poller / đồng bộ / quét sạch) gộp MỘT khoá toàn
  // hệ thống mỗi giờ (U13).
  ["pos.loi-ket-noi:he-thong:2026-10-06T10", "lib/payments/pos/xu-ly-ket-qua.ts"],
  // GĐ2 POS: quét sạch cuối ngày 23:30 giờ VN ghi nhận phiếu thu thẻ mà poller/nút/đồng bộ bỏ sót.
  ["pos.quet-sach:2026-10-06", "lib/payments/pos/quet-sach.ts"],
  // 07/10/2026 — GĐ4 POS: chuông máy đồng bộ, khoá (cơ sở + ngày VN) — `lib/payments/pos/agent/canh-bao.ts`.
  ["pos.agent-het-phien:cs1:2026-10-07", "lib/payments/pos/agent/canh-bao.ts"],
  ["pos.agent-mat-ket-noi:cs1:2026-10-07", "lib/payments/pos/agent/canh-bao.ts"],
  ["pos.agent-sap-het-phien:cs1:2026-10-07", "lib/payments/pos/agent/canh-bao.ts"],
  ["pos.agent-loi:cs1:2026-10-07", "lib/payments/pos/agent/canh-bao.ts"],

  // 08/10/2026 — Bảo lưu (Phiên 3): chờ duyệt → QLCS; đã duyệt / từ chối → người lập hồ sơ.
  ["pause.cho-duyet:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.da-duyet:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.tu-choi:r1", "lib/bao-luu/thong-bao.ts"],
  // Phiên 5 — cron + vòng đời bảo lưu.
  ["pause.nhac-truoc-han:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.nhac-het-han:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.qua-han:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.leo-thang:r1:2026-10-08", "lib/bao-luu/thong-bao.ts"],
  ["pause.cham-dut:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.thu-hoi-kit:r1", "lib/bao-luu/thong-bao.ts"],
  ["pause.center-qua-ngay:r1:2026-10-08", "lib/bao-luu/thong-bao.ts"],
  ["pause.gia-han-cho-duyet:r1:u1", "lib/bao-luu/thong-bao.ts"],
  ["pause.gia-han-da-duyet:r1:2026-10-08", "lib/bao-luu/thong-bao.ts"],
  ["pause.gia-han-tu-choi:r1:2026-10-08", "lib/bao-luu/thong-bao.ts"],
  // 06/10/2026 — chín khoá phát thật qua `notifyStaff` mà chưa từng được khai. Đo bằng cách
  // dò mọi `dedupeKey: \`…:` trong mã rồi lọc theo hàm thật sự nhận khoá (khoá của
  // `publishEvent` / thông báo phụ huynh KHÔNG thuộc danh mục này).
  ["trial-case.moved-in:te1:ts1:1791228000000", "app/(admin)/admin/lop-trial/_actions.ts"],
  ["trial-case.moved-out:te1:ts1:1791228000000", "app/(admin)/admin/lop-trial/_actions.ts"],
  ["trial-case.go:te1:ts1:1791228000000", "app/(admin)/admin/lop-trial/_actions.ts"],
  ["lead.nhap_lai:lead1:1791228000000", "lib/lead/assign-lead.ts"],
  ["lead.pool_rong:lead1", "lib/lead/assign-lead.ts"],
  ["no-qua-han:o1:2026-10-06", "app/api/cron/nhac-no-theo-con/route.ts"],
  ["el.enr:e1", "lib/elearning/_handlers/notify.ts"],
  ["el.over:e1:hoc-vien", "lib/elearning/_handlers/notify.ts"],
  ["el.done:e1", "lib/elearning/_handlers/notify.ts"],
];

// ── [CAT-SONG] chiều NGƯỢC LẠI: mỗi mục trong danh mục phải còn ít nhất một nơi phát ──────
// Ảnh chụp trên chỉ bắt "phát mà quên khai". Nó KHÔNG bắt "khai mà không còn ai phát": ba mục
// `trial-case.assigned:`, `trial-case.rescheduled:`, `trial-v1.assigned:`, `trial-class.assigned:` đã sống nhiều tuần
// sau khi đường phát của chúng bị gỡ, bày ra màn cấu hình đẩy thành công tắc không nối vào đâu
// (prod 06/10: `trial-case.assigned` đang BẬT, người vận hành tưởng mình nhận được tin phân ca).
//
// Dò tên khoá (bỏ dấu `:` cuối) trên mã nguồn ĐÃ BỎ CHÚ THÍCH — một dòng chú thích nhắc tên
// khoá cũ (như chính khối này) không được phép giữ một mục chết sống.
const KHOA_GHEP_DONG: Readonly<Record<string, string>> = {
  // `dedupeKey: \`khuyen-mai.${loai}:${cs.id}\`` — `loai` ∈ {"ban-hanh","thu-hoi"}.
  "khuyen-mai.ban-hanh:": "lib/khuyen-mai/chinh-sach.ts",
  "khuyen-mai.thu-hoi:": "lib/khuyen-mai/chinh-sach.ts",
  // `khoaChuongAgent` dựng `\`pos.agent-${loai}:…\`` — `loai` ∈ LoaiChuongAgent
  // (lib/payments/pos/agent/canh-bao-luat.ts), phát từ lib/payments/pos/agent/canh-bao.ts.
  "pos.agent-het-phien:": "lib/payments/pos/agent/canh-bao-luat.ts",
  "pos.agent-mat-ket-noi:": "lib/payments/pos/agent/canh-bao-luat.ts",
  "pos.agent-sap-het-phien:": "lib/payments/pos/agent/canh-bao-luat.ts",
  "pos.agent-loi:": "lib/payments/pos/agent/canh-bao-luat.ts",
  // `\`pause.gia-han-${duyet ? "da-duyet" : "tu-choi"}:…\`` — một dòng phát cho cả hai mốc.
  "pause.gia-han-da-duyet:": "lib/bao-luu/thong-bao.ts",
  "pause.gia-han-tu-choi:": "lib/bao-luu/thong-bao.ts",
};

function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function maNguon(): string {
  const goc = resolve(process.cwd());
  const ra: string[] = [];
  for (const thuMuc of ["lib", "app", "components"]) {
    for (const p of readdirSync(resolve(goc, thuMuc), { recursive: true })) {
      const tep = String(p).replaceAll("\\", "/");
      if (!/\.tsx?$/.test(tep) || /\.(test|spec)\.tsx?$/.test(tep)) continue;
      if (`${thuMuc}/${tep}` === "lib/notifications/catalog.ts") continue;
      ra.push(boChuThich(readFileSync(resolve(goc, thuMuc, tep), "utf8")));
    }
  }
  return ra.join("\n");
}

describe("[CAT-SONG] mọi mục trong danh mục còn nơi phát", () => {
  const src = maNguon();
  it("đối chứng dương: bộ dò THẤY một khoá chắc chắn đang phát", () => {
    expect(src.includes("lead.moi")).toBe(true);
  });
  it.each([...catalogPrefixes()])("%s", (prefix) => {
    if (KHOA_GHEP_DONG[prefix]) return;
    expect(src.includes(prefix.replace(/:$/, "")), `${prefix} không còn nơi phát`).toBe(true);
  });
});

describe("catalog — phủ hết nguồn sinh đang chạy", () => {
  it.each(KHOA_DANG_CHAY)("%s (%s) đã được khai", (key) => {
    expect(classifyNotification(key).known).toBe(true);
  });

  it("cả 14 loại việc tồn đều được khai, cả pending lẫn overdue", () => {
    for (const type of PENDING_SYNC_TYPES) {
      expect(classifyNotification(pendingSyncKey(type, "pending")).known).toBe(true);
      expect(classifyNotification(pendingSyncKey(type, "overdue")).known).toBe(true);
    }
  });

  it("khoá lạ rơi về Hệ thống/P3 và được đánh dấu chưa khai", () => {
    const r = classifyNotification("mot-thu-chua-tung-co:x");
    expect(r.known).toBe(false);
    expect(r.groupKey).toBe("system");
    expect(r.priority).toBe(3);
  });
});

describe("catalog — nhóm và mức", () => {
  it("mọi khai báo trả về nhóm hợp lệ và mức trong 1..3", () => {
    for (const [key] of KHOA_DANG_CHAY) {
      const r = classifyNotification(key);
      expect(isNotiGroupKey(r.groupKey)).toBe(true);
      expect([1, 2, 3]).toContain(r.priority);
    }
  });

  it("tin nhắn phụ huynh vào đúng nhóm parent_message", () => {
    expect(classifyNotification("conversation.message_posted:m1").groupKey).toBe("parent_message");
  });

  it("nhắc chốt buổi là Đến hạn mức khẩn", () => {
    const r = classifyNotification("session.close-reminder:s1");
    expect(r.groupKey).toBe("due_date");
    expect(r.priority).toBe(1);
  });

  it("điểm danh bị sửa hồi tố là việc phải làm, không phải tin tham khảo", () => {
    expect(classifyNotification("attendance.edited:s1").groupKey).toBe("action_required");
  });

  it("email hoá đơn không tới được khách là việc phải làm, mức thường, thuộc thanh toán", () => {
    expect(classifyNotification("hoa-don.gui-loi:g1:ke-toan")).toEqual({
      groupKey: "action_required",
      priority: 2,
      entityType: "payment",
      known: true,
    });
  });

  it("chuông lần thu chờ xuất hoá đơn là việc phải làm, mức thường — không phải tin hệ thống", () => {
    for (const key of ["hoa-don.cho-xuat:cs1:2026-09-28", "hoa-don.cho-xuat:tong:2026-09-28"]) {
      expect(classifyNotification(key)).toEqual({
        groupKey: "action_required",
        priority: 2,
        entityType: "payment",
        known: true,
      });
    }
  });

  it("[POS1-NT-01] thu thẻ POS: báo admin là việc phải làm thuộc ĐƠN; tiền phiếu gộp về là tin cho sale", () => {
    for (const key of ["pos.bao-admin:i1", "pos.loi-ket-noi:i1:2026-10-06T10", "pos.chua-xac-dinh:i1:2026-10-06T10"]) {
      const r = classifyNotification(key);
      expect(r.known, key).toBe(true);
      expect(r.groupKey, key).toBe("action_required");
      expect(r.entityType, key).toBe("order");
    }
    // "Chưa xác định — đừng cho quẹt lại" là việc KHẨN: tiền có thể đã trừ thẻ khách.
    expect(classifyNotification("pos.chua-xac-dinh:i1:2026-10-06T10").priority).toBe(1);
    const tien = classifyNotification("phieu-gop.da-chia:bt1:b1");
    expect(tien).toMatchObject({ known: true, entityType: "order" });
  });

  it("[POS2-NT-01] quét sạch cuối ngày: tiền tố RIÊNG (không lọt vào `pos.` chung), việc phải làm mức thường, thuộc TIỀN", () => {
    const r = classifyNotification("pos.quet-sach:2026-10-06");
    expect(r).toEqual({ groupKey: "action_required", priority: 2, entityType: "payment", known: true });
    // Khoá toàn hệ thống của lỗi kết nối vẫn rơi vào mục `pos.loi-ket-noi:` (không cần tiền tố mới).
    expect(classifyNotification("pos.loi-ket-noi:he-thong:2026-10-06T17")).toMatchObject({ known: true, groupKey: "action_required" });
  });

  it("[POS4-NT-01] máy đồng bộ POS: 4 tiền tố RIÊNG, việc phải làm; hết phiên KHẨN (P1), còn lại P2 — không lọt vào `pos.loi-ket-noi:`", () => {
    expect(classifyNotification("pos.agent-het-phien:cs1:2026-10-07")).toMatchObject({ known: true, groupKey: "action_required", priority: 1 });
    for (const key of ["pos.agent-mat-ket-noi:cs1:2026-10-07", "pos.agent-sap-het-phien:cs1:2026-10-07", "pos.agent-loi:cs1:2026-10-07"]) {
      expect(classifyNotification(key), key).toMatchObject({ known: true, groupKey: "action_required", priority: 2 });
    }
  });

  it("sinh nhật học viên là nhóm Hệ thống mức thấp — không được chen lên trên việc gấp", () => {
    expect(classifyNotification("birthday:g1").priority).toBe(3);
  });
});

describe("catalog — quy tắc nâng mức khi quá hạn", () => {
  it(":overdue của việc tồn luôn lên P1 dù mức khai là P2/P3", () => {
    // student_birthday khai P3, renewal khai P2 — cả hai phải thành P1 khi quá hạn.
    expect(classifyNotification("student_birthday:pending").priority).toBe(3);
    expect(classifyNotification("student_birthday:overdue").priority).toBe(1);
    expect(classifyNotification("renewal:pending").priority).toBe(2);
    expect(classifyNotification("renewal:overdue").priority).toBe(1);
  });

  it("nhóm KHÔNG đổi khi quá hạn — chỉ mức đổi", () => {
    expect(classifyNotification("student_care:overdue").groupKey).toBe("new_task");
    expect(classifyNotification("student_care:pending").groupKey).toBe("new_task");
  });

  it("khoá sự kiện kết thúc bằng ':overdue' KHÔNG bị nâng oan (không thuộc vòng việc tồn)", () => {
    // Không có loại việc nào tên "sla:first_touch" nên đây không phải khoá việc tồn.
    expect(classifyNotification("sla:first_touch:overdue").priority).toBe(1); // vốn đã P1 theo khai báo
    expect(classifyNotification("birthday:overdue").priority).toBe(3); // vẫn P3, không bị nâng
  });
});

describe("catalog — khớp tiền tố dài nhất", () => {
  it("payment-reconcile:unmatched: không bị nuốt bởi tiền tố ngắn hơn", () => {
    expect(classifyNotification("payment-reconcile:unmatched:2026-08-19").entityType).toBe("payment");
  });

  it("hai cặp tiền tố trial gần giống nhau KHÔNG nuốt nhau", () => {
    // Chúng phân biệt nhau ở một ký tự: sau "reminder"/"cong" là "-" chứ không phải ":".
    // Ca này canh đúng chỗ dễ hỏng nếu sau này ai đổi tên khoá cho "gọn".
    expect(classifyNotification("trial.reminder-gv:1-gio:s1").priority).toBe(1);
    expect(classifyNotification("trial.reminder:2-gio:e1:s1").priority).toBe(2);
    expect(classifyNotification("trial.cho-phan-cong-gap:s1").groupKey).toBe("due_date");
    expect(classifyNotification("trial.cho-phan-cong:s1").groupKey).toBe("new_task");
  });

  it("danh sách tiền tố được sắp dài trước", () => {
    const p = catalogPrefixes();
    for (let i = 1; i < p.length; i++) {
      expect(p[i - 1]!.length).toBeGreaterThanOrEqual(p[i]!.length);
    }
  });
});

describe("catalog — 5 nhóm theo PRD", () => {
  it("đúng 5 nhóm, đúng thứ tự hiển thị", () => {
    expect(NOTI_GROUPS.map((g) => g.key)).toEqual([
      "action_required",
      "parent_message",
      "new_task",
      "due_date",
      "system",
    ]);
  });

  it("nhãn tiếng Việt tra được, nhóm lạ trả 'Khác'", () => {
    expect(notiGroupLabel("parent_message")).toBe("Tin nhắn PH");
    expect(notiGroupLabel("khong_co")).toBe("Khác");
  });
});
