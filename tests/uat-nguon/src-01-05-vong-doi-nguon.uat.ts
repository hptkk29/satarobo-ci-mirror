// SRC-01 · SRC-02 · SRC-03 · SRC-04 · SRC-05 — VÒNG ĐỜI MỘT NGUỒN TUỲ BIẾN, từ lúc tạo tới lúc tắt, trên môi trường test THẬT.
//
// Một file, chạy THEO THỨ TỰ KHAI BÁO (workers: 1) vì các ca nối nhau trên CÙNG hai nguồn thử (A: thường · B: bắt giải trình):
//   SRC-01 tạo/đọc/sửa nguồn → SRC-03 nguồn mới hiện ở form nhập (không deploy) → SRC-04 ô chọn nguồn (tìm · bắt buộc · không UNKNOWN)
//   → SRC-05 nguồn bắt giải trình → SRC-02 TẮT nguồn (cuối cùng: nguồn thử không nằm lại làm bẩn ô chọn của người dùng thật).
// Thứ tự trong file KHÔNG theo số mã ca vì SRC-02 phải đứng cuối — đó là chủ ý, đừng "sắp lại cho gọn".
// KHÔNG dùng `describe.serial`: serial BỎ QUA mọi ca sau một ca đỏ nên mất bằng chứng của chúng (đã đo khi cấy lỗi vào ô chọn nguồn: SRC-04 đỏ, SRC-05 và SRC-02 không chạy). Ca đỏ ở đầu
// kéo theo ca đỏ/BLOCKED phía sau vì thiếu nguồn A/B — đó là hệ quả thật; hãy đọc ca đỏ ĐẦU TIÊN.
//
// Mọi bản ghi mang tiền tố `UAT SOURCE FINAL <mã đợt>`. Không xoá gì sau khi chạy: nguồn nằm lại ở trạng thái "Tạm ngừng" làm bằng chứng.
// Tiền đề (BLOCKED nếu thiếu, KHÔNG phải PASS): cờ `nguon.enabled` BẬT trên test; vai Marketing có `sources:manage`.
import { expect, test } from "./_lib/fixtures";
import { maNguon, tenDuLieu } from "./_lib/an-toan";
import type { NhatKyCa } from "./_lib/nhat-ky";
import { nhanActor, type Phien } from "./_lib/phien";
import { VAI, type KhoaVai } from "./_lib/vai";
import { DUONG_DAN, choHydrate, chuGiaiThichChanLuu, coThay, danhSachTheoTrangThai, di, dienFormTaoNguon, hangNguon, khaiNguoiPhuTrach, moHopThoai, moOChonNguon, soDienThoaiThu, tenCacLuaChon, type TaoNguonInput } from "./_lib/thao-tac";

const DOT = process.env.UAT_RUN_CODE ?? "LOCAL";
const A = { ten: tenDuLieu(DOT, "A"), ma: maNguon(DOT, "A") };
const B = { ten: tenDuLieu(DOT, "B giải trình"), ma: maNguon(DOT, "B") };
const MO_TA_A = `${tenDuLieu(DOT, "A")} — mô tả lúc tạo`;
const MO_TA_A_SUA = `${tenDuLieu(DOT, "A")} — mô tả ĐÃ SỬA`;

/**
 * Tạo một nguồn «Đang dùng» bằng giao diện, CÓ DỰ PHÒNG. Trên test có thể đang chạy một chính sách trả cho «người phụ trách nguồn»: khi đó nguồn Đang dùng KHÔNG chủ bị chặn và
 * nguồn có chủ cần quyền kích hoạt chính sách (Marketing không có) — nút «Tạo nguồn» bị khoá kèm câu giải thích. Gặp vậy: ghi câu đó vào bằng chứng rồi thử lại bằng Admin + khai người
 * phụ trách (mã NV của uat.marketing). Cả hai đều bị khoá ⇒ BLOCKED kèm đúng câu của giao diện (không đứng chờ tới hết giờ).
 */
