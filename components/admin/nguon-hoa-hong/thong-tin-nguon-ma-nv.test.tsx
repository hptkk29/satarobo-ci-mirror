// @vitest-environment jsdom
/**
 * [MNG-09] — «Mã NV đã gõ» trên trang chi tiết nguồn / sheet gán nguồn (`ThongTinNguon`), trên phần tử THẬT.
 *
 * Vì sao có tệp này: vòng 11/10 ghi nhận «chưa có ca render cho thong-tin-nguon.tsx — chỉ lưới ghim văn bản» (§17.EF.8 a). Phép cấy C1h của vòng UAT cuối (in thẳng `maNvSai.raw ?? maNvSai.ma`) chỉ làm đỏ
 * hai lưới GREP, không ca hành vi nào. Ở đây khẳng định cái người dùng THẤY: người có quyền PII (server đã đưa `raw`) thấy chuỗi họ gõ; người không có quyền chỉ thấy «đã ẩn» + độ dài;
 * KHAC_MA đổi tiêu đề thành «Các mã xung đột»; dòng cũ chưa lưu chuỗi gốc nói thật «chưa lưu chuỗi gốc».
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ThongTinNguon } from "./thong-tin-nguon";
import type { NguonHienTai } from "@/lib/nguon/doc-gan-nguon";
import type { MaNvSaiHienThi } from "@/lib/nguon/doc-hang-cho";

afterEach(cleanup);

const nguon = (maNvSai: MaNvSaiHienThi | null): NguonHienTai => ({
  groupId: "g1",
  groupCode: "EMPLOYEE_REFERRAL",
  groupName: "Nhân sự giới thiệu",
  giaiTrinh: null,
  nguoi: null,
  thieuNguoi: true,
  khoa: false,
  canhBao: [],
  xemTay: ["INVALID_EMPLOYEE_REFERRER_CODE"],
  vanDe: ["THIEU_NGUOI", "XEM_TAY"],
  cachXacDinh: "SYSTEM_IMPORT",
  luat: "NV_GIOI_THIEU_SAI",
  ngayGhiCong: "2026-10-01T03:00:00.000Z",
  hanGhiCong: "2026-12-30T03:00:00.000Z",
  conHanGhiCong: true,
  nhanGoc: null,
  maNvSai,
  capNhatLuc: "2026-10-01T03:00:00.000Z",
});
const ve = (m: MaNvSaiHienThi | null) => render(<ThongTinNguon nguon={nguon(m)} duongVao="import-excel" />).container;

describe("[MNG-09] ThongTinNguon — «Mã NV đã gõ» theo quyền của người xem (server đã lọc)", () => {
  it("có quyền PII: thấy ĐÚNG chuỗi gốc (kể cả SĐT) + lý do «không dùng được — mã không có trong hệ thống»", () => {
    const c = ve({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: "0905.123.456", coQuyenXem: true });
    expect(c.textContent).toContain("Mã NV đã gõ");
    expect(c.textContent).toContain("0905.123.456");
    expect(c.textContent).toContain("không dùng được — mã không có trong hệ thống");
  });

  it("KHÔNG quyền: «đã ẩn» + độ dài, không chữ số SĐT nào, không «null/undefined»", () => {
    const c = ve({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: null, coQuyenXem: false });
    expect(c.textContent).toMatch(/12 ký tự, đã ẩn/);
    expect(c.textContent).not.toMatch(/905/);
    expect(c.textContent).not.toMatch(/null|undefined/);
  });

  it("KHÔNG quyền nhưng mã CÓ dạng mã nhân viên: vẫn thấy mã (như trước vòng này) — đối chứng dương của nhánh «đã ẩn»", () => {
    const c = ve({ ma: "SR.NV.404", loai: "KHONG_TON_TAI", doDai: 9, raw: null, coQuyenXem: false });
    expect(c.textContent).toContain("SR.NV.404");
    expect(c.textContent).not.toMatch(/đã ẩn/);
  });

  it("KHAC_MA: tiêu đề «Các mã xung đột» + các ứng viên của người có quyền; không quyền chỉ thấy phần có dạng mã", () => {
    const co = ve({ ma: "EMNV.NV.001", loai: "KHAC_MA", doDai: 22, raw: "0912 345 678 | emnv.nv.001", coQuyenXem: true });
    expect(co.textContent).toContain("Các mã xung đột");
    expect(co.textContent).not.toContain("Mã NV đã gõ");
    expect(co.textContent).toContain("0912 345 678 | emnv.nv.001");
    cleanup();
    const khong = ve({ ma: "EMNV.NV.001", loai: "KHAC_MA", doDai: 22, raw: null, coQuyenXem: false });
    expect(khong.textContent).toContain("Các mã xung đột");
    expect(khong.textContent).toContain("EMNV.NV.001");
    expect(khong.textContent).not.toMatch(/0912|345/);
  });

  it("có quyền nhưng dòng ghi trước khi hệ thống lưu chuỗi gốc: nói THẬT «chưa lưu chuỗi gốc», KHÔNG nói «đã ẩn»", () => {
    const c = ve({ ma: null, loai: "KHONG_TON_TAI", doDai: 10, raw: null, coQuyenXem: true });
    expect(c.textContent).toMatch(/chưa lưu chuỗi gốc/);
    expect(c.textContent).not.toMatch(/đã ẩn/);
  });

  it("không có mã sai (null) ⇒ không có dòng «Mã NV đã gõ» / «Các mã xung đột»", () => {
    const c = ve(null);
    expect(c.textContent).not.toMatch(/Mã NV đã gõ|Các mã xung đột/);
  });
});
