// SRC-24 · SRC-25 — RESPONSIVE (375/768/1280/1920) và NGĂN GIẢI THÍCH («Vì sao …») của module Nguồn.
//
// SRC-24 đo bằng thứ người dùng CẢM THẤY (tràn ngang thật, phần tử tương tác ngoài khung/bị che/chạm quá nhỏ — `quetMan` dùng chung với bộ e2e AFF-L4) và
// chụp ảnh ở bốn bề rộng. CAO = không dùng được (ca đỏ); THẤP chỉ ghi nhận.
//
// SRC-25 mở ngăn giải thích ở Sổ hoa hồng. Nó cần DÒNG sổ thật: không có dòng ⇒ BLOCKED (ghi rõ), KHÔNG dựng giả và KHÔNG tính là đạt.
import { expect, test } from "./_lib/fixtures";
import { nhanActor } from "./_lib/phien";
import { DUONG_DAN, choHydrate, coThay, di, moOChonNguon } from "./_lib/thao-tac";
import { cao, quetMan, thap } from "../e2e/_helpers/quet-375";
import type { Page } from "@playwright/test";

const KHUNG_375 = { width: 375, height: 812 } as const;

test("[SRC-24] Responsive: không tràn ngang và không có điều khiển CAO ở 375px; ảnh 375/768/1280/1920 các màn chính", async ({ ca, moVai }, testInfo) => {
  const mk = await moVai("marketing");
  const sale = await moVai("sale1");

  const man: Array<{ ten: string; vai: "marketing" | "sale1"; duong: string; san: (p: Page) => Promise<boolean>; moThem?: (p: Page) => Promise<void> }> = [
    { ten: "Danh sách nguồn", vai: "marketing", duong: DUONG_DAN.danhSach, san: (p) => coThay(p.getByRole("columnheader", { name: /^Nguồn$/ }), 60_000) },
    { ten: "Tạo nguồn", vai: "marketing", duong: DUONG_DAN.tao, san: async (p) => { await choHydrate(p.getByLabel("Tên nguồn")); return true; } },
    { ten: "Chi tiết nguồn mặc định (PAID_ADS)", vai: "marketing", duong: DUONG_DAN.chiTiet("PAID_ADS"), san: (p) => coThay(p.getByRole("heading").first(), 60_000) },
    {
      ten: "Nhập khách — ô chọn nguồn đang mở",
      vai: "sale1",
      duong: DUONG_DAN.nhapKhach,
      san: async (p) => {
        if (!(await coThay(p.getByTestId("o-chon-nguon"), 60_000))) return false;
        await choHydrate(p.getByLabel("Tên phụ huynh"));
        return true;
      },
      moThem: async (p) => {
        await moOChonNguon(p);
      },
    },
  ];

  for (const m of man) {
    const phien = m.vai === "marketing" ? mk : sale;
    const page = phien.page;
    const actor = nhanActor(m.vai);
    await page.setViewportSize(KHUNG_375);
    await di(page, m.duong);
    if (!(await m.san(page))) {
      ca.buoc({ actor, action: `Dựng màn «${m.ten}» ở 375px`, input: m.duong, expected: "màn dựng xong", actual: "không dựng xong trong thời hạn (có thể cờ nguon.enabled tắt)", pass: false });
      continue;
    }
    await m.moThem?.(page);
    const ket = await quetMan(page, testInfo, m.ten, { chup: false });
    // Công tắc (shadcn Switch) là nút 36×20px NHƯNG biểu mẫu bọc nó trong `<label for>` cao ≥ 44px — đó mới là vùng chạm thật (nguon-form.tsx, `CongTac`). Bộ quét chỉ đo nút, nên
    // phát hiện «vùng chạm nhỏ» của một công tắc CÓ nhãn bấm được ≥ 40px KHÔNG tính là CAO — vẫn ghi lại ở phần thông tin để người xem thấy.
    const congTacCoNhanLon = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[role=switch]"))
        .filter((sw) => Math.max(0, ...Array.from(document.querySelectorAll(`label[for="${sw.id}"]`)).map((l) => l.getBoundingClientRect().height)) >= 40)
        .map((sw) => sw.getAttribute("aria-label") ?? ""),
    );
    const laCongTacCoNhan = (chiTiet: string) => congTacCoNhanLon.some((t) => t !== "" && chiTiet.includes(`«${t}»`));
    const cacCaoTho = cao(ket);
    const cacCao = cacCaoTho.filter((c) => !(c.loai === "vung-cham-nho" && laCongTacCoNhan(c.chiTiet)));
    if (cacCaoTho.length !== cacCao.length) ca.thongTin(actor, `«${m.ten}»: công tắc nhỏ nhưng nhãn bọc ≥ 40px (không tính lỗi)`, cacCaoTho.filter((c) => !cacCao.includes(c)).map((c) => c.chiTiet));
    ca.buoc({
      actor,
      action: `Quét «${m.ten}» ở 375px`,
      input: m.duong,
      expected: { tranNgangPx: 0, dieuKhienCao: 0 },
      actual: { tranNgangPx: ket.tranPx, dieuKhienCao: cacCao.map((c) => `${c.loai}: ${c.chiTiet}`), soDieuKhien: ket.soPhanTuTuongTac },
      pass: ket.tranPx === 0 && cacCao.length === 0,
    });
    ca.thongTin(actor, `Điều khiển mức THẤP ở «${m.ten}» (chưa đẹp, không làm đỏ ca)`, thap(ket).slice(0, 12).map((c) => `${c.loai}: ${c.chiTiet}`));
    await ca.chupDaKichThuoc(page, m.ten);
  }
});