async function taoNguonCoDuPhong(ca: NhatKyCa, moVai: (v: KhoaVai) => Promise<Phien>, input: TaoNguonInput, nhan: string): Promise<KhoaVai> {
  let lyDoChan = "";
  for (const vai of ["marketing", "admin"] as const) {
    const p = await moVai(vai);
    await di(p.page, DUONG_DAN.tao);
    await dienFormTaoNguon(p.page, input);
    if (vai === "admin") await khaiNguoiPhuTrach(p.page, "HO.MKT.001");
    const nut = p.page.getByRole("button", { name: "Tạo nguồn" });
    const bamDuoc = await expect(nut).toBeEnabled({ timeout: 5_000 }).then(() => true, () => false);
    if (!bamDuoc) {
      lyDoChan = (await chuGiaiThichChanLuu(p.page)) || "(giao diện không nói lý do)";
      ca.thongTin(nhanActor(vai), `Nút «Tạo nguồn» (${nhan}) bị khoá khi kích hoạt ngay`, { lyDo: lyDoChan, anh: await ca.chup(p.page, `tao-${nhan}-bi-khoa-${vai}`, { fullPage: false }) });
      continue;
    }
    await nut.click();
    await p.page.waitForURL(/\/nguon-hoa-hong\/nguon\?xem=tat-ca/, { timeout: 60_000 });
    if (vai === "admin") ca.thongTin(nhanActor(vai), `Nguồn ${nhan} phải tạo bằng Admin kèm người phụ trách (Marketing bị khoá)`, lyDoChan);
    return vai;
  }
  return ca.biChan(`Không bấm được «Tạo nguồn» (${nhan}) ở trạng thái «Đang dùng» bằng cả Marketing lẫn Admin: ${lyDoChan}`);
}

