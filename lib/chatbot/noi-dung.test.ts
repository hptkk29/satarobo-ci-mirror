import { describe, expect, it } from "vitest";
import { NGUON_CONG_KHAI_DA_BIET } from "@/lib/validators/lead";
import { SATA_ROBO_PHONE, SATA_ROBO_LOCATIONS, operationalLocations } from "@/lib/locations";
import {
  DO_DAI_GHI_CHU_TOI_DA,
  DO_DAI_TIN_TOI_DA,
  MODEL_CHATBOT,
  NGUON_LEAD_CHATBOT,
  SO_LUOT_HOI_TOI_DA,
  cuocTroChuyenSchema,
  dungGhiChuLead,
} from "./noi-dung";
import { duLieuChatbot, dungLoiDan } from "./loi-dan";
import { laKhoaHopLe } from "./khoa-api";

const SO_TIEN = /\d{1,3}(\.\d{3})+\s*đ(?!\p{L})/u;
const luot = (n: number) =>
  Array.from({ length: n * 2 - 1 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `câu ${i}` }));

describe("[CB-01] dữ liệu vào từ trình duyệt", () => {
  it("nhận cuộc trò chuyện xen kẽ, kết thúc bằng câu của phụ huynh", () => {
    expect(cuocTroChuyenSchema.safeParse({ messages: luot(3) }).success).toBe(true);
  });
  it("từ chối: tin cuối là của trợ lý · sai thứ tự vai · rỗng", () => {
    expect(cuocTroChuyenSchema.safeParse({ messages: [...luot(2), { role: "assistant", content: "x" }] }).success).toBe(false);
    expect(cuocTroChuyenSchema.safeParse({ messages: [{ role: "assistant", content: "x" }, { role: "user", content: "y" }] }).success).toBe(false);
    expect(cuocTroChuyenSchema.safeParse({ messages: [] }).success).toBe(false);
  });
  it("từ chối tin phụ huynh dài quá trần và cuộc trò chuyện vượt số lượt", () => {
    expect(cuocTroChuyenSchema.safeParse({ messages: [{ role: "user", content: "a".repeat(DO_DAI_TIN_TOI_DA + 1) }] }).success).toBe(false);
    expect(cuocTroChuyenSchema.safeParse({ messages: [{ role: "user", content: "a".repeat(DO_DAI_TIN_TOI_DA) }] }).success).toBe(true);
    expect(cuocTroChuyenSchema.safeParse({ messages: luot(SO_LUOT_HOI_TOI_DA) }).success).toBe(true);
    expect(cuocTroChuyenSchema.safeParse({ messages: luot(SO_LUOT_HOI_TOI_DA + 1) }).success).toBe(false);
  });
});

describe("[CB-02] ghi chú lead cho Sale", () => {
  it("gồm thông tin khai thêm + các câu ĐÃ HỎI, có nhãn nguồn", () => {
    const g = dungGhiChuLead({ lopCuaCon: "Lớp 3", khoaQuanTam: "Sata4 – Robotics", diaChi: "Hoà Cường" }, ["Con lớp 3 học gì?", "  Học thử  thế nào? "]);
    expect(g).toBe("[Chatbot website] · Con học: Lớp 3 · Quan tâm: Sata4 – Robotics · Địa chỉ: Hoà Cường · Đã hỏi: Con lớp 3 học gì? | Học thử thế nào?");
  });
  it("bỏ ô trống; không bao giờ vượt trần 500 ký tự của form lead", () => {
    expect(dungGhiChuLead({ lopCuaCon: null, khoaQuanTam: " ", diaChi: null }, [])).toBe("[Chatbot website]");
    const dai = dungGhiChuLead({ lopCuaCon: null, khoaQuanTam: null, diaChi: null }, Array(30).fill("x".repeat(60)));
    expect(dai.length).toBe(DO_DAI_GHI_CHU_TOI_DA);
    expect(dai.endsWith("…")).toBe(true);
  });
});

describe("[CB-03] lời dặn hệ thống", () => {
  const ld = dungLoiDan();
  it("KHÔNG chứa con số học phí nào (chatbot không báo giá — BLĐ chốt ẩn học phí)", () => {
    expect(ld).not.toMatch(SO_TIEN);
    expect(ld).toMatch(/Không báo học phí/);
  });
  it("mang hotline + địa chỉ mọi cơ sở đang hoạt động; dặn không xin SĐT trong chat", () => {
    expect(ld).toContain(SATA_ROBO_PHONE.hien);
    for (const l of operationalLocations()) expect(ld).toContain(l.address);
    expect(ld).toMatch(/Không xin số điện thoại/);
  });
  it("ổn định giữa các lượt (không thời điểm/id) — giữ bộ nhớ đệm prompt", () => {
    expect(dungLoiDan()).toBe(ld);
  });
});

describe("[CB-04] biểu mẫu để lại thông tin", () => {
  it("cơ sở = cơ sở đang hoạt động (CS1, CS2), không có Hội sở; có mã để /api/leads quy ra centerId", () => {
    const du = duLieuChatbot();
    expect(du.coSo.map((c) => c.code)).toEqual(operationalLocations().map((l) => l.code));
    expect(du.coSo.length).toBeGreaterThanOrEqual(2);
    expect(du.coSo.some((c) => /hội sở|hoi-so/i.test(`${c.name} ${c.address}`))).toBe(false);
    expect(SATA_ROBO_LOCATIONS.length).toBeGreaterThanOrEqual(du.coSo.length);
  });
  it("danh sách khoá có lựa chọn 'chưa rõ'", () => {
    expect(duLieuChatbot().khoaQuanTam).toContain("Chưa rõ, cần tư vấn");
  });
  it("nguồn lead chatbot là nguồn công khai ĐÃ BIẾT (không bị dán nhãn nguồn lạ)", () => {
    expect(NGUON_CONG_KHAI_DA_BIET.has(NGUON_LEAD_CHATBOT)).toBe(true);
  });
});

describe("[CB-05] hằng & dạng key", () => {
  it("model là Claude Haiku 5.5 (chủ dự án chốt 06/11/2026)", () => {
    expect(MODEL_CHATBOT).toBe("claude-haiku-5-5");
  });
  it("chỉ nhận chuỗi dạng key Anthropic", () => {
    expect(laKhoaHopLe("sk-ant-api03-" + "a".repeat(40))).toBe(true);
    expect(laKhoaHopLe("sk-proj-" + "a".repeat(40))).toBe(false);
    expect(laKhoaHopLe("sk-ant-api03 có khoảng trắng " + "a".repeat(30))).toBe(false);
    expect(laKhoaHopLe("")).toBe(false);
  });
});