test("[SRC-25] Ngăn «Vì sao» ở Sổ hoa hồng mở được, đọc được ở 1280 và 375px (Kế toán Hội sở)", async ({ ca, moVai }) => {
  const kt = await moVai("ketoan");
  const actor = nhanActor("ketoan");
  const page = kt.page;

  // (1) Sổ hoa hồng — dòng có tiền.
  await di(page, "/nguon-hoa-hong/so?xem=tat-ca");
  const nutSo = page.getByRole("button", { name: /^Xem vì sao/ });
  const coDongSo = await coThay(nutSo, 45_000);
  // (2) Dòng KHÔNG đủ điều kiện (0đ) — ngăn «Vì sao không có hoa hồng».
  let nutGt = page.getByRole("button", { name: /không có hoa hồng, lẽ ra/ });
  let coDongGt = false;
  if (!coDongSo) {
    await di(page, "/nguon-hoa-hong/so?xem=khong-du-dieu-kien");
    nutGt = page.getByRole("button", { name: /không có hoa hồng, lẽ ra/ });
    coDongGt = await coThay(nutGt, 30_000);
  }
  if (!coDongSo && !coDongGt) {
    ca.biChan("Không có dòng nào ở Sổ hoa hồng để mở ngăn «Vì sao» (sổ trống, engine hoa hồng chưa bật, hoặc chưa nạp fixture lane C2). Cần dòng sổ thật — không dựng giả.");
  }
  const nut = coDongSo ? nutSo : nutGt;
  const ten = coDongSo ? "Vì sao con số này" : "Vì sao không có hoa hồng";
  await nut.first().click();
  const ngan = page.getByRole("dialog");
  await expect(ngan).toBeVisible({ timeout: 30_000 });
  await expect(ngan.getByRole("heading", { name: ten })).toBeVisible();
  // Đợi hết trạng thái «Đang tải…».
  await expect(ngan.getByText(/Đang tải/)).toBeHidden({ timeout: 45_000 });
  const noiDung = (await ngan.innerText()).replace(/\s+/g, " ");
  const khongLoi = !/Không tải được|Thử lại/.test(noiDung);
  ca.buoc({
    actor,
    action: `Mở ngăn «${ten}» ở 1280px`,
    input: coDongSo ? "Sổ hoa hồng · dòng đầu" : "Không đủ điều kiện · dòng đầu",
    expected: "ngăn mở, tải xong, không báo lỗi, có nội dung giải thích",
    actual: { khongLoi, doDai: noiDung.length, dau: noiDung.slice(0, 160) },
    pass: khongLoi && noiDung.length > 60,
    screenshots: [await ca.chup(page, `ngan-${coDongSo ? "vi-sao" : "khong-hoa-hong"}-1280`, { fullPage: false })],
  });

  await page.setViewportSize(KHUNG_375);
  await page.waitForTimeout(400);
  const hop = await ngan.boundingBox();
  const trongKhung = !!hop && hop.x >= -1 && hop.x + hop.width <= KHUNG_375.width + 1;
  ca.buoc({
    actor,
    action: "Ngăn vẫn nằm trong khung ở 375px",
    input: KHUNG_375,
    expected: "ngăn không tràn ra ngoài chiều ngang màn hình",
    actual: { x: hop?.x ?? null, rong: hop?.width ?? null },
    pass: trongKhung,
    screenshots: [await ca.chup(page, "ngan-375", { fullPage: false })],
  });
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.keyboard.press("Escape");
  await expect(ngan).toBeHidden({ timeout: 15_000 });
  ca.buoc({ actor, action: "Nhấn Esc đóng ngăn", input: "Escape", expected: "ngăn đóng", actual: "đã đóng", pass: true });
});