test("[SRC-01] CRUD nguồn: tạo · đọc · sửa · từ chối mã trùng và biểu mẫu trống (Marketing)", async ({ ca, moVai }) => {
  const mk = await moVai("marketing");
  const actor = nhanActor("marketing");
  const page = mk.page;

  await di(page, DUONG_DAN.danhSach);
  const nutTao = page.getByRole("link", { name: /Tạo nguồn/ });
  if (!(await coThay(nutTao, 45_000))) {
    ca.biChan("Không thấy nút «Tạo nguồn» ở danh sách nguồn: cờ nguon.enabled đang TẮT trên test, hoặc vai Marketing chưa có sources:manage (SRC-15 phân biệt hai ca).");
  }
  ca.buoc({ actor, action: "Mở danh sách nguồn (xem=tat-ca)", input: DUONG_DAN.danhSach, expected: "có nút «Tạo nguồn»", actual: "có", pass: true, screenshots: [await ca.chup(page, "danh-sach-truoc")] });

  // ── C: tạo A (đang dùng) ──
  const vaiTaoA = await taoNguonCoDuPhong(ca, moVai, { ten: A.ten, ma: A.ma, nhom: "Quảng cáo", moTa: MO_TA_A, kichHoatNgay: true }, "A");
  await di(page, danhSachTheoTrangThai("ACTIVE"));
  await expect(hangNguon(page, A.ten).first()).toBeVisible({ timeout: 30_000 });
  const hangA = (await hangNguon(page, A.ten).first().innerText()).replace(/\s+/g, " ");
  ca.buoc({
    actor: nhanActor(vaiTaoA),
    action: "Tạo nguồn A (Quảng cáo, kích hoạt ngay)",
    input: { ten: A.ten, ma: A.ma },
    expected: "có dòng nguồn A ở danh sách «Đang dùng»",
    actual: hangA,
    pass: hangA.includes(A.ma) && hangA.includes("Đang dùng"),
    screenshots: [await ca.chup(page, "danh-sach-sau-tao-A")],
  });

  // ── C: tạo B (bắt giải trình) ──
  const vaiTaoB = await taoNguonCoDuPhong(ca, moVai, { ten: B.ten, ma: B.ma, nhom: "Khác", baoGiaiTrinh: true, kichHoatNgay: true }, "B");
  await di(page, danhSachTheoTrangThai("ACTIVE"));
  await expect(hangNguon(page, B.ten).first()).toBeVisible({ timeout: 30_000 });
  const hangB = (await hangNguon(page, B.ten).first().innerText()).replace(/\s+/g, " ");
  ca.buoc({
    actor: nhanActor(vaiTaoB),
    action: "Tạo nguồn B (Khác, bắt buộc giải trình, kích hoạt ngay)",
    input: { ten: B.ten, ma: B.ma },
    expected: "có dòng nguồn B ở danh sách «Đang dùng»",
    actual: hangB,
    pass: hangB.includes(B.ma) && hangB.includes("Đang dùng"),
  });

  // ── R: đọc chi tiết ──
  await di(page, DUONG_DAN.chiTiet(A.ma));
  await expect(page.getByText(A.ten).first()).toBeVisible({ timeout: 30_000 });
  const chiTiet = await page.locator("main").innerText();
  ca.buoc({
    actor,
    action: "Mở trang chi tiết nguồn A",
    input: DUONG_DAN.chiTiet(A.ma),
    expected: "thấy tên, mã và mô tả lúc tạo",
    actual: { coTen: chiTiet.includes(A.ten), coMa: chiTiet.includes(A.ma), coMoTa: chiTiet.includes(MO_TA_A) },
    pass: chiTiet.includes(A.ten) && chiTiet.includes(A.ma) && chiTiet.includes(MO_TA_A),
    screenshots: [await ca.chup(page, "chi-tiet-A")],
  });

  // ── U: sửa mô tả ──
  await di(page, DUONG_DAN.sua(A.ma));
  await choHydrate(page.getByLabel("Mô tả"));
  await page.getByLabel("Mô tả").fill(MO_TA_A_SUA);
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.waitForURL((u) => u.pathname === DUONG_DAN.chiTiet(A.ma), { timeout: 60_000 });
  await expect(page.getByText(MO_TA_A_SUA).first()).toBeVisible({ timeout: 30_000 });
  ca.buoc({ actor, action: "Sửa mô tả nguồn A rồi lưu", input: MO_TA_A_SUA, expected: "về trang chi tiết, mô tả mới hiển thị", actual: "mô tả mới hiển thị", pass: true, screenshots: [await ca.chup(page, "chi-tiet-A-sau-sua")] });

  // ── Từ chối: mã trùng ──
  await di(page, DUONG_DAN.tao);
  await dienFormTaoNguon(page, { ten: `${A.ten} (bản trùng mã)`, ma: A.ma, nhom: "Quảng cáo", kichHoatNgay: false });
  await page.getByRole("button", { name: "Tạo nguồn" }).click();
  const loiTrung = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(loiTrung).toBeVisible({ timeout: 30_000 });
  const chuLoiTrung = (await loiTrung.innerText()).replace(/\s+/g, " ");
  const vanOTrangTao = new URL(page.url()).pathname === DUONG_DAN.tao;
  ca.buoc({ actor, action: "Tạo nguồn thứ hai TRÙNG mã với A", input: A.ma, expected: "có thông báo lỗi và vẫn ở trang tạo (không tạo bản ghi)", actual: { loi: chuLoiTrung, vanOTrangTao }, pass: vanOTrangTao && chuLoiTrung.length > 0, screenshots: [await ca.chup(page, "loi-ma-trung")] });

  // ── Từ chối: biểu mẫu trống ──
  await di(page, DUONG_DAN.tao);
  await choHydrate(page.getByLabel("Tên nguồn"));
  await page.getByRole("button", { name: "Tạo nguồn" }).click();
  const loiTrong = (await page.getByRole("alert").allInnerTexts()).filter((t) => t.trim() !== "");
  ca.buoc({ actor, action: "Bấm «Tạo nguồn» trên biểu mẫu trắng", input: null, expected: "ít nhất một lỗi hiện cạnh ô, vẫn ở trang tạo", actual: { loi: loiTrong.map((s) => s.replace(/\s+/g, " ")), url: new URL(page.url()).pathname }, pass: loiTrong.length > 0 && new URL(page.url()).pathname === DUONG_DAN.tao, screenshots: [await ca.chup(page, "loi-form-trong")] });
});

