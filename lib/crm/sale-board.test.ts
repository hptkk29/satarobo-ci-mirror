// Test bảng việc của tư vấn viên — phần THUẦN.
//
// Hai thứ đáng khoá:
//  1. Bảng chỉ hiện luật SLA mà chính người phụ trách BẤM ĐƯỢC. Một bảng có việc
//     không làm được thì lần sau người ta không mở nữa.
//  2. Mốc "hôm nay" theo giờ Việt Nam. Việc hạn 23h tối mà UTC đã sang ngày mới
//     thì với người dùng nó vẫn là việc hôm nay — xếp nhầm sang "sắp tới" là
//     giấu mất đúng việc gấp nhất.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  cuoiNgayVN,
  loLuatCuaSale,
  LUAT_CUA_SALE,
  phanNhomViec,
  type ViecItem,
} from "./sale-board";
import { SLA_THRESHOLDS } from "./sla";

const viec = (id: string, dueAt: string): ViecItem => ({
  id,
  title: `việc ${id}`,
  dueAt: new Date(dueAt),
  leadId: `lead-${id}`,
  tenKhach: "PH Test",
});

describe("[bảng việc] phanNhomViec — chia theo hạn", () => {
  // 10:00 giờ VN ngày 24/08 = 03:00 UTC cùng ngày.
  const now = new Date("2026-08-24T03:00:00.000Z");

  it("việc đã qua hạn → nhóm quá hạn", () => {
    const r = phanNhomViec([viec("a", "2026-08-23T03:00:00.000Z")], now);
    expect(r.quaHan.map((x) => x.id)).toEqual(["a"]);
    expect(r.homNay).toEqual([]);
  });

  it("việc hạn cuối ngày hôm nay (23h VN) → HÔM NAY, không phải sắp tới", () => {
    // 23:00 VN ngày 24/08 = 16:00 UTC ngày 24/08. Nếu cắt ngày theo UTC thì mốc
    // này vẫn trong ngày UTC nên may mà đúng — nên dùng mốc 23:30 VN = 16:30 UTC,
    // và thêm một ca 00:30 VN ngày mai để bắt đúng chỗ lệch.
    const r = phanNhomViec([viec("a", "2026-08-24T16:30:00.000Z")], now);
    expect(r.homNay.map((x) => x.id)).toEqual(["a"]);
    expect(r.sapToi).toEqual([]);
  });

  it("việc 00:30 sáng MAI (giờ VN) → sắp tới, không lẫn vào hôm nay", () => {
    // 00:30 VN ngày 25/08 = 17:30 UTC ngày 24/08 — cùng NGÀY UTC với `now`.
    // Cắt ngày theo UTC sẽ xếp nhầm nó vào hôm nay.
    const r = phanNhomViec([viec("a", "2026-08-24T17:30:00.000Z")], now);
    expect(r.sapToi.map((x) => x.id)).toEqual(["a"]);
    expect(r.homNay).toEqual([]);
  });

  it("không mất việc nào — ba nhóm cộng lại bằng đầu vào", () => {
    const ds = [
      viec("a", "2026-08-20T00:00:00.000Z"),
      viec("b", "2026-08-24T10:00:00.000Z"),
      viec("c", "2026-09-01T00:00:00.000Z"),
    ];
    const r = phanNhomViec(ds, now);
    expect(r.quaHan.length + r.homNay.length + r.sapToi.length).toBe(3);
  });

  it("cuoiNgayVN trả đúng 23:59:59.999 giờ VN", () => {
    const c = cuoiNgayVN(now);
    // 23:59:59.999 VN ngày 24/08 = 16:59:59.999 UTC cùng ngày.
    expect(c.toISOString()).toBe("2026-08-24T16:59:59.999Z");
  });
});

