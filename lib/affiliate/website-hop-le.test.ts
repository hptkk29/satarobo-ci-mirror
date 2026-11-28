/**
 * [WHL-*] LƯỚI BẢO MẬT của `website-hop-le.ts` — cổng chặn open-redirect / link giả mạo cho P1 (đặc tả §14, §64).
 *
 * Mỗi ca tấn công là MỘT DÒNG CÓ TÊN và khẳng định ĐÚNG MÃ LỖI (`lyDo`), không chỉ «bị từ chối»: bộ phân tích URL của WHATWG sửa chữa nhiều dạng tấn công thành địa chỉ hợp lệ,
 * và nhiều cổng có lớp phòng thủ chồng nhau — chỉ kiểm `ok: false` thì gỡ một cổng riêng lẻ vẫn ra xanh vì cổng sau tình cờ chặn. Mã lỗi cụ thể buộc từng cổng phải tự chứng minh.
 *
 *   [WHL-ATK]   tấn công theo tên (host · userinfo · cổng · scheme · gạch chéo · điều khiển · leo thang · mã hoá)
 *   [WHL-OK]    đối chứng DƯƠNG: những địa chỉ phải ĐƯỢC PHÉP (không có thì mọi ca «bị chặn» có thể chỉ là hàm chặn tất cả)
 *   [WHL-SOLE]  ca mà gỡ cổng tương ứng thì địa chỉ được CHO QUA (cổng duy nhất giữ) — phép cấy lỗi nhắm vào đây
 *   [WHL-MAU]   chuanHoaDuongDanMau + khopDuongDan (ngữ nghĩa đúng/tiền tố, hai chiều)
 *   [WHL-DOM]   chuanHoaTenMien / kiemTenMien
 *   [WHL-BASE]  kiemBaseUrl
 *   [WHL-SHAPE] hợp đồng hình dạng: không query/fragment trong kết quả; nhãn đủ cho mọi mã; module thuần
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DO_DAI_URL_TOI_DA,
  MA_LY_DO,
  NHAN_LY_DO,
  chuanHoaDuongDanMau,
  chuanHoaTenMien,
  khopDuongDan,
  kiemBaseUrl,
  kiemTenMien,
  kiemUrlDuocPhep,
  nhanLyDo,
  type MaLyDo,
  type SiteDeKiem,
  type TrangDichDeKiem,
} from "./website-hop-le";

const SITE: SiteDeKiem = { allowedDomains: ["quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true };
const TRANG: TrangDichDeKiem[] = [
  { pathPattern: "/khoa-robotics", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
  { pathPattern: "/khoa-hoc/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
  { pathPattern: "/trang-cu", isActive: false, host: "quatang.edu.vn", trackingEnabled: true },
];
const kiem = (u: unknown, site: SiteDeKiem = SITE, trang: readonly TrangDichDeKiem[] = TRANG) => kiemUrlDuocPhep(u, site, trang);
const lyDo = (u: unknown, site: SiteDeKiem = SITE, trang: readonly TrangDichDeKiem[] = TRANG): MaLyDo | "OK" => {
  const kq = kiem(u, site, trang);
  return kq.ok ? "OK" : kq.lyDo;
};

describe("[WHL-ATK] tấn công — mỗi dòng một ca có tên, khẳng định đúng mã lỗi", () => {
  const ca: ReadonlyArray<readonly [string, string, MaLyDo]> = [
    // ── tên miền ──────────────────────────────────────────────────────────────────────────────────────
    ["userinfo: evil.com@quatang.edu.vn", "https://evil.com@quatang.edu.vn/", "CO_USERINFO"],
    ["userinfo: có cả đường dẫn hợp lệ phía sau", "https://evil.com@quatang.edu.vn/khoa-robotics", "CO_USERINFO"],
    ["userinfo: user:pass@", "https://user:pass@quatang.edu.vn/khoa-robotics", "CO_USERINFO"],
    ["đuôi giả: quatang.edu.vn.evil.com", "https://quatang.edu.vn.evil.com/", "HOST_KHONG_DUOC_PHEP"],
    ["đuôi giả: kèm đường dẫn hợp lệ", "https://quatang.edu.vn.evil.com/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["tiền tố giả: evilquatang.edu.vn", "https://evilquatang.edu.vn/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["tên miền con không khai: www.quatang.edu.vn", "https://www.quatang.edu.vn/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["tên miền con sâu hơn: a.b.quatang.edu.vn", "https://a.b.quatang.edu.vn/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["tên miền cha: edu.vn", "https://edu.vn/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["cổng lạ: :8443", "https://quatang.edu.vn:8443/", "CONG_LA"],
    ["cổng lạ: :8443 kèm đường dẫn hợp lệ", "https://quatang.edu.vn:8443/khoa-robotics", "CONG_LA"],
    ["cổng tường minh :443 cũng từ chối (không đoán)", "https://quatang.edu.vn:443/khoa-robotics", "CONG_LA"],
    ["cổng :80", "https://quatang.edu.vn:80/khoa-robotics", "CONG_LA"],
    ["cổng rỗng: dấu : cuối", "https://quatang.edu.vn:/khoa-robotics", "CONG_LA"],
    ["IPv6 [::1]", "https://[::1]/khoa-robotics", "CONG_LA"],
    ["IPv4 thẳng", "https://127.0.0.1/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["IPv4 viết số nguyên (2130706433 = 127.0.0.1)", "https://2130706433/khoa-robotics", "TEN_MIEN_KHONG_CHUAN"],
    ["IPv4 viết hex (0x7f.1)", "https://0x7f.1/khoa-robotics", "TEN_MIEN_KHONG_CHUAN"],
    ["dấu chấm cuối: quatang.edu.vn.", "https://quatang.edu.vn./khoa-robotics", "TEN_MIEN_DAU_CHAM_CUOI"],
    ["punycode giả: xn--quatang-9ya.edu.vn", "https://xn--quatang-9ya.edu.vn/khoa-robotics", "HOST_KHONG_DUOC_PHEP"],
    ["punycode hỏng: xn--", "https://xn--/khoa-robotics", "URL_KHONG_HOP_LE"],
    ["chữ Unicode giống: quatäng.edu.vn", "https://quatäng.edu.vn/khoa-robotics", "TEN_MIEN_KHONG_CHUAN"],
    ["dấu chấm toàn chiều rộng: quatang。edu。vn", "https://quatang。edu。vn/khoa-robotics", "TEN_MIEN_KHONG_CHUAN"],
    ["host mã hoá %: quatang%2eedu.vn", "https://quatang%2eedu.vn/khoa-robotics", "TEN_MIEN_MA_HOA"],
    ["host mã hoá %: %71uatang.edu.vn", "https://%71uatang.edu.vn/khoa-robotics", "TEN_MIEN_MA_HOA"],
    // ── scheme / gạch chéo / điều khiển ───────────────────────────────────────────────────────────────
    ["scheme-tương-đối: //evil.com", "//evil.com/khoa-robotics", "KHONG_PHAI_HTTPS"],
    ["đường dẫn tương đối: /khoa-robotics", "/khoa-robotics", "KHONG_PHAI_HTTPS"],
    ["thiếu scheme: quatang.edu.vn/khoa-robotics", "quatang.edu.vn/khoa-robotics", "KHONG_PHAI_HTTPS"],
    ["http thay vì https", "http://quatang.edu.vn/khoa-robotics", "KHONG_PHAI_HTTPS"],
    ["javascript:", "javascript:alert(1)", "KHONG_PHAI_HTTPS"],
    ["javascript: giả dạng host", "javascript://quatang.edu.vn/%0aalert(1)", "KHONG_PHAI_HTTPS"],
    ["data:", "data:text/html,<script>alert(1)</script>", "KHONG_PHAI_HTTPS"],
    ["https một gạch: https:/quatang.edu.vn", "https:/quatang.edu.vn/khoa-robotics", "KHONG_PHAI_HTTPS"],
    ["https không gạch: https:quatang.edu.vn", "https:quatang.edu.vn/khoa-robotics", "KHONG_PHAI_HTTPS"],
    ["ba gạch: https:///quatang.edu.vn", "https:///quatang.edu.vn/khoa-robotics", "THIEU_TEN_MIEN"],
    ["https:// rồi hết", "https://", "THIEU_TEN_MIEN"],
    ["https:// rồi ?", "https://?x=1", "THIEU_TEN_MIEN"],
    ["gạch chéo ngược: \\\\evil.com", "\\\\evil.com", "GACH_CHEO_NGUOC"],
    ["gạch chéo ngược sau https:", "https:\\\\evil.com", "GACH_CHEO_NGUOC"],
    ["gạch chéo ngược trong đường dẫn", "https://quatang.edu.vn/khoa-hoc\\..\\admin", "GACH_CHEO_NGUOC"],
    ["gạch chéo ngược cạnh @", "https://quatang.edu.vn\\@evil.com/", "GACH_CHEO_NGUOC"],
    ["TAB giữa host", "https://quatang.edu.vn\t.evil.com/khoa-robotics", "KY_TU_CAM"],
    ["CR trong đường dẫn", "https://quatang.edu.vn/khoa-hoc/a\rb", "KY_TU_CAM"],
    ["LF trong đường dẫn", "https://quatang.edu.vn/khoa-hoc/a\nb", "KY_TU_CAM"],
    ["NUL trong đường dẫn", "https://quatang.edu.vn/khoa-hoc/a\u0000b", "KY_TU_CAM"],
    ["TAB chen scheme: ht\ttps://", "ht\ttps://quatang.edu.vn/khoa-robotics", "KY_TU_CAM"],
    ["dấu cách trong đường dẫn", "https://quatang.edu.vn/khoa-hoc/a b", "KY_TU_CAM"],
    ["dấu cách đầu chuỗi", " https://quatang.edu.vn/khoa-robotics", "KY_TU_CAM"],
    ["dấu cách cuối chuỗi", "https://quatang.edu.vn/khoa-robotics ", "KY_TU_CAM"],
    ["khoảng trắng NBSP", "https://quatang.edu.vn/khoa-hoc/a b", "KY_TU_CAM"],
    ["zero-width space", "https://quatang.edu.vn/khoa-hoc/a​b", "KY_TU_CAM"],
    ["ký tự bidi override", "https://quatang.edu.vn/khoa-hoc/a‮b", "KY_TU_CAM"],
    // ── đường dẫn ─────────────────────────────────────────────────────────────────────────────────────
    ["leo thang: /khoa-hoc/../admin", "https://quatang.edu.vn/khoa-hoc/../admin", "DUONG_DAN_LEO_THANG"],
    ["leo thang rồi quay lại tiền tố: /khoa-hoc/../khoa-hoc/x", "https://quatang.edu.vn/khoa-hoc/../khoa-hoc/x", "DUONG_DAN_LEO_THANG"],
    ["leo thang ở cuối: /khoa-hoc/x/..", "https://quatang.edu.vn/khoa-hoc/x/..", "DUONG_DAN_LEO_THANG"],
    ["đoạn một chấm: /khoa-hoc/./x", "https://quatang.edu.vn/khoa-hoc/./x", "DUONG_DAN_LEO_THANG"],
    ["leo thang mã hoá: /%2e%2e/admin", "https://quatang.edu.vn/%2e%2e/admin", "DUONG_DAN_LEO_THANG"],
    ["leo thang mã hoá HOA/thường lẫn: /%2E%2e/admin", "https://quatang.edu.vn/%2E%2e/admin", "DUONG_DAN_LEO_THANG"],
    ["leo thang nửa mã hoá: /.%2e/admin", "https://quatang.edu.vn/.%2e/admin", "DUONG_DAN_LEO_THANG"],
    ["leo thang sau tiền tố: /khoa-hoc/%2e%2e", "https://quatang.edu.vn/khoa-hoc/%2e%2e", "DUONG_DAN_LEO_THANG"],
    ["gạch chéo mã hoá: /..%2f", "https://quatang.edu.vn/..%2f", "DUONG_DAN_MA_HOA_NGUY_HIEM"],
    ["gạch chéo mã hoá sau tiền tố: /khoa-hoc/x%2f..%2fadmin", "https://quatang.edu.vn/khoa-hoc/x%2f..%2fadmin", "DUONG_DAN_MA_HOA_NGUY_HIEM"],
    ["gạch chéo mã hoá HOA: %2F", "https://quatang.edu.vn/khoa-hoc/x%2Fy", "DUONG_DAN_MA_HOA_NGUY_HIEM"],
    ["gạch chéo ngược mã hoá: %5c", "https://quatang.edu.vn/khoa-hoc/x%5cy", "DUONG_DAN_MA_HOA_NGUY_HIEM"],
    ["NUL mã hoá: %00", "https://quatang.edu.vn/khoa-hoc/a%00b", "DUONG_DAN_MA_HOA_NGUY_HIEM"],
    ["mã hoá hai lần: %252e%252e", "https://quatang.edu.vn/khoa-hoc/%252e%252e", "DUONG_DAN_MA_HOA_NGUY_HIEM"],
    ["hai gạch chéo ở đầu đường dẫn: //evil.com", "https://quatang.edu.vn//evil.com", "DUONG_DAN_HAI_GACH"],
    ["hai gạch chéo giữa đường dẫn", "https://quatang.edu.vn/khoa-hoc//x", "DUONG_DAN_HAI_GACH"],
    // ── trang đích ────────────────────────────────────────────────────────────────────────────────────
    ["đường dẫn không có trang đích: /admin", "https://quatang.edu.vn/admin", "KHONG_CO_TRANG_DICH"],
    ["gốc / khi chỉ khai trang con", "https://quatang.edu.vn/", "KHONG_CO_TRANG_DICH"],
    ["không có đường dẫn", "https://quatang.edu.vn", "KHONG_CO_TRANG_DICH"],
    ["trang đích đã TẮT: /trang-cu", "https://quatang.edu.vn/trang-cu", "KHONG_CO_TRANG_DICH"],
    ["tiền tố không qua ranh giới đoạn: /khoa-hocx", "https://quatang.edu.vn/khoa-hocx", "KHONG_CO_TRANG_DICH"],
    ["đúng-mẫu không khớp phần mở rộng: /khoa-robotics/x", "https://quatang.edu.vn/khoa-robotics/x", "KHONG_CO_TRANG_DICH"],
    ["phân biệt hoa/thường đường dẫn: /Khoa-Robotics", "https://quatang.edu.vn/Khoa-Robotics", "KHONG_CO_TRANG_DICH"],
    ["đường dẫn nằm trong QUERY, không phải đường dẫn thật", "https://quatang.edu.vn/admin?next=/khoa-robotics", "KHONG_CO_TRANG_DICH"],
    ["đường dẫn nằm trong FRAGMENT", "https://quatang.edu.vn/admin#/khoa-robotics", "KHONG_CO_TRANG_DICH"],
    ["query ngay sau host, không đường dẫn", "https://quatang.edu.vn?next=/khoa-robotics", "KHONG_CO_TRANG_DICH"],
    // ── đầu vào không phải chuỗi ──────────────────────────────────────────────────────────────────────
    ["chuỗi rỗng", "", "RONG"],
    ["undefined", undefined as unknown as string, "RONG"],
    ["null", null as unknown as string, "RONG"],
    ["số", 123 as unknown as string, "RONG"],
    ["đối tượng URL", new URL("https://quatang.edu.vn/khoa-robotics") as unknown as string, "RONG"],
    ["quá dài (2049 ký tự)", `https://quatang.edu.vn/khoa-hoc/${"a".repeat(DO_DAI_URL_TOI_DA)}`, "QUA_DAI"],
  ];

  it.each(ca)("%s", (_ten, url, ma) => {
    expect(lyDo(url)).toBe(ma);
  });

  it("danh sách ca không rỗng và mỗi mã lỗi quan trọng có ít nhất một ca đại diện (lưới không tự rỗng)", () => {
    expect(ca.length).toBeGreaterThan(60);
    const daCo = new Set(ca.map((c) => c[2]));
    for (const m of MA_LY_DO) {
      // SITE_NGUNG / SITE_TAT_THEO_DOI / CO_QUERY / BASEURL_CO_DUONG_DAN có ca riêng bên dưới (khác tham số).
      if (m === "SITE_NGUNG" || m === "SITE_TAT_THEO_DOI" || m === "CO_QUERY" || m === "BASEURL_CO_DUONG_DAN") continue;
      expect(daCo.has(m), `mã ${m} chưa có ca tấn công đại diện`).toBe(true);
    }
  });

  it("trạng thái website: INACTIVE ⇒ SITE_NGUNG; tắt theo dõi ⇒ SITE_TAT_THEO_DOI (URL tự nó hoàn toàn hợp lệ)", () => {
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", { ...SITE, status: "INACTIVE" })).toBe("SITE_NGUNG");
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", { ...SITE, trackingEnabled: false })).toBe("SITE_TAT_THEO_DOI");
    // đối chứng dương: cùng URL, website bật ⇒ được phép
    expect(lyDo("https://quatang.edu.vn/khoa-robotics")).toBe("OK");
  });

  it("host sai vẫn bị báo là host sai kể cả khi website đang ngừng (không lộ trạng thái website cho tên miền lạ)", () => {
    expect(lyDo("https://evil.com/khoa-robotics", { ...SITE, status: "INACTIVE" })).toBe("HOST_KHONG_DUOC_PHEP");
  });
});

describe("[WHL-OK] đối chứng DƯƠNG — những địa chỉ phải ĐƯỢC PHÉP", () => {
  it("trang đích đúng-mẫu", () => {
    const kq = kiem("https://quatang.edu.vn/khoa-robotics");
    expect(kq).toMatchObject({ ok: true, host: "quatang.edu.vn", path: "/khoa-robotics", url: "https://quatang.edu.vn/khoa-robotics", trangDichKhop: "/khoa-robotics" });
  });

  it("host viết HOA ⇒ được phép SAU khi chuẩn hoá; host trả về chữ thường", () => {
    const kq = kiem("https://QUATANG.EDU.VN/khoa-robotics");
    expect(kq.ok && kq.host).toBe("quatang.edu.vn");
    expect(kq.ok && kq.url).toBe("https://quatang.edu.vn/khoa-robotics");
  });

  it("scheme viết HOA (HTTPS://) ⇒ được phép", () => {
    expect(lyDo("HTTPS://quatang.edu.vn/khoa-robotics")).toBe("OK");
  });

  it("đúng-mẫu có dấu / cuối ⇒ khớp mẫu không có dấu / cuối", () => {
    expect(lyDo("https://quatang.edu.vn/khoa-robotics/")).toBe("OK");
  });

  it("tiền tố: /khoa-hoc, /khoa-hoc/, /khoa-hoc/a, /khoa-hoc/a/b đều khớp /khoa-hoc/*", () => {
    for (const p of ["/khoa-hoc", "/khoa-hoc/", "/khoa-hoc/a", "/khoa-hoc/a/b/c"]) {
      expect(lyDo(`https://quatang.edu.vn${p}`), p).toBe("OK");
    }
  });

  it("tham số quảng cáo / PII trong query KHÔNG làm hỏng việc so khớp và KHÔNG xuất hiện trong kết quả", () => {
    const kq = kiem("https://quatang.edu.vn/khoa-robotics?utm_source=fb&sdt=0909123456&email=a@b.c#phan-2");
    expect(kq.ok).toBe(true);
    if (kq.ok) {
      expect(kq.url).toBe("https://quatang.edu.vn/khoa-robotics");
      expect(JSON.stringify(kq)).not.toMatch(/0909123456|utm_source|a@b\.c|phan-2|[?#]/);
    }
  });

  it("ô đường dẫn ở GỐC website: mẫu `/*` khớp cả trang chủ; mẫu `/` đúng-mẫu chỉ khớp gốc", () => {
    expect(lyDo("https://quatang.edu.vn/", SITE, [{ pathPattern: "/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true }])).toBe("OK");
    expect(lyDo("https://quatang.edu.vn", SITE, [{ pathPattern: "/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true }])).toBe("OK");
    expect(lyDo("https://quatang.edu.vn/", SITE, [{ pathPattern: "/", isActive: true, host: "quatang.edu.vn", trackingEnabled: true }])).toBe("OK");
    expect(lyDo("https://quatang.edu.vn/x", SITE, [{ pathPattern: "/", isActive: true, host: "quatang.edu.vn", trackingEnabled: true }])).toBe("KHONG_CO_TRANG_DICH");
  });

  it("nhiều tên miền khai: mỗi tên miền đều được phép, tên miền thứ ba chưa khai thì không", () => {
    const site: SiteDeKiem = { ...SITE, allowedDomains: ["quatang.edu.vn", "www.quatang.edu.vn"] };
    // AFF-L6: trang đích GẮN VỚI TÊN MIỀN — mỗi tên miền có trang đích của riêng nó.
    const theoHost = (...hosts: string[]) => hosts.flatMap((h) => TRANG.map((t) => ({ ...t, host: h })));
    const ca = theoHost("quatang.edu.vn", "www.quatang.edu.vn");
    expect(lyDo("https://www.quatang.edu.vn/khoa-robotics", site, ca)).toBe("OK");
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", site, ca)).toBe("OK");
    expect(lyDo("https://m.quatang.edu.vn/khoa-robotics", site, ca)).toBe("HOST_KHONG_DUOC_PHEP");
  });

  it("[AFF-L6] tên miền được phép nhưng KHÔNG có trang đích nào mang tên miền đó ⇒ KHONG_CO_TRANG_DICH (đường dẫn của tên miền khác không cứu)", () => {
    const site: SiteDeKiem = { ...SITE, allowedDomains: ["quatang.edu.vn", "covua.quatang.edu.vn"] };
    expect(lyDo("https://covua.quatang.edu.vn/khoa-robotics", site)).toBe("KHONG_CO_TRANG_DICH");
    const co = [...TRANG, { pathPattern: "/khoa-robotics", isActive: true, host: "covua.quatang.edu.vn", trackingEnabled: true }];
    expect(lyDo("https://covua.quatang.edu.vn/khoa-robotics", site, co)).toBe("OK");
  });

  it("[AFF-L6] trang đích tắt theo dõi RIÊNG (website vẫn bật) không được tính; nhiều trang cùng khớp ⇒ chọn CHÍNH XÁC trước tiền tố", () => {
    const tat = [{ pathPattern: "/khoa-robotics", isActive: true, host: "quatang.edu.vn", trackingEnabled: false }];
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", SITE, tat)).toBe("KHONG_CO_TRANG_DICH");
    const hai = [
      { pathPattern: "/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
      { pathPattern: "/khoa-robotics", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
    ];
    const kq = kiem("https://quatang.edu.vn/khoa-robotics", SITE, hai);
    expect(kq.ok && kq.trangDichKhop).toBe("/khoa-robotics");
    const kq2 = kiem("https://quatang.edu.vn/khac", SITE, hai);
    expect(kq2.ok && kq2.trangDichKhop).toBe("/*");
  });

  it("allowedDomains lưu lẫn HOA: vẫn khớp (phép chuẩn hoá nằm TRONG phép kiểm, không tin dữ liệu đã sạch)", () => {
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", { ...SITE, allowedDomains: ["QuaTang.edu.vn"] })).toBe("OK");
  });

  it("mục hỏng trong allowedDomains KHÔNG BAO GIỜ khớp (scheme, ký tự đại diện, đường dẫn, tên miền cha thiếu nhãn)", () => {
    for (const hong of ["https://quatang.edu.vn", "*.edu.vn", "*", "quatang.edu.vn/khoa-robotics", "quatang.edu.vn.", "", " "]) {
      expect(lyDo("https://quatang.edu.vn/khoa-robotics", { ...SITE, allowedDomains: [hong] }), JSON.stringify(hong)).toBe("HOST_KHONG_DUOC_PHEP");
    }
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", { ...SITE, allowedDomains: [] })).toBe("HOST_KHONG_DUOC_PHEP");
  });

  it("không wildcard ở P0: khai `edu.vn` không mở tên miền con", () => {
    expect(lyDo("https://quatang.edu.vn/khoa-robotics", { ...SITE, allowedDomains: ["edu.vn"] })).toBe("HOST_KHONG_DUOC_PHEP");
  });

  it("độ dài đúng bằng trần ⇒ được xét tiếp (không off-by-one)", () => {
    const dau = "https://quatang.edu.vn/khoa-hoc/";
    const url = dau + "a".repeat(DO_DAI_URL_TOI_DA - dau.length);
    expect(url).toHaveLength(DO_DAI_URL_TOI_DA);
    expect(lyDo(url)).toBe("OK");
    expect(lyDo(`${url}a`)).toBe("QUA_DAI");
  });

  it("punycode THẬT được khai thì khớp (IDN hợp lệ không bị chặn oan)", () => {
    const site: SiteDeKiem = { ...SITE, allowedDomains: ["xn--vit-5kz.vn"] };
    expect(lyDo("https://xn--vit-5kz.vn/khoa-hoc/a", site, TRANG.map((t) => ({ ...t, host: "xn--vit-5kz.vn" })))).toBe("OK");
  });
});

describe("[WHL-SOLE] ca mà gỡ cổng tương ứng thì địa chỉ được CHO QUA — cổng DUY NHẤT giữ", () => {
  it("TAB chen giữa đường dẫn: bộ phân tích XOÁ tab ⇒ /khoa-hoc/x hợp lệ; chỉ cổng ký tự điều khiển giữ", () => {
    expect(new URL("https://quatang.edu.vn/khoa-\thoc/x").pathname).toBe("/khoa-hoc/x"); // bằng chứng: parser tự sửa
    expect(lyDo("https://quatang.edu.vn/khoa-\thoc/x")).toBe("KY_TU_CAM");
  });

  it("ba gạch chéo: bộ phân tích cho host quatang.edu.vn; chỉ cổng «thiếu tên miền» giữ", () => {
    expect(new URL("https:///quatang.edu.vn/khoa-robotics").hostname).toBe("quatang.edu.vn");
    expect(lyDo("https:///quatang.edu.vn/khoa-robotics")).toBe("THIEU_TEN_MIEN");
  });

  it("/khoa-hoc/../khoa-hoc/x: bộ phân tích đưa về /khoa-hoc/x (khớp tiền tố); chỉ cổng leo-thang trên đường dẫn THÔ giữ", () => {
    expect(new URL("https://quatang.edu.vn/khoa-hoc/../khoa-hoc/x").pathname).toBe("/khoa-hoc/x");
    expect(lyDo("https://quatang.edu.vn/khoa-hoc/../khoa-hoc/x")).toBe("DUONG_DAN_LEO_THANG");
    expect(new URL("https://quatang.edu.vn/khoa-hoc/%2e%2e/khoa-hoc/x").pathname).toBe("/khoa-hoc/x");
    expect(lyDo("https://quatang.edu.vn/khoa-hoc/%2e%2e/khoa-hoc/x")).toBe("DUONG_DAN_LEO_THANG");
  });

  it("%2f còn nguyên sau phân tích và vẫn khớp tiền tố: chỉ cổng mã-hoá-nguy-hiểm giữ", () => {
    const url = "https://quatang.edu.vn/khoa-hoc/x%2f..%2fadmin";
    expect(new URL(url).pathname).toBe("/khoa-hoc/x%2f..%2fadmin");
    expect(khopDuongDan("/khoa-hoc/*", "/khoa-hoc/x%2f..%2fadmin")).toBe(false); // lớp thứ hai của chính khopDuongDan
    expect(lyDo(url)).toBe("DUONG_DAN_MA_HOA_NGUY_HIEM");
  });

  it("cổng :443 tường minh: bộ phân tích nuốt cổng; chỉ cổng «không cổng» trên chuỗi thô giữ", () => {
    expect(new URL("https://quatang.edu.vn:443/khoa-robotics").port).toBe("");
    expect(lyDo("https://quatang.edu.vn:443/khoa-robotics")).toBe("CONG_LA");
  });

  it("quatang%2eedu.vn và quatang。edu。vn: bộ phân tích đưa về quatang.edu.vn; chỉ cổng chuẩn-hoá/mã-hoá giữ", () => {
    expect(new URL("https://quatang%2eedu.vn/khoa-robotics").hostname).toBe("quatang.edu.vn");
    expect(new URL("https://quatang。edu。vn/khoa-robotics").hostname).toBe("quatang.edu.vn");
    expect(lyDo("https://quatang%2eedu.vn/khoa-robotics")).toBe("TEN_MIEN_MA_HOA");
    expect(lyDo("https://quatang。edu。vn/khoa-robotics")).toBe("TEN_MIEN_KHONG_CHUAN");
  });

  it("gạch chéo ngược: bộ phân tích coi như gạch chéo xuôi; chỉ cổng chuỗi thô giữ", () => {
    expect(new URL("https://quatang.edu.vn\\khoa-robotics").pathname).toBe("/khoa-robotics");
    expect(lyDo("https://quatang.edu.vn\\khoa-robotics")).toBe("GACH_CHEO_NGUOC");
  });
});

describe("[WHL-MAU] đường dẫn mẫu + khopDuongDan", () => {
  it("chuanHoaDuongDanMau — hợp lệ: đúng-mẫu bỏ / cuối; tiền tố giữ nguyên; gốc", () => {
    expect(chuanHoaDuongDanMau("/khoa-robotics")).toEqual({ ok: true, mau: "/khoa-robotics", kieu: "CHINH_XAC" });
    expect(chuanHoaDuongDanMau("  /khoa-robotics/ ")).toEqual({ ok: true, mau: "/khoa-robotics", kieu: "CHINH_XAC" });
    expect(chuanHoaDuongDanMau("/khoa-hoc/*")).toEqual({ ok: true, mau: "/khoa-hoc/*", kieu: "TIEN_TO" });
    expect(chuanHoaDuongDanMau("/*")).toEqual({ ok: true, mau: "/*", kieu: "TIEN_TO" });
    expect(chuanHoaDuongDanMau("/")).toEqual({ ok: true, mau: "/", kieu: "CHINH_XAC" });
    expect(chuanHoaDuongDanMau("/a/b.html")).toEqual({ ok: true, mau: "/a/b.html", kieu: "CHINH_XAC" });
  });

  it.each([
    ["trống", ""],
    ["không bắt đầu bằng /", "khoa-robotics"],
    ["hai gạch chéo", "//evil.com"],
    ["hai gạch chéo giữa", "/a//b"],
    ["đoạn ..", "/a/../b"],
    ["đoạn .", "/a/./b"],
    ["đoạn chỉ chấm dài", "/a/.../b"],
    ["mã hoá %2e", "/a/%2e%2e/b"],
    ["mã hoá %", "/a%20b"],
    ["dấu cách", "/a b"],
    ["tab", "/a\tb"],
    ["dấu ?", "/a?x=1"],
    ["dấu #", "/a#x"],
    ["gạch chéo ngược", "/a\\b"],
    ["* ở giữa", "/a/*/b"],
    ["* không đứng sau /", "/khoa*"],
    ["hai dấu *", "/a/**"],
    ["* đứng đầu", "*"],
    ["chữ có dấu", "/khóa-học"],
    ["scheme", "https://quatang.edu.vn/a"],
  ])("từ chối mẫu hỏng: %s", (_ten, mau) => {
    const kq = chuanHoaDuongDanMau(mau);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.loi.length).toBeGreaterThan(5);
  });

  it("từ chối mẫu quá dài và không phải chuỗi", () => {
    expect(chuanHoaDuongDanMau(`/${"a".repeat(200)}`).ok).toBe(false);
    expect(chuanHoaDuongDanMau(undefined).ok).toBe(false);
    expect(chuanHoaDuongDanMau(7).ok).toBe(false);
  });

  it("khopDuongDan — đúng-mẫu: hai chiều", () => {
    expect(khopDuongDan("/khoa-robotics", "/khoa-robotics")).toBe(true);
    expect(khopDuongDan("/khoa-robotics", "/khoa-robotics/")).toBe(true);
    expect(khopDuongDan("/khoa-robotics/", "/khoa-robotics")).toBe(true);
    expect(khopDuongDan("/khoa-robotics", "/khoa-robotics/x")).toBe(false);
    expect(khopDuongDan("/khoa-robotics", "/khoa-robotic")).toBe(false);
    expect(khopDuongDan("/khoa-robotics", "/Khoa-Robotics")).toBe(false);
    expect(khopDuongDan("/khoa-robotics", "/")).toBe(false);
  });

  it("khopDuongDan — tiền tố: ranh giới đoạn, hai chiều", () => {
    expect(khopDuongDan("/khoa-hoc/*", "/khoa-hoc")).toBe(true);
    expect(khopDuongDan("/khoa-hoc/*", "/khoa-hoc/")).toBe(true);
    expect(khopDuongDan("/khoa-hoc/*", "/khoa-hoc/a/b")).toBe(true);
    expect(khopDuongDan("/khoa-hoc/*", "/khoa-hocx")).toBe(false);
    expect(khopDuongDan("/khoa-hoc/*", "/khoa")).toBe(false);
    expect(khopDuongDan("/khoa-hoc/*", "/khac/khoa-hoc/a")).toBe(false);
    expect(khopDuongDan("/*", "/bat-ky/dau")).toBe(true);
  });

  it("khopDuongDan — mẫu hỏng ⇒ false (không bao giờ nở thành khớp-tất-cả)", () => {
    for (const hong of ["", "khoa", "/khoa*", "/a/*/b", "/a/../b", "*", "/%2e"]) {
      expect(khopDuongDan(hong, "/khoa-hoc/x"), hong).toBe(false);
    }
  });

  it("khopDuongDan — đường dẫn đi lên thư mục cha / mã hoá nguy hiểm ⇒ false kể cả khớp tiền tố", () => {
    for (const p of ["/khoa-hoc/../admin", "/khoa-hoc/x/..", "/khoa-hoc/%2e%2e/admin", "/khoa-hoc/x%2fy", "/khoa-hoc/x%5cy", "/khoa-hoc//x", "/khoa-hoc/a\\b", "/khoa-hoc/a\tb", "/khoa-hoc/a%00"]) {
      expect(khopDuongDan("/khoa-hoc/*", p), p).toBe(false);
    }
    expect(khopDuongDan("/*", "/khoa-hoc/../admin")).toBe(false);
  });

  it("khopDuongDan — đường dẫn rỗng / không bắt đầu / mang query ⇒ false", () => {
    expect(khopDuongDan("/*", "")).toBe(false);
    expect(khopDuongDan("/*", "khoa")).toBe(false);
    expect(khopDuongDan("/khoa-robotics", "/khoa-robotics?x=1")).toBe(false);
    expect(khopDuongDan("/khoa-robotics", "/khoa-robotics#a")).toBe(false);
    expect(khopDuongDan("/*", undefined as unknown as string)).toBe(false);
  });
});

