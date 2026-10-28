// tests/uat-nguon/_lib/fixtures.ts — fixture dùng chung của bộ UAT Nguồn:
//   · `ca`    — NhatKyCa của test hiện tại (id lấy từ `[SRC-xx]` ở đầu tên test);
//   · `moVai` — mở phiên cho một vai (mỗi lần gọi một browser context riêng ⇒ nhiều vai chạy song song trong MỘT ca).
// Teardown: đóng mọi phiên (giữ trace CHỈ khi ca đỏ) rồi ghi bằng chứng JSON.
import { test as goc, expect } from "@playwright/test";
import { join } from "node:path";
import { maCaTuTen, maDotChay, moiTruongTuEnv, type MoiTruongUat } from "./an-toan";
import { NhatKyCa, thuMucBangChung } from "./nhat-ky";
import { moPhien, type Phien } from "./phien";
import type { KhoaVai } from "./vai";

export { expect };

type Fixtures = {
  ca: NhatKyCa;
  moVai: (vai: KhoaVai) => Promise<Phien>;
  env: MoiTruongUat;
  dot: string;
};

const DOT = maDotChay(process.env.UAT_RUN_CODE, Date.now());

// ⚠️ Tham số thứ hai của fixture Playwright luôn là hàm "giao" (thường đặt tên `use`) — ở đây đặt `giao` vì tên `use` làm `react-hooks/rules-of-hooks` báo nhầm. Mẫu `({}, giao)` cũng
// là cách Playwright đòi cho fixture không phụ thuộc gì (tham số đầu PHẢI là destructuring), nên tắt `no-empty-pattern` đúng hai dòng.

export const test = goc.extend<Fixtures>({
  // Cổng môi trường chạy lại Ở ĐÂY nữa (cấu hình đã kiểm một lần): hai chỗ độc lập, quên một chỗ vẫn còn chỗ kia.
  // eslint-disable-next-line no-empty-pattern
  env: async ({}, giao) => {
    await giao(moiTruongTuEnv(process.env));
  },
  // eslint-disable-next-line no-empty-pattern
  dot: async ({}, giao) => {
    await giao(DOT);
  },

  ca: async ({ env, dot }, giao, testInfo) => {
    const id = maCaTuTen(testInfo.title);
    if (!id) throw new Error(`[UAT-NGUON] Tên test phải mở đầu bằng mã ca «[SRC-xx]»: «${testInfo.title}»`);
    const matKhau = process.env.UAT_PASSWORD ?? "";
    const ca = new NhatKyCa(id, testInfo.title, env, dot, thuMucBangChung(process.env), [matKhau], testInfo, new Date());
    try {
      await giao(ca);
    } finally {
      ca.ketThuc();
    }
  },

  moVai: async ({ browser, ca, env }, giao, testInfo) => {
    const mo: Phien[] = [];
    const thuMucPhien = process.env.UAT_PHIEN_DIR?.trim() || join(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "/tmp", "uat-nguon-phien");
    await giao(async (vai) => {
      const p = await moPhien(browser, vai, {
        env,
        thuMucPhien,
        matKhau: process.env.UAT_PASSWORD ?? "",
        khiViPham: (m) => ca.ghiViPham(m),
        ghiTrace: process.env.UAT_TRACE !== "0",
      });
      mo.push(p);
      return p;
    });
    const hong = testInfo.status !== "passed" && testInfo.status !== "skipped";
    for (const p of mo) {
      const dich = hong ? join(thuMucBangChung(process.env), ca.id, `trace-${p.vai}.zip`) : null;
      await p.dong(dich).catch(() => undefined);
    }
  },
});
