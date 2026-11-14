/**
 * [DISC-QA-SENTRY] P1 — bộ che Sentry đã THU HẸP: khoá đặc thù DISC che toàn app, khoá CHUNG (email/họ tên/kết quả/điểm…)
 * chỉ che trên đường DISC. Hai chiều đều phải có ca: chỉ thử "che" thì bản quay lại che-toàn-app vẫn xanh;
 * chỉ thử "không che" thì bản bỏ che vẫn xanh. Dữ liệu GIẢ.
 */
import { describe, expect, it } from "vitest";
import { CHO_CHE, locSuKienSentry } from "@/lib/security/che-bi-mat";
import { DA_CHE, laTenNhayCam } from "@/lib/observability/che-bi-mat";

type Ev = { request?: { url?: string }; transaction?: string; extra?: Record<string, unknown> };
const ev = (url: string, extra: Record<string, unknown>): Ev => ({ request: { url }, extra });
const loc = (e: Ev) => locSuKienSentry(e) as Ev;

const KHOA_CHUNG = ["email", "fullName", "result", "diem"] as const;
const KHOA_DAC_THU = ["namSinhCon", "tenPhuHuynh", "tenCon", "traLoi", "otp", "tokenTai", "phoneKey"] as const;

describe("[DISC-QA-SENTRY-01] khoá đặc thù DISC che Ở MỌI NƠI", () => {
  for (const url of ["https://admin.satarobo.vn/admin/orders/1", "https://satarobo.vn/disc/bat-dau", "https://satarobo.vn/kich-hoat"]) {
    it(`${url}`, () => {
      const e = loc(ev(url, Object.fromEntries(KHOA_DAC_THU.map((k) => [k, "GIA-TRI-NHAY-CAM"]))));
      for (const k of KHOA_DAC_THU) expect(e.extra?.[k], k).toBe(CHO_CHE);
    });
  }
});

describe("[DISC-QA-SENTRY-02] khoá CHUNG: KHÔNG che trên đường ngoài DISC (không làm mất dữ liệu điều tra của module khác)", () => {
  for (const url of ["https://admin.satarobo.vn/admin/orders/1", "https://admin.satarobo.vn/admin/leads", "https://satarobo.vn/api/leads"]) {
    it(`${url}`, () => {
      const e = loc(ev(url, Object.fromEntries(KHOA_CHUNG.map((k) => [k, "GIA-TRI-CONG-KHAI"]))));
      for (const k of KHOA_CHUNG) expect(e.extra?.[k], k).toBe("GIA-TRI-CONG-KHAI");
    });
  }
  it("điểm kiểm tra tên-khoá thuần: laTenNhayCam(khoá chung) = false khi không ở đường DISC, true khi laDisc", () => {
    for (const k of KHOA_CHUNG) {
      expect(laTenNhayCam(k), `${k} ngoài DISC`).toBe(false);
      expect(laTenNhayCam(k, true), `${k} trong DISC`).toBe(true);
    }
    expect(DA_CHE.length).toBeGreaterThan(0);
  });
});

describe("[DISC-QA-SENTRY-03] khoá CHUNG: CHE trên đường DISC (/disc, /api/disc, /portal/disc)", () => {
  for (const url of ["https://satarobo.vn/disc/bat-dau", "https://satarobo.vn/api/disc/luu", "https://hocvien.satarobo.vn/portal/disc/abc", "https://satarobo.vn/disc/xac-minh-email?t=x"]) {
    it(`${url}`, () => {
      const e = loc(ev(url, Object.fromEntries(KHOA_CHUNG.map((k) => [k, "GIA-TRI-NHAY-CAM"]))));
      for (const k of KHOA_CHUNG) expect(e.extra?.[k], k).toBe(CHO_CHE);
    });
  }
  it("đối chứng biên: đường giống tên nhưng KHÔNG phải DISC (/discount, /disc-het-han) không bị coi là DISC", () => {
    for (const url of ["https://satarobo.vn/discount/1", "https://satarobo.vn/khuyen-mai/discover"]) {
      const e = loc(ev(url, { email: "cong-khai@example.test" }));
      expect(e.extra?.email, url).toBe("cong-khai@example.test");
    }
  });
});

describe("[DISC-QA-SENTRY-04] liên kết xác minh email: token `?t=` bị che trong chuỗi, kể cả ngoài sự kiện DISC", () => {
  it("URL /disc/xac-minh-email?t=… ở breadcrumb/extra", () => {
    const e = loc(ev("https://admin.satarobo.vn/admin", { dieuHuong: "https://satarobo.vn/disc/xac-minh-email?t=TOKEN-GIA-123456" }));
    expect(JSON.stringify(e)).not.toContain("TOKEN-GIA-123456");
  });
});

/**
 * GHI NHẬN (không phải khẳng định đúng-sai): khe còn lại của thiết kế "chỉ che khoá chung trên đường DISC" —
 * sự kiện sinh từ luồng nhận bài đi qua `/kich-hoat` (không nằm trong MAU_DUONG_DISC) KHÔNG che `email`/`fullName`.
 * Hiện luồng đó không đưa hai khoá này vào Prisma `data` (taoPhuHuynh chỉ ghi phone/password) nên chưa rò; nếu ai thêm,
 * ca này phải đổi chiều. Ghim để thay đổi thành lựa chọn có chủ đích.
 */
describe("[DISC-QA-SENTRY-05] khe đã biết: /kich-hoat không phải đường DISC", () => {
  it("email trong sự kiện từ /kich-hoat KHÔNG bị che (hành vi hiện hành, ghi nhận)", () => {
    const e = loc(ev("https://satarobo.vn/kich-hoat", { email: "cong-khai@example.test" }));
    expect(e.extra?.email).toBe("cong-khai@example.test");
  });
});