describe("[WHL-DOM] chuanHoaTenMien / kiemTenMien", () => {
  it("hợp lệ: hạ chữ thường, cắt khoảng trắng hai đầu", () => {
    expect(chuanHoaTenMien("quatang.edu.vn")).toBe("quatang.edu.vn");
    expect(chuanHoaTenMien("  QuaTang.EDU.vn  ")).toBe("quatang.edu.vn");
    expect(chuanHoaTenMien("a-b.c1.vn")).toBe("a-b.c1.vn");
    expect(chuanHoaTenMien("xn--vit-5kz.vn")).toBe("xn--vit-5kz.vn");
  });

  it.each([
    ["trống", ""],
    ["toàn dấu cách", "   "],
    ["có scheme", "https://quatang.edu.vn"],
    ["có đường dẫn", "quatang.edu.vn/khoa"],
    ["có query", "quatang.edu.vn?x"],
    ["có fragment", "quatang.edu.vn#x"],
    ["có gạch chéo ngược", "quatang.edu.vn\\x"],
    ["có @", "a@quatang.edu.vn"],
    ["có cổng", "quatang.edu.vn:8443"],
    ["IPv6", "[::1]"],
    ["ký tự đại diện", "*.quatang.edu.vn"],
    ["dấu cách giữa", "quatang .edu.vn"],
    ["chữ có dấu", "quàtang.edu.vn"],
    ["Unicode lạ", "quatäng.edu.vn"],
    ["chấm đầu", ".quatang.edu.vn"],
    ["chấm cuối", "quatang.edu.vn."],
    ["hai chấm liền", "quatang..edu.vn"],
    ["một nhãn (localhost)", "localhost"],
    ["nhãn bắt đầu bằng -", "-a.edu.vn"],
    ["nhãn kết thúc bằng -", "a-.edu.vn"],
    ["nhãn quá 63 ký tự", `${"a".repeat(64)}.edu.vn`],
    ["tổng quá 253 ký tự", `${"a.".repeat(130)}vn`],
    ["gạch dưới", "quat_ang.edu.vn"],
    ["IPv4", "127.0.0.1"],
    ["TLD toàn số", "a.123"],
    ["punycode hỏng", "xn--.vn"],
    ["ký tự điều khiển", "quatang.edu.vn\u0000"],
    ["tab giữa", "quatang\t.edu.vn"],
  ])("từ chối: %s", (_ten, d) => {
    expect(chuanHoaTenMien(d)).toBeNull();
    const kq = kiemTenMien(d);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.loi.length).toBeGreaterThan(5);
  });

  it("không phải chuỗi ⇒ null", () => {
    expect(chuanHoaTenMien(undefined)).toBeNull();
    expect(chuanHoaTenMien(null)).toBeNull();
    expect(chuanHoaTenMien(42)).toBeNull();
  });
});

