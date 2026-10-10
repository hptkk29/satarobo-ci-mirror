import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isAuthPhoneProvisioningEnabled,
  isPaymentLedgerV2Enabled,
  isZalocrmEnabled,
  isInboxEnabled,
} from "./flags";

/** `.env.example` đọc MỘT lần — nhiều bộ dưới đây soi nó. */
const ENV_EXAMPLE = readFileSync(join(process.cwd(), ".env.example"), "utf8");

// AUTH-SĐT P5 — cờ ngắt đường TỰ ĐỘNG cấp tài khoản phụ huynh theo SĐT.
// Doc phase đã từng ghi cờ `AUTH_PHONE_PROVISIONING` ở hàng "Feature flag" và ở
// mục Rollback của P5 trong khi **không có dòng code nào đọc nó** — đường lùi chỉ
// tồn tại trên giấy. Bộ test này khoá đúng ngữ nghĩa để không tái diễn.

const KEY = "AUTH_PHONE_PROVISIONING";

afterEach(() => {
  delete process.env[KEY];
});

describe("isAuthPhoneProvisioningEnabled", () => {
  it("mặc định BẬT khi không khai env — merge P5 không đổi hành vi", () => {
    delete process.env[KEY];
    expect(isAuthPhoneProvisioningEnabled()).toBe(true);
  });

  it('CHỈ đúng chuỗi "false" mới ngắt', () => {
    process.env[KEY] = "false";
    expect(isAuthPhoneProvisioningEnabled()).toBe(false);
  });

  it("bật với các giá trị khẳng định thông thường", () => {
    for (const v of ["true", "1", "yes", "on"]) {
      process.env[KEY] = v;
      expect(isAuthPhoneProvisioningEnabled(), `giá trị ${v}`).toBe(true);
    }
  });

  it('KHÔNG ngắt vì "False"/"FALSE"/" false " — tránh tưởng đã tắt mà thật ra vẫn chạy', () => {
    // Nhất quán với các cờ khác trong lib/flags.ts (so khớp đúng-bằng, không
    // normalize). Ghi thành test để người kéo cờ lúc sự cố biết phải gõ chính xác:
    // gõ hoa một chữ là đường tự động VẪN chạy mà không báo gì.
    for (const v of ["False", "FALSE", " false "]) {
      process.env[KEY] = v;
      expect(isAuthPhoneProvisioningEnabled(), `giá trị ${JSON.stringify(v)}`).toBe(true);
    }
  });
});

// 03/08 — cờ cutover sổ thu mới. Ngữ nghĩa NGƯỢC với cờ trên: mặc định TẮT, chỉ
// đúng chuỗi "true" mới bật. Khoá lại để không ai vô tình lật sổ tiền bằng một
// giá trị env "gần đúng" (TRUE/1/yes) rồi tưởng là chưa bật.
const LEDGER_KEY = "PAYMENT_LEDGER_V2";

describe("isPaymentLedgerV2Enabled", () => {
  afterEach(() => {
    delete process.env[LEDGER_KEY];
  });

  it("mặc định TẮT khi không khai env — sổ mới chạy song song, chưa cutover", () => {
    delete process.env[LEDGER_KEY];
    expect(isPaymentLedgerV2Enabled()).toBe(false);
  });

  it('CHỈ đúng chuỗi "true" mới bật', () => {
    process.env[LEDGER_KEY] = "true";
    expect(isPaymentLedgerV2Enabled()).toBe(true);
  });

  it('KHÔNG bật với "TRUE"/"True"/"1"/"yes"/" true " — cutover tiền phải gõ chính xác', () => {
    for (const v of ["TRUE", "True", "1", "yes", "on", " true "]) {
      process.env[LEDGER_KEY] = v;
      expect(isPaymentLedgerV2Enabled(), `giá trị ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('chuỗi rỗng / "false" → TẮT', () => {
    for (const v of ["", "false"]) {
      process.env[LEDGER_KEY] = v;
      expect(isPaymentLedgerV2Enabled(), `giá trị ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cờ `SALE_SITE_ENABLED` — GỠ 22/09/2026 cùng site Sale.
//
// Bộ test cũ khoá hai thứ: cờ phải có mặt trong `.env.example`, và chỉ đúng chuỗi
// "true" mới bật. Cả hai mất nghĩa khi không còn cờ. Host `sale.satarobo.vn` nay
// luôn 307 về biểu mẫu nhập khách của admin — ràng buộc đó khoá ở
// `lib/auth/route-policy.test.ts`, không phải ở đây.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ZaloCRM (đợt tích hợp 06/09/2026) — hai cờ 2-phase: `ZALOCRM_ENABLED` (S1) và
// `INBOX_ENABLED` (S9-B4).
//
// Vì sao khoá ngữ nghĩa bằng test chứ không tin JSDoc: `lib/settings/registry.ts`
// đã nhắc tới `INBOX_ENABLED` "trong lib/flags.ts" suốt từ đợt hộp thư trong khi
// KHÔNG có dòng code nào đọc nó — y hệt vết `AUTH_PHONE_PROVISIONING` (đường lùi
// chỉ tồn tại trên giấy). Bộ test này bắt cả hai điều kiện: hàm CÓ THẬT, và
// `.env.example` CÓ khai để người dựng môi trường mới nhìn thấy.
// ─────────────────────────────────────────────────────────────────────────────
const ZALOCRM_KEY = "ZALOCRM_ENABLED";
const INBOX_KEY = "INBOX_ENABLED";

describe("isZalocrmEnabled", () => {
  afterEach(() => {
    delete process.env[ZALOCRM_KEY];
  });

  it("`.env.example` có khai cờ — người dựng môi trường mới nhìn thấy nó", () => {
    expect(
      new RegExp(`^${ZALOCRM_KEY}=`, "m").test(ENV_EXAMPLE),
      "thiếu dòng ZALOCRM_ENABLED trong .env.example",
    ).toBe(true);
  });

  it("mặc định OFF khi env vắng — merge lô nền không mở gì cho người dùng", () => {
    delete process.env[ZALOCRM_KEY];
    expect(isZalocrmEnabled()).toBe(false);
  });

  it('chỉ chuỗi "true" mới bật — "True"/"1"/"yes" vẫn OFF', () => {
    process.env[ZALOCRM_KEY] = "true";
    expect(isZalocrmEnabled()).toBe(true);
    for (const v of ["True", "TRUE", "1", "yes", "on", " true ", "", "false"]) {
      process.env[ZALOCRM_KEY] = v;
      expect(isZalocrmEnabled(), `giá trị ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe("isInboxEnabled", () => {
  afterEach(() => {
    delete process.env[INBOX_KEY];
  });

  it("`.env.example` có khai cờ — hết cảnh cờ chỉ tồn tại trong chú thích", () => {
    expect(
      new RegExp(`^${INBOX_KEY}=`, "m").test(ENV_EXAMPLE),
      "thiếu dòng INBOX_ENABLED trong .env.example",
    ).toBe(true);
  });

  it("mặc định OFF khi env vắng", () => {
    delete process.env[INBOX_KEY];
    expect(isInboxEnabled()).toBe(false);
  });

  it('isInboxEnabled cùng khuôn === "true" — gõ gần đúng là VẪN TẮT', () => {
    process.env[INBOX_KEY] = "true";
    expect(isInboxEnabled()).toBe(true);
    for (const v of ["True", "TRUE", "1", "yes", "on", " true ", "", "false"]) {
      process.env[INBOX_KEY] = v;
      expect(isInboxEnabled(), `giá trị ${JSON.stringify(v)}`).toBe(false);
    }
  });
});
