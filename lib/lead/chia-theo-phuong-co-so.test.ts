/**
 * [CTC-*] Quản lý cơ sở cấu hình PHẦN CỦA CƠ SỞ MÌNH (06/11/2026) — lõi THUẦN `apDungCapNhatTheoCoSo`.
 *   [CTC-01] đặt phường TRỐNG cho cơ sở mình ✔; trả phường của mình về trống ✔; chuyển giữa hai cơ sở của mình ✔
 *   [CTC-02] phường đang của cơ sở KHÁC mà muốn ĐỔI ⇒ từ chối (không giật phường); KHÔNG đổi (biểu mẫu gửi lại cả danh sách) ⇒ bỏ qua êm
 *   [CTC-03] đặt phường cho cơ sở KHÔNG phải của mình ⇒ từ chối
 *   [CTC-04] nguyên khối: một dòng sai ⇒ KHÔNG bảng mới (không lưu nửa chừng)
 *   [CTC-05] dòng thiếu tên / trùng phường ⇒ từ chối; cơ sở đóng chỉ chặn dòng ĐỔI, không chặn dòng giữ nguyên
 */
import { describe, expect, it } from "vitest";
import { apDungCapNhatTheoCoSo, BANG_RONG, coSoCuaCacPhuong, datPhuong, type BangPhuongCoSo } from "./chia-theo-phuong";

const TP = "Tp Đà Nẵng";
const HOP_LE = new Set(["cs1", "cs2", "cs3"]);
const TOI = new Set(["cs1"]); // người lưu quản lý CS1

/** Bảng: Hải Châu → cs2 (của cơ sở KHÁC), An Hải → cs1 (của mình), Thanh Khê trống. */
function bang(): BangPhuongCoSo {
  let b: BangPhuongCoSo = BANG_RONG;
  b = datPhuong(b, TP, "Phường Hải Châu", "cs2");
  b = datPhuong(b, TP, "Phường An Hải", "cs1");
  return b;
}
const doc = (b: BangPhuongCoSo) => coSoCuaCacPhuong(b, TP, ["Phường An Hải", "Phường Hải Châu", "Phường Thanh Khê"]);

describe("[CTC-01] đổi được phần của mình", () => {
  it("đặt phường trống cho cơ sở mình; trả phường của mình về trống", () => {
    const r = apDungCapNhatTheoCoSo(
      bang(),
      TP,
      [
        { phuong: "Phường Thanh Khê", coSoId: "cs1" },
        { phuong: "Phường An Hải", coSoId: null },
      ],
      TOI,
      HOP_LE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(doc(r.bang)).toEqual({ "Phường An Hải": null, "Phường Hải Châu": "cs2", "Phường Thanh Khê": "cs1" });
    expect(r.soDongDoi).toBe(2);
  });
  it("người quản lý hai cơ sở chuyển phường giữa hai cơ sở của mình", () => {
    const r = apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường An Hải", coSoId: "cs3" }], new Set(["cs1", "cs3"]), HOP_LE);
    expect(r.ok && doc(r.bang)["Phường An Hải"]).toBe("cs3");
  });
});

describe("[CTC-02] không giật phường của cơ sở khác", () => {
  it("đổi/giật phường của cơ sở khác ⇒ từ chối, nói rõ phường nào", () => {
    const r = apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường Hải Châu", coSoId: "cs1" }], TOI, HOP_LE);
    expect(r).toEqual({ ok: false, loi: ["«Phường Hải Châu» đang thuộc cơ sở khác — chỉ Quản trị đổi được."] });
  });
  it("gỡ phường của cơ sở khác (đặt trống) cũng bị từ chối", () => {
    expect(apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường Hải Châu", coSoId: null }], TOI, HOP_LE).ok).toBe(false);
  });
  it("gửi lại phường của cơ sở khác NGUYÊN GIÁ TRỊ ⇒ không phải sửa, bỏ qua êm; bảng không đổi", () => {
    const b0 = bang();
    const r = apDungCapNhatTheoCoSo(b0, TP, [{ phuong: "Phường Hải Châu", coSoId: "cs2" }, { phuong: "Phường An Hải", coSoId: "cs1" }], TOI, HOP_LE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soDongDoi).toBe(0);
    expect(r.bang).toEqual(b0);
  });
});

describe("[CTC-03] chỉ đặt cho cơ sở của mình", () => {
  it("phường trống đặt cho cơ sở khác ⇒ từ chối", () => {
    const r = apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường Thanh Khê", coSoId: "cs2" }], TOI, HOP_LE);
    expect(r).toEqual({ ok: false, loi: ["Bạn chỉ đặt được phường/xã cho cơ sở của mình («Phường Thanh Khê»)."] });
  });
  it("không quản lý cơ sở nào (tập rỗng) ⇒ không đổi được gì (fail-closed)", () => {
    expect(apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường Thanh Khê", coSoId: "cs1" }], new Set(), HOP_LE).ok).toBe(false);
  });
});

describe("[CTC-04] nguyên khối", () => {
  it("một dòng hợp lệ + một dòng sai ⇒ lỗi, không có bảng mới", () => {
    const r = apDungCapNhatTheoCoSo(
      bang(),
      TP,
      [
        { phuong: "Phường Thanh Khê", coSoId: "cs1" },
        { phuong: "Phường Hải Châu", coSoId: "cs1" },
      ],
      TOI,
      HOP_LE,
    );
    expect(r.ok).toBe(false);
    expect("bang" in r).toBe(false);
  });
});

describe("[CTC-05] dòng hỏng", () => {
  it("thiếu tên phường · trùng phường ⇒ từ chối", () => {
    expect(apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "  ", coSoId: "cs1" }], TOI, HOP_LE).ok).toBe(false);
    const hai = apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường Thanh Khê", coSoId: "cs1" }, { phuong: "phường thanh khê", coSoId: null }], TOI, HOP_LE);
    expect(hai.ok).toBe(false);
  });
  it("cơ sở của mình đã ĐÓNG: dòng ĐỔI sang nó bị chặn, dòng giữ nguyên thì không", () => {
    const dong = new Set(["cs2", "cs3"]); // cs1 không còn nhận lead
    expect(apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường Thanh Khê", coSoId: "cs1" }], TOI, dong).ok).toBe(false);
    expect(apDungCapNhatTheoCoSo(bang(), TP, [{ phuong: "Phường An Hải", coSoId: "cs1" }], TOI, dong).ok).toBe(true);
  });
});