describe("[WHL-BASE] kiemBaseUrl", () => {
  const AD = ["quatang.edu.vn"];
  it("hợp lệ: bỏ dấu / cuối, hạ chữ thường host", () => {
    expect(kiemBaseUrl("https://quatang.edu.vn", AD)).toEqual({ ok: true, baseUrl: "https://quatang.edu.vn", host: "quatang.edu.vn" });
    expect(kiemBaseUrl("https://quatang.edu.vn/", AD)).toEqual({ ok: true, baseUrl: "https://quatang.edu.vn", host: "quatang.edu.vn" });
    expect(kiemBaseUrl("https://QUATANG.edu.vn/", AD)).toEqual({ ok: true, baseUrl: "https://quatang.edu.vn", host: "quatang.edu.vn" });
  });

  it.each<readonly [string, unknown, MaLyDo]>([
    ["http", "http://quatang.edu.vn", "KHONG_PHAI_HTTPS"],
    ["thiếu scheme", "quatang.edu.vn", "KHONG_PHAI_HTTPS"],
    ["host không thuộc danh sách", "https://evil.com", "HOST_KHONG_DUOC_PHEP"],
    ["tên miền con không khai", "https://www.quatang.edu.vn", "HOST_KHONG_DUOC_PHEP"],
    ["đuôi giả", "https://quatang.edu.vn.evil.com", "HOST_KHONG_DUOC_PHEP"],
    ["userinfo", "https://evil.com@quatang.edu.vn", "CO_USERINFO"],
    ["cổng", "https://quatang.edu.vn:8443", "CONG_LA"],
    ["đường dẫn", "https://quatang.edu.vn/khoa-hoc", "BASEURL_CO_DUONG_DAN"],
    ["query", "https://quatang.edu.vn?x=1", "CO_QUERY"],
    ["query sau /", "https://quatang.edu.vn/?x=1", "CO_QUERY"],
    ["fragment rỗng", "https://quatang.edu.vn#", "CO_QUERY"],
    ["dấu cách", "https://quatang.edu.vn /", "KY_TU_CAM"],
    ["ba gạch chéo", "https:///quatang.edu.vn", "THIEU_TEN_MIEN"],
    ["trống", "", "RONG"],
    ["dấu chấm cuối", "https://quatang.edu.vn.", "TEN_MIEN_DAU_CHAM_CUOI"],
  ])("từ chối: %s", (_ten, url, ma) => {
    const kq = kiemBaseUrl(url, AD);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.lyDo).toBe(ma);
  });

  it("danh sách tên miền rỗng hoặc hỏng ⇒ không có host nào được phép", () => {
    expect(kiemBaseUrl("https://quatang.edu.vn", [])).toEqual({ ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" });
    expect(kiemBaseUrl("https://quatang.edu.vn", ["https://quatang.edu.vn"])).toEqual({ ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" });
  });

  it("allowedDomains lưu lẫn HOA vẫn khớp (chuẩn hoá nằm trong phép kiểm)", () => {
    expect(kiemBaseUrl("https://quatang.edu.vn", ["QuaTang.edu.vn"]).ok).toBe(true);
  });
});

describe("[WHL-SHAPE] hợp đồng hình dạng", () => {
  it("mọi mã lỗi đều có nhãn tiếng Việt không rỗng; nhanLyDo trả đúng nhãn", () => {
    for (const m of MA_LY_DO) {
      expect(NHAN_LY_DO[m].length, m).toBeGreaterThan(10);
      expect(nhanLyDo(m)).toBe(NHAN_LY_DO[m]);
    }
    expect(Object.keys(NHAN_LY_DO).sort()).toEqual([...MA_LY_DO].sort());
  });

  it("mã lỗi không trùng nhau", () => {
    expect(new Set(MA_LY_DO).size).toBe(MA_LY_DO.length);
  });

  it("module THUẦN: không import nào (không DB, không next, không react)", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/affiliate/website-hop-le.ts"), "utf8");
    const boChuThich = src
      .split(/\r?\n/)
      .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect([...boChuThich.matchAll(/^\s*import\s/gm)]).toHaveLength(0);
    expect([...boChuThich.matchAll(/\brequire\s*\(/g)]).toHaveLength(0);
  });

  it("kết quả thất bại KHÔNG mang host/đường dẫn nào (không rò phần đã phân tích)", () => {
    const kq = kiem("https://evil.com/khoa-robotics?sdt=0909123456");
    expect(kq).toEqual({ ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" });
  });
});
