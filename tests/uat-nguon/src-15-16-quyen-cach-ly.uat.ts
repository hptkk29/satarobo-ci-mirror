// SRC-15 · SRC-16 — MA TRẬN QUYỀN và CÁCH LY CƠ SỞ của module Nguồn, đo bằng đăng nhập thật nhiều vai trên test.
//
// Quy tắc dựng ca (luật 11 trong CLAUDE.md: "ca chỉ khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn"):
//   · MỌI khẳng định "vai X KHÔNG thấy Y" đi kèm (a) một TÍN HIỆU TỪ CHỐI DƯƠNG TÍNH (câu «Bạn không có quyền xem…», trang «Không tìm thấy», hoặc bị
//     đá sang site khác) — phiên hết hạn (/login) KHÔNG được đọc là «bị từ chối»; và (b) một ĐỐI CHỨNG DƯƠNG: cùng truy vấn, vai có quyền THẤY.
//   · Bảng kỳ vọng lấy từ TÀI LIỆU (docs/source-commission/09-uat-checklist.md §1.2, đã được lưới CI so với seed vai), KHÔNG lấy từ hằng của mã.
import { expect, test } from "./_lib/fixtures";
import { nhanActor, type Phien } from "./_lib/phien";
import type { NhatKyCa } from "./_lib/nhat-ky";
import { tenDuLieu } from "./_lib/an-toan";
import { VAI, type KhoaVai } from "./_lib/vai";
import { DUONG_DAN, choHydrate, coThay, di, moOChonNguon, soDienThoaiThu } from "./_lib/thao-tac";
import type { Page } from "@playwright/test";

/** doc 09 §1.2 — `sources:view` / `sources:manage` theo từng tài khoản UAT. */
const MA_TRAN: ReadonlyArray<{ vai: KhoaVai; xem: boolean; ghi: boolean }> = [
  { vai: "admin", xem: true, ghi: true },
  { vai: "marketing", xem: true, ghi: true },
  { vai: "giamdoc", xem: true, ghi: false },
  { vai: "ketoan", xem: true, ghi: false },
  { vai: "nhansu", xem: false, ghi: false },
  { vai: "sale1", xem: false, ghi: false },
  { vai: "sale2", xem: false, ghi: false },
  { vai: "saleho", xem: false, ghi: false },
  { vai: "giaovu", xem: false, ghi: false },
  { vai: "daotao", xem: false, ghi: false },
  { vai: "giaovien", xem: false, ghi: false },
  { vai: "phuhuynh", xem: false, ghi: false },
];

type TruyCap = "XEM_GHI" | "CHI_XEM" | "CO_FORM_TAO" | "TU_CHOI" | "SANG_SITE_KHAC" | "PHIEN_HET_HAN" | "KHAC";

