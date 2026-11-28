/**
 * [DISC-E2E-TC-*] TIẾP CẬN + THÍCH ỨNG trên TRÌNH DUYỆT THẬT (cờ BẬT, dev server có DISC_ENABLED=true, Postgres satarobo_test; dữ liệu 100% GIẢ).
 *   TC-01  màn siêu lớn 5120x2880 · 7680x4320: hành trình tới câu hỏi đầu, không tràn ngang, cột nội dung không bị kéo giãn
 *   TC-02  phóng 200% (640x400) và 400% (320x256): không tràn ngang, nút chính tới được và KHÔNG bị che
 *   TC-03  CHỈ bàn phím: gõ hồ sơ → Tiếp tục → chọn đáp án bằng phím → sang câu sau; tiêu điểm hiện rõ và đổi theo chặng
 *   TC-04  prefers-reduced-motion: không còn hoạt cảnh/chuyển tiếp nào đang chạy ở các màn của hành trình
 *   TC-05  tương phản chữ ≥ 4,5:1 (cỡ lớn ≥ 3:1) trên landing · hồ sơ · làm bài · hoàn thành (đo màu hiển thị thật)
 *   (TC-06 iPhone/WebKit tải PDF: tiep-can-iphone.spec.ts — cần test.use ở cấp tệp)
 */
import { expect, test, type Page } from "@playwright/test";
import { CO_DISC, tranNgangPx } from "./_khung";
import { chup, dienHoSo, lamBoDe } from "./_nhap-lieu";

test.skip(CO_DISC !== "on", "Cần DISC_E2E_FLAG=on (cờ BẬT)");

