// lib/leads/status.test.ts — GĐ0: khoá "một nguồn sự thật" cho trạng thái lead.
//
// Vì sao bộ test này tồn tại: trước GĐ0, nhãn/màu/danh sách hợp lệ/danh sách
// "đã kết thúc" của LeadStatus bị chép ở 6 nơi với nội dung LỆCH NHAU. TypeScript
// chỉ bắt được thiếu key trong `Record<LeadStatus, …>`; nó KHÔNG bắt được:
//   - mảng literal `LeadStatus[]` thiếu giá trị (vd KANBAN_COLUMNS bỏ sót 1 cột),
//   - mảng literal còn giữ giá trị đã bị xoá khỏi enum (lỗi nổ lúc chạy, không lúc build),
//   - bảng tra cứu khai `Record<string, string>` (thiếu key thì hiện raw enum ra UI).
// Đó chính là ba cách mà GĐ5 (đổi tên + gộp enum) sẽ rò rỉ nếu không có lưới này.
import { describe, it, expect } from "vitest";
import { LeadStatus } from "@prisma/client";
import {
  LEAD_STATUS_VALUES,
  ALL_LEAD_STATUSES,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_LABEL_SHORT,
  LEAD_STATUS_BADGE,
  LEAD_STATUS_ACCENT,
  LEAD_STATUS_VARIANT,
  LEAD_STATUS_DOT,
  KANBAN_COLUMNS,
  LEAD_FUNNEL_STAGES,
  LEAD_FUNNEL_EXCLUDED,
  LEAD_CLOSED_STATUSES,
  LEAD_PIPELINE_EXIT_STATUSES,
  CONVERTED_STATUSES,
  leadStatusLabel,
  canTransitionLeadStatus,
} from "./status";
import { FUNNEL_ORDER, STATUS_RANK } from "@/lib/reports/lead";

/** Giá trị enum LeadStatus thật, đọc từ Prisma Client lúc chạy. */
const ENUM_VALUES = Object.values(LeadStatus) as LeadStatus[];

describe("LEAD_STATUS_VALUES là nguồn sự thật", () => {
  it("phủ ĐÚNG bộ giá trị của enum Prisma — không thiếu, không thừa", () => {
    expect([...LEAD_STATUS_VALUES].sort()).toEqual([...ENUM_VALUES].sort());
  });

  it("không có giá trị lặp", () => {
    expect(new Set(LEAD_STATUS_VALUES).size).toBe(LEAD_STATUS_VALUES.length);
  });

  it("ALL_LEAD_STATUSES suy ra từ nó, không phải bản chép tay", () => {
    expect(ALL_LEAD_STATUSES).toEqual([...LEAD_STATUS_VALUES]);
  });
});

describe("mọi bảng tra cứu phủ đủ enum", () => {
  // Khai theo cặp để thông báo lỗi chỉ đích danh bảng nào hỏng.
  const TABLES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["LEAD_STATUS_LABEL", LEAD_STATUS_LABEL],
    ["LEAD_STATUS_LABEL_SHORT", LEAD_STATUS_LABEL_SHORT],
    ["LEAD_STATUS_BADGE", LEAD_STATUS_BADGE],
    ["LEAD_STATUS_ACCENT", LEAD_STATUS_ACCENT],
    ["LEAD_STATUS_VARIANT", LEAD_STATUS_VARIANT],
    ["LEAD_STATUS_DOT", LEAD_STATUS_DOT],
  ];

  it.each(TABLES)("%s có key cho mọi giá trị enum", (_ten, table) => {
    const thieu = ENUM_VALUES.filter((v) => table[v] == null);
    expect(thieu).toEqual([]);
  });

  it.each(TABLES)("%s không có key thừa (giá trị đã xoá khỏi enum)", (_ten, table) => {
    const thua = Object.keys(table).filter(
      (k) => !ENUM_VALUES.includes(k as LeadStatus),
    );
    expect(thua).toEqual([]);
  });

  it("leadStatusLabel trả nhãn cho mọi giá trị, không rơi về raw enum", () => {
    for (const v of ENUM_VALUES) {
      expect(leadStatusLabel(v)).not.toBe(v);
    }
  });

  it("leadStatusLabel trả chính chuỗi vào khi gặp giá trị lạ", () => {
    expect(leadStatusLabel("KHONG_TON_TAI")).toBe("KHONG_TON_TAI");
  });
});

