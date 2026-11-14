import { describe, expect, it } from "vitest";
import { buocHocBu, noiDungBaoNghi } from "@/lib/portal/hoc-bu-thuan";

describe("[HB-01] các bước học bù theo trạng thái thật", () => {
  const tt = (s: ReturnType<typeof buocHocBu>) => s.map((x) => x.tt[0]).join("");
  it("chưa có đơn ⇒ đang ở bước xin học bù", () => {
    expect(tt(buocHocBu({ status: "PENDING", yeuCauMo: false }))).toBe("xdccc");
  });
  it("đã có đơn ⇒ chờ trung tâm xếp giờ", () => {
    expect(tt(buocHocBu({ status: "PENDING", yeuCauMo: true }))).toBe("xxdcc");
  });
  it("đã xếp lịch ⇒ con học bù; xong ⇒ chờ nhận xét", () => {
    expect(tt(buocHocBu({ status: "SCHEDULED", yeuCauMo: true }))).toBe("xxxdc");
    expect(tt(buocHocBu({ status: "COMPLETED", yeuCauMo: true }))).toBe("xxxxd");
  });
});

describe("[HB-02] nội dung báo nghỉ", () => {
  it("luôn ≥ 5 ký tự, kể cả khi không ghi chú", () => {
    expect(noiDungBaoNghi({ lyDo: "Con ốm", ghiChu: " ", muonBu: true }).length).toBeGreaterThanOrEqual(5);
  });
  it("ghi rõ có/không xin học bù", () => {
    expect(noiDungBaoNghi({ lyDo: "Con ốm", ghiChu: "về quê", muonBu: true })).toBe("Lý do: Con ốm. Ghi chú: về quê Con muốn học bù buổi này.");
    expect(noiDungBaoNghi({ lyDo: "Khác", ghiChu: "", muonBu: false })).toContain("Không cần học bù");
  });
});
