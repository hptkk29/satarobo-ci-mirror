// Ca [HMC-0x] — `phapNhanPhatHanhChoCoSo`: pháp nhân + ký hiệu PHÁT HÀNH THẬT của một cơ sở vào một ngày (S1 Invoice Hub, 01/11/2026).
// THUẦN (không DB). Hàm này là MỘT nguồn cho cả máy phát hành MISA lẫn nút trên dòng hàng chờ; dây nối canh ở
// `phat-hanh-cau-hinh.wiring.test.ts` ([HMC-W*]) và hành vi trên Postgres thật ở `tests/finance/hoa-don-phat-hanh-misa.test.ts` ([HMC-3x]).
import { describe, expect, it } from "vitest";
import { phapNhanPhatHanhChoCoSo, type CauHinhCoSo } from "./cau-hinh-co-so";
import { CAU_HINH_HOA_DON_MAC_DINH } from "./phap-nhan";

const DS = CAU_HINH_HOA_DON_MAC_DINH.phapNhan;
const dong = (o: Partial<CauHinhCoSo> & { id: string; centerId: string }): CauHinhCoSo => ({
  phapNhanMa: "SATA_ROBO",
  kyHieu: "1C26MAI",
  hieuLucTu: "2026-01-01",
  hieuLucDen: "2026-12-31",
  dangBat: true,
  ...o,
});
const CS1 = dong({ id: "a", centerId: "cs1", kyHieu: "1C26MAI" });
const CS2 = dong({ id: "b", centerId: "cs2", phapNhanMa: "NEW_VISION", kyHieu: "1C26MNV" });
const lay = (cauHinh: CauHinhCoSo[], centerId: string, ngay = "2026-10-20") =>
  phapNhanPhatHanhChoCoSo({ cauHinh, centerId, ngay, danhSachPhapNhan: DS });

describe("[HMC-01] có cấu hình ⇒ pháp nhân + ký hiệu NGUYÊN CHUỖI của cấu hình", () => {
  it("cs1 ⇒ SATA_ROBO + 1C26MAI (không phải 1C26TSR của hằng pháp nhân)", () => {
    const r = lay([CS1, CS2], "cs1");
    expect(r).toMatchObject({ ok: true, kyHieu: "1C26MAI" });
    expect(r.ok && r.phapNhan.ma).toBe("SATA_ROBO");
    expect(DS.find((p) => p.ma === "SATA_ROBO")!.kyHieu).toBe("1C26TSR");
  });
  it("cs2 ⇒ NEW_VISION + 1C26MNV — mỗi cơ sở đọc ĐÚNG dòng của mình", () => {
    const r = lay([CS1, CS2], "cs2");
    expect(r).toMatchObject({ ok: true, kyHieu: "1C26MNV" });
    expect(r.ok && r.phapNhan.ma).toBe("NEW_VISION");
  });
  it("ký hiệu giữ NGUYÊN: ngày 2026 mà cấu hình ghi hai số năm lệch (1C25XYZ) vẫn trả đúng chuỗi — hệ thống không tự đổi năm (23/10/2026)", () => {
    expect(lay([dong({ id: "z", centerId: "cs1", kyHieu: "1C25XYZ" })], "cs1")).toMatchObject({ ok: true, kyHieu: "1C25XYZ" });
  });
  it("đổi ký hiệu GIỮA năm: ngày trước/sau mốc ra hai ký hiệu khác nhau", () => {
    const a = dong({ id: "1", centerId: "cs1", hieuLucDen: "2026-06-30", kyHieu: "1C26MAI" });
    const b = dong({ id: "2", centerId: "cs1", hieuLucTu: "2026-07-01", kyHieu: "1C26MBI" });
    expect(lay([a, b], "cs1", "2026-06-30")).toMatchObject({ ok: true, kyHieu: "1C26MAI" });
    expect(lay([a, b], "cs1", "2026-07-01")).toMatchObject({ ok: true, kyHieu: "1C26MBI" });
  });
});