describe("các tập con đều nằm trong enum", () => {
  const SUBSETS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["KANBAN_COLUMNS", KANBAN_COLUMNS],
    ["LEAD_CLOSED_STATUSES", LEAD_CLOSED_STATUSES],
    ["LEAD_PIPELINE_EXIT_STATUSES", LEAD_PIPELINE_EXIT_STATUSES],
    ["CONVERTED_STATUSES", [...CONVERTED_STATUSES]],
    ["FUNNEL_ORDER", FUNNEL_ORDER],
    ["STATUS_RANK", Object.keys(STATUS_RANK)],
  ];

  it.each(SUBSETS)("%s chỉ chứa giá trị enum hợp lệ", (_ten, arr) => {
    const la = arr.filter((v) => !ENUM_VALUES.includes(v as LeadStatus));
    expect(la).toEqual([]);
  });

  it.each(SUBSETS)("%s không lặp giá trị", (_ten, arr) => {
    expect(new Set(arr).size).toBe(arr.length);
  });
});

describe("hai tập 'kết thúc' tách theo mục đích, không gộp làm một", () => {
  // LEAD_CLOSED_STATUSES = lead đã đóng hẳn (dùng cho đếm tải round-robin, bàn giao).
  // LEAD_PIPELINE_EXIT_STATUSES = đã rời phễu, gồm cả DA_DANG_KY (dùng cho module trial:
  // lead đã ghi nhận tiền thì tiến độ học thử KHÔNG được đẩy trạng thái nữa).
  it("tập rời phễu bao trùm tập đã đóng", () => {
    for (const s of LEAD_CLOSED_STATUSES) {
      expect(LEAD_PIPELINE_EXIT_STATUSES).toContain(s);
    }
  });

  it("tập rời phễu có thêm đúng DA_DANG_KY", () => {
    const them = LEAD_PIPELINE_EXIT_STATUSES.filter(
      (s) => !LEAD_CLOSED_STATUSES.includes(s),
    );
    expect(them).toEqual(["DA_DANG_KY"]);
  });

  it("DA_DANG_KY KHÔNG nằm trong tập đã đóng — lead đã đăng ký vẫn là việc đang mở của sale", () => {
    expect(LEAD_CLOSED_STATUSES).not.toContain("DA_DANG_KY");
  });
});

describe("phễu CRM phủ hết trạng thái", () => {
  // Đây là lỗi GĐ0 vá: bản chép cũ ở màn CRM bỏ sót DANG_HOC_THU (TRIAL_IN_PROGRESS)
  // và DA_DANG_KY (REGISTERED), nên lead đang học thử dở và lead ĐÃ ghi nhận tiền
  // không rơi vào bậc nào.
  const trongPheu = LEAD_FUNNEL_STAGES.flatMap((s) => s.statuses);

  it("mọi trạng thái đều có bậc, trừ nhóm loại có chủ đích", () => {
    const chuaXep = ENUM_VALUES.filter(
      (v) => !trongPheu.includes(v) && !LEAD_FUNNEL_EXCLUDED.includes(v),
    );
    expect(chuaXep).toEqual([]);
  });

  it("một trạng thái chỉ thuộc đúng một bậc", () => {
    expect(new Set(trongPheu).size).toBe(trongPheu.length);
  });

  it("nhóm loại và nhóm trong phễu không giao nhau", () => {
    const giao = LEAD_FUNNEL_EXCLUDED.filter((v) => trongPheu.includes(v));
    expect(giao).toEqual([]);
  });

  it("bậc 'Đã chốt' khớp với CONVERTED_STATUSES của báo cáo Lead", () => {
    const daChot = LEAD_FUNNEL_STAGES.find((s) => s.name === "Đã chốt");
    expect(daChot).toBeDefined();
    expect([...(daChot?.statuses ?? [])].sort()).toEqual([...CONVERTED_STATUSES].sort());
  });
});

