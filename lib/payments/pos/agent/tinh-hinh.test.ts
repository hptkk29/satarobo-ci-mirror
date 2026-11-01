// Ca [POS4-TH-01..04] — "tình hình chung" + thứ tự thẻ + dòng "Phiên portal" của màn Sức khoẻ POS Agent (đợt
// /impeccable 07/10/2026). THUẦN. Người mở màn (Kế toán HO / Quản trị tối cao) phải thấy NGAY cơ sở nào đang chết
// và việc phải làm — nên máy hỏng đứng TRƯỚC, và dòng tóm tắt không được nói "ổn" khi còn một máy cần xử lý.
import { describe, it, expect } from "vitest";
import { dongPhien, tinhHinhChung, xepTheoMucKhan } from "./tinh-hinh";

const GIAY = 1_000;
const PHUT = 60 * GIAY;
/** Thứ Tư 07/10/2026 10:20:00 giờ VN — đóng băng (luật 19: test không đọc đồng hồ thật). */
const NOW = new Date("2026-10-07T03:20:00Z");
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

type May = Parameters<typeof xepTheoMucKhan>[0][number];

const may = (id: string, coSo: string, x: Partial<May> = {}): May => ({
  id,
  coSo,
  active: true,
  sessionState: "READY",
  sessionDoiLuc: null,
  sessionExpiresAt: new Date("2026-10-08T01:15:00Z"),
  lastHeartbeatAt: truoc(25 * GIAY),
  matKetNoiTuLuc: null,
  lastSyncedAt: truoc(40 * GIAY),
  ...x,
});

const SONG = may("a-song", "CS1");
const HET_PHIEN = may("b-het", "CS2", { sessionState: "EXPIRED", sessionDoiLuc: truoc(12 * PHUT) });
const MAT = may("c-mat", "CS3", { lastHeartbeatAt: truoc(9 * PHUT) });
const TAT = may("d-tat", "CS0", { active: false });
const CHUA = may("e-chua", "CS4", { lastHeartbeatAt: null, lastSyncedAt: null });
const SAP_HET = may("f-sap", "CS5", { sessionExpiresAt: new Date("2026-10-07T09:30:00Z") }); // 16:30 hôm nay

describe("[POS4-TH-01] xepTheoMucKhan — máy hỏng lên đầu, máy tắt xuống cuối", () => {
  it("đỏ → vàng → cần cài (xám có việc) → đang làm việc → đã tắt", () => {
    const xep = xepTheoMucKhan([TAT, SONG, SAP_HET, CHUA, HET_PHIEN], NOW).map((x) => x.a.id);
    expect(xep).toEqual(["b-het", "f-sap", "e-chua", "a-song", "d-tat"]);
  });
  it("cùng mức ⇒ theo tên cơ sở (ổn định giữa hai lượt tải, không nhảy chỗ)", () => {
    const xep = xepTheoMucKhan([MAT, HET_PHIEN], NOW).map((x) => x.a.coSo);
    expect(xep).toEqual(["CS2", "CS3"]);
    expect(xepTheoMucKhan([HET_PHIEN, MAT], NOW).map((x) => x.a.coSo)).toEqual(["CS2", "CS3"]);
  });
});

describe("[POS4-TH-02] tinhHinhChung — không nói 'ổn' khi còn máy cần xử lý", () => {
  it("không có máy ⇒ null (màn rỗng tự nói)", () => {
    expect(tinhHinhChung([])).toBeNull();
  });
  it("một máy hết phiên trong hai ⇒ tone danger, liệt kê ĐÚNG máy đó kèm việc phải làm", () => {
    const th = tinhHinhChung(xepTheoMucKhan([SONG, HET_PHIEN], NOW))!;
    expect(th.tone).toBe("danger");
    expect(th.tieuDe).toBe("1/2 POS Agent cần xử lý");
    expect(th.canXuLy.map((x) => x.coSo)).toEqual(["CS2"]);
    expect(th.canXuLy[0]!.lamGi).toContain("đăng nhập lại");
  });
  it("chỉ máy sắp hết phiên ⇒ warning (không phải danger)", () => {
    const th = tinhHinhChung(xepTheoMucKhan([SONG, SAP_HET], NOW))!;
    expect(th.tone).toBe("warning");
    expect(th.canXuLy.map((x) => x.coSo)).toEqual(["CS5"]);
  });
  it("chỉ máy chưa cài ⇒ muted — là việc phải làm nhưng không phải báo động", () => {
    expect(tinhHinhChung(xepTheoMucKhan([SONG, CHUA], NOW))!.tone).toBe("muted");
  });
  it("mọi máy đang làm việc ⇒ success; máy tắt KHÔNG tính vào mẫu số, nhưng được nói ra", () => {
    const th = tinhHinhChung(xepTheoMucKhan([SONG, TAT], NOW))!;
    expect(th.tone).toBe("success");
    expect(th.tieuDe).toBe("1/1 POS Agent đang làm việc");
    expect(th.phu).toBe("1 máy đã tắt — cơ sở đó đọc file nhập tay");
    expect(th.canXuLy).toEqual([]);
  });
  it("mọi máy đều tắt ⇒ muted, không in '0/0'", () => {
    const th = tinhHinhChung(xepTheoMucKhan([TAT], NOW))!;
    expect(th.tone).toBe("muted");
    expect(th.tieuDe).toBe("Mọi POS Agent đang tắt");
    expect(th.tieuDe).not.toContain("0/0");
  });
});

describe("[POS4-TH-03] dongPhien — 'Phiên portal' không nói 'hết hạn <tương lai>' cho một phiên ĐÃ chết (luật 12)", () => {
  it("EXPIRED ⇒ 'Hết phiên · từ hh:mm', KHÔNG in mốc hạn token cũ", () => {
    const d = dongPhien(may("x", "CS1", { sessionState: "EXPIRED", sessionDoiLuc: truoc(12 * PHUT) }), NOW);
    expect(d).toEqual({ chu: "Hết phiên", phu: "từ 10:08", tone: "danger" });
  });
  it("READY + hạn ngày mai ⇒ 'hết hạn 08:15 08/10'", () => {
    expect(dongPhien(SONG, NOW)).toEqual({ chu: "Sống", phu: "hết hạn 08:15 08/10", tone: null });
  });
  it("READY + hạn trước 21:00 hôm nay ⇒ warning", () => {
    expect(dongPhien(SAP_HET, NOW)).toEqual({ chu: "Sống", phu: "hết hạn 16:30", tone: "warning" });
  });
  it("READY + hạn ĐÃ QUA ⇒ nói thẳng mốc đã qua, chờ POS Agent báo lại — không in 'hết hạn' như tương lai", () => {
    const d = dongPhien(may("x", "CS1", { sessionExpiresAt: truoc(5 * PHUT) }), NOW);
    expect(d.phu).toBe("mốc hạn đã qua lúc 10:15 — chờ POS Agent báo lại");
    expect(d.tone).toBe("warning");
  });
  it("READY + không rõ hạn (nguồn SESSION ⇒ null) ⇒ 'chưa rõ hạn'", () => {
    expect(dongPhien(may("x", "CS1", { sessionExpiresAt: null }), NOW).phu).toBe("chưa rõ hạn");
  });
  it("UNKNOWN ⇒ 'Chưa rõ', không phụ đề", () => {
    expect(dongPhien(may("x", "CS1", { sessionState: "UNKNOWN" }), NOW)).toEqual({ chu: "Chưa rõ", phu: null, tone: null });
  });
});
