import { describe, it, expect } from "vitest";
import { pickDefaultSession, type SessionLike } from "./default-session";

// Hồi quy cho sự cố 19/08/2026 (admin không thấy điểm danh của GV). Ca "lớp đang chạy"
// bên dưới CHÍNH LÀ ca mà luật cũ (`find(date >= now)`) trả về buổi tương lai.

const d = (iso: string) => new Date(iso);
const s = (id: string, iso: string, status = "SCHEDULED"): SessionLike => ({
  id,
  date: d(iso),
  status,
});

// Mốc "hết hôm nay" giả lập: 19/08/2026 23:59:59 giờ VN ≈ 16:59:59Z.
const TODAY_END = d("2026-08-19T16:59:59.000Z");

describe("pickDefaultSession", () => {
  it("lớp đang chạy: lấy buổi ĐÃ DIỄN RA gần nhất, KHÔNG lấy buổi sắp tới", () => {
    const sessions = [
      s("b1", "2026-08-10T11:00:00Z"),
      s("b2", "2026-08-17T11:00:00Z"),
      s("b3", "2026-08-24T11:00:00Z"), // tương lai
      s("b4", "2026-08-31T11:00:00Z"), // tương lai
    ];
    expect(pickDefaultSession(sessions, TODAY_END)?.id).toBe("b2");
  });

  it("buổi HÔM NAY vẫn được coi là đã diễn ra (GV điểm danh cuối buổi)", () => {
    const sessions = [
      s("b1", "2026-08-17T11:00:00Z"),
      s("hom-nay", "2026-08-19T11:00:00Z"),
      s("b3", "2026-08-24T11:00:00Z"),
    ];
    expect(pickDefaultSession(sessions, TODAY_END)?.id).toBe("hom-nay");
  });

  it("bỏ qua buổi ĐÃ HUỶ khi chọn mặc định", () => {
    const sessions = [
      s("b1", "2026-08-10T11:00:00Z"),
      s("b2", "2026-08-17T11:00:00Z", "CANCELLED"),
    ];
    expect(pickDefaultSession(sessions, TODAY_END)?.id).toBe("b1");
  });

  it("lớp CHƯA khai giảng (toàn buổi tương lai): lấy buổi sắp tới đầu tiên", () => {
    const sessions = [
      s("b1", "2026-09-01T11:00:00Z"),
      s("b2", "2026-09-08T11:00:00Z"),
    ];
    expect(pickDefaultSession(sessions, TODAY_END)?.id).toBe("b1");
  });

  it("lớp đã dạy xong hết: lấy buổi cuối cùng", () => {
    const sessions = [
      s("b1", "2026-06-01T11:00:00Z"),
      s("b2", "2026-06-08T11:00:00Z"),
    ];
    expect(pickDefaultSession(sessions, TODAY_END)?.id).toBe("b2");
  });

  it("tất cả buổi đều huỷ: vẫn trả buổi cuối chứ không trả null", () => {
    const sessions = [
      s("b1", "2026-06-01T11:00:00Z", "CANCELLED"),
      s("b2", "2026-06-08T11:00:00Z", "CANCELLED"),
    ];
    expect(pickDefaultSession(sessions, TODAY_END)?.id).toBe("b2");
  });

  it("lớp chưa có buổi nào: null", () => {
    expect(pickDefaultSession([], TODAY_END)).toBeNull();
  });
});