describe("[HMC-02] KHÔNG có cấu hình dùng được ⇒ LỖI tiếng Việt (không rơi về mặc định)", () => {
  it("không dòng nào ⇒ lỗi nêu NGÀY + màn Cấu hình ký hiệu", () => {
    expect(lay([], "cs1")).toEqual({ ok: false, error: expect.stringMatching(/2026-10-20.*Cấu hình ký hiệu/) });
  });
  it("dòng của cơ sở KHÁC · đã TẮT · ngoài khoảng ngày ⇒ coi như thiếu", () => {
    expect(lay([CS2], "cs1")).toMatchObject({ ok: false });
    expect(lay([{ ...CS1, dangBat: false }], "cs1")).toMatchObject({ ok: false });
    expect(lay([CS1], "cs1", "2027-01-01")).toMatchObject({ ok: false });
  });
  it("ngày rác ⇒ lỗi (không phát hành với ngày không hợp lệ)", () => {
    expect(lay([CS1], "cs1", "2026-13-40")).toMatchObject({ ok: false });
  });
});

describe("[HMC-03] mơ hồ / pháp nhân không dùng được ⇒ LỖI, không đoán một dòng", () => {
  it("hai dòng bật chồng ngày ⇒ lỗi 'chồng ngày'", () => {
    const trung = dong({ id: "z", centerId: "cs1", kyHieu: "1C26XYZ" });
    expect(lay([CS1, trung], "cs1")).toEqual({ ok: false, error: expect.stringMatching(/chồng ngày/) });
  });
  it("cấu hình trỏ pháp nhân đã tắt hoặc không còn trong danh sách ⇒ lỗi nêu mã pháp nhân", () => {
    const dsTat = DS.map((p) => (p.ma === "SATA_ROBO" ? { ...p, bat: false } : p));
    expect(phapNhanPhatHanhChoCoSo({ cauHinh: [CS1], centerId: "cs1", ngay: "2026-10-20", danhSachPhapNhan: dsTat })).toEqual({
      ok: false,
      error: expect.stringContaining("SATA_ROBO"),
    });
    expect(lay([dong({ id: "q", centerId: "cs1", phapNhanMa: "KHONG_CO" })], "cs1")).toMatchObject({ ok: false });
  });
  // Dòng cấu hình có pháp nhân hợp lệ nhưng ký hiệu RỖNG (dữ liệu ghi thẳng vào DB, đi vòng `luuCauHinh`): không được trả
  // `ok:true` kèm ký hiệu trống — tờ gửi MISA sẽ mang ký hiệu "" (hoặc lỗi muộn ở tầng dựng phiếu). Guard cuối của hàm.
  it("dòng cấu hình trỏ pháp nhân dùng được mà ký hiệu RỖNG ⇒ lỗi nói thiếu ký hiệu (đối chứng dương: cùng dòng có ký hiệu ⇒ ok)", () => {
    expect(lay([dong({ id: "k", centerId: "cs1", kyHieu: "1C26MAI" })], "cs1")).toMatchObject({ ok: true, kyHieu: "1C26MAI" });
    expect(lay([dong({ id: "k", centerId: "cs1", kyHieu: "" })], "cs1")).toEqual({
      ok: false,
      error: expect.stringMatching(/ký hiệu hoá đơn.*Cấu hình ký hiệu/),
    });
  });
});

// [HMC-04] là phát biểu Ý ĐỊNH, chưa được chứng minh cắn riêng (cấy `MAC_DINH` vào hàm chỉ làm đỏ [HMC-02]/[HMC-11], không
// làm đỏ ca này). Lưới thật của luật "không mặc định" là [HMC-02] + [HMC-W1] (helper không chứa `macDinh`/`MAC_DINH`).
describe("[HMC-04] KHÔNG có đường rơi về pháp nhân mặc định (ý định — không phải lưới độc lập)", () => {
  it("truyền thêm `macDinh` / `khiThieuCauHinh: MAC_DINH` ngoài chữ ký cũng KHÔNG đổi kết quả thiếu-cấu-hình (hàm không đọc chúng)", () => {
    const them = phapNhanPhatHanhChoCoSo({
      cauHinh: [],
      centerId: "cs1",
      ngay: "2026-10-20",
      danhSachPhapNhan: DS,
      ...({ macDinh: DS[0], khiThieuCauHinh: "MAC_DINH" } as object),
    });
    expect(them).toMatchObject({ ok: false });
  });
});