test("[SRC-03] Nguồn tuỳ biến vừa tạo hiện ở form nhập khách ngay, không cần deploy (Sale CS1)", async ({ ca, moVai }) => {
  const sale = await moVai("sale1");
  const actor = nhanActor("sale1");
  const page = sale.page;
  await di(page, DUONG_DAN.nhapKhach);
  if (!(await coThay(page.getByTestId("o-chon-nguon"), 60_000))) {
    ca.biChan("Form nhập khách không có ô chọn nguồn (data-testid=o-chon-nguon): cờ nguon.enabled TẮT trên test — form vẫn là ô gõ tự do.");
  }
  await choHydrate(page.getByLabel("Tên phụ huynh"));
  const ds = await moOChonNguon(page);
  const ten = await tenCacLuaChon(ds);
  ca.buoc({ actor, action: "Mở ô «Nguồn khách hàng» ở /nhap-khach-hang", input: null, expected: { chua: [A.ten, B.ten] }, actual: { soLuaChon: ten.length, coA: ten.includes(A.ten), coB: ten.includes(B.ten) }, pass: ten.includes(A.ten) && ten.includes(B.ten), screenshots: [await ca.chup(page, "o-chon-nguon-co-nguon-moi", { fullPage: false })] });
  // Đối chứng dương cho "có mặt": ô chọn cũng liệt kê các nguồn mặc định (không phải ô rỗng).
  ca.buoc({ actor, action: "Đối chứng: ô chọn còn liệt kê nguồn mặc định", input: null, expected: "có ≥ 3 lựa chọn", actual: ten.length, pass: ten.length >= 3 });
});

test("[SRC-04] Ô chọn nguồn: tìm kiếm · bắt buộc chọn · không có UNKNOWN / xem tay (Sale CS1)", async ({ ca, moVai, dot }) => {
  const sale = await moVai("sale1");
  const actor = nhanActor("sale1");
  const page = sale.page;
  await di(page, DUONG_DAN.nhapKhach);
  if (!(await coThay(page.getByTestId("o-chon-nguon"), 60_000))) {
    ca.biChan("Form nhập khách không có ô chọn nguồn: cờ nguon.enabled TẮT trên test.");
  }

  // (a) không có UNKNOWN / MANUAL_REVIEW — ĐO TRÊN DANH SÁCH ĐẦY, kèm đối chứng dương.
  await choHydrate(page.getByLabel("Tên phụ huynh"));
  const ds = await moOChonNguon(page);
  const tatCa = await tenCacLuaChon(ds);
  const cam = tatCa.filter((t) => /không rõ nguồn|unknown|manual.?review|xem tay/i.test(t));
  ca.buoc({
    actor,
    action: "Soát danh sách đầy đủ: không có nguồn hệ thống «Không rõ nguồn» hay trạng thái xem tay",
    input: null,
    expected: { cam: [], conTuongDuong: "danh sách có ≥ 3 lựa chọn và chứa nguồn thử A" },
    actual: { soLuaChon: tatCa.length, cam, coA: tatCa.includes(A.ten) },
    pass: cam.length === 0 && tatCa.length >= 3 && tatCa.includes(A.ten),
    screenshots: [await ca.chup(page, "danh-sach-day-du", { fullPage: false })],
  });

  // (b) tìm kiếm
  const tim = page.getByRole("searchbox", { name: "Tìm nguồn" });
  await tim.fill(tenDuLieu(dot, ""));
  const sauLoc = await tenCacLuaChon(ds);
  ca.buoc({ actor, action: "Gõ tiền tố dữ liệu thử vào ô «Tìm nguồn»", input: tenDuLieu(dot, ""), expected: "chỉ còn các nguồn thử của đợt (A và B), không lẫn nguồn mặc định", actual: sauLoc, pass: sauLoc.length >= 2 && sauLoc.every((t) => t.startsWith(tenDuLieu(dot, "").trim())) && sauLoc.includes(A.ten) && sauLoc.includes(B.ten), screenshots: [await ca.chup(page, "tim-kiem-tien-to", { fullPage: false })] });
  await tim.fill("zzz-khong-co-nguon-nay-zzz");
  const khongKhop = await ds.innerText();
  ca.buoc({ actor, action: "Gõ chuỗi không khớp nguồn nào", input: "zzz-khong-co-nguon-nay-zzz", expected: "báo «Không có nguồn nào khớp»", actual: khongKhop.replace(/\s+/g, " ").slice(0, 120), pass: /Không có nguồn nào khớp/.test(khongKhop) });
  await tim.press("Escape");

  // (c) bắt buộc chọn: điền SĐT + tên nhưng KHÔNG chọn nguồn ⇒ chặn, không tạo phiếu.
  await page.getByLabel("Tên phụ huynh").fill(tenDuLieu(dot, "Thiếu nguồn"));
  await page.getByLabel("SĐT phụ huynh").fill(soDienThoaiThu(dot, 900));
  await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
  const loi = page.getByRole("alert").filter({ hasText: /nguồn/i }).first();
  await expect(loi).toBeVisible({ timeout: 15_000 });
  const chuLoi = (await loi.innerText()).replace(/\s+/g, " ");
  const phieuDaTao = await page.getByText("Đã nhập trong phiên này (").count();
  ca.buoc({ actor, action: "Bấm Lưu khi chưa chọn nguồn", input: { ten: tenDuLieu(dot, "Thiếu nguồn") }, expected: "có lỗi cạnh ô nguồn và KHÔNG có phiếu nào được tạo", actual: { loi: chuLoi, soPhieuTrongPhien: phieuDaTao }, pass: chuLoi.length > 0 && phieuDaTao === 0, screenshots: [await ca.chup(page, "bat-buoc-chon-nguon", { fullPage: false })] });
});