describe("KANBAN_COLUMNS", () => {
  // GĐ5 ĐỔI KHẲNG ĐỊNH: bản cũ khoá "vắng ĐÚNG một cột DEMO_SCHEDULED" vì giá trị đó
  // đã deprecated nhưng vẫn còn trong enum. Nay DEMO_SCHEDULED đã bị gỡ hẳn (gộp vào
  // DA_HEN_HOC_THU) nên không còn ngoại lệ nào — bảng Kanban phải phủ ĐỦ enum. Giữ
  // khẳng định cũ thì test xanh giả: nó chỉ so một mảng rỗng với một mảng rỗng.
  it("phủ đủ enum — không cột nào bị bỏ quên", () => {
    const vang = ENUM_VALUES.filter((v) => !KANBAN_COLUMNS.includes(v));
    expect(vang).toEqual([]);
  });

  it("không có cột thừa (giá trị đã xoá khỏi enum)", () => {
    const thua = KANBAN_COLUMNS.filter((v) => !ENUM_VALUES.includes(v));
    expect(thua).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ảnh chụp phễu — bản GĐ5. Bản GĐ0 chốt hành vi CŨ (8 bậc, tên tiếng Anh) đúng
// để lượt rút enum này biết con số nào đổi; nay enum đã rút nên ảnh chụp phải
// chụp lại, không thì nó khoá một hiện trạng không còn tồn tại.
//
// ĐỔI KHẲNG ĐỊNH (GĐ5): phễu còn 7 bậc thay vì 8 — NEW và ASSIGNED cùng ánh xạ về
// MOI, vì "đã phân công" nay là chức năng của `Lead.assignedToId` chứ không phải một
// bậc chuyển đổi. Số bậc phễu ở báo cáo VÌ THẾ giảm 1; đó là thay đổi số liệu có
// chủ đích, không phải hồi quy.
// ─────────────────────────────────────────────────────────────────────────────
describe("ảnh chụp phễu sau khi rút enum", () => {
  it("FUNNEL_ORDER còn 7 bậc theo SR.QD.217", () => {
    expect(FUNNEL_ORDER).toEqual([
      "MOI",
      "DA_LIEN_HE",
      "DANG_TU_VAN",
      "DA_HEN_HOC_THU",
      "DA_HOC_THU",
      "CHO_QUYET_DINH",
      "DA_DANG_KY",
    ]);
  });

  it("DANG_HOC_THU và DANG_NUOI_DUONG có bậc tích luỹ, không rơi ra ngoài phễu", () => {
    // Hai giá trị này KHÔNG phải bậc riêng: đang học thử vẫn tính là đã hẹn học thử,
    // đang nuôi dưỡng vẫn tính là đã tư vấn. Cặp cũ (REGISTERED ↔ ENROLLED) không còn
    // kiểm được nữa vì hai giá trị đó đã gộp làm một — so chúng là so chính nó.
    expect(STATUS_RANK.DANG_HOC_THU).toBe(STATUS_RANK.DA_HEN_HOC_THU);
    expect(STATUS_RANK.DANG_NUOI_DUONG).toBe(STATUS_RANK.DANG_TU_VAN);
  });

  it("chỉ DA_MAT nằm ngoài phễu", () => {
    // Cũ là LOST + DUPLICATE. DUPLICATE đã gỡ khỏi enum (chống trùng nay làm bằng
    // ràng buộc lúc tạo lead), nên chỉ còn đúng một giá trị ngoài phễu.
    const ngoai = ENUM_VALUES.filter((v) => (STATUS_RANK[v] ?? -1) < 0);
    expect(ngoai.sort()).toEqual(["DA_MAT"]);
  });
});

describe("canTransitionLeadStatus — nay permissive HOÀN TOÀN", () => {
  it("cho phép mọi chuyển đổi thường", () => {
    expect(canTransitionLeadStatus("MOI", "DA_MAT").ok).toBe(true);
    expect(canTransitionLeadStatus("DANG_TU_VAN", "DANG_NUOI_DUONG").ok).toBe(true);
  });

  it("no-op luôn hợp lệ", () => {
    expect(canTransitionLeadStatus("DA_MAT", "DA_MAT").ok).toBe(true);
  });

  // ĐỔI KHẲNG ĐỊNH (GĐ5): bản cũ khoá "chỉ chặn vào REGISTERED khi chưa có khoản ghi
  // nhận" và "vào REGISTERED phải đi từ AWAITING_DECISION". Nhánh đó ĐÃ GỠ khỏi
  // `canTransitionLeadStatus`: sau khi ENROLLED gộp vào DA_DANG_KY, nó chặn luôn cả
  // đường convert hợp lệ. Cổng tiền THẬT nằm ở `evaluatePaymentGuard` (lib/crm/
  // convert-lead-v2.ts) — có kiểm cả trường hợp học bổng 100% mà nhánh cũ không kiểm.
  // Vì vậy khẳng định đúng bây giờ là: hàm này KHÔNG chặn, và tham số hasRecordedPayment
  // không còn tác dụng. Giữ khẳng định cũ = khoá một cổng đã dời đi nơi khác.
  it("KHÔNG còn chặn đường vào DA_DANG_KY — cổng tiền đã dời sang evaluatePaymentGuard", () => {
    expect(canTransitionLeadStatus("CHO_QUYET_DINH", "DA_DANG_KY", { hasRecordedPayment: true }).ok).toBe(true);
    expect(canTransitionLeadStatus("CHO_QUYET_DINH", "DA_DANG_KY", { hasRecordedPayment: false }).ok).toBe(true);
    expect(canTransitionLeadStatus("DANG_TU_VAN", "DA_DANG_KY", { hasRecordedPayment: true }).ok).toBe(true);
  });

  it("mọi cặp trạng thái đều hợp lệ — không cặp nào bị chặn ngầm", () => {
    for (const from of ENUM_VALUES) {
      for (const to of ENUM_VALUES) {
        expect(canTransitionLeadStatus(from, to).ok).toBe(true);
      }
    }
  });
});
