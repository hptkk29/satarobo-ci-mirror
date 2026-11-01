// Ca [THT-*] — bản hoá đơn KẾ TIẾP tự nối `thayTheChoId` về bản ĐÃ HUỶ nào (quyết định (1) 27/09).
import { describe, it, expect } from "vitest";
import { chonHoaDonDuocThay, hoaDonDaHuyCuaLanThu, huyGanNhatTheoKhoan } from "./thay-the";

const t = (ngay: string) => new Date(`2026-09-${ngay}T03:00:00Z`);

describe("[THT] chọn bản đã huỷ mà bản mới thay cho", () => {
  it("[THT-01] không khoản nào từng nằm trong bản đã huỷ ⇒ null (tiền mới)", () => {
    expect(chonHoaDonDuocThay([{ id: "A", huyLuc: t("20"), paymentIds: ["p1"] }], ["p9"])).toBeNull();
    expect(chonHoaDonDuocThay([], ["p1"])).toBeNull();
  });

  it("[THT-02] một bản đã huỷ phủ đúng khoản ⇒ nối về nó", () => {
    expect(chonHoaDonDuocThay([{ id: "A", huyLuc: t("20"), paymentIds: ["p1"] }], ["p1"])).toBe("A");
  });

  it("[THT-03] chuỗi A→B (cùng khoản, B huỷ muộn hơn) ⇒ bản mới nối về B, không về A", () => {
    const daHuy = [
      { id: "A", huyLuc: t("20"), paymentIds: ["p1"] },
      { id: "B", huyLuc: t("22"), paymentIds: ["p1"] },
    ];
    expect(chonHoaDonDuocThay(daHuy, ["p1"])).toBe("B");
    // Thứ tự đầu vào không đổi kết quả.
    expect(chonHoaDonDuocThay([...daHuy].reverse(), ["p1"])).toBe("B");
  });

  it("[THT-04] phủ MỘT PHẦN (bản mới có thêm tiền mới) ⇒ vẫn nối về bản cũ", () => {
    expect(chonHoaDonDuocThay([{ id: "A", huyLuc: t("20"), paymentIds: ["p1", "p2"] }], ["p1", "p5"])).toBe("A");
  });

  it("[THT-05] đếm PHIẾU: bản có nhiều khoản chung hơn thắng, dù huỷ SỚM hơn", () => {
    const daHuy = [
      { id: "A", huyLuc: t("25"), paymentIds: ["p1"] },
      { id: "B", huyLuc: t("21"), paymentIds: ["p2", "p3"] },
    ];
    expect(chonHoaDonDuocThay(daHuy, ["p1", "p2", "p3"])).toBe("B");
  });

  it("[THT-06] hoà phiếu ⇒ bản huỷ muộn hơn; null coi là xa nhất; hoà hết ⇒ id lớn hơn", () => {
    expect(
      chonHoaDonDuocThay(
        [
          { id: "A", huyLuc: t("21"), paymentIds: ["p1"] },
          { id: "B", huyLuc: t("23"), paymentIds: ["p2"] },
        ],
        ["p1", "p2"],
      ),
    ).toBe("B");
    expect(
      chonHoaDonDuocThay(
        [
          { id: "Z", huyLuc: null, paymentIds: ["p1"] },
          { id: "A", huyLuc: t("01"), paymentIds: ["p2"] },
        ],
        ["p1", "p2"],
      ),
    ).toBe("A");
    expect(
      chonHoaDonDuocThay(
        [
          { id: "A", huyLuc: t("21"), paymentIds: ["p1"] },
          { id: "C", huyLuc: t("21"), paymentIds: ["p2"] },
        ],
        ["p1", "p2"],
      ),
    ).toBe("C");
  });

  it("[THT-07] các bản đã huỷ đứng trước một lần thu — mỗi bản một lần, muộn nhất trước", () => {
    const A = { id: "A", huyLuc: t("20"), paymentIds: ["p1", "p2"] };
    const B = { id: "B", huyLuc: t("24"), paymentIds: ["p3"] };
    const C = { id: "C", huyLuc: t("18"), paymentIds: ["p1"] }; // bị A che (A muộn hơn trên p1)
    expect(hoaDonDaHuyCuaLanThu([A, B, C], ["p1", "p2", "p3"]).map((h) => h.id)).toEqual(["B", "A"]);
    expect(huyGanNhatTheoKhoan([A, C]).get("p1")?.id).toBe("A");
  });
});
