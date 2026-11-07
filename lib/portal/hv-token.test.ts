import { describe, expect, it } from "vitest";
import {
  HAN_VE_MS,
  docTokenCheDo,
  kiemVeXacMinh,
  taoTokenCheDo,
  taoVeXacMinh,
} from "./hv-token";

const KHOA = "khoa-ky-thu-nghiem-du-dai-32-ky-tu-tro-len-0001";
const KHOA_KHAC = "khoa-ky-thu-nghiem-du-dai-32-ky-tu-tro-len-0002";
const NOW = 1_800_000_000_000;

describe("token chế độ học sinh", () => {
  it("[HVT-01] token hợp lệ đọc lại đúng phụ huynh + con", () => {
    const t = taoTokenCheDo("cmparent1", "cmstudent1", NOW, KHOA);
    expect(docTokenCheDo(t, KHOA)).toEqual({ parentUserId: "cmparent1", studentId: "cmstudent1", luc: NOW });
  });
  it("[HVT-02] đổi một ký tự (id con hoặc chữ ký) ⇒ không còn ở chế độ học sinh", () => {
    const t = taoTokenCheDo("cmparent1", "cmstudent1", NOW, KHOA);
    expect(docTokenCheDo(t.replace("cmstudent1", "cmstudent2"), KHOA)).toBeNull();
    expect(docTokenCheDo(t.replace("cmparent1", "cmparent2"), KHOA)).toBeNull();
    expect(docTokenCheDo(t.slice(0, -2) + "xx", KHOA)).toBeNull();
  });
  it("[HVT-03] ký bằng khoá khác (token giả) ⇒ không nhận", () => {
    expect(docTokenCheDo(taoTokenCheDo("cmparent1", "cmstudent1", NOW, KHOA_KHAC), KHOA)).toBeNull();
  });
  it("[HVT-04] rác / rỗng / token vé xác minh đem dùng làm token chế độ ⇒ không nhận", () => {
    for (const x of [undefined, null, "", "abc", "a.b", "x".repeat(500)]) expect(docTokenCheDo(x, KHOA)).toBeNull();
    expect(docTokenCheDo(taoVeXacMinh("cmparent1", "doi", NOW, KHOA), KHOA)).toBeNull();
  });
});

describe("vé xác minh tạm (đổi mã / quên mã)", () => {
  it("[HVT-05] vé đúng người + đúng mục đích + còn hạn ⇒ hợp lệ", () => {
    const ve = taoVeXacMinh("cmparent1", "doi", NOW, KHOA);
    expect(kiemVeXacMinh(ve, "cmparent1", "doi", NOW + 1000, KHOA)).toBe(true);
  });
  it("[HVT-06] vé của người khác, vé sai mục đích, vé quá hạn, vé giả ⇒ đều bị từ chối", () => {
    const ve = taoVeXacMinh("cmparent1", "doi", NOW, KHOA);
    expect(kiemVeXacMinh(ve, "cmparent2", "doi", NOW + 1000, KHOA)).toBe(false);
    // vé "đổi mã" (chỉ cần biết mã cũ) không được dùng chỗ "quên mã" (đòi mật khẩu)
    expect(kiemVeXacMinh(ve, "cmparent1", "quen", NOW + 1000, KHOA)).toBe(false);
    expect(kiemVeXacMinh(ve, "cmparent1", "doi", NOW + HAN_VE_MS, KHOA)).toBe(false);
    expect(kiemVeXacMinh(ve, "cmparent1", "doi", NOW + 1000, KHOA_KHAC)).toBe(false);
    expect(kiemVeXacMinh(undefined, "cmparent1", "doi", NOW, KHOA)).toBe(false);
    // token chế độ học sinh không phải vé
    expect(kiemVeXacMinh(taoTokenCheDo("cmparent1", "cmstudent1", NOW, KHOA), "cmparent1", "doi", NOW, KHOA)).toBe(false);
  });
});
