import { describe, it, expect } from "vitest";
import {
  buildBadge,
  buildTabTitlePrefix,
  scoreNotification,
  sortForPanel,
  BADGE_MIN_COUNT,
  BADGE_MAX_COUNT,
} from "./badge";

const T0 = new Date("2026-08-19T10:00:00+07:00");
const phutTruoc = (m: number) => new Date(T0.getTime() - m * 60_000);

describe("buildBadge — 4 mốc của PRD §7.3", () => {
  it("0 chưa đọc → không chấm, không số", () => {
    const b = buildBadge(0, false);
    expect(b.showDot).toBe(false);
    expect(b.label).toBe("");
  });

  it("1 chưa đọc → CHẤM ĐỎ, KHÔNG có số", () => {
    const b = buildBadge(1, false);
    expect(b.showDot).toBe(true);
    expect(b.label).toBe("");
  });

  it("2–9 → hiện đúng số", () => {
    expect(buildBadge(2, false).label).toBe("2");
    expect(buildBadge(5, false).label).toBe("5");
    expect(buildBadge(9, false).label).toBe("9");
  });

  it("≥10 → 9+", () => {
    expect(buildBadge(10, false).label).toBe("9+");
    expect(buildBadge(137, false).label).toBe("9+");
  });

  it("hằng số ngưỡng đúng như PRD chốt", () => {
    expect(BADGE_MIN_COUNT).toBe(2);
    expect(BADGE_MAX_COUNT).toBe(9);
  });
});

describe("buildBadge — mức khẩn và aria", () => {
  it("có mục khẩn thì cờ được bật để chip đổi màu", () => {
    expect(buildBadge(3, true).hasPriority1).toBe(true);
    expect(buildBadge(3, false).hasPriority1).toBe(false);
  });

  it("0 chưa đọc thì không bao giờ báo khẩn, kể cả bị truyền cờ sai", () => {
    expect(buildBadge(0, true).hasPriority1).toBe(false);
  });

  it("aria mô tả đúng số lượng và tình trạng khẩn", () => {
    expect(buildBadge(9, false).ariaLabel).toBe("Thông báo, 9 mục chưa đọc");
    expect(buildBadge(25, true).ariaLabel).toBe(
      "Thông báo, 9 hoặc nhiều hơn mục chưa đọc, trong đó có mục khẩn",
    );
    expect(buildBadge(0, false).ariaLabel).toBe("Thông báo, không có mục chưa đọc");
  });

  it("số âm hoặc số lẻ do lỗi đếm không làm vỡ badge", () => {
    expect(buildBadge(-3, false).showDot).toBe(false);
    expect(buildBadge(2.7, false).label).toBe("2");
  });
});

describe("buildTabTitlePrefix — KHÁC chuông một cách có chủ ý", () => {
  it("hiện (1) ngay từ mục đầu tiên, trong khi chuông chỉ có chấm", () => {
    expect(buildTabTitlePrefix(1)).toBe("(1) ");
    expect(buildBadge(1, false).label).toBe("");
  });

  it("0 → không có tiền tố", () => {
    expect(buildTabTitlePrefix(0)).toBe("");
  });

  it("≥10 → (9+) — dùng chung ngưỡng với chuông cho nhất quán", () => {
    expect(buildTabTitlePrefix(10)).toBe("(9+) ");
    expect(buildTabTitlePrefix(400)).toBe("(9+) ");
  });
});

describe("scoreNotification — công thức PRD §7.5", () => {
  it("mức ưu tiên lấn át mọi thứ khác", () => {
    const p1Moi = { priority: 1, groupKey: "system", createdAt: T0, readAt: null };
    const p2Cu = { priority: 2, groupKey: "parent_message", createdAt: phutTruoc(10_000), readAt: null };
    expect(scoreNotification(p1Moi, T0)).toBeGreaterThan(scoreNotification(p2Cu, T0));
  });

  it("cùng mức thì chờ lâu hơn được điểm cao hơn", () => {
    const cu = { priority: 2, groupKey: "system", createdAt: phutTruoc(600), readAt: null };
    const moi = { priority: 2, groupKey: "system", createdAt: phutTruoc(5), readAt: null };
    expect(scoreNotification(cu, T0)).toBeGreaterThan(scoreNotification(moi, T0));
  });

  it("điểm tuổi có trần — chờ 3 ngày và chờ 3 tháng cho cùng một điểm", () => {
    const baNgay = { priority: 2, groupKey: "system", createdAt: phutTruoc(3 * 24 * 60), readAt: null };
    const baThang = { priority: 2, groupKey: "system", createdAt: phutTruoc(90 * 24 * 60), readAt: null };
    expect(scoreNotification(baNgay, T0)).toBe(scoreNotification(baThang, T0));
  });

  it("tin nhắn phụ huynh được đẩy lên trước ở CÙNG mức", () => {
    const ph = { priority: 2, groupKey: "parent_message", createdAt: T0, readAt: null };
    const khac = { priority: 2, groupKey: "new_task", createdAt: T0, readAt: null };
    expect(scoreNotification(ph, T0)).toBeGreaterThan(scoreNotification(khac, T0));
  });

  it("điểm nhóm KHÔNG đủ để vượt một mức ưu tiên", () => {
    const phP2 = { priority: 2, groupKey: "parent_message", createdAt: phutTruoc(10_000), readAt: null };
    const p1 = { priority: 1, groupKey: "system", createdAt: T0, readAt: null };
    expect(scoreNotification(p1, T0)).toBeGreaterThan(scoreNotification(phP2, T0));
  });
});

describe("sortForPanel", () => {
  it("CHƯA ĐỌC luôn trên ĐÃ ĐỌC, kể cả khi mục đã đọc điểm cao hơn", () => {
    const daDocKhan = { id: "a", priority: 1, groupKey: "due_date", createdAt: phutTruoc(5000), readAt: T0 };
    const chuaDocThuong = { id: "b", priority: 3, groupKey: "system", createdAt: T0, readAt: null };
    const out = sortForPanel([daDocKhan, chuaDocThuong], T0);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("quá hạn (P1) nằm trên cùng bất kể thời gian tạo", () => {
    const rows = [
      { id: "moi", priority: 2, groupKey: "new_task", createdAt: T0, readAt: null },
      { id: "quahan", priority: 1, groupKey: "due_date", createdAt: phutTruoc(2000), readAt: null },
      { id: "tham-khao", priority: 3, groupKey: "system", createdAt: phutTruoc(1), readAt: null },
    ];
    expect(sortForPanel(rows, T0)[0]!.id).toBe("quahan");
  });

  it("cùng điểm thì mới nhất lên trước", () => {
    const rows = [
      { id: "cu", priority: 2, groupKey: "system", createdAt: phutTruoc(2), readAt: null },
      { id: "moi", priority: 2, groupKey: "system", createdAt: phutTruoc(1), readAt: null },
    ];
    expect(sortForPanel(rows, T0).map((x) => x.id)).toEqual(["moi", "cu"]);
  });

  it("không làm biến đổi mảng gốc", () => {
    const rows = [
      { id: "a", priority: 3, groupKey: "system", createdAt: phutTruoc(1), readAt: null },
      { id: "b", priority: 1, groupKey: "system", createdAt: phutTruoc(1), readAt: null },
    ];
    const snapshot = rows.map((r) => r.id);
    sortForPanel(rows, T0);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });

  it("danh sách rỗng không vỡ", () => {
    expect(sortForPanel([], T0)).toEqual([]);
  });
});