/** Đứng trên đường dẫn, đợi tới khi một TÍN HIỆU rõ ràng xuất hiện (khung chờ `loading.tsx` không phải tín hiệu), rồi phân loại. */
async function phanLoai(page: Page, duong: string, loai: "danh-sach" | "tao"): Promise<{ kq: TruyCap; ghiChu: string }> {
  await di(page, duong);
  let cuoi: { kq: TruyCap; ghiChu: string } = { kq: "KHAC", ghiChu: "chưa có tín hiệu" };
  await expect
    .poll(
      async () => {
        const u = new URL(page.url());
        const dich = u.pathname + u.search;
        if (/^\/login/.test(u.pathname)) return (cuoi = { kq: "PHIEN_HET_HAN", ghiChu: dich }).kq;
        if (/^\/(teacher|portal)(\/|$)/.test(u.pathname)) return (cuoi = { kq: "SANG_SITE_KHAC", ghiChu: dich }).kq;
        if (/error=unauthorized/.test(u.search)) return (cuoi = { kq: "TU_CHOI", ghiChu: `đá về ${dich}` }).kq;
        const thanBai = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
        if (/Bạn không có quyền xem/.test(thanBai)) return (cuoi = { kq: "TU_CHOI", ghiChu: "«Bạn không có quyền xem …»" }).kq;
        if (/Không tìm thấy trang/.test(thanBai)) return (cuoi = { kq: "TU_CHOI", ghiChu: "«Không tìm thấy trang»" }).kq;
        if (loai === "tao") {
          if (await page.getByLabel("Tên nguồn").isVisible().catch(() => false)) return (cuoi = { kq: "CO_FORM_TAO", ghiChu: "thấy biểu mẫu Tạo nguồn" }).kq;
        } else if (await page.getByRole("columnheader", { name: /^Nguồn$/ }).isVisible().catch(() => false)) {
          const ghi = await page.getByRole("link", { name: /Tạo nguồn/ }).isVisible().catch(() => false);
          return (cuoi = { kq: ghi ? "XEM_GHI" : "CHI_XEM", ghiChu: ghi ? "thấy bảng + nút «Tạo nguồn»" : "thấy bảng, không có nút «Tạo nguồn»" }).kq;
        }
        return "CHO";
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe("CHO")
    .catch(() => undefined);
  return cuoi;
}

test("[SRC-15] Ma trận quyền module Nguồn: ai xem danh sách, ai tạo nguồn (12 vai)", async ({ ca, moVai }) => {
  for (const k of MA_TRAN) {
    const p = await moVai(k.vai);
    const actor = nhanActor(k.vai);

    const ds = await phanLoai(p.page, DUONG_DAN.danhSach, "danh-sach");
    const muonDs: TruyCap[] = k.xem ? (k.ghi ? ["XEM_GHI"] : ["CHI_XEM"]) : ["TU_CHOI", "SANG_SITE_KHAC"];
    ca.buoc({
      actor,
      action: `Mở danh sách nguồn (${DUONG_DAN.danhSach})`,
      input: { xem: k.xem, ghi: k.ghi },
      expected: muonDs,
      actual: ds,
      pass: muonDs.includes(ds.kq),
      screenshots: [await ca.chup(p.page, `danh-sach-${k.vai}`, { fullPage: false })],
    });

    const tao = await phanLoai(p.page, DUONG_DAN.tao, "tao");
    const muonTao: TruyCap[] = k.ghi ? ["CO_FORM_TAO"] : ["TU_CHOI", "SANG_SITE_KHAC"];
    ca.buoc({
      actor,
      action: `Mở biểu mẫu Tạo nguồn (${DUONG_DAN.tao})`,
      input: { xem: k.xem, ghi: k.ghi },
      expected: muonTao,
      actual: tao,
      pass: muonTao.includes(tao.kq),
    });
  }
  // Đối chứng dương cấp ca: có ít nhất một vai XEM được và một vai TẠO được — nếu không, cả ma trận chỉ đo "mọi người đều bị chặn".
  const soXem = MA_TRAN.filter((k) => k.xem).length;
  ca.thongTin("(ca)", "Đối chứng dương: số vai kỳ vọng XEM / TẠO", { xem: soXem, tao: MA_TRAN.filter((k) => k.ghi).length });
});

/** Tạo một lead thử bằng form nhập khách THẬT (chọn rõ cơ sở). Trả liên kết `/leads/<id>` hoặc `null` (đã ghi bước đỏ — KHÔNG gắn tín hiệu vào lead trùng của người khác). */
async function taoLeadThu(ca: NhatKyCa, phien: Phien, vai: KhoaVai, o: { ten: string; sdt: string; coSo: "CS1" | "CS2" }): Promise<string | null> {
  const page = phien.page;
  const actor = nhanActor(vai);
  await di(page, DUONG_DAN.nhapKhach);
  if (!(await coThay(page.getByTestId("o-chon-nguon"), 60_000))) {
    ca.biChan("Form nhập khách không có ô chọn nguồn: cờ nguon.enabled TẮT trên test — không dựng được lead thử có nguồn.");
  }
  await choHydrate(page.getByLabel("Tên phụ huynh"));
  if ((await page.locator(`#centerCode option[value='${o.coSo}']`).count()) === 0) ca.biChan(`Ô «Cơ sở phụ huynh chọn» không có cơ sở mã ${o.coSo} cho ${VAI[vai].local}.`);
  await page.getByLabel("Tên phụ huynh").fill(o.ten);
  await page.getByLabel("SĐT phụ huynh").fill(o.sdt);
  await page.locator("#centerCode").selectOption(o.coSo);
  const ds = await moOChonNguon(page);
  const lua = await ds.getByRole("option").evaluateAll((os) => os.map((x) => ({ ten: (x.querySelector("span span")?.textContent ?? "").trim(), day: (x.textContent ?? "").trim() })));
  const chon = lua.find((l) => l.ten !== "" && !l.ten.startsWith("UAT SOURCE FINAL") && !/Chọn |Phải giải trình/.test(l.day));
  if (!chon) ca.biChan("Không có nguồn mặc định nào chọn được mà không cần người giới thiệu/giải trình — không dựng được lead thử.");
  await ds.getByRole("option", { name: chon.day }).first().click();
  await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
  const dong = page.getByRole("listitem").filter({ hasText: o.ten });
  await expect(dong.first()).toBeVisible({ timeout: 60_000 });
  const ghiChu = (await dong.first().innerText()).replace(/\s+/g, " ");
  if (!/đã tạo/.test(ghiChu)) {
    ca.buoc({ actor, action: `Tạo lead thử ở ${o.coSo}`, input: o.sdt, expected: "«đã tạo» (phiếu MỚI — không gắn tín hiệu vào lead của người khác)", actual: ghiChu, pass: false });
    return null;
  }
  const href = await dong.first().getByRole("link", { name: "Mở" }).getAttribute("href");
  ca.buoc({ actor, action: `Tạo lead thử ở ${o.coSo} qua /nhap-khach-hang`, input: { ten: o.ten, coSo: o.coSo, nguon: chon.ten }, expected: "phiếu mới được tạo", actual: { ghiChu, href }, pass: !!href, screenshots: [await ca.chup(page, `da-tao-lead-${o.coSo.toLowerCase()}`, { fullPage: false })] });
  return href;
}

test("[SRC-16] Cách ly cơ sở + phạm vi xem lead: QLCS CS1 thấy lead CS1 mà KHÔNG thấy lead CS2; Sale chỉ thấy phiếu của mình (đối chứng dương)", async ({ ca, moVai, dot }) => {
  // Nguồn kỳ vọng: prisma/seed-roles.ts — `leads:view-all` GLOBAL cho SUPER_ADMIN · HO_MARKETING (dòng 413); CENTER_MANAGER có `leads:view-all` nhưng bị scopedDb khoá ở cơ sở của họ (dòng 726);
  // HO_SALE và CENTER_SALES_CSM chỉ `leads:view-own` (dòng 643-665, 1062: «phiếu mình nhập»/được chia).
  // ⚠️ CLAUDE.md (mục "Target — Doc 15") nói HO_SALE "xem lead scope A&B": đó là MỤC TIÊU thiết kế; seed hiện hành chỉ cho HO_SALE `leads:view-own`. Ca này đo HIỆN TRẠNG theo seed
  // (DB local 19/10/2026: saleho thấy 0 lead của người khác). Nếu một ngày seed đổi theo mục tiêu, ca này đỏ ở hai bước của saleho — đó là tín hiệu đúng, hãy cập nhật cả hai nơi.
  //
  // VÌ SAO HAI LEAD (CS1 và CS2): Sale CS2 không thấy lead CS1 vì Sale chỉ thấy phiếu CỦA MÌNH — kết quả đó y hệt kể cả khi cách ly CƠ SỞ hỏng (đã cấy: bỏ `Lead` khỏi SCOPED_MODELS mà
  // bản đầu của ca — chỉ có "Sale CS2 không thấy" — vẫn XANH). Phép đo cách ly cơ sở THẬT cần vai thấy-tất-cả-trong-cơ-sở: QLCS CS1 nhìn lead CS2. Seed UAT không có QLCS CS2 nên đo chiều CS1→CS2.
  const sale1 = await moVai("sale1");
  const sale2 = await moVai("sale2");
  const ten1 = tenDuLieu(dot, "Cách ly CS1");
  const ten2 = tenDuLieu(dot, "Cách ly CS2");
  const href1 = await taoLeadThu(ca, sale1, "sale1", { ten: ten1, sdt: soDienThoaiThu(dot, 16), coSo: "CS1" });
  if (!href1) return;
  const href2 = await taoLeadThu(ca, sale2, "sale2", { ten: ten2, sdt: soDienThoaiThu(dot, 17), coSo: "CS2" });
  if (!href2) return;

  const doc = async (vai: KhoaVai, ten: string) => {
    const p = await moVai(vai);
    await di(p.page, DUONG_DAN.leads(ten));
    const oTimKiem = await coThay(p.page.locator('input[name="q"]'), 60_000);
    // Ô tìm hiện TRƯỚC bảng kết quả (RSC stream): đọc ngay là đọc trang chưa có dữ liệu — «THẤY» đỏ oan, và tệ hơn, «KHÔNG thấy» đạt VÔ HIỆU. Đợi dòng tổng («Tổng N lead») hoặc trạng thái rỗng («Chưa có lead nào»)
    // rồi mới đọc (đo trên bản `next start` 20/10/2026: dev server đủ chậm để che lỗi này).
    if (oTimKiem) await coThay(p.page.getByText(/Tổng \d+ lead|Chưa có lead nào/), 60_000);
    const thanBai = oTimKiem ? ((await p.page.locator("main").innerText()) || "") : "";
    return { p, thay: thanBai.includes(ten), oTimKiem, soHang: await p.page.getByRole("row").count() };
  };
  const kiem = async (lead: string, ten: string, thay: KhoaVai[], khongThay: KhoaVai[], lyDoKhong: string) => {
    for (const vai of thay) {
      const { p: _p, ...r } = await doc(vai, ten);
      void _p;
      ca.buoc({ actor: nhanActor(vai), action: `[${lead}] Tìm «${ten}» ở /leads`, input: { q: ten }, expected: "THẤY lead (đối chứng dương: truy vấn đúng, lead có thật, vai có quyền)", actual: r, pass: r.oTimKiem && r.thay });
    }
    for (const vai of khongThay) {
      const { p, ...r } = await doc(vai, ten);
      ca.buoc({
        actor: nhanActor(vai),
        action: `[${lead}] Tìm «${ten}» ở /leads — ${lyDoKhong}`,
        input: { q: ten },
        expected: "KHÔNG thấy lead; trang vẫn dựng bình thường (có ô tìm kiếm) — không phải trang lỗi/hết phiên",
        actual: r,
        pass: r.oTimKiem && !r.thay,
        screenshots: [await ca.chup(p.page, `${lead}-${vai}-khong-thay`, { fullPage: false })],
      });
    }
  };
  // Lead CS1: ai thấy / ai không.
  await kiem("CS1", ten1, ["admin", "marketing", "giamdoc"], ["sale2", "saleho"], "Sale chỉ thấy phiếu của mình");
  // Lead CS2: ĐÂY là phép đo cách ly cơ sở — QLCS CS1 (thấy-tất-cả trong CS1) KHÔNG được thấy.
  await kiem("CS2", ten2, ["admin", "marketing"], ["giamdoc", "sale1", "saleho"], "cách ly cơ sở / chỉ phiếu của mình");

  // Mở thẳng theo id (IDOR): QLCS CS1 mở lead CS2 ⇒ bị từ chối; mở lead CS1 ⇒ thấy (đối chứng dương).
  const ql = await moVai("giamdoc");
  const actorQl = nhanActor("giamdoc");
  await di(ql.page, href2);
  await expect
    .poll(
      async () => {
        const u = new URL(ql.page.url());
        const t = ((await ql.page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
        if (u.pathname !== href2) return "DA_DOI_TRANG";
        if (/không có quyền|Không tìm thấy|không tồn tại/i.test(t)) return "TU_CHOI";
        if (t.includes(ten2)) return "THAY_TEN";
        return "CHO";
      },
      { timeout: 45_000 },
    )
    .not.toBe("CHO")
    .catch(() => undefined);
  const urlSau = new URL(ql.page.url()).pathname;
  const thanBai = ((await ql.page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const khongLoTen = !thanBai.includes(ten2);
  const coTinHieuTuChoi = urlSau !== href2 || /không có quyền|Không tìm thấy|không tồn tại/i.test(thanBai);
  ca.buoc({
    actor: actorQl,
    action: `Mở thẳng ${href2} (lead CS2, theo id)`,
    input: href2,
    expected: "không lộ tên lead, và có tín hiệu từ chối (đổi trang / «Không tìm thấy» / «không có quyền»)",
    actual: { khongLoTen, coTinHieuTuChoi, urlSau },
    pass: khongLoTen && coTinHieuTuChoi,
    screenshots: [await ca.chup(ql.page, "giamdoc-mo-thang-lead-cs2", { fullPage: false })],
  });
  await di(ql.page, href1);
  await expect(ql.page.locator("main")).toContainText(ten1, { timeout: 90_000 });
  ca.buoc({ actor: actorQl, action: `Mở thẳng ${href1} (lead CS1 — đối chứng dương)`, input: href1, expected: "thấy hồ sơ lead", actual: "thấy tên lead", pass: true });

  // Thông tin (không tính): người tạo tìm lại phiếu của mình — còn tuỳ lead được chia cho ai.
  for (const [vai, ten] of [["sale1", ten1], ["sale2", ten2]] as const) {
    const { p: _p, ...r } = await doc(vai, ten);
    void _p;
    ca.thongTin(nhanActor(vai), "Người tạo tìm lại lead của chính mình (phụ thuộc lead được chia cho ai)", r);
  }
});
