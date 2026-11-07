// Ca [QNT-*] — thông báo ngoại lệ của scanner bóng (Invoice Hub S8). THUẦN.
// Luật: chỉ báo ngoại lệ MỚI; người nhận suy từ DỮ LIỆU quyền của TỪNG cơ sở (không gõ cứng vai, không chéo cơ sở); không PII, không số tiền.
import { describe, expect, it } from "vitest";
import { dungThongBaoNgoaiLe, HREF_NGOAI_LE, TIEN_TO_NGOAI_LE, type MoiTheoCoSo } from "./quet-nghia-vu-thong-bao";

const cs1: MoiTheoCoSo = { centerId: "cs1", ten: "Cơ sở Nguyễn Hữu Thọ", moi: 2, khan: 1, dangMo: 5 };
const cs2: MoiTheoCoSo = { centerId: "cs2", ten: "Cơ sở Hoàng Diệu", moi: 1, khan: 0, dangMo: 1 };
const nguoi = new Map<string, readonly string[]>([
  ["cs1", ["ke-toan-cs1", "ke-toan-ho"]],
  ["cs2", ["ke-toan-cs2", "ke-toan-ho"]],
]);

describe("[QNT-01] ai nhận bản nào", () => {
  it("MỖI cơ sở có ngoại lệ mới ⇒ MỘT thông báo, gửi cho đúng người giữ quyền Ở CƠ SỞ ĐÓ — kế toán CS1 không nhận bản CS2 (và ngược lại)", () => {
    const tb = dungThongBaoNgoaiLe({ coSo: [cs1, cs2], nguoiNhanTheoCoSo: nguoi, ngay: "2026-11-02" });
    expect(tb).toHaveLength(2);
    const b1 = tb.find((t) => t.dedupeKey.includes(":cs1:"))!;
    const b2 = tb.find((t) => t.dedupeKey.includes(":cs2:"))!;
    expect(b1.userIds).toEqual(["ke-toan-cs1", "ke-toan-ho"]);
    expect(b2.userIds).toEqual(["ke-toan-cs2", "ke-toan-ho"]);
    expect(b1.userIds).not.toContain("ke-toan-cs2");
    expect(b2.userIds).not.toContain("ke-toan-cs1");
  });

  it("cơ sở KHÔNG có ngoại lệ mới ⇒ không thông báo (đối chứng của ca trên)", () => {
    const tb = dungThongBaoNgoaiLe({ coSo: [{ ...cs1, moi: 0, khan: 0 }, cs2], nguoiNhanTheoCoSo: nguoi, ngay: "2026-11-02" });
    expect(tb.map((t) => t.dedupeKey)).toEqual([`${TIEN_TO_NGOAI_LE}cs2:2026-11-02`]);
  });

  it("cơ sở có ngoại lệ mới nhưng KHÔNG ai giữ quyền ⇒ bỏ (không rơi về 'gửi tất cả')", () => {
    expect(dungThongBaoNgoaiLe({ coSo: [cs1], nguoiNhanTheoCoSo: new Map(), ngay: "2026-11-02" })).toEqual([]);
    expect(dungThongBaoNgoaiLe({ coSo: [cs1], nguoiNhanTheoCoSo: new Map([["cs1", []]]), ngay: "2026-11-02" })).toEqual([]);
  });

  it("người trùng trong danh sách chỉ nhận một lần", () => {
    const tb = dungThongBaoNgoaiLe({ coSo: [cs1], nguoiNhanTheoCoSo: new Map([["cs1", ["a", "a", "b"]]]), ngay: "2026-11-02" });
    expect(tb[0]!.userIds).toEqual(["a", "b"]);
  });
});

describe("[QNT-02] nội dung", () => {
  const tb = dungThongBaoNgoaiLe({ coSo: [cs1, cs2], nguoiNhanTheoCoSo: nguoi, ngay: "2026-11-02" });

  it("khoá chống trùng = tiền tố + cơ sở + NGÀY (mỗi người tối đa một bản/cơ sở/ngày); trỏ thẳng tab Cảnh báo", () => {
    expect(tb.map((t) => t.dedupeKey).sort()).toEqual([`${TIEN_TO_NGOAI_LE}cs1:2026-11-02`, `${TIEN_TO_NGOAI_LE}cs2:2026-11-02`]);
    expect(tb.every((t) => t.href === HREF_NGOAI_LE)).toBe(true);
  });

  it("nói số ngoại lệ mới, số khẩn (chỉ khi có), số đang mở; KHÔNG PII, KHÔNG số tiền, KHÔNG mã đơn", () => {
    const b1 = tb.find((t) => t.dedupeKey.includes(":cs1:"))!;
    expect(b1.body).toMatch(/2 ngoại lệ/);
    expect(b1.body).toMatch(/1 khẩn/);
    expect(b1.body).toMatch(/5 đang mở/);
    const b2 = tb.find((t) => t.dedupeKey.includes(":cs2:"))!;
    expect(b2.body).not.toMatch(/khẩn/); // đối chứng: không khẩn thì không nhắc chữ "khẩn"
    for (const t of tb) {
      expect(`${t.title} ${t.body}`).not.toMatch(/\d{6,}|@|ORD-|\d\s*(đ|₫|VND)(?![\p{L}])/iu);
    }
  });

  it("thứ tự ổn định theo tên cơ sở (xác định)", () => {
    const dao = dungThongBaoNgoaiLe({ coSo: [cs2, cs1], nguoiNhanTheoCoSo: nguoi, ngay: "2026-11-02" });
    expect(dao.map((t) => t.dedupeKey)).toEqual(tb.map((t) => t.dedupeKey));
  });
});