describe("[bảng việc] loLuatCuaSale — chỉ hai luật người phụ trách bấm được", () => {
  const now = new Date("2026-08-24T03:00:00.000Z");
  const cachDay = (h: number) => new Date(now.getTime() - h * 3_600_000);

  const nen = {
    status: "MOI" as const,
    qualifiedAt: null,
    handedAt: null,
    receivedConfirmedAt: null,
    assignedAt: null,
    firstContactAt: null,
    lastActivityAt: null,
    createdAt: cachDay(1),
  };

  it("đã nhận khách 5 giờ mà chưa liên hệ → SLA-3", () => {
    const r = loLuatCuaSale({ ...nen, assignedAt: cachDay(5) }, now, SLA_THRESHOLDS);
    expect(r).toContain("SLA-3");
  });

  it("khách im 3 ngày → SLA-4", () => {
    const r = loLuatCuaSale(
      { ...nen, assignedAt: cachDay(100), firstContactAt: cachDay(90), lastActivityAt: cachDay(72) },
      now,
      SLA_THRESHOLDS,
    );
    expect(r).toContain("SLA-4");
  });

  it("KHÔNG hiện SLA-2 (chưa phân công) — vô nghĩa với chính người đã được phân công", () => {
    // Dựng đúng ca kích SLA-2: đã bàn giao 2 giờ trước, chưa có assignedAt.
    const r = loLuatCuaSale({ ...nen, handedAt: cachDay(2) }, now, SLA_THRESHOLDS);
    expect(r).not.toContain("SLA-2");
    for (const luat of r) expect(LUAT_CUA_SALE).toContain(luat);
  });

  it("KHÔNG hiện SLA-1 (chưa bàn giao) — chặng trước khi lead về tay sale", () => {
    const r = loLuatCuaSale({ ...nen, qualifiedAt: cachDay(10) }, now, SLA_THRESHOLDS);
    expect(r).not.toContain("SLA-1");
  });

  it("khách ĐÃ MẤT im lâu → KHÔNG báo (đây là chỗ cron đang sai)", () => {
    // `slaInputFromLead` không set `resolved` nên `evaluateSla` coi mọi lead là
    // chưa xong ⇒ cron bắn SLA-4 cho cả lead LOST. Bảng này truyền `resolved`
    // đúng theo trạng thái nên không kế thừa lỗi đó.
    const daMat = {
      ...nen,
      status: "DA_MAT" as const,
      assignedAt: cachDay(200),
      firstContactAt: cachDay(190),
      lastActivityAt: cachDay(100),
    };
    expect(loLuatCuaSale(daMat, now, SLA_THRESHOLDS)).toEqual([]);
    // Đối chứng: cùng dữ liệu nhưng còn đang chăm thì PHẢI báo.
    expect(
      loLuatCuaSale({ ...daMat, status: "MOI" as const }, now, SLA_THRESHOLDS),
    ).toContain("SLA-4");
  });

  it("khách vừa chạm xong → không có việc gì", () => {
    const r = loLuatCuaSale(
      { ...nen, assignedAt: cachDay(50), firstContactAt: cachDay(49), lastActivityAt: cachDay(1) },
      now,
      SLA_THRESHOLDS,
    );
    expect(r).toEqual([]);
  });
});

describe("[bảng việc] chốt chặn nguồn", () => {
  const src = () => fs.readFileSync("lib/crm/sale-board.ts", "utf8");
  const boChuThich = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("đi scopedDb + mệnh đề sở hữu, không `db` trần", () => {
    const s = boChuThich(src());
    expect(s).toContain("scopedDb(actor)");
    expect(s).toContain("leadOwnershipWhere(userId)");
    expect(s).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("[S-4] khối SLA lọc theo NGƯỜI PHỤ TRÁCH, không theo người nhập", () => {
    // S-4 nới "khách của tôi" sang cả phiếu mình nhập — đúng cho DANH SÁCH, sai
    // cho BẢNG VIỆC. Phiếu Sale Hội sở nhập được chia cho Sale cơ sở; người phải
    // gọi điện là Sale cơ sở. Đổ SLA của họ lên bảng của Hội sở là (a) đếm đôi
    // `soKhachDangMo` trên hai màn, (b) bày việc mà người xem không bấm được.
    const s = boChuThich(src());
    const i = s.indexOf("sdb.lead.findMany");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 400)).toContain("leadPhuTrachWhere(userId)");
    expect(s.slice(i, i + 400)).not.toContain("leadOwnershipWhere(userId)");
  });

  it("[S-4] khối việc follow-up VẪN dùng mệnh đề rộng — việc giao cho tôi thì phải hiện", () => {
    // Ngược lại với khối trên: `LeadTask` đã lọc `assignedToId: userId` trên
    // CHÍNH cái việc, nên mệnh đề lead chỉ còn là hàng rào cách ly. Siết nó lại
    // là giấu mất việc đã giao đích danh cho người đang xem.
    const s = boChuThich(src());
    const i = s.indexOf("leadTask.findMany");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 400)).toContain("leadOwnershipWhere(userId)");
  });

  it("truy vấn LeadTask lọc qua quan hệ lead — model đó KHÔNG được scopedDb tự lọc", () => {
    // `LeadTask` không nằm trong SCOPED_MODELS. Quên lọc qua `lead` là đọc lọt
    // việc của cơ sở khác mà không có gì báo.
    const s = boChuThich(src());
    const i = s.indexOf("leadTask.findMany");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 500)).toContain("lead: { deletedAt: null");
  });

  it("dùng ngưỡng ĐỘNG từ cấu hình, không hằng số cứng", () => {
    // Ngưỡng SLA đổi được ở màn cấu hình vận hành; đọc hằng số là màn hình nói
    // một đằng, cấu hình một nẻo.
    expect(boChuThich(src())).toContain("loadSlaThresholds()");
  });
});
