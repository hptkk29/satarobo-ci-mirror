// lib/cham-cong/ip-cham-cong.test.ts — so khớp IP/CIDR + luật chế độ (P2.4). Thuần.
import { describe, expect, it } from "vitest";
import { ipThuocMuc, loiDanhSachIp, mucKhop, phanTichMucIp } from "@/lib/security/ip-cidr";
import { quyetDinhIp, seBiChan } from "./ip-cham-cong";

describe("[IPC] so khớp IP / CIDR", () => {
  it("[IPC-01] IPv4: IP đơn, dải /24, /0; biên dải; mục 'có phần host' hiểu là cả dải", () => {
    expect(ipThuocMuc("203.0.113.7", "203.0.113.7")).toBe(true);
    expect(ipThuocMuc("203.0.113.8", "203.0.113.7")).toBe(false);
    expect(ipThuocMuc("203.0.113.255", "203.0.113.0/24")).toBe(true);
    expect(ipThuocMuc("203.0.114.0", "203.0.113.0/24")).toBe(false);
    expect(ipThuocMuc("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(ipThuocMuc("203.0.113.200", "203.0.113.9/24")).toBe(true);
  });

  it("[IPC-02] IPv6: viết tắt '::', dải /48, chữ hoa; IPv4 ánh xạ IPv6 so được với mục IPv4", () => {
    expect(ipThuocMuc("2001:db8:abcd:12::1", "2001:db8:abcd::/48")).toBe(true);
    expect(ipThuocMuc("2001:db8:abce::1", "2001:db8:abcd::/48")).toBe(false);
    expect(ipThuocMuc("2001:DB8::1", "2001:db8::1")).toBe(true);
    // Vị trí của "::" phải đúng: bung sai chỗ (dồn số 0 về cuối) thì hai ca dưới đổi kết quả. Cấy 11/10 —
    // bản đầu của ca này XANH với phép bung sai vì mọi ca cũ cho cùng kết quả hai cách bung.
    expect(ipThuocMuc("::1", "0:0:0:0:0:0:0:1")).toBe(true);
    expect(ipThuocMuc("2001:db8::1", "2001:db8::/127")).toBe(true);
    expect(ipThuocMuc("::ffff:203.0.113.7", "203.0.113.0/24")).toBe(true);
    // Họ khác nhau không bao giờ khớp.
    expect(ipThuocMuc("203.0.113.7", "::/0")).toBe(false);
  });

  it("[IPC-03] nhiều mục: trả mục ĐẦU TIÊN khớp; mục sai bị bắt trước khi lưu", () => {
    expect(mucKhop("10.0.0.5", ["192.168.1.0/24", "10.0.0.0/8", "10.0.0.5"])).toBe("10.0.0.0/8");
    expect(mucKhop("8.8.8.8", ["192.168.1.0/24"])).toBeNull();
    for (const sai of ["300.1.1.1", "1.2.3.4/33", "2001:db8::/129", "abc", "1.2.3", "1::2::3", "1.2.3.4/24/1"]) {
      expect(phanTichMucIp(sai), sai).toBeNull();
    }
    expect(loiDanhSachIp(["1.2.3.4", "x.y"])).toMatch(/x\.y/);
    expect(loiDanhSachIp(["1.2.3.4", "2001:db8::/32"])).toBeNull();
  });
});

describe("[IPQ] luật chế độ", () => {
  const goc = { danhSach: ["203.0.113.0/24"], mien: null as string | null };

  it("[IPQ-01] OFF không làm gì; ngữ cảnh miễn + điểm chưa khai danh sách KHÔNG bao giờ chặn", () => {
    expect(quyetDinhIp({ ...goc, cheDo: "OFF", ip: "8.8.8.8" })).toEqual({ ipRule: null, cho: true, co: null });
    expect(quyetDinhIp({ ...goc, cheDo: "ENFORCE", ip: "8.8.8.8", mien: "LAM_TU_XA" })).toEqual({ ipRule: "MIEN:LAM_TU_XA", cho: true, co: null });
    expect(quyetDinhIp({ cheDo: "ENFORCE", danhSach: [], ip: "8.8.8.8", mien: null })).toEqual({ ipRule: "CHUA_KHAI", cho: true, co: null });
  });

  it("[IPQ-02] ngoài danh sách: OBSERVE ghi lại không cờ · WARNING gắn cờ · ENFORCE chặn", () => {
    const o = quyetDinhIp({ ...goc, cheDo: "OBSERVE", ip: "8.8.8.8" });
    expect(o).toEqual({ ipRule: "NGOAI_DS", cho: true, co: null });
    expect(seBiChan(o.ipRule)).toBe(true); // thu dữ liệu "sẽ bị chặn"
    expect(quyetDinhIp({ ...goc, cheDo: "WARNING", ip: "8.8.8.8" })).toEqual({ ipRule: "NGOAI_DS", cho: true, co: "IP_NGOAI_DANH_SACH" });
    expect(quyetDinhIp({ ...goc, cheDo: "ENFORCE", ip: "8.8.8.8" }).cho).toBe(false);
    expect(quyetDinhIp({ ...goc, cheDo: "ENFORCE", ip: "203.0.113.9" })).toEqual({ ipRule: "203.0.113.0/24", cho: true, co: null });
  });

  it("[IPQ-03] không xác định được IP tin cậy ⇒ KHÔNG chặn kể cả ENFORCE (không khoá cửa hàng loạt), gắn cờ để rà", () => {
    expect(quyetDinhIp({ ...goc, cheDo: "ENFORCE", ip: null })).toEqual({ ipRule: "KHONG_XAC_DINH_IP", cho: true, co: "IP_KHONG_XAC_DINH" });
    expect(quyetDinhIp({ ...goc, cheDo: "OBSERVE", ip: null })).toMatchObject({ cho: true, co: null });
  });
});
