/**
 * `assertTestDb()` (tests/e2e/_helpers/seed.ts) — cổng đứng trước `resetDb()` (TRUNCATE mọi
 * bảng) của CẢ Playwright lẫn các bộ Vitest chạm DB (`seedChat`, tests/khuyen-mai, tests/nen…).
 *
 * [ATD-TUN] 28/09/2026 — DB prod/test chuyển lên VPS, tới được qua SSH tunnel
 * 127.0.0.1:5433 (PROD) / 127.0.0.1:5435 (TEST — tên đúng là `satarobo_test`). Cổng cũ hỏi
 * "host 127.0.0.1 + tên satarobo_test" ⇒ tunnel test qua trọn vẹn ⇒ Playwright
 * `resetDb()` xoá sạch dữ liệu của test.satarobo.vn. Và ngoài Vitest không có cờ
 * `ALLOW_DB_RESET` nào đứng thêm phía trước: cổng này là lớp DUY NHẤT.
 *
 * ⚠️ `assertTestDb` đọc `process.env.DATABASE_URL` LÚC GỌI ⇒ mỗi ca tự đặt rồi trả lại.
 */
import { afterEach, describe, expect, it } from "vitest";

import { assertTestDb } from "../e2e/_helpers/seed";

const GOC = process.env.DATABASE_URL;
afterEach(() => {
  if (GOC === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = GOC;
});

function voi(url: string): () => void {
  return () => {
    process.env.DATABASE_URL = url;
    assertTestDb();
  };
}

describe("[ATD-TUN] assertTestDb từ chối tunnel VPS", () => {
  it("[ATD-TUN-01] 127.0.0.1:5435/satarobo_test (DB của test.satarobo.vn) ⇒ NÉM, nói rõ lý do", () => {
    expect(voi("postgresql://satarobo_test:matkhau@127.0.0.1:5435/satarobo_test")).toThrow(
      /5435[\s\S]*tunnel[\s\S]*test\.satarobo\.vn/,
    );
  });

  it("[ATD-TUN-02] 127.0.0.1:5433 (DB PROD) ⇒ NÉM — kể cả khi tên DB trông như DB test", () => {
    expect(voi("postgresql://satarobo:matkhau@127.0.0.1:5433/satarobo")).toThrow(/5433[\s\S]*PROD/);
    expect(voi("postgresql://satarobo:matkhau@localhost:5433/satarobo_test")).toThrow(/5433/);
  });

  it("[ATD-TUN-03] lời báo KHÔNG in mật khẩu", () => {
    // Bắt lỗi TƯỜNG MINH: `expect.unreachable` ném trong `try` sẽ bị chính `catch` nuốt và ca
    // xanh vô nghĩa khi cổng không ném gì (bản đầu của ca này đã xanh trên mã chưa vá).
    let loi: unknown = null;
    try {
      voi("postgresql://satarobo_test:matkhau@127.0.0.1:5435/satarobo_test")();
    } catch (e) {
      loi = e;
    }
    expect(loi, "phải ném").toBeInstanceOf(Error);
    expect(String(loi)).not.toContain("matkhau");
  });

  it("[ATD-TUN-04] đối chứng dương: Postgres trên máy cổng 5432 (và không ghi cổng) ⇒ CHO QUA", () => {
    expect(voi("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test")).not.toThrow();
    expect(voi("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test_ipcaddy")).not.toThrow();
    expect(voi("postgresql://ci:ci@localhost:5432/ci_test")).not.toThrow();
    expect(voi("postgresql://ci:ci@localhost/ci_test")).not.toThrow();
  });

  it("[ATD-TUN-05] hành vi cũ giữ nguyên: DB máy KHÔNG phải DB test (satarobo_local) ⇒ NÉM", () => {
    expect(voi("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_local")).toThrow(/satarobo_local/);
  });
});