let ipSeq = Math.floor(Math.random() * 200) + 20;
test.beforeEach(async ({ context }) => {
  ipSeq = (ipSeq % 250) + 1;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${ipSeq}` });
  // Đã có quyết định cookie ⇒ banner không che (banner có phép đo riêng ở dieu-huong.spec).
  await context.addInitScript(() => {
    try {
      localStorage.setItem("satarobo:consent:v1", JSON.stringify({ version: "2026-05-17", acceptedAt: new Date().toISOString(), categories: { necessary: true, analytics: false, marketing: false } }));
    } catch {
      /* bỏ qua */
    }
    // Popup mời học thử (z-110, bật sau 20s ở MỌI trang public, kể cả /disc) chặn bấm giữa bài — ghi nhận ở 09-uat-evidence; ở đây đóng sẵn để đo đúng thứ cần đo.
    try {
      localStorage.setItem("satarobo-popup-hoc-thu-da-gui", "1");
    } catch {
      /* bỏ qua */
    }
  });
});

/** Đo tương phản chữ bằng MÀU HIỂN THỊ THẬT (canvas hiểu cả lab()/oklch()). Bỏ phần tử có ảnh/gradient nền (không đo được chính xác). */
async function doTuongPhan(page: Page, pham_vi = "body") {
  return page.evaluate((sel) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = (r: number, g: number, b: number) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const nenCua = (e: Element | null): [number, number, number] | null => {
      let nen: [number, number, number] = [255, 255, 255];
      const chuoi: Element[] = [];
      for (let x: Element | null = e; x; x = x.parentElement) chuoi.push(x);
      for (const x of chuoi) if (getComputedStyle(x).backgroundImage !== "none") return null;
      for (const x of chuoi.reverse()) {
        const [r, g, b, a] = rgba(getComputedStyle(x).backgroundColor);
        if (a > 0) nen = [Math.round(r * a + nen[0] * (1 - a)), Math.round(g * a + nen[1] * (1 - a)), Math.round(b * a + nen[2] * (1 - a))];
      }
      return nen;
    };
    const goc = document.querySelector(sel) ?? document.body;
    const out: { chu: string; cr: number; can: number; co: string }[] = [];
    let dem = 0;
    const w = document.createTreeWalker(goc, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue ?? "").trim();
      const e = n.parentElement;
      if (!t || !e) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none" || e.closest("[aria-hidden='true'],script,style,noscript,[data-nextjs-toast],nextjs-portal")) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const nen = nenCua(e);
      if (!nen) continue;
      const [fr, fg, fb, fa] = rgba(cs.color);
      const chu: [number, number, number] = [Math.round(fr * fa + nen[0] * (1 - fa)), Math.round(fg * fa + nen[1] * (1 - fa)), Math.round(fb * fa + nen[2] * (1 - fa))];
      let op = 1;
      for (let x: Element | null = e; x; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
      const L1 = lum(...chu) * op + lum(...nen) * (1 - op);
      const L2 = lum(...nen);
      const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const dam = Number(cs.fontWeight) >= 700;
      const can = px >= 24 || (px >= 18.66 && dam) ? 3 : 4.5;
      dem++;
      if (cr < can) out.push({ chu: t.slice(0, 40), cr: Math.round(cr * 100) / 100, can, co: `${px}px/${cs.fontWeight}` });
    }
    return { do: dem, loi: out };
  }, pham_vi);
}

test.describe("[DISC-E2E-TC-01] màn siêu lớn", () => {
  for (const kn of [
    { w: 5120, h: 2880 },
    { w: 7680, h: 4320 },
  ]) {
    test(`${kn.w}x${kn.h}: landing → hồ sơ → câu đầu; không tràn ngang; cột nội dung không bị kéo giãn`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: kn.w, height: kn.h });
      await page.goto("/disc");
      expect(await tranNgangPx(page)).toBeLessThanOrEqual(1);
      await page.getByRole("link", { name: /bắt đầu|làm bài/i }).first().click();
      await expect(page.getByTestId("disc-ho-so")).toBeVisible();
      const hoSo = await page.getByTestId("disc-ho-so").boundingBox();
      // Biểu mẫu là cột đọc: không rộng quá ~70 ký tự (≈ 720px) dù màn rộng 5120/7680.
      expect(hoSo!.width).toBeLessThanOrEqual(760);
      await dienHoSo(page);
      await page.getByTestId("disc-ho-so-tiep").click();
      await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
      const bai = await page.getByTestId("disc-lam-bai").boundingBox();
      expect(bai!.width).toBeLessThanOrEqual(760);
      // Khối hành trình được căn giữa, không dính mép trái
      const giua = await page.getByTestId("disc-hanh-trinh").boundingBox();
      expect(Math.abs(giua!.x + giua!.width / 2 - kn.w / 2)).toBeLessThan(kn.w * 0.02);
      expect(await tranNgangPx(page)).toBeLessThanOrEqual(1);
      await chup(page, `tc01-${kn.w}`);
    });
  }
});

test.describe("[DISC-E2E-TC-02] phóng 200% / 400%", () => {
  for (const kn of [
    { ten: "200%", w: 640, h: 400 },
    { ten: "400%", w: 320, h: 256 },
  ]) {
    test(`${kn.ten} (${kn.w}x${kn.h}): hồ sơ → câu đầu, không tràn ngang, nút chính không bị che`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: kn.w, height: kn.h });
      await page.goto("/disc/bat-dau");
      await expect(page.getByTestId("disc-ho-so")).toBeVisible();
      await dienHoSo(page);
      const tiep = page.getByTestId("disc-ho-so-tiep");
      await tiep.scrollIntoViewIfNeeded();
      // phần tử trên cùng tại tâm nút phải là chính nút (không bị header/banner dính che)
      const trenCung = await tiep.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!t && (el === t || el.contains(t));
      });
      expect(trenCung).toBe(true);
      expect(await tranNgangPx(page)).toBeLessThanOrEqual(1);
      await chup(page, `tc02-ho-so-${kn.w}`);
      await tiep.click();
      await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
      const nhan = page.getByTestId("disc-lam-bai").locator("fieldset label").first();
      await nhan.scrollIntoViewIfNeeded();
      await nhan.click();
      const tiepCau = page.getByTestId("disc-cau-tiep");
      await tiepCau.scrollIntoViewIfNeeded();
      const duoc = await tiepCau.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!t && (el === t || el.contains(t));
      });
      expect(duoc).toBe(true);
      expect(await tranNgangPx(page)).toBeLessThanOrEqual(1);
      await chup(page, `tc02-lam-bai-${kn.w}`);
    });
  }
});

test.describe("[DISC-E2E-TC-03] chỉ bàn phím", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("gõ hồ sơ bằng bàn phím, chọn đáp án bằng phím, tiêu điểm hiện rõ và sang chặng sau", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/disc/bat-dau");
    await expect(page.getByTestId("disc-ho-so")).toBeVisible();
    // Tiêu điểm hiện rõ: sau mỗi lần Tab, phần tử đang focus có viền/bóng nhìn thấy
    const viTriTab: string[] = [];
    await page.getByLabel("Họ và tên").focus();
    await page.keyboard.type("DISCDB Nguyễn Thị Hạnh");
    for (let k = 0; k < 14; k++) {
      await page.keyboard.press("Tab");
      const t = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e) return null;
        const cs = getComputedStyle(e);
        const thay = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== "none" && cs.boxShadow !== "") || e.matches("input,select,textarea") /* ô nhập: viền ring do :focus */;
        return { tag: e.tagName, id: e.id || (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24), thay };
      });
      if (!t) continue;
      viTriTab.push(`${t.tag}:${t.id}`);
      expect(t.thay, `phần tử focus không thấy viền: ${t.tag} ${t.id}`).toBe(true);
    }
    // Điền nốt bằng bàn phím + chuột-không: dùng fill cho ô khó (năm sinh/lựa chọn), nhưng "Tiếp tục" bằng Enter
    await dienHoSo(page);
    await page.getByLabel("Năm sinh của bé").focus();
    await page.keyboard.press("Enter"); // gửi form bằng Enter trên ô văn bản (Enter trong <select> không gửi form — hành vi trình duyệt, không phải lỗi)
    await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
    // Sau khi đổi chặng, tiêu điểm nằm trong vùng nội dung (trình đọc màn hình đọc lại tiêu đề)
    const trongVung = await page.evaluate(() => {
      const v = document.querySelector("[data-testid='disc-hanh-trinh']");
      return !!v && v.contains(document.activeElement) && document.activeElement !== document.body;
    });
    expect(trongVung).toBe(true);
    // Chọn đáp án bằng phím: tới radio đầu của nhóm rồi Space
    const radio = page.getByTestId("disc-lam-bai").locator("input[type=radio]").first();
    await radio.focus();
    await page.keyboard.press("Space");
    await expect(radio).toBeChecked();
    // Mũi tên đổi lựa chọn trong cùng nhóm (hành vi chuẩn của radio)
    await page.keyboard.press("ArrowDown");
    expect(await page.getByTestId("disc-lam-bai").locator("input[type=radio]:checked").count()).toBe(1);
    // Nút Tiếp tới được bằng Tab và kích hoạt bằng Enter
    const tiep = page.getByTestId("disc-cau-tiep");
    await tiep.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("disc-lam-bai")).toContainText("Câu 2");
    expect(viTriTab.length).toBeGreaterThan(5);
  });
});

test.describe("[DISC-E2E-TC-04] giảm chuyển động", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("reduce ⇒ không còn hoạt cảnh/chuyển tiếp đang chạy ở landing · hồ sơ · làm bài", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dem = async () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running" && (a.effect?.getComputedTiming().iterations === Infinity || (Number(a.effect?.getComputedTiming().duration) || 0) > 50))
          .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "?"),
      );
    await page.goto("/disc");
    await page.waitForTimeout(800);
    const o1 = await dem();
    await page.goto("/disc/bat-dau");
    await expect(page.getByTestId("disc-ho-so")).toBeVisible();
    await page.waitForTimeout(500);
    const o2 = await dem();
    await dienHoSo(page);
    await page.getByTestId("disc-ho-so-tiep").click();
    await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
    await page.getByTestId("disc-lam-bai").locator("fieldset label").first().click();
    await page.waitForTimeout(500);
    const o3 = await dem();
    // Thanh tiến độ được đổi bề rộng: chuyển tiếp phải ~0 khi reduce
    const tg = await page.evaluate(() => {
      const e = document.querySelector("[role=progressbar] > *, [data-testid='disc-tien-do'] > *") as HTMLElement | null;
      return e ? getComputedStyle(e).transitionDuration : null;
    });
    expect({ landing: o1, hoSo: o2, lamBai: o3 }).toEqual({ landing: [], hoSo: [], lamBai: [] });
    if (tg) expect(parseFloat(tg)).toBeLessThanOrEqual(0.01);
  });
});

test.describe("[DISC-E2E-TC-05] tương phản chữ", () => {
  for (const w of [375, 1440]) {
    test(`${w}px: landing · hồ sơ · làm bài · hoàn thành — mọi chữ ≥ 4,5:1 (lớn ≥ 3:1)`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: 900 });
      const tong: Record<string, { do: number; loi: { chu: string; cr: number; can: number; co: string }[] }> = {};
      await page.goto("/disc");
      await page.waitForTimeout(600);
      tong.landing = await doTuongPhan(page, "main");
      await page.goto("/disc/bat-dau");
      await expect(page.getByTestId("disc-ho-so")).toBeVisible();
      tong.hoSo = await doTuongPhan(page, "[data-testid='disc-hanh-trinh']");
      await dienHoSo(page);
      await page.getByTestId("disc-ho-so-tiep").click();
      await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
      tong.lamBai = await doTuongPhan(page, "[data-testid='disc-hanh-trinh']");
      await lamBoDe(page);
      await lamBoDe(page);
      await expect(page.getByTestId("disc-hoan-thanh")).toBeVisible();
      tong.hoanThanh = await doTuongPhan(page, "[data-testid='disc-hanh-trinh']");
      for (const [man, r] of Object.entries(tong)) {
        expect(r.do, `${man}: đối chứng dương — đã đo được chữ`).toBeGreaterThan(5);
      }
      expect(Object.fromEntries(Object.entries(tong).map(([k, v]) => [k, v.loi]))).toEqual({ landing: [], hoSo: [], lamBai: [], hoanThanh: [] });
    });
  }
});
