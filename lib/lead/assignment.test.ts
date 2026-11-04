// Đợt A (kế hoạch Site Sale, 21/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// BỆNH: đo trên prod 21/08 — 33 lead có vết chia nhưng **chỉ 1** có `Lead.assignedAt`.
// Nguyên nhân: `autoAssignNewLead`, `manualAssignLead`, `transferLead`,
// `bulkReassignLeads` đều đổi chủ lead mà KHÔNG ghi mốc phân công.
//
// HỆ QUẢ: `evaluateSla` đọc `assignedAt` để tính SLA-2 ("đã bàn giao mà chưa phân
// công") và SLA-3 ("đã phân công mà chưa liên hệ"). Không có mốc ⇒ **hai cảnh báo
// đó không bao giờ kêu**, và mọi cơ chế thu hồi lead sau này đứng trên đồng hồ chết.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { assignmentWrite } from "./assignment";

const NOW = new Date("2026-08-21T09:30:00.000Z");

describe("[Đợt A] assignmentWrite — đổi chủ lead thì phải ghi mốc phân công", () => {
  it("gán cho một người → ghi CẢ chủ lẫn mốc", () => {
    expect(assignmentWrite("user-1", NOW)).toEqual({
      assignedToId: "user-1",
      assignedAt: NOW,
    });
  });

  it("bỏ gán (về vô chủ) → xoá CẢ chủ lẫn mốc", () => {
    // Để lại mốc cũ khi lead đã vô chủ là nói dối đồng hồ: SLA-2 kiểm "chưa phân
    // công" bằng chính `assignedAt IS NULL`, giữ mốc cũ = cảnh báo không bao giờ kêu.
    expect(assignmentWrite(null, NOW)).toEqual({
      assignedToId: null,
      assignedAt: null,
    });
  });

  it("chuỗi rỗng coi như bỏ gán, không phải một id hợp lệ", () => {
    expect(assignmentWrite("", NOW)).toEqual({ assignedToId: null, assignedAt: null });
    expect(assignmentWrite("   ", NOW)).toEqual({ assignedToId: null, assignedAt: null });
  });

  it("mốc dùng đúng thời điểm được truyền vào (test không phụ thuộc đồng hồ máy)", () => {
    const other = new Date("2020-01-01T00:00:00.000Z");
    expect(assignmentWrite("user-1", other).assignedAt).toEqual(other);
  });

  it("không truyền thời điểm → lấy hiện tại", () => {
    const before = Date.now();
    const at = assignmentWrite("user-1").assignedAt!;
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("đổi chủ lần 2 làm MỚI mốc — người nhận mới có cửa sổ SLA riêng", () => {
    const lan1 = assignmentWrite("user-1", new Date("2026-08-01T00:00:00.000Z"));
    const lan2 = assignmentWrite("user-2", NOW);
    expect(lan2.assignedAt!.getTime()).toBeGreaterThan(lan1.assignedAt!.getTime());
  });
});

/**
 * Chốt chặn hồi quy: bốn đường đổi chủ lead phải đi qua helper.
 *
 * Test này bắt lỗi mà unit test thuần không bắt được — ai đó viết lại khối
 * `lead.update({ data: { assignedToId } })` bằng tay và quên mốc, y như lần trước.
 */
describe("[Đợt A] mọi đường đổi chủ lead đều dùng assignmentWrite()", () => {
  const ROOT = process.cwd();
  const DUONG_DOI_CHU = [
    "lib/lead/auto-assign.ts", // autoAssignNewLead + manualAssignLead
    "lib/lead/assign.ts", // đường CŨ: autoAssignLead + reassignOpenLeads (3 webhook)
    "lib/lead-handover/service.ts", // bàn giao hàng loạt khi sale nghỉ
    "app/(admin)/admin/leads/actions.ts", // transferLead — chuyển lead + đổi cơ sở
  ];

  it.each(DUONG_DOI_CHU)("%s dùng assignmentWrite()", (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    expect(
      src.includes("assignmentWrite("),
      `${rel} đổi chủ lead nhưng không đi qua assignmentWrite() ⇒ nhiều khả năng quên ghi assignedAt.`,
    ).toBe(true);
  });

  it("mọi lệnh ghi lên bảng Lead có đổi chủ đều đi qua assignmentWrite()", () => {
    // Chỉ soi đúng đối tượng: lời gọi `lead.update(...)`. Nhờ vậy không đụng nhầm
    // `assignedToId` ở chỗ khác — bộ lọc `where`, `select`, `oldValues/newValues`
    // của audit, hay `LeadTask.assignedToId` (model khác, người nhận VIỆC).
    const viPham: string[] = [];
    for (const rel of DUONG_DOI_CHU) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const re = /\.lead\.update\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Cắt đúng thân lời gọi (tới `})` đóng update), không lấy dư sang code
        // phía sau — nếu không sẽ bắt nhầm những chỗ chỉ nhắc `assignedToId`
        // trong giá trị trả về ngay bên dưới.
        const ket = src.indexOf("})", m.index);
        const cuaSo = src.slice(m.index, ket === -1 ? m.index + 400 : ket);
        if (/assignedToId\s*:/.test(cuaSo) && !/assignmentWrite\(/.test(cuaSo)) {
          const dong = src.slice(0, m.index).split("\n").length;
          viPham.push(`${rel}:${dong} — lead.update đổi chủ nhưng không dùng assignmentWrite()`);
        }
      }
    }
    expect(viPham, viPham.join("\n")).toEqual([]);
  });
});
