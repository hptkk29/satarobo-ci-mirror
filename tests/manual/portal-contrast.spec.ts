/**
 * Rà CỔNG PHỤ HUYNH: tương phản chữ (WCAG AA) + tràn ngang ở 375px.
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts portal-contrast
 *   PORTAL_THEME=dark ... (đo chế độ Tối)
 *   VIEWPORT=mobile ...   (đo ở 375px)
 *
 * VÌ SAO PORTAL KHÁC HAI SITE KIA. Màu nhấn ở đây do NGƯỜI DÙNG chọn (6 preset,
 * xem lib/portal/appearance.ts) và được gán INLINE lên `.portal-v2`, nên tương
 * phản của nút/nhãn phụ thuộc lựa chọn của từng nhà. Phần đó đã có `inkOn()` tự
 * chọn mực trắng/tối theo nền — đã kiểm bằng tính tay cả 6 preset, 4/6 buộc phải
 * dùng mực tối và code làm đúng. Spec này lo phần CÒN LẠI: những màu viết cứng
 * trong trang, không đi qua cơ chế đó.
 *
 * ⚠️ Máy đo BỎ QUA phần tử nền ảnh/gradient — không kết luận "sạch" từ con số này.
 */
import { test } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";
import { AUDIT, type ChoTruot } from "./_contrast";

const EMAIL = process.env.PARENT_EMAIL ?? "phuhuynh.test@satarobo.vn";
const PW = process.env.PARENT_PW ?? "Test@1234";
const THEME = process.env.PORTAL_THEME === "dark" ? "dark" : "light";
const MOBILE = process.env.VIEWPORT === "mobile";

test.use(
  MOBILE
    ? { viewport: { width: 375, height: 812 } }
    : { viewport: { width: 1280, height: 900 } },
);

const ROUTES = [
  "/portal",
  "/portal/ho-so",
  "/portal/ho-so-con",
  "/portal/lich-hoc",
  "/portal/hoc-phi",
  "/portal/hoc-ba",
  "/portal/bai-tap",
  "/portal/bai-thi",
  "/portal/nhan-xet",
  "/portal/hinh-anh",
  "/portal/yeu-cau",
  "/portal/satacoin",
  "/portal/thong-bao",
  "/portal/huong-dan",
  "/portal/giao-dien",
  "/portal/khao-sat",
  "/portal/danh-gia-gv",
  "/portal/ket-qua",
];

test(`cong phu huynh — ${THEME}${MOBILE ? " · 375px" : ""}`, async ({
  page,
}) => {
  test.setTimeout(30 * 60_000);
  await sharedLogin(page, { email: EMAIL, password: PW, timeout: 120_000 });
  await page.goto("/portal", { waitUntil: "domcontentloaded" });
  // Sáng/Tối của portal lưu ở localStorage (PortalAppearanceProvider), không phải cookie.
  await page.evaluate((t) => {
    const raw = localStorage.getItem("portal-appearance");
    const cur = raw ? JSON.parse(raw) : {};
    localStorage.setItem(
      "portal-appearance",
      JSON.stringify({ ...cur, theme: t }),
    );
  }, THEME);

  let truot = 0;
  let tran = 0;
  for (const r of ROUTES) {
    await page.goto(r, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    if (MOBILE) {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      if (w > 376) {
        tran++;
        console.log("TRAN NGANG", r, w + "px");
      }
    }

    const bad = (await page.evaluate(`(${AUDIT})()`)) as ChoTruot[];
    if (bad.length) {
      console.log("== " + r);
      for (const b of bad)
        console.log(
          `   ${b.ty}:1 (can ${b.can}) ${b.co}px  "${b.chu}"  ${b.mau} tren ${b.nen}  [${b.cls}]`,
        );
      truot += bad.length;
    }
  }
  console.log(
    `KET LUAN portal (${THEME}${MOBILE ? "/375px" : ""}): truot AA ${truot} | tran ngang ${tran}`,
  );
});