test("[SRC-05] Nguồn bắt giải trình: hiện «Giải trình nguồn», chặn dưới 10 ký tự, lưu được khi đủ (Sale CS1)", async ({ ca, moVai, dot }) => {
  const sale = await moVai("sale1");
  const actor = nhanActor("sale1");
  const page = sale.page;
  await di(page, DUONG_DAN.nhapKhach);
  if (!(await coThay(page.getByTestId("o-chon-nguon"), 60_000))) {
    ca.biChan("Form nhập khách không có ô chọn nguồn: cờ nguon.enabled TẮT trên test.");
  }
  await choHydrate(page.getByLabel("Tên phụ huynh"));
  const ds = await moOChonNguon(page);
  await ds.getByRole("option", { name: new RegExp(B.ten.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  const gt = page.getByLabel("Giải trình nguồn");
  await expect(gt).toBeVisible({ timeout: 15_000 });
  ca.buoc({ actor, action: "Chọn nguồn B (bắt giải trình)", input: B.ten, expected: "hiện ô «Giải trình nguồn»", actual: "hiện", pass: true, screenshots: [await ca.chup(page, "hien-giai-trinh", { fullPage: false })] });

  const ten = tenDuLieu(dot, "Lead B giải trình");
  const sdt = soDienThoaiThu(dot, 5);
  await page.getByLabel("Tên phụ huynh").fill(ten);
  await page.getByLabel("SĐT phụ huynh").fill(sdt);

  for (const [nhan, chuoi] of [["rỗng", ""], ["9 ký tự", "123456789"]] as const) {
    await gt.fill(chuoi);
    await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
    const loi = page.getByRole("alert").filter({ hasText: /giải trình|ký tự/i }).first();
    const thay = await coThay(loi, 10_000);
    const daTao = await page.getByText("Đã nhập trong phiên này (").count();
    ca.buoc({ actor, action: `Lưu với giải trình ${nhan}`, input: chuoi.length, expected: "bị chặn: có lỗi giải trình, không tạo phiếu", actual: { thayLoi: thay, soPhieuTrongPhien: daTao }, pass: thay && daTao === 0 });
  }

  await gt.fill("Khách biết đến Sata Robo qua buổi UAT nghiệm thu nguồn."); // ≥ 10 ký tự
  await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
  const dong = page.getByRole("listitem").filter({ hasText: ten });
  await expect(dong.first()).toBeVisible({ timeout: 60_000 });
  const ghiChu = (await dong.first().innerText()).replace(/\s+/g, " ");
  if (/trùng/i.test(ghiChu)) {
    // Không bao giờ để bộ UAT gắn tín hiệu vào lead CỦA NGƯỜI KHÁC: SĐT thử trùng một khách thật ⇒ dừng và báo.
    ca.buoc({ actor, action: "Lưu với giải trình đủ dài", input: sdt, expected: "«đã tạo» (phiếu mới)", actual: ghiChu, pass: false });
    return;
  }
  ca.buoc({ actor, action: "Lưu với giải trình đủ dài (≥ 10 ký tự)", input: { ten, giaiTrinhDai: true }, expected: "phiếu được tạo («đã tạo»)", actual: ghiChu, pass: /đã tạo/.test(ghiChu), screenshots: [await ca.chup(page, "da-tao-lead-B", { fullPage: false })] });

  // Đọc lại nguồn đã lưu trên phiếu. Khối «Nguồn» của phiếu gác bằng `sources:view` (Sale THƯỜNG không có — doc 09 §1.2), nên người đọc là QLCS CS1.
  const hrefPhieu = await dong.first().getByRole("link", { name: "Mở" }).getAttribute("href");
  ca.thongTin(actor, "Liên kết «Mở» của phiếu vừa tạo", hrefPhieu);
  if (!hrefPhieu || !/^\/leads\/[^/?#]+$/.test(hrefPhieu)) {
    ca.buoc({ actor, action: "Lấy liên kết phiếu vừa tạo", input: null, expected: "/leads/<id>", actual: hrefPhieu, pass: false });
    return;
  }
  const ql = await moVai("giamdoc");
  const actorQl = nhanActor("giamdoc");
  await di(ql.page, hrefPhieu);
  await expect(ql.page.locator("main")).toContainText(ten, { timeout: 90_000 });
  // Khối «Nguồn» stream muộn hơn phần đầu trang: đợi tiêu đề của nó rồi mới đọc.
  const khoiNguon = ql.page.locator("section[aria-labelledby='khoi-nguon-tieu-de']");
  const coKhoi = await coThay(khoiNguon, 60_000);
  const chiTiet = coKhoi ? await khoiNguon.first().innerText() : "(không có khối «Nguồn» trên phiếu)";
  ca.buoc({
    actor: actorQl,
    action: "Mở phiếu vừa tạo, đọc khối «Nguồn»",
    input: hrefPhieu,
    expected: { chua: [B.ten, "Khách biết đến Sata Robo qua buổi UAT"] },
    actual: { coKhoi, coTenNguon: chiTiet.includes(B.ten), coGiaiTrinh: /Khách biết đến Sata Robo qua buổi UAT/.test(chiTiet) },
    pass: coKhoi && chiTiet.includes(B.ten) && /Khách biết đến Sata Robo qua buổi UAT/.test(chiTiet),
    screenshots: [await ca.chup(ql.page, "phieu-lead-B-khoi-nguon")],
  });
});

/**
 * Tắt một nguồn (Đang dùng → Tạm ngừng) bằng giao diện, CÓ DỰ PHÒNG: nút của Marketing có thể thành «Vì sao không đổi trạng thái được» (nguồn đã có chủ + chính sách chủ nguồn đang chạy ⇒ cần quyền
 * kích hoạt chính sách) — khi đó ghi lý do và thử lại bằng Admin. Kiểm kết quả ở TRANG CHI TIẾT của nguồn (danh sách đầy đủ có phân trang, mỗi lượt chạy thêm hai nguồn «Tạm ngừng» nên hàng
 * của nguồn thử có thể trôi sang trang sau). Trả về vai đã tắt được.
 */
async function tatNguonCoDuPhong(ca: NhatKyCa, moVai: (v: KhoaVai) => Promise<Phien>, nguon: { ten: string; ma: string }): Promise<KhoaVai> {
  let lyDo = "";
  for (const vai of ["marketing", "admin"] as const) {
    const p = await moVai(vai);
    await di(p.page, danhSachTheoTrangThai("ACTIVE"));
    const hang = hangNguon(p.page, nguon.ten).first();
    if (!(await coThay(hang, 45_000))) {
      lyDo = `nguon ${nguon.ma} không có trong danh sách «Đang dùng» (đã tắt từ trước hoặc chưa tạo được)`;
      continue;
    }
    const nut = hang.getByRole("button", { name: /Đổi trạng thái|Vì sao không đổi/ });
    const nhanNut = (await nut.getAttribute("aria-label")) ?? "";
    if (/Vì sao không đổi/.test(nhanNut)) {
      lyDo = `nút của ${VAI[vai].local}: ${nhanNut}`;
      ca.thongTin(nhanActor(vai), `Không đổi được trạng thái nguồn ${nguon.ma}`, lyDo);
      continue;
    }
    const hop = await moHopThoai(p.page, nut);
    const lua = hop.getByRole("radio", { name: /Tạm ngừng|Ngừng/ });
    if (await lua.count()) await lua.first().check();
    const oLyDo = hop.getByLabel(/Lý do/);
    if (await oLyDo.count()) await oLyDo.fill("UAT SOURCE FINAL: tắt nguồn thử sau khi nghiệm thu.");
    await ca.chup(p.page, `hop-thoai-tat-${nguon.ma.slice(-1)}`, { fullPage: false });
    await hop.getByRole("button").filter({ hasNotText: /Huỷ|Đóng/ }).last().click();
    await expect(hop).toBeHidden({ timeout: 30_000 });
    await di(p.page, DUONG_DAN.chiTiet(nguon.ma));
    await expect(p.page.locator("main")).toContainText(/Tạm ngừng/, { timeout: 45_000 });
    const trangThai = ((await p.page.locator("main").innerText()) || "").replace(/\s+/g, " ");
    ca.buoc({
      actor: nhanActor(vai),
      action: `Tắt nguồn ${nguon.ma} (Đang dùng → Tạm ngừng)`,
      input: nguon.ma,
      expected: "trang chi tiết nguồn hiện «Tạm ngừng» (nguồn vẫn còn, không bị xoá)",
      actual: trangThai.slice(0, 160),
      pass: /Tạm ngừng/.test(trangThai) && trangThai.includes(nguon.ten),
      screenshots: [await ca.chup(p.page, `chi-tiet-${nguon.ma.slice(-1)}-da-tat`)],
    });
    return vai;
  }
  return ca.biChan(`Không tắt được nguồn ${nguon.ma} bằng Marketing lẫn Admin: ${lyDo}`);
}

test("[SRC-02] Bật/tắt nguồn: tắt thì biến khỏi ô chọn nguồn nhưng nguồn vẫn còn (Marketing/Admin → Sale)", async ({ ca, moVai }) => {
  const sale = await moVai("sale1");
  await tatNguonCoDuPhong(ca, moVai, A);

  // Phía người nhập: A biến mất khỏi ô chọn; B (còn bật) vẫn còn — đối chứng dương.
  const sp = sale.page;
  await di(sp, DUONG_DAN.nhapKhach);
  const ds = await moOChonNguon(sp);
  const ten = await tenCacLuaChon(ds);
  ca.buoc({ actor: nhanActor("sale1"), action: "Mở ô chọn nguồn sau khi A bị tắt", input: null, expected: { khongCo: A.ten, van: B.ten }, actual: { coA: ten.includes(A.ten), coB: ten.includes(B.ten) }, pass: !ten.includes(A.ten) && ten.includes(B.ten), screenshots: [await ca.chup(sp, "o-chon-sau-khi-tat-A", { fullPage: false })] });

  // Dọn trạng thái: tắt nốt B để nguồn thử không nằm lại trong ô chọn của người dùng thật.
  await tatNguonCoDuPhong(ca, moVai, B);
});
