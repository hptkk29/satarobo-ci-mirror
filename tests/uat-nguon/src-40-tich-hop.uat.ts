// SRC-06 … SRC-23 — NGUỒN TÍCH HỢP trên test THẬT (suite `tich-hop`): người giới thiệu · chủ nguồn · đổi nguồn · nhập Excel · mã NV sai · affiliate · đa website · Sale độc lập · hiển thị tiền theo quyền · cổng ghi ·
// backfill · audit · nguồn → hoa hồng. Mã ca là mã của BẢNG SRC trong tác vụ lane E2 (xem bảng đối chiếu ở `uat-harness.md` §4/§11 — KHÔNG phải mã cũ SRC-06..20 của các ca «chờ fixture» đã gỡ).
//
// TIỀN ĐỀ chung (thiếu ⇒ BLOCKED có lý do, không FAIL): cờ `nguon.enabled` + `nguon.referral` + `nguon.autoAttribution` BẬT (suite `chuan-bi` SRC-39); bộ nạp UAT SOURCE FINAL đã chạy; với nhóm hoa hồng: engine + mốc + chính sách chung
// (SRC-40..43) và vét lead cũ đã chạy (workflow). Tệp chạy SAU `src-30-t1-hang-cho` (ca SRC-09b đổi nguồn của lead đã thu — lead ấy là «Bé … DRIFT» mà T1 vừa xử lý xong).
//
// Thứ tự trong tệp LÀ thứ tự chạy; các ca nối nhau qua `luuTrangThai/docTrangThai` (liên kết phiếu đã tạo, theo mã đợt). Chạy MỘT ca lẻ mà phiếu chưa có ⇒ BLOCKED «chạy SRC-xx trước».
// Mọi dữ liệu tạo ra mang `UAT SOURCE FINAL <mã đợt>`; KHÔNG xoá gì.
import type { Page } from "@playwright/test";
import { expect, test } from "./_lib/fixtures";
import { tenDuLieu } from "./_lib/an-toan";
import { locAuditLog } from "./_lib/audit";
import { DUONG_SO_TAT_CA, chupSo, dongCuBiDoi, soTien } from "./_lib/hoa-hong-ui";
import { docKhoiNguon, docThongTin, docTrangThai, luuTrangThai, nhapPhieu, timPhieuTheoSdt } from "./_lib/nhap-khach";
import { canCo } from "./_lib/nhat-ky";
import { nhanActor } from "./_lib/phien";
import { bamNhapVaDocKetQua, taiTepNhapLead, taoXlsxNhapLead } from "./_lib/xlsx";
import { DUONG_DAN, choHydrate, coThay, di, moHopThoai, moOChonNguon, soDienThoaiThu } from "./_lib/thao-tac";

const DOT = process.env.UAT_RUN_CODE ?? "LOCAL";

test("[SRC-06] Nguồn «nhân sự giới thiệu»: Sale nhập phiếu chọn nhân sự CS2 → QLCS đọc lại thấy đúng nguồn + người giới thiệu", async ({ ca, moVai }) => {
  const sale = await moVai("sale1");
  const ten = tenDuLieu(DOT, "Lead nhân sự giới thiệu");
  const sdt = soDienThoaiThu(DOT, 21);
  const r = await nhapPhieu(ca, sale.page, { ten, sdt, nguon: /Nguồn từ nhân sự giới thiệu/, nguoi: { nhan: "Nhân sự giới thiệu", tuKhoa: "CS2.TVV.001", chon: /Tư vấn viên CS2/ } });
  if (r.trung) ca.biChan(`SĐT thử ${sdt} đã thuộc một khách khác trên test («${r.ghiChu}») — không gắn tín hiệu nguồn vào lead của người khác.`);
  ca.buoc({ actor: nhanActor("sale1"), action: "Nhập phiếu: nguồn «Nguồn từ nhân sự giới thiệu» + chọn nhân sự uat.sale2 (CS2.TVV.001)", input: { ten, sdt }, expected: "phiếu được tạo («đã tạo») kèm liên kết «Mở»", actual: { ghiChu: r.ghiChu, href: r.href }, pass: r.daTao && r.href !== null, screenshots: [await ca.chup(sale.page, "da-nhap-nhan-su-gt", { fullPage: false })] });
  if (!r.href) return;
  luuTrangThai(DOT, "lead-nhan-su", r.href);

  const ql = await moVai("giamdoc");
  const khoi = await docKhoiNguon(ql.page, r.href, ten);
  ca.buoc({
    actor: nhanActor("giamdoc"),
    action: "QLCS mở phiếu, đọc khối «Nguồn»",
    input: r.href,
    expected: { nguon: "Nguồn từ nhân sự giới thiệu", nguoiGioiThieu: "chứa «Tư vấn viên CS2»" },
    actual: khoi.truong,
    pass: khoi.co && /Nguồn từ nhân sự giới thiệu/.test(khoi.truong["Nguồn"] ?? "") && /Tư vấn viên CS2/.test(khoi.truong["Người giới thiệu"] ?? ""),
    screenshots: [await ca.chup(ql.page, "khoi-nguon-nhan-su")],
  });
});

test("[SRC-07] Nguồn «phụ huynh giới thiệu»: Sale nhập phiếu chọn phụ huynh (qua tên bé) → QLCS đọc lại đúng nguồn + phụ huynh", async ({ ca, moVai }) => {
  const sale = await moVai("sale1");
  const ten = tenDuLieu(DOT, "Lead phụ huynh giới thiệu");
  const sdt = soDienThoaiThu(DOT, 22);
  const r = await nhapPhieu(ca, sale.page, { ten, sdt, nguon: /Nguồn từ phụ huynh giới thiệu/, nguoi: { nhan: "Phụ huynh giới thiệu", tuKhoa: "UAT SOURCE FINAL", chon: /UAT/ } });
  if (r.trung) ca.biChan(`SĐT thử ${sdt} đã thuộc một khách khác trên test («${r.ghiChu}»).`);
  ca.buoc({ actor: nhanActor("sale1"), action: "Nhập phiếu: nguồn «Nguồn từ phụ huynh giới thiệu» + chọn phụ huynh của bé «UAT SOURCE FINAL (con phụ huynh giới thiệu)»", input: { ten, sdt }, expected: "phiếu được tạo", actual: { ghiChu: r.ghiChu, href: r.href }, pass: r.daTao && r.href !== null, screenshots: [await ca.chup(sale.page, "da-nhap-phu-huynh-gt", { fullPage: false })] });
  if (!r.href) return;
  luuTrangThai(DOT, "lead-phu-huynh", r.href);

  const ql = await moVai("giamdoc");
  const khoi = await docKhoiNguon(ql.page, r.href, ten);
  ca.buoc({
    actor: nhanActor("giamdoc"),
    action: "QLCS mở phiếu, đọc khối «Nguồn»",
    input: r.href,
    expected: { nguon: "Nguồn từ phụ huynh giới thiệu", nguoiGioiThieu: "có tên phụ huynh" },
    actual: khoi.truong,
    pass: khoi.co && /Nguồn từ phụ huynh giới thiệu/.test(khoi.truong["Nguồn"] ?? "") && !/^(Không có|—)?$/.test(khoi.truong["Người giới thiệu"] ?? ""),
    screenshots: [await ca.chup(ql.page, "khoi-nguon-phu-huynh")],
  });
});

/** Mở Sheet «Gán nguồn» của phiếu (nút «Đổi nguồn của lead này»), chọn nguồn mới, nhập lý do, bấm «Lưu nguồn mới». Trả toast/lỗi hiện ra; KHÔNG kết luận gì — người gọi đo kết quả ở khối Nguồn. */
async function doiNguonQuaSheet(page: Page, o: { nguonMoi: RegExp; lyDo: string; giaiTrinh?: string }): Promise<{ thongBao: string }> {
  const nut = page.getByRole("button", { name: "Đổi nguồn của lead này" });
  await expect(nut).toBeVisible({ timeout: 60_000 });
  const sheet = await moHopThoai(page, nut);
  await expect(sheet.getByText("Gán nguồn")).toBeVisible({ timeout: 30_000 });
  const ds = await moOChonNguon(sheet);
  await ds.getByRole("option", { name: o.nguonMoi }).first().click();
  if (o.giaiTrinh) await sheet.getByLabel("Giải trình nguồn").fill(o.giaiTrinh);
  await sheet.getByLabel(/Lý do đổi nguồn/).fill(o.lyDo);
  await sheet.getByRole("button", { name: "Lưu nguồn mới" }).click();
  const toast = page.getByText(/Đã đổi nguồn sang/).first();
  await expect(toast).toBeVisible({ timeout: 60_000 });
  return { thongBao: (await toast.innerText()).replace(/\s+/g, " ") };
}

test("[SRC-09] Đổi nguồn TRƯỚC thanh toán (QLCS có leads:overwrite): bắt lý do ≥ 10 ký tự, đổi được, nguồn mới + nhật ký hiện đúng, Sale phụ trách không đổi", async ({ ca, moVai }) => {
  const href = docTrangThai(DOT, "lead-nhan-su");
  canCo(ca, href, "Chưa có phiếu của SRC-06 trong lượt chạy này — chạy SRC-06 trước.");
  const ql = await moVai("giamdoc");
  const page = ql.page;
  const actor = nhanActor("giamdoc");
  const truoc = await docKhoiNguon(page, href);
  const saleTruoc = await docThongTin(page, "SALE PHỤ TRÁCH");
  ca.thongTin(actor, "Trước khi đổi nguồn", { nguon: truoc.truong["Nguồn"], nguoiGioiThieu: truoc.truong["Người giới thiệu"], saleTruoc });
  if (!/Nguồn từ nhân sự giới thiệu/.test(truoc.truong["Nguồn"] ?? "")) ca.biChan(`Phiếu của SRC-06 không còn nguồn «nhân sự giới thiệu» (đang là «${truoc.truong["Nguồn"]}») — đã đổi ở lượt trước.`);

  // Từ chối: lý do ngắn (< 10 ký tự) — hộp thoại phải báo lỗi và KHÔNG đổi.
  const nut = page.getByRole("button", { name: "Đổi nguồn của lead này" });
  if (!(await coThay(nut, 30_000))) ca.biChan("QLCS không thấy nút «Đổi nguồn của lead này» trên phiếu CS1: thiếu `leads:overwrite` cho vai này trên test (xem SRC-18 cho phép thử âm).");
  const sheet = await moHopThoai(page, nut);
  const ds = await moOChonNguon(sheet);
  await ds.getByRole("option", { name: /Nguồn từ Quảng Cáo/ }).first().click();
  await sheet.getByLabel(/Lý do đổi nguồn/).fill("ngắn");
  await sheet.getByRole("button", { name: "Lưu nguồn mới" }).click();
  const loiNgan = sheet.getByRole("alert").filter({ hasText: /lý do|ký tự/i }).first();
  const thayLoi = await coThay(loiNgan, 15_000);
  ca.buoc({ actor, action: "Đổi nguồn với lý do 5 ký tự", input: "ngắn", expected: "bị chặn: có lỗi lý do, Sheet vẫn mở", actual: { thayLoi, loi: thayLoi ? (await loiNgan.innerText()).replace(/\s+/g, " ") : null }, pass: thayLoi, screenshots: [await ca.chup(page, "doi-nguon-ly-do-ngan", { fullPage: false })] });
  await page.keyboard.press("Escape");

  // Đủ lý do ⇒ đổi được.
  await di(page, href);
  const lyDo = `${tenDuLieu(DOT, "doi nguon truoc thanh toan")} — phụ huynh xác nhận khách đến từ quảng cáo, không phải nhân sự giới thiệu`;
  const kq = await doiNguonQuaSheet(page, { nguonMoi: /Nguồn từ Quảng Cáo/, lyDo });
  ca.buoc({ actor, action: "Đổi nguồn «nhân sự giới thiệu» → «Quảng Cáo» với lý do đủ dài", input: { lyDo }, expected: "toast «Đã đổi nguồn sang …» (không có cảnh báo đã thu tiền)", actual: kq.thongBao, pass: /Quảng Cáo/.test(kq.thongBao) });
  const sau = await docKhoiNguon(page, href);
  const saleSau = await docThongTin(page, "SALE PHỤ TRÁCH");
  ca.buoc({
    actor,
    action: "Đọc lại khối «Nguồn» sau khi đổi",
    input: href,
    expected: { nguon: "Nguồn từ Quảng Cáo", nguoiGioiThieu: "Không có (không còn người của nguồn cũ)" },
    actual: { nguon: sau.truong["Nguồn"], nguoiGioiThieu: sau.truong["Người giới thiệu"] },
    pass: /Nguồn từ Quảng Cáo/.test(sau.truong["Nguồn"] ?? "") && /Không có/.test(sau.truong["Người giới thiệu"] ?? ""),
    screenshots: [await ca.chup(page, "khoi-nguon-sau-doi")],
  });
  ca.buoc({ actor, action: "Đổi nguồn KHÔNG đổi Sale phụ trách (hai thứ độc lập)", input: null, expected: saleTruoc, actual: saleSau, pass: saleTruoc !== null && saleSau === saleTruoc });
  luuTrangThai(DOT, "sale-sau-doi-nguon", saleSau ?? "");
  luuTrangThai(DOT, "ly-do-doi-nguon", lyDo);
});

// SĐT của lead fixture «Bé … DRIFT» (`phoneHangCho("DRIFT")` ở lib/uat/nguon-final.ts: `09905` + số thứ tự). Hằng số chép tay vì ca UAT không import mã ứng dụng; lưới `[UTH-W1]` đối chiếu với nguồn.
const SDT_LEAD_DA_THU = "0990500001";
const TEN_HOC_VIEN_DA_THU = "Bé UAT SOURCE FINAL DRIFT";

test("[SRC-09b] Đổi nguồn SAU thanh toán (Admin có sources:override-after-payment): cảnh báo đã thu · đổi được · SỔ HOA HỒNG không bị sửa · nhật ký DOI_NGUON_SAU_THU", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  const href = await timPhieuTheoSdt(page, SDT_LEAD_DA_THU);
  canCo(ca, href, `Không thấy lead fixture đã thu (SĐT ${SDT_LEAD_DA_THU}) — bộ nạp UAT SOURCE FINAL lần 2 (sau khi bật engine) chưa chạy.`);
  const truocSo = await chupSo(page, TEN_HOC_VIEN_DA_THU);
  if (truocSo.length === 0) ca.biChan(`Sổ hoa hồng chưa có dòng nào của «${TEN_HOC_VIEN_DA_THU}» (engine chưa ghi sổ) — không có gì để đối chiếu "sổ không bị sửa".`);
  const truocNguon = await docKhoiNguon(page, href);
  ca.thongTin(actor, "Trước khi đổi nguồn", { nguon: truocNguon.truong["Nguồn"], soDongSo: truocSo.length });

  // Mở Sheet và đọc cảnh báo «đã có khoản thu» TRƯỚC khi lưu.
  const nut = page.getByRole("button", { name: "Đổi nguồn của lead này" });
  if (!(await coThay(nut, 45_000))) ca.biChan("Admin không thấy nút «Đổi nguồn của lead này» trên lead đã thu: thiếu `sources:override-after-payment` hoặc `leads:overwrite`.");
  const sheet = await moHopThoai(page, nut);
  const canhBao = sheet.getByRole("status").filter({ hasText: /khoản thu/ }).first();
  const thayCanhBao = await coThay(canhBao, 30_000);
  const chuCanhBao = thayCanhBao ? (await canhBao.innerText()).replace(/\s+/g, " ") : "";
  ca.buoc({ actor, action: "Sheet «Gán nguồn» của lead ĐÃ thu tiền có cảnh báo «đã có N khoản thu … các dòng hoa hồng đã tính không bị sửa»", input: href, expected: "có cảnh báo nhắc khoản thu + «không bị sửa»", actual: chuCanhBao, pass: thayCanhBao && /không bị sửa/.test(chuCanhBao), screenshots: [await ca.chup(page, "sheet-doi-nguon-da-thu", { fullPage: false })] });
  const nguonMoi = /Nguồn từ sự kiện/.test(truocNguon.truong["Nguồn"] ?? "") ? /Nguồn KH tự đến/ : /Nguồn từ sự kiện/; // KHÔNG «Nguồn từ đối tác»: nguồn ấy bắt buộc chọn đối tác, nút «Lưu nguồn mới» không gửi (đo 20/10/2026)
  const ds = await moOChonNguon(sheet);
  await ds.getByRole("option", { name: nguonMoi }).first().click();
  const lyDo = `${tenDuLieu(DOT, "doi nguon sau thanh toan")} — kiểm tra đổi nguồn sau thu tiền chỉ ghi nhận, không sửa sổ`;
  await sheet.getByLabel(/Lý do đổi nguồn/).fill(lyDo);
  await sheet.getByRole("button", { name: "Lưu nguồn mới" }).click();
  const toast = page.getByText(/Đã đổi nguồn sang/).first();
  if (!(await coThay(toast, 60_000))) {
    // Không có toast thành công: ghi NGUYÊN VĂN thứ đang hiện (toast lỗi / thông báo trong sheet) để phân biệt «lead đã đổi nguồn ở lượt chạy trước» với lỗi thật.
    const dangHien = (await page.locator("[data-sonner-toast], [role=alert], [role=dialog]").allInnerTexts()).join(" | ").replace(/\s+/g, " ").slice(0, 600);
    ca.buoc({ actor, action: "Lưu nguồn mới của lead đã thu: chờ toast «Đã đổi nguồn sang …»", input: { lyDo, nguonTruoc: truocNguon.truong["Nguồn"] }, expected: "toast «Đã đổi nguồn sang …»", actual: dangHien, pass: false, screenshots: [await ca.chup(page, "khong-thay-toast-doi-nguon", { fullPage: false })] });
    return;
  }
  const thongBaoThu = page.getByText(/Lead đã có khoản thu/).first();
  const coThongBaoThu = await coThay(thongBaoThu, 10_000);
  ca.buoc({ actor, action: "Lưu: có toast đổi nguồn và toast «Lead đã có khoản thu — thay đổi được ghi nhận để điều chỉnh hoa hồng»", input: { lyDo }, expected: "cả hai toast", actual: { doiNguon: (await toast.innerText()).replace(/\s+/g, " "), ghiNhanDieuChinh: coThongBaoThu }, pass: coThongBaoThu });

  const sauNguon = await docKhoiNguon(page, href);
  ca.buoc({ actor, action: "Khối «Nguồn» của lead đã thu hiện nguồn MỚI", input: href, expected: "khác nguồn cũ", actual: { truoc: truocNguon.truong["Nguồn"], sau: sauNguon.truong["Nguồn"] }, pass: !!sauNguon.truong["Nguồn"] && sauNguon.truong["Nguồn"] !== truocNguon.truong["Nguồn"], screenshots: [await ca.chup(page, "khoi-nguon-sau-doi-da-thu")] });
  const sauSo = await chupSo(page, TEN_HOC_VIEN_DA_THU);
  const matDoi = dongCuBiDoi(truocSo, sauSo);
  ca.buoc({ actor, action: "SỔ hoa hồng của học viên KHÔNG bị sửa sau đổi nguồn (mọi dòng cũ còn nguyên văn, không thêm dòng)", input: null, expected: { dongCuBiMatHoacDoi: 0, soDongSau: truocSo.length }, actual: { dongCuBiMatHoacDoi: matDoi.length, soDongSau: sauSo.length, matDoi }, pass: matDoi.length === 0 && sauSo.length === truocSo.length });
  luuTrangThai(DOT, "lead-da-thu", href);
  luuTrangThai(DOT, "ly-do-doi-nguon-sau-thu", lyDo);
});

test("[SRC-10] Import Excel lead: «Nguồn của cả file» BẮT BUỘC chọn trước khi nhập — nút nhập khoá tới khi chọn; xem trước đếm đúng; cả hai lead tạo ra mang ĐÚNG nguồn đã chọn (Sale CS1 → Admin đọc lại)", async ({ ca, moVai }) => {
  const sale = await moVai("sale1");
  const page = sale.page;
  const sdtA = soDienThoaiThu(DOT, 31);
  const sdtB = soDienThoaiThu(DOT, 32);
  const tenA = tenDuLieu(DOT, "Excel nguồn cả file A");
  const tenB = tenDuLieu(DOT, "Excel nguồn cả file B");
  const tep = await taoXlsxNhapLead([
    { "Tên phụ huynh": tenA, "SĐT": sdtA },
    { "Tên phụ huynh": tenB, "SĐT": sdtB },
    { "Tên phụ huynh": tenDuLieu(DOT, "Excel SĐT sai"), "SĐT": "12345" },
  ]);
  const xemTruoc = await taiTepNhapLead(page, tep);
  ca.buoc({ actor: nhanActor("sale1"), action: "Tải tệp 3 dòng (2 hợp lệ · 1 SĐT sai) bằng ô chọn tệp", input: { dong: 3 }, expected: { hopLe: 2, loi: 1 }, actual: { hopLe: xemTruoc.hopLe, loi: xemTruoc.loi }, pass: xemTruoc.hopLe === 2 && xemTruoc.loi === 1, screenshots: [await ca.chup(page, "xem-truoc-excel")] });
  if (xemTruoc.hopLe !== 2) return;
  // CHƯA chọn «Nguồn của cả file»: nút nhập phải khoá và câu giải thích phải hiện NGAY CẠNH nút (nút xám mà không nói vì sao là affordance nói dối).
  const khoaNut = await page.getByRole("button", { name: /^Nhập \d+ dòng/ }).isDisabled();
  const cauKhoa = (await page.getByTestId("khong-cho-nhap").innerText().catch(() => "")).replace(/\s+/g, " ");
  ca.buoc({ actor: nhanActor("sale1"), action: "Chưa chọn «Nguồn của cả file»: nút «Nhập 2 dòng» bị khoá và có câu nói vì sao", input: null, expected: { nutKhoa: true, cau: "nhắc chọn «Nguồn của cả file»" }, actual: { nutKhoa: khoaNut, cau: cauKhoa }, pass: khoaNut && /Nguồn của cả file/.test(cauKhoa), screenshots: [await ca.chup(page, "excel-chua-chon-nguon", { fullPage: false })] });
  const ketQua = await bamNhapVaDocKetQua(page, /Nguồn từ Quảng Cáo/);
  ca.buoc({ actor: nhanActor("sale1"), action: "Chọn nguồn «Nguồn từ Quảng Cáo» cho cả file, bấm «Nhập 2 dòng»: màn kết quả báo «2 Tạo mới», 0 lỗi", input: null, expected: "Tạo mới 2 · Lỗi 0", actual: ketQua.slice(ketQua.indexOf("Tạo mới") - 2, ketQua.indexOf("Tạo mới") + 160), pass: /2 Tạo mới/.test(ketQua) && /0 Lỗi/.test(ketQua), screenshots: [await ca.chup(page, "ket-qua-excel")] });

  const ad = await moVai("admin");
  const hrefA = await timPhieuTheoSdt(ad.page, sdtA);
  const hrefB = await timPhieuTheoSdt(ad.page, sdtB);
  ca.buoc({ actor: nhanActor("admin"), action: "Cả hai lead của tệp đã nằm trong danh sách lead (tìm theo SĐT)", input: { sdtA, sdtB }, expected: "thấy cả hai", actual: { a: hrefA, b: hrefB }, pass: !!hrefA && !!hrefB });
  if (!hrefA || !hrefB) return;
  const kA = await docKhoiNguon(ad.page, hrefA, tenA);
  const kB = await docKhoiNguon(ad.page, hrefB, tenB);
  ca.buoc({ actor: nhanActor("admin"), action: "CẢ HAI lead mang nguồn đã chọn ở ô «Nguồn của cả file» — «Nguồn từ Quảng Cáo»", input: { hrefA, hrefB }, expected: "Nguồn từ Quảng Cáo ở cả hai", actual: { a: kA.truong["Nguồn"], b: kB.truong["Nguồn"] }, pass: /Nguồn từ Quảng Cáo/.test(kA.truong["Nguồn"] ?? "") && /Nguồn từ Quảng Cáo/.test(kB.truong["Nguồn"] ?? ""), screenshots: [await ca.chup(ad.page, "nguon-ca-file-quang-cao")] });
});

test("[SRC-11] File Excel CŨ còn cột «Nguồn» + «Mã NV giới thiệu»: hai cột đó KHÔNG còn quyết nguồn — lead mang nguồn của ô «Nguồn của cả file», kết quả có cảnh báo «Mã NV giới thiệu … KHÔNG được áp dụng», KHÔNG vào «Cần xem tay» vì mã sai", async ({ ca, moVai }) => {
  const sale = await moVai("sale1");
  const page = sale.page;
  const sdt = soDienThoaiThu(DOT, 33);
  const ten = tenDuLieu(DOT, "Excel file cũ mã NV");
  const MA_CU = "ZZ.XX.999";
  const tep = await taoXlsxNhapLead([{ "Tên phụ huynh": ten, "SĐT": sdt, "Nguồn": "Ads", "Mã NV giới thiệu": MA_CU }], ["Nguồn", "Mã NV giới thiệu"]);
  const xemTruoc = await taiTepNhapLead(page, tep);
  ca.buoc({ actor: nhanActor("sale1"), action: "Tải tệp CŨ 1 dòng (còn cột «Nguồn» = Ads và «Mã NV giới thiệu» không có trong hệ thống)", input: { ma: MA_CU }, expected: { hopLe: 1, loi: 0 }, actual: { hopLe: xemTruoc.hopLe, loi: xemTruoc.loi }, pass: xemTruoc.hopLe === 1 && xemTruoc.loi === 0, screenshots: [await ca.chup(page, "xem-truoc-file-cu")] });
  if (xemTruoc.hopLe !== 1) return;
  const ketQua = await bamNhapVaDocKetQua(page, /Nguồn KH tự đến/);
  ca.buoc({
    actor: nhanActor("sale1"),
    action: "Chọn «Nguồn KH tự đến» cho cả file, nhập: lead tạo mới, cảnh báo nói cột Mã NV giới thiệu KHÔNG được áp dụng",
    input: null,
    expected: "1 Tạo mới · cảnh báo «Mã NV giới thiệu … KHÔNG được áp dụng»",
    actual: ketQua.slice(ketQua.indexOf("Tạo mới") - 2, ketQua.indexOf("Tạo mới") + 480),
    pass: /1 Tạo mới/.test(ketQua) && /Mã NV giới thiệu/.test(ketQua) && /KHÔNG được áp dụng/.test(ketQua),
    screenshots: [await ca.chup(page, "ket-qua-file-cu")],
  });

  const ad = await moVai("admin");
  const href = await timPhieuTheoSdt(ad.page, sdt);
  canCo(ca, href, `Không tìm thấy lead vừa nhập (SĐT ${sdt}).`);
  const k = await docKhoiNguon(ad.page, href, ten);
  ca.buoc({
    actor: nhanActor("admin"),
    action: "Khối «Nguồn» của lead: nguồn là «Nguồn KH tự đến» (ô chọn quyết, KHÔNG phải nhãn «Ads» trong file), không có dấu «Mã NV sai»",
    input: href,
    expected: { nguon: "Nguồn KH tự đến", maSai: false },
    actual: { chu: k.chu.slice(0, 420), nguon: k.truong["Nguồn"] },
    pass: /Nguồn KH tự đến/.test(k.truong["Nguồn"] ?? "") && !/Quảng Cáo/.test(k.truong["Nguồn"] ?? "") && !k.chu.includes(MA_CU),
    screenshots: [await ca.chup(ad.page, "khoi-nguon-file-cu")],
  });
});
test("[SRC-14] Sale phụ trách ĐỘC LẬP với người giới thiệu: gán lại Sale (QLCS) không đổi nguồn/người giới thiệu của phiếu «phụ huynh giới thiệu» (SRC-07) — đối chứng chiều kia ở SRC-09", async ({ ca, moVai }) => {
  const href = docTrangThai(DOT, "lead-phu-huynh");
  canCo(ca, href, "Chưa có phiếu của SRC-07 trong lượt chạy này — chạy SRC-07 trước.");
  const ql = await moVai("giamdoc");
  const page = ql.page;
  const actor = nhanActor("giamdoc");
  const truoc = await docKhoiNguon(page, href);
  const sale0 = await docThongTin(page, "SALE PHỤ TRÁCH");
  ca.buoc({ actor, action: "Phiếu có đồng thời người giới thiệu và Sale phụ trách (hai trường khác nhau)", input: href, expected: "cả hai đều có giá trị", actual: { nguoiGioiThieu: truoc.truong["Người giới thiệu"], sale: sale0 }, pass: !!truoc.truong["Người giới thiệu"] && !/^Không có/.test(truoc.truong["Người giới thiệu"]) && !!sale0 && sale0 !== "Chưa gán" });
  const oGan = page.locator("select").filter({ has: page.locator("option", { hasText: "Gán cho…" }) }).first();
  await choHydrate(oGan);
  const lua = (await oGan.locator("option").allInnerTexts()).map((t) => t.trim()).filter((t) => t !== "" && !/^Gán cho/.test(t) && t !== sale0);
  if (lua.length === 0) ca.biChan(`Không có Sale CS1 nào khác (${sale0}) trong ô «Gán cho…» để gán lại.`);
  const moi = lua.find((t) => /\(3\)/.test(t)) ?? lua[0]!;
  await oGan.selectOption({ label: moi });
  await expect.poll(async () => {
    await di(page, href);
    await expect(page.locator("main")).toContainText(/Sale phụ trách/i, { timeout: 60_000 });
    return await docThongTin(page, "SALE PHỤ TRÁCH");
  }, { timeout: 90_000, intervals: [2_000, 4_000] }).toBe(moi);
  const sau = await docKhoiNguon(page, href);
  ca.buoc({ actor, action: `Gán lại Sale phụ trách sang «${moi}»`, input: { tu: sale0, sang: moi }, expected: "Sale phụ trách đổi; nguồn + người giới thiệu GIỮ NGUYÊN", actual: { sale: moi, nguon: sau.truong["Nguồn"], nguoiGioiThieu: sau.truong["Người giới thiệu"] }, pass: sau.truong["Nguồn"] === truoc.truong["Nguồn"] && sau.truong["Người giới thiệu"] === truoc.truong["Người giới thiệu"], screenshots: [await ca.chup(page, "sau-gan-lai-sale")] });
  // Chiều ngược: SRC-09 đã đổi nguồn mà Sale phụ trách của phiếu (SRC-06) không đổi (bước đo ở chính SRC-09, ghi lại ở đây để cùng một bảng bằng chứng).
  const saleSauDoiNguon = docTrangThai(DOT, "sale-sau-doi-nguon");
  ca.thongTin(actor, "Chiều ngược (đã đo ở SRC-09): đổi nguồn không đổi Sale phụ trách", { saleSauDoiNguon: saleSauDoiNguon ?? "(SRC-09 chưa chạy trong lượt này)" });
});

test("[SRC-18] Ghi trực tiếp bị chặn: người XEM được lead cơ sở khác nhưng KHÔNG có quyền ghi thì không đổi được nguồn (Marketing HO → lead CS2); đối chứng dương QLCS CS1 → lead CS1 và Admin → lead CS2", async ({ ca, moVai }) => {
  const sale2 = await moVai("sale2");
  const ten = tenDuLieu(DOT, "Lead CS2 thử cổng ghi");
  const sdt = soDienThoaiThu(DOT, 23);
  const r = await nhapPhieu(ca, sale2.page, { ten, sdt, nguon: /Nguồn KH tự đến/ });
  if (r.trung) ca.biChan(`SĐT thử ${sdt} đã thuộc một khách khác trên test («${r.ghiChu}»).`);
  ca.buoc({ actor: nhanActor("sale2"), action: "Sale CS2 nhập một phiếu mới (lead CS2) để đo cổng ghi", input: { ten, sdt }, expected: "phiếu được tạo", actual: { ghiChu: r.ghiChu, href: r.href }, pass: r.daTao && r.href !== null });
  if (!r.href) return;
  luuTrangThai(DOT, "lead-cs2", r.href);
  const hrefCs1 = docTrangThai(DOT, "lead-nhan-su");
  canCo(ca, hrefCs1, "Chưa có phiếu CS1 của SRC-06 trong lượt chạy này — chạy SRC-06 trước (cần làm đối chứng dương).");

  // Đối chứng DƯƠNG 1: QLCS CS1 trên lead CS1 THẤY nút (có quyền ghi tại cơ sở của lead).
  const ql = await moVai("giamdoc");
  await docKhoiNguon(ql.page, hrefCs1);
  const nutQl = await coThay(ql.page.getByRole("button", { name: "Đổi nguồn của lead này" }), 30_000);
  ca.buoc({ actor: nhanActor("giamdoc"), action: "ĐỐI CHỨNG DƯƠNG — QLCS CS1 mở lead CS1: có nút «Đổi nguồn của lead này»", input: hrefCs1, expected: "có nút", actual: nutQl ? "có nút" : "không có nút", pass: nutQl, screenshots: [await ca.chup(ql.page, "qlcs-cs1-lead-cs1", { fullPage: false })] });

  // Đối chứng DƯƠNG 2: Admin (quyền toàn hệ thống) trên lead CS2 THẤY nút — quyền ghi là thuộc tính của VAI, không do «xem được».
  const ad = await moVai("admin");
  await docKhoiNguon(ad.page, r.href);
  const nutAd = await coThay(ad.page.getByRole("button", { name: "Đổi nguồn của lead này" }), 30_000);
  ca.buoc({ actor: nhanActor("admin"), action: "ĐỐI CHỨNG DƯƠNG — Admin mở lead CS2: có nút «Đổi nguồn của lead này»", input: r.href, expected: "có nút", actual: nutAd ? "có nút" : "không có nút", pass: nutAd });

  // DENY: Marketing HO xem được lead CS2 (leads:view-all) và đọc được khối «Nguồn» (sources:view), nhưng KHÔNG có leads:overwrite ⇒ không nút + câu nêu khoá còn thiếu.
  const mk = await moVai("marketing");
  const khoi = await docKhoiNguon(mk.page, r.href, ten);
  const nutMk = await coThay(mk.page.getByRole("button", { name: "Đổi nguồn của lead này" }), 8_000);
  const chuTuChoi = (await mk.page.locator("section[aria-labelledby='khoi-nguon-tieu-de']").innerText()).replace(/\s+/g, " ");
  ca.buoc({
    actor: nhanActor("marketing"),
    action: "DENY — Marketing HO XEM được lead CS2 (khối «Nguồn» hiện) nhưng KHÔNG có nút «Đổi nguồn» và có câu «Không đổi được nguồn lead này. Quyền cần có: …»",
    input: r.href,
    expected: { thayKhoiNguon: true, coNut: false, cauTuChoi: "nêu leads:overwrite" },
    actual: { thayKhoiNguon: khoi.co, coNut: nutMk, cauTuChoi: /Không đổi được nguồn lead này\. Quyền cần có/.test(chuTuChoi) ? chuTuChoi.slice(chuTuChoi.indexOf("Không đổi được"), chuTuChoi.indexOf("Không đổi được") + 120) : null },
    pass: khoi.co && !nutMk && /Không đổi được nguồn lead này\. Quyền cần có:[^.]*leads:overwrite/.test(chuTuChoi),
    screenshots: [await ca.chup(mk.page, "marketing-lead-cs2-bi-chan")],
  });

  // Cách ly ĐỌC (không phải cổng ghi): QLCS CS1 mở thẳng lead CS2 theo id ⇒ không thấy. Ghi lại để phân biệt hai lớp (visibility ≠ write authority).
  await di(ql.page, r.href);
  await ql.page.waitForLoadState("domcontentloaded");
  const thayTen = await coThay(ql.page.getByText(ten).first(), 12_000);
  ca.buoc({ actor: nhanActor("giamdoc"), action: "(lớp ĐỌC, ghi để phân biệt) QLCS CS1 mở thẳng lead CS2 theo id: KHÔNG thấy nội dung", input: r.href, expected: "không thấy tên lead", actual: thayTen ? "thấy tên lead" : "không thấy", pass: !thayTen, screenshots: [await ca.chup(ql.page, "qlcs-cs1-mo-lead-cs2", { fullPage: false })] });
});

test("[SRC-18b] Cổng GHI ở tầng máy chủ (`kiemQuyenGhiTaiCoSo`): gửi thẳng Server Action đổi nguồn tới lead cơ sở khác — BLOCKED_NO_UI", async ({ ca }) => {
  ca.biChan("BLOCKED_NO_UI: cổng `kiemQuyenGhiTaiCoSo` (lib/nguon/quyen-ghi-tai-co-so.ts) chặn ở Server Action `doiNguonLeadAction`; giao diện không có đường gửi hành động tới lead mà vai không thấy nút (SRC-18 đã đo lớp giao diện). Bằng chứng máy: lib/nguon/quyen-ghi-tai-co-so.test.ts và tests/hoa-hong/ (phiên PR #794).");
});

test("[SRC-22] Audit / lịch sử nguồn: các lần đổi nguồn của SRC-09/09b hiện ở «Khiếu nại & lịch sử › Đổi nguồn» (từ → sang · người · giờ · lý do) và ở Audit Log (DOI_NGUON · DOI_NGUON_SAU_THU)", async ({ ca, moVai }) => {
  const lyDo1 = docTrangThai(DOT, "ly-do-doi-nguon");
  const lyDo2 = docTrangThai(DOT, "ly-do-doi-nguon-sau-thu");
  if (!lyDo1 && !lyDo2) ca.biChan("Không có lần đổi nguồn nào của SRC-09/09b trong lượt chạy này — chạy SRC-09 (và SRC-09b) trước.");
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  await di(page, "/nguon-hoa-hong/khieu-nai?con=doi-nguon");
  if (!(await coThay(page.getByText(/mục · mới nhất trước/), 90_000))) ca.biChan("Tab con «Đổi nguồn» không có danh sách (engine tắt hoặc thiếu quyền).");
  const chu = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const kiem = [
    { ten: "lần đổi TRƯỚC thu tiền (SRC-09)", lyDo: lyDo1, tuSang: /Nguồn từ nhân sự giới thiệu → Nguồn từ Quảng Cáo/, nguoi: /UAT — Giám đốc cơ sở 1/ },
    { ten: "lần đổi SAU thu tiền (SRC-09b)", lyDo: lyDo2, tuSang: /→ Nguồn từ sự kiện|→ Nguồn từ đối tác|→ Nguồn KH tự đến/, nguoi: /UAT — Quản trị hệ thống/ },
  ];
  for (const k of kiem) {
    if (!k.lyDo) {
      ca.thongTin(actor, `${k.ten}: không đo (ca tạo ra nó chưa chạy trong lượt này)`, null);
      continue;
    }
    const khoiXung = chu.indexOf(k.lyDo);
    const vung = khoiXung >= 0 ? chu.slice(Math.max(0, khoiXung - 400), khoiXung + k.lyDo.length) : "";
    ca.buoc({ actor, action: `Lịch sử «Đổi nguồn» có ${k.ten}: từ → sang, người đổi, giờ, lý do nguyên văn`, input: k.lyDo, expected: "thấy lý do, mũi tên từ → sang, tên người đổi, ngày giờ", actual: vung.slice(-420), pass: khoiXung >= 0 && k.tuSang.test(vung) && k.nguoi.test(vung) && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(vung), screenshots: khoiXung >= 0 ? [await ca.chup(page, "lich-su-doi-nguon")] : [] });
  }
  for (const [hanhDong, lyDo, ten] of [["DOI_NGUON", lyDo1, "trước thu"], ["DOI_NGUON_SAU_THU", lyDo2, "sau thu"]] as const) {
    if (!lyDo) continue;
    // Lọc bằng ô «Hành động» + «Tìm trong lý do» (chuỗi duy nhất của lượt chạy này) — KHÔNG đếm trên danh sách chưa lọc.
    const mau = lyDo.split(" — ")[0]!;
    const dong = await locAuditLog(page, { hanhDong, lyDo: mau });
    ca.buoc({ actor, action: `Audit Log lọc «${hanhDong}» + lý do «${mau}» ⇒ đúng dòng của lần đổi nguồn ${ten}`, input: { hanhDong, mau }, expected: "đúng 1 dòng, hành động khớp", actual: { soDong: dong.length, dong: dong[0]?.slice(0, 200) }, pass: dong.length === 1 && dong[0]!.includes(hanhDong), screenshots: [await ca.chup(page, `audit-${hanhDong.toLowerCase()}`, { fullPage: false })] });
  }
});

test("[SRC-08] Chủ nguồn: người phụ trách HIỆN TẠI và LỊCH SỬ hiệu lực của nguồn mặc định PAID_ADS và nguồn tuỳ biến UAT_SF_TUY_BIEN (Admin, Marketing xem)", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const mk = await moVai("marketing");
  const doc = async (p: Page, ma: string): Promise<string> => {
    await di(p, DUONG_DAN.chiTiet(ma));
    await expect(p.getByText("Người phụ trách").first()).toBeVisible({ timeout: 90_000 });
    return (await p.locator("main").innerText()).replace(/\s+/g, " ");
  };
  const ma = "HO.MKT.001";
  const tuyBien = await doc(ad.page, "UAT_SF_TUY_BIEN");
  ca.buoc({ actor: nhanActor("admin"), action: "Nguồn tuỳ biến UAT_SF_TUY_BIEN: «Người phụ trách» = uat.marketing (HO.MKT.001) và cửa sổ ghi công RIÊNG 60 ngày", input: "UAT_SF_TUY_BIEN", expected: { nguoiPhuTrach: ma, cuaSo: "60 ngày (cửa sổ riêng của nguồn này)" }, actual: { coNguoi: tuyBien.includes(`Người phụ trách UAT — Marketing Hội sở (${ma})`), cuaSo60: /60 ngày kể từ lúc lead vào \(cửa sổ riêng của nguồn này\)/.test(tuyBien) }, pass: tuyBien.includes(`Người phụ trách UAT — Marketing Hội sở (${ma})`) && /60 ngày kể từ lúc lead vào \(cửa sổ riêng của nguồn này\)/.test(tuyBien), screenshots: [await ca.chup(ad.page, "chu-nguon-tuy-bien")] });

  const paid = await doc(ad.page, "PAID_ADS");
  const coChu = paid.includes(`Người phụ trách UAT — Marketing Hội sở (${ma})`);
  // Lịch sử hiệu lực: chủ nguồn có NGÀY HIỆU LỰC (đổi chủ hẹn trước) ⇒ trang nói «Đã hẹn đổi chủ: từ DD/MM/YYYY …» hoặc «Chủ nguồn đã có LỊCH SỬ …» (không chụp lại hồi tố).
  const hen = /Đã hẹn đổi chủ: từ (\d{2}\/\d{2}\/\d{4})/.exec(paid)?.[1] ?? null;
  const lichSu = /Nguồn này đã có LỊCH SỬ chủ nguồn/.test(paid);
  ca.buoc({ actor: nhanActor("admin"), action: "Nguồn PAID_ADS: chủ nguồn hiện tại + LỊCH SỬ có ngày hiệu lực (không hồi tố lên lead cũ)", input: "PAID_ADS", expected: { nguoiPhuTrach: ma, lichSuCoNgayHieuLuc: true }, actual: { coChu, henDoiChuTu: hen, nhacLichSu: lichSu }, pass: coChu && (hen !== null || lichSu), screenshots: [await ca.chup(ad.page, "chu-nguon-paid-ads")] });

  const mkThay = await doc(mk.page, "UAT_SF_TUY_BIEN");
  ca.buoc({ actor: nhanActor("marketing"), action: "Marketing (HO) cũng đọc được chủ nguồn của nguồn tuỳ biến (cùng giá trị)", input: "UAT_SF_TUY_BIEN", expected: `Người phụ trách … (${ma})`, actual: mkThay.includes(`Người phụ trách UAT — Marketing Hội sở (${ma})`), pass: mkThay.includes(`Người phụ trách UAT — Marketing Hội sở (${ma})`) });
});

test("[SRC-17] Hiển thị TIỀN theo quyền: Kế toán thấy mọi dòng + tổng (đối chứng dương); Sale chỉ thấy dòng CỦA MÌNH; Giáo vụ không có dòng nào («Bạn chưa có dòng hoa hồng nào»); Sale không thấy khối «Nguồn», khối «Nguồn» của QLCS không mang số tiền", async ({ ca, moVai, dot }) => {
  const docDong = async (p: Page): Promise<string[]> => {
    await di(p, DUONG_SO_TAT_CA());
    await expect(p.getByRole("heading", { name: "Sổ hoa hồng", exact: true })).toBeVisible({ timeout: 90_000 });
    await coThay(p.locator("tbody tr").first().or(p.getByText(/Bạn chưa có dòng hoa hồng nào/)), 60_000);
    return p.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
  };
  const kt = await moVai("ketoan");
  const dongKt = (await docDong(kt.page)).filter((d) => d.includes("Bé UAT SOURCE FINAL"));
  const nguoiKt = new Set(dongKt.map((d) => /UAT — [^|]*?(?= (?:Sale Admin|Sale|Marketing|Quản lý cơ sở|Điều chỉnh))/.exec(d)?.[0] ?? "?"));
  ca.buoc({ actor: nhanActor("ketoan"), action: "ĐỐI CHỨNG DƯƠNG — Kế toán Hội sở mở Sổ: thấy dòng của NHIỀU người hưởng (Sale · Sale Admin · Marketing · QLCS) với số tiền", input: DUONG_SO_TAT_CA(), expected: "≥ 8 dòng của bộ fixture, ≥ 4 người hưởng khác nhau, có số tiền", actual: { soDong: dongKt.length, nguoi: [...nguoiKt] }, pass: dongKt.length >= 8 && nguoiKt.size >= 4 && dongKt.every((d) => /\d[\d.]*đ/.test(d)), screenshots: [await ca.chup(kt.page, "so-ketoan", { fullPage: false })] });

  const sale = await moVai("sale1");
  const dongSale = await docDong(sale.page);
  const laCuaToi = (d: string): boolean => /UAT — Tư vấn viên CS1(?! \()/.test(d) && !/Giám đốc cơ sở|Kinh doanh Hội sở|Tư vấn viên CS1 \(/.test(d);
  ca.buoc({ actor: nhanActor("sale1"), action: "Sale (chỉ commission:view-self) mở Sổ: mọi dòng là của CHÍNH MÌNH, KHÔNG có dòng của QLCS / Sale Admin / Marketing / Sale khác", input: DUONG_SO_TAT_CA(), expected: "≥ 1 dòng, tất cả là của mình", actual: { soDong: dongSale.length, khongPhaiCuaToi: dongSale.filter((d) => !laCuaToi(d)).slice(0, 2) }, pass: dongSale.length >= 1 && dongSale.every(laCuaToi), screenshots: [await ca.chup(sale.page, "so-sale1", { fullPage: false })] });
  const coTabHangCho = await coThay(sale.page.getByRole("link", { name: /Cần xử lý/ }), 4_000);
  ca.buoc({ actor: nhanActor("sale1"), action: "Sale KHÔNG có chế độ «Cần xử lý» (hàng chờ chứa tiền của vai khác)", input: null, expected: "không có", actual: coTabHangCho ? "có" : "không có", pass: !coTabHangCho });

  const gv = await moVai("giaovu");
  const dongGv = await docDong(gv.page);
  const chuGv = (await gv.page.locator("main").innerText()).replace(/\s+/g, " ");
  ca.buoc({ actor: nhanActor("giaovu"), action: "Giáo vụ (không có phần hoa hồng nào) mở Sổ: KHÔNG có dòng nào và trang nói «Bạn chưa có dòng hoa hồng nào»", input: DUONG_SO_TAT_CA(), expected: { soDong: 0, tinNhan: true }, actual: { soDong: dongGv.length, tinNhan: /Bạn chưa có dòng hoa hồng nào/.test(chuGv) }, pass: dongGv.length === 0 && /Bạn chưa có dòng hoa hồng nào/.test(chuGv), screenshots: [await ca.chup(gv.page, "so-giaovu", { fullPage: false })] });

  const href = docTrangThai(dot, "lead-nhan-su");
  if (!href) {
    ca.thongTin(nhanActor("giamdoc"), "Khối «Nguồn» không mang số tiền: không đo (SRC-06 chưa chạy trong lượt này)", null);
    return;
  }
  await di(sale.page, href);
  await expect(sale.page.locator("main")).toContainText("Thông tin khách hàng", { timeout: 90_000 });
  const saleThayKhoi = await coThay(sale.page.locator("section[aria-labelledby='khoi-nguon-tieu-de']"), 8_000);
  ca.buoc({ actor: nhanActor("sale1"), action: "Sale mở phiếu của chính mình: KHÔNG có khối «Nguồn» (cần sources:view)", input: href, expected: "không có khối", actual: saleThayKhoi ? "có khối" : "không có", pass: !saleThayKhoi });
  const ql = await moVai("giamdoc");
  const k = await docKhoiNguon(ql.page, href);
  ca.buoc({ actor: nhanActor("giamdoc"), action: "ĐỐI CHỨNG DƯƠNG — QLCS mở cùng phiếu THẤY khối «Nguồn», và khối ấy KHÔNG mang số tiền hoa hồng của ai (PRD §56)", input: href, expected: { coKhoi: true, coSoTien: false }, actual: { coKhoi: k.co, coSoTien: /\d[\d.]*\s?đ/.test(k.chu) }, pass: k.co && !/\d[\d.]*\s?đ/.test(k.chu) });
});

test("[SRC-19] Backfill DRY-RUN — BLOCKED_NO_UI (chỉ có ở workflow)", async ({ ca }) => {
  ca.biChan("BLOCKED_NO_UI: dry-run của backfill quy nguồn là bước của workflow `seed-test-data.yml` (nguon_viec = vet-lead-cu-chay-thu): báo cáo + digest nằm ở job summary/artifact, KHÔNG có màn hình nào hiện nó. Bằng chứng: artifact `nguon-vet-lead-cu-chay-thu-test-<run>` của lượt workflow, và ca máy [WGB-*] / [QN-DT-*] (tests/lead-intake, lib/nguon).");
});

/** `dau` = dấu hiệu RIÊNG của từng lớp trên khối «Nguồn» (AUTO không dấu nào; MANUAL_REVIEW «Thiếu người giới thiệu»; OTHER «Cần xem tay»). */
// Hai bộ lead nhãn cũ: bộ CHUNG (SĐT 099040000x, bị BỎ QUA khi mốc cutover đã đặt — đúng hiện trường test) và bộ ĐẠI DIỆN của nút `uat-nap-lead-cu-*` (SĐT dải 09907, `lib/uat/nguon-final.ts` LEAD_CU_DAI_DIEN: ADS = chỉ số 1, GIOI_THIEU = 9, NGUON_KHAC = 14).
// Ca lấy bộ đầu TÌM THẤY; không bộ nào có ⇒ BLOCKED như cũ.
const LEAD_CU = [
  { ma: "AUTO", ung: [{ sdt: "0990400001", ten: "UAT SOURCE FINAL · nhãn cũ AUTO" }, { sdt: "0990700001", ten: "UAT SOURCE FINAL · nhãn cũ ADS" }], nguon: /Nguồn từ Quảng Cáo/, dau: null },
  { ma: "MANUAL_REVIEW", ung: [{ sdt: "0990400002", ten: "UAT SOURCE FINAL · nhãn cũ MANUAL_REVIEW" }, { sdt: "0990700009", ten: "UAT SOURCE FINAL · nhãn cũ GIOI_THIEU" }], nguon: /Nguồn từ phụ huynh giới thiệu/, dau: /Thiếu người giới thiệu/ },
  { ma: "OTHER", ung: [{ sdt: "0990400003", ten: "UAT SOURCE FINAL · nhãn cũ OTHER" }, { sdt: "0990700014", ten: "UAT SOURCE FINAL · nhãn cũ NGUON_KHAC" }], nguon: /Nguồn khác/, dau: /Cần xem tay/ },
] as const;

/** Tìm dòng của một lead ở danh sách «Hàng chờ nguồn» theo bộ lọc `van-de`, đi hết các trang (≤ 10). Trả chữ của dòng hoặc null. */
async function timDongHangChoNguon(page: Page, vanDe: string, ten: string): Promise<string | null> {
  for (let trang = 1; trang <= 10; trang++) {
    await di(page, `/nguon-hoa-hong/nguon?van-de=${vanDe}&trang=${trang}`);
    const hang = page.getByRole("row");
    if (!(await coThay(hang.nth(1), 60_000))) return null;
    const dong = hang.filter({ hasText: ten });
    if ((await dong.count()) > 0) return (await dong.first().innerText()).replace(/\s+/g, " ");
    if ((await hang.count()) <= 20) return null;
  }
  return null;
}

test("[SRC-20] Backfill APPLY + idempotent: lead CŨ (nhãn cũ) đã có quy nguồn — AUTO vào nguồn đúng, MANUAL_REVIEW/OTHER vào hàng chờ xem tay, không còn lead «chưa quy nguồn»", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  const daThay: Record<string, string> = {};
  for (const l of LEAD_CU) {
    let href: string | null = null;
    let ten: string = l.ung[0].ten;
    for (const u of l.ung) {
      href = await timPhieuTheoSdt(page, u.sdt);
      if (href) { ten = u.ten; break; }
    }
    daThay[l.ma] = ten;
    canCo(ca, href, `Không thấy lead cũ ${l.ma} (SĐT ${l.ung.map((u) => u.sdt).join(" / ")}) — bộ nạp UAT SOURCE FINAL (lần 1, nhóm «lead nhãn cũ») chưa chạy, hoặc mốc cutover ĐÃ đặt nên bộ nạp chung BỎ QUA lead cũ (đúng hiện trường test.satarobo.vn) — khi đó nạp lead nhãn cũ bằng đường riêng workflow seed-test-data nguon_viec = uat-nap-lead-cu-ghi (SĐT dải 09907, bộ LEAD_CU_DAI_DIEN) rồi chạy backfill; ca này chỉ kiểm bộ 3 lead SĐT 099040000x của bộ nạp chung.`);
    const k = await docKhoiNguon(page, href, ten);
    if (/chưa có quy nguồn/.test(k.chu)) ca.biChan(`Lead cũ ${l.ma} CHƯA có quy nguồn («chưa có quy nguồn … đang chờ đợt chuyển dữ liệu nguồn cũ») — workflow backfill (vet-lead-cu-ghi) chưa chạy trên môi trường này.`);
    ca.buoc({ actor, action: `Lead cũ ${l.ma} (nhãn cũ) đã có quy nguồn sau backfill`, input: href, expected: { nguon: String(l.nguon), dau: l.dau ? String(l.dau) : "không dấu nào" }, actual: { nguon: k.truong["Nguồn"], xemTay: /Cần xem tay/.test(k.chu), thieuNguoi: /Thiếu người giới thiệu/.test(k.chu), cachXacDinh: k.truong["Cách xác định"] }, pass: l.nguon.test(k.truong["Nguồn"] ?? "") && (l.dau === null ? !/Cần xem tay|Thiếu người giới thiệu/.test(k.chu) : l.dau.test(k.chu)), screenshots: [await ca.chup(page, `lead-cu-${l.ma.toLowerCase()}`)] });
  }
  // Hàng chờ nguồn: hai lead xem tay có mặt (danh sách phân trang — tìm hết các trang).
  const dongOther = await timDongHangChoNguon(page, "XEM_TAY", daThay.OTHER!);
  ca.buoc({ actor, action: "Hàng chờ nguồn «Cần xem tay» có lead cũ nhãn «Nguồn khác» (OTHER)", input: "/nguon-hoa-hong/nguon?van-de=XEM_TAY", expected: "có dòng", actual: dongOther, pass: dongOther !== null, screenshots: [await ca.chup(page, "hang-cho-xem-tay-lead-cu", { fullPage: false })] });
  const dongManual = await timDongHangChoNguon(page, "THIEU_NGUOI", daThay.MANUAL_REVIEW!);
  ca.buoc({ actor, action: "Hàng chờ nguồn «Thiếu người giới thiệu» có lead cũ nhãn «Giới thiệu» (MANUAL_REVIEW) — chưa tự gán người", input: "/nguon-hoa-hong/nguon?van-de=THIEU_NGUOI", expected: "có dòng", actual: dongManual, pass: dongManual !== null });
  ca.thongTin(actor, "Idempotency của lệnh ghi (chạy lại ghi 0)", "chỉ kiểm được bằng lượt workflow thứ hai (nguon_viec = vet-lead-cu-ghi: «Ghi mới 0 · đã có N»). Ca này đo KẾT QUẢ: không lead cũ nào của fixture còn thiếu quy nguồn.");
});

test("[SRC-21] Cổng GHI Wave 1: lượt backfill để lại AuditLog — chữ ký owner (APPLY · write-gate) + bắt đầu/kết thúc (DI_TRU_NGUON · DI_TRU_NGUON_KET_THUC) với số khớp", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  const apply = await locAuditLog(page, { hanhDong: "APPLY", lyDo: "wave1-nguon-di-tru" });
  if (apply.length === 0) ca.biChan("Không có dòng audit APPLY «wave1-nguon-di-tru» (cổng ghi Wave 1 chưa từng ghi backfill trên môi trường này — lượt vet-lead-cu-ghi chưa chạy bằng workflow có chữ ký owner).");
  ca.buoc({ actor, action: "Audit Log lọc APPLY + «wave1-nguon-di-tru»: có dòng module write-gate (owner phê duyệt ghi N dòng)", input: "APPLY · wave1-nguon-di-tru", expected: "≥ 1 dòng, module write-gate", actual: { soDong: apply.length, dong: apply[0]?.slice(0, 220) }, pass: apply.length >= 1 && /write-gate/.test(apply[0]!), screenshots: [await ca.chup(page, "audit-write-gate", { fullPage: false })] });
  for (const hd of ["DI_TRU_NGUON", "DI_TRU_NGUON_KET_THUC"] as const) {
    const dong = await locAuditLog(page, { hanhDong: hd });
    // `DI_TRU_NGUON` là tiền tố của `DI_TRU_NGUON_KET_THUC`: lọc theo ô «Hành động» khớp một phần ⇒ lọc lại đúng từng loại.
    const dung = dong.filter((d) => (hd === "DI_TRU_NGUON" ? / DI_TRU_NGUON(?!_KET_THUC)/.test(d) : / DI_TRU_NGUON_KET_THUC/.test(d)));
    ca.buoc({ actor, action: `Audit Log có dòng ${hd} (module nguon-hoa-hong · NguonDiTru, người thực hiện nguon-di-tru)`, input: hd, expected: "≥ 1 dòng", actual: { soDong: dung.length, dong: dung[0]?.slice(0, 200) }, pass: dung.length >= 1 && /NguonDiTru/.test(dung[0] ?? ""), screenshots: [await ca.chup(page, `audit-${hd.toLowerCase()}`, { fullPage: false })] });
  }
  ca.thongTin(actor, "Cổng ghi: chữ ký Ed25519 của owner + vân tay khoá ghim", "kiểm ở bước VERIFY của workflow (scripts/ops/kiem-phe-duyet-ghi.ts) TRƯỚC khi ghi; dòng APPLY ở trên là dấu vết của phép claim `wg:<nonce>` (một nonce chỉ dùng một lần). Không có màn hình nào cho phép ghi mà không qua cổng.");
});

test("[SRC-23] Nguồn → hoa hồng, SỐ THEO FIXTURE: khoản thu 10.000.000đ của lead «Nguồn KH tự đến» ra đúng 3 dòng — Sale 4% 400.000đ · Sale Admin 1% 100.000đ · QLCS 2% 200.000đ; Marketing KHÔNG hưởng (chính sách NGUON_WALK_IN loại Marketing) (Kế toán HO đọc Sổ)", async ({ ca, moVai }) => {
  // Chủ dự án chốt 09/10/2026: «Marketing 1% chỉ cho nguồn quảng cáo» ⇒ mỗi nguồn KHÔNG quảng cáo có một chính sách `EXCLUDE MARKETING` (08 §3.1). Trên test, chính sách NGUON_WALK_IN đã kích hoạt
  // (đang «Chờ hiệu lực» tới 01/11/2026, khoản thu fixture rơi kỳ 02/2027 nên đã có hiệu lực) ⇒ 4% + 1% + 2% = 7% = 700.000đ, KHÔNG có dòng Marketing.
  // (Bản đầu của ca mong 4 dòng gồm Marketing 1% — đo trên test 20/10/2026 là mong sai, vì quên chính sách loại trừ.) Đối chứng dương: dòng chính sách NGUON_WALK_IN có mặt và đã kích hoạt.
  const kt = await moVai("ketoan");
  const page = kt.page;
  const actor = nhanActor("ketoan");
  const mong: ReadonlyArray<readonly [string, string, string]> = [
    ["Sale", "4%", "400.000đ"],
    ["Sale Admin", "1%", "100.000đ"],
    ["Quản lý cơ sở", "2%", "200.000đ"],
  ];
  const tatCa = await chupSo(page, "Bé UAT SOURCE FINAL");
  if (tatCa.length === 0) ca.biChan("Sổ hoa hồng chưa có dòng nào của bộ fixture «Bé UAT SOURCE FINAL …» — engine chưa ghi sổ (chưa chạy suite chuan-bi + nạp lần 2).");
  await di(page, "/nguon-hoa-hong/chinh-sach?xem=tat-ca");
  await coThay(page.getByRole("row").nth(1), 60_000);
  const dongLoaiTru = (await page.getByRole("row").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).find((t) => /NGUON_WALK_IN/.test(t)) ?? null;
  ca.buoc({ actor, action: "Đối chứng: chính sách NGUON_WALK_IN (loại Marketing khỏi nguồn «Nguồn KH tự đến Trung tâm») đã kích hoạt", input: "/nguon-hoa-hong/chinh-sach?xem=tat-ca", expected: "dòng có Marketing, trạng thái «Chờ hiệu lực» hoặc «Đang áp dụng»", actual: dongLoaiTru, pass: dongLoaiTru !== null && /Marketing/.test(dongLoaiTru) && /Chờ hiệu lực|Đang áp dụng/.test(dongLoaiTru) });
  for (const hv of ["DRIFT", "WITHDRAWN"] as const) {
    const ten = `Bé UAT SOURCE FINAL ${hv}`;
    // Dòng GỐC (kỳ của khoản thu, không phải «Điều chỉnh ·») — T1 có thể đã thêm dòng điều chỉnh; dòng gốc vẫn nguyên (sổ chỉ-thêm).
    const goc = tatCa.filter((d) => d.includes(ten) && !/Điều chỉnh ·/.test(d));
    const ketQua = mong.map(([vai, tl, tien]) => {
      const d = goc.find((x) => new RegExp(`${vai} ${ten}`).test(x) && x.includes(` ${tl} `) && x.includes(tien));
      return { vai, tyLe: tl, tien, thay: !!d, nguon: d ? /Nguồn KH tự đến Trung tâm/.test(d) : false, tienGoc10tr: d ? /10\.000\.000đ/.test(d) : false };
    });
    const tong = goc.reduce((t, d) => t + (soTien(d.slice(d.lastIndexOf("%") + 1)) ?? 0), 0);
    const coMarketing = goc.some((d) => /Marketing/.test(d.replace(ten, "")));
    ca.buoc({ actor, action: `Lead «${ten}»: 3 dòng gốc đúng số theo bảng tỉ lệ chính sách chung (nguồn Nguồn KH tự đến Trung tâm, tiền gốc 10.000.000đ), tổng 700.000đ, KHÔNG có dòng Marketing`, input: ten, expected: mong.map((m) => `${m[0]} ${m[1]} ${m[2]}`), actual: { dong: ketQua, tongGoc: tong, soDongGoc: goc.length, coDongMarketing: coMarketing }, pass: ketQua.every((k) => k.thay && k.nguon && k.tienGoc10tr) && goc.length === 3 && tong === 700_000 && !coMarketing, screenshots: [await ca.chup(page, `so-${hv.toLowerCase()}`, { fullPage: false })] });
  }
});

// ── Affiliate: ĐA WEBSITE (SRC-13) → campaign → nguồn → link/QR (SRC-12). Cần cờ `affiliate.enabled` BẬT (suite chuan-bi SRC-45, tuỳ chọn) — tắt ⇒ các trang `/nguon-hoa-hong/{website,campaign,link}` «Không tìm thấy trang» ⇒ BLOCKED. ──
// Website KHÔNG quyết nguồn: nguồn của khách đi theo CAMPAIGN (+ loại/nhãn đối tác); website chỉ là «ở đâu được phép đặt link». Ca đo cấu hình trên GIAO DIỆN (bộ «Thử một địa chỉ» chạy ngay trên trình duyệt);
// KHÔNG điều hướng tới tên miền thử (cổng host của bộ UAT chặn mọi điều hướng sang host lạ — xem SRC-13b).
const duongAffiliate = { website: "/nguon-hoa-hong/website", campaign: "/nguon-hoa-hong/campaign", link: "/nguon-hoa-hong/link" } as const;

async function affiliateDangBat(page: Page): Promise<boolean> {
  await di(page, duongAffiliate.website);
  return coThay(page.getByRole("heading", { name: /Website & trang đích/ }), 60_000);
}

async function taoWebsiteQuaGiaoDien(page: Page, w: { ma: string; ten: string; mien: string; trangDich: string }): Promise<void> {
  await di(page, duongAffiliate.website);
  const nutThem = page.getByRole("button", { name: "Thêm website" }).first();
  await expect(nutThem).toBeVisible({ timeout: 60_000 });
  const hop = await moHopThoai(page, nutThem);
  await hop.getByPlaceholder("Ví dụ: QUATANG_EDU").fill(w.ma);
  await hop.getByPlaceholder("Ví dụ: Quà tặng Sata Robo").fill(w.ten);
  await hop.getByPlaceholder("Ví dụ: https://quatang.edu.vn").fill(`https://${w.mien}`);
  await hop.getByPlaceholder("Ví dụ: quatang.edu.vn").fill(w.mien);
  await hop.getByRole("button", { name: "Thêm", exact: true }).click();
  await hop.getByRole("button", { name: "Tạo website" }).click();
  const hang = page.getByRole("row").filter({ hasText: w.ma }).first();
  await expect(hang).toBeVisible({ timeout: 60_000 });
  await hang.click();
  const ct = page.getByRole("dialog");
  await expect(ct.getByText("Trang đích").first()).toBeVisible({ timeout: 30_000 });
  await ct.locator("input[id$=-mau]").fill(w.trangDich);
  await ct.getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(ct.getByText(w.trangDich).first()).toBeVisible({ timeout: 30_000 });
}

/** Trong chi tiết một website: dán địa chỉ vào «Thử một địa chỉ», bấm «Kiểm tra», trả «ĐƯỢC PHÉP» / «KHÔNG ĐƯỢC PHÉP» + lý do. */
async function thuDiaChi(page: Page, url: string): Promise<{ duoc: boolean; chu: string }> {
  const ct = page.getByRole("dialog");
  const o = ct.locator("input[id$=-url]");
  await o.fill(url);
  await ct.getByRole("button", { name: "Kiểm tra" }).click();
  const kq = ct.getByText(/^(ĐƯỢC PHÉP|KHÔNG ĐƯỢC PHÉP)/).first();
  await expect(kq).toBeVisible({ timeout: 15_000 });
  const chu = (await ct.innerText()).replace(/\s+/g, " ");
  const tu = chu.lastIndexOf(/KHÔNG ĐƯỢC PHÉP/.test(chu) ? "KHÔNG ĐƯỢC PHÉP" : "ĐƯỢC PHÉP");
  return { duoc: !/KHÔNG ĐƯỢC PHÉP/.test(chu.slice(tu, tu + 20)), chu: chu.slice(tu, tu + 260) };
}

test("[SRC-13] Đa website: hai website (hai tên miền, hai trang đích) — «Thử một địa chỉ» chỉ cho đúng tên miền + đúng đường dẫn; tên miền con / host website kia / đường dẫn lạ bị từ chối; website không gắn campaign thì không quyết nguồn gì", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  if (!(await affiliateDangBat(page))) ca.biChan("Trang «Website & trang đích» không mở: cờ `affiliate.enabled` đang TẮT trên test (trang trả «Không tìm thấy trang»). Bật bằng suite chuan-bi SRC-45 (UAT_BAT_AFFILIATE=1 / ô bat_affiliate) nếu chủ dự án đồng ý.");
  const dotNho = DOT.toLowerCase();
  const A = { ma: `UATSF_${DOT}_WA`.slice(0, 40), ten: tenDuLieu(DOT, "website A"), mien: `uatsf-${dotNho}-a.example.test`, trangDich: "/khoa/*" };
  const B = { ma: `UATSF_${DOT}_WB`.slice(0, 40), ten: tenDuLieu(DOT, "website B"), mien: `uatsf-${dotNho}-b.example.test`, trangDich: "/giai-dau/*" };
  await taoWebsiteQuaGiaoDien(page, A);
  ca.buoc({ actor, action: `Tạo website A (${A.mien}) + trang đích ${A.trangDich} bằng form thật`, input: A, expected: "có dòng website A và trang đích hiện", actual: "có", pass: true, screenshots: [await ca.chup(page, "website-a", { fullPage: false })] });
  const a1 = await thuDiaChi(page, `https://${A.mien}/khoa/robot-1`);
  const a2 = await thuDiaChi(page, `https://www.${A.mien}/khoa/robot-1`);
  const a3 = await thuDiaChi(page, `https://${A.mien}/giai-dau/vong-1`);
  const a4 = await thuDiaChi(page, `https://${B.mien}/giai-dau/vong-1`);
  ca.buoc({ actor, action: "Website A: «Thử một địa chỉ» — ĐÚNG tên miền + đúng trang đích ⇒ ĐƯỢC PHÉP", input: `https://${A.mien}/khoa/robot-1`, expected: "ĐƯỢC PHÉP, khớp /khoa/*", actual: a1.chu, pass: a1.duoc && /\/khoa\/\*/.test(a1.chu) });
  ca.buoc({ actor, action: "Website A: tên miền CON (www.) ⇒ KHÔNG ĐƯỢC PHÉP (so khớp chính xác tên miền)", input: `https://www.${A.mien}/khoa/robot-1`, expected: "KHÔNG ĐƯỢC PHÉP — mã HOST_KHONG_DUOC_PHEP (bị chặn Ở TÊN MIỀN, không phải vì đường dẫn)", actual: a2.chu, pass: !a2.duoc && /HOST_KHONG_DUOC_PHEP/.test(a2.chu) });
  ca.buoc({ actor, action: "Website A: đường dẫn KHÔNG nằm trong trang đích (/giai-dau/…) ⇒ KHÔNG ĐƯỢC PHÉP", input: `https://${A.mien}/giai-dau/vong-1`, expected: "KHÔNG ĐƯỢC PHÉP — mã KHONG_CO_TRANG_DICH (tên miền đúng nhưng đường dẫn không khớp trang đích nào)", actual: a3.chu, pass: !a3.duoc && /KHONG_CO_TRANG_DICH/.test(a3.chu) });
  ca.buoc({ actor, action: "Website A: địa chỉ thuộc tên miền của website B ⇒ KHÔNG ĐƯỢC PHÉP (mỗi website một danh sách tên miền riêng)", input: `https://${B.mien}/giai-dau/vong-1`, expected: "KHÔNG ĐƯỢC PHÉP — mã HOST_KHONG_DUOC_PHEP", actual: a4.chu, pass: !a4.duoc && /HOST_KHONG_DUOC_PHEP/.test(a4.chu) });
  await page.keyboard.press("Escape");
  await taoWebsiteQuaGiaoDien(page, B);
  const b1 = await thuDiaChi(page, `https://${B.mien}/giai-dau/vong-1`);
  const b2 = await thuDiaChi(page, `https://${A.mien}/khoa/robot-1`);
  ca.buoc({ actor, action: "Website B: địa chỉ của chính nó ⇒ ĐƯỢC PHÉP; địa chỉ của website A ⇒ KHÔNG", input: { b: `https://${B.mien}/giai-dau/vong-1`, a: `https://${A.mien}/khoa/robot-1` }, expected: { b: "ĐƯỢC PHÉP", a: "KHÔNG ĐƯỢC PHÉP" }, actual: { b: b1.chu.slice(0, 80), a: b2.chu.slice(0, 80) }, pass: b1.duoc && !b2.duoc, screenshots: [await ca.chup(page, "website-b", { fullPage: false })] });
  const chuHang = (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
  ca.buoc({ actor, action: "Website chưa gắn campaign ⇒ «Chưa gắn campaign nào» (website không quyết nguồn — nguồn đi theo campaign, SRC-12)", input: B.ma, expected: "Chưa gắn campaign nào", actual: /Chưa gắn campaign nào/.test(chuHang) ? "Chưa gắn campaign nào" : chuHang.slice(0, 200), pass: /Chưa gắn campaign nào/.test(chuHang) });
  luuTrangThai(DOT, "web-a", A.ma);
  luuTrangThai(DOT, "web-a-ten", A.ten);
});

test("[SRC-13b] Truy cập landing thật (tên miền ngoài / quatang.edu.vn / covua.quatang.edu.vn) — BLOCKED_NO_UI", async ({ ca }) => {
  ca.biChan("BLOCKED_NO_UI: bộ UAT chỉ được nói chuyện với test.satarobo.vn (`phanLoaiRequest` chặn mọi điều hướng sang host khác và mọi request tới `*.satarobo.vn` khác host test) — không mở được landing của website đối tác để bấm biểu mẫu. Bằng chứng máy cho «website không quyết nguồn»: tests/lead-intake/source-integration.spec.ts [SRC-INT-06/06b] và tests/hoa-hong/affiliate-*.spec.ts [AFFL6-*].");
});

test("[SRC-12] Affiliate → nguồn: campaign (nguồn mặc định «Nguồn từ đối tác») + website + đối tác tham gia ⇒ «Xem trước nguồn» ra đúng nguồn, kích hoạt được, phát link/QR của đối tác (Admin)", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  const webA = docTrangThai(DOT, "web-a");
  const tenWebA = docTrangThai(DOT, "web-a-ten");
  canCo(ca, webA, "Chưa có website A của SRC-13 trong lượt chạy này (hoặc affiliate tắt) — chạy SRC-13 trước.");
  canCo(ca, tenWebA, "Chưa có website A của SRC-13 trong lượt chạy này (hoặc affiliate tắt) — chạy SRC-13 trước.");
  const ma = `UATSF_${DOT}_C1`.slice(0, 40);
  const ten = tenDuLieu(DOT, "campaign A");

  // 1 · Tạo campaign: nguồn mặc định = «Nguồn từ đối tác».
  await di(page, `${duongAffiliate.campaign}/tao`);
  const oTen = page.locator("input[id$=-name]");
  await choHydrate(oTen);
  await oTen.fill(ten);
  await page.locator("input[id$=-code]").fill(ma);
  const oNguon = page.locator("select[id$=-defaultSourceGroupId]");
  const nhanNguon = (await oNguon.locator("option").allInnerTexts()).find((t) => /Nguồn từ đối tác/.test(t));
  canCo(ca, nhanNguon, "Ô «Nguồn mặc định» của campaign không có «Nguồn từ đối tác» (nguồn AFFILIATE đã tắt / đổi tên).");
  await oNguon.selectOption({ label: nhanNguon });
  await page.getByRole("button", { name: /Tạo campaign/ }).click();
  await page.waitForURL((u) => u.pathname === `${duongAffiliate.campaign}/${ma}`, { timeout: 60_000 });
  await expect(page.getByText("Hoa hồng", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  ca.buoc({ actor, action: "Tạo campaign (nguồn mặc định «Nguồn từ đối tác») ở trạng thái Nháp", input: { ma, ten }, expected: "chuyển sang trang chi tiết, trạng thái Nháp, nguồn mặc định = Nguồn từ đối tác", actual: (await page.locator("main").innerText()).replace(/\s+/g, " ").match(/Trạng thái .{0,10}Nháp[^]*?Nguồn mặc định [^]{0,40}/)?.[0] ?? null, pass: /Nguồn mặc định Nguồn từ đối tác/.test((await page.locator("main").innerText()).replace(/\s+/g, " ")), screenshots: [await ca.chup(page, "campaign-moi")] });

  // 2 · Hoa hồng: «Không có mức riêng cho campaign» (bước bắt buộc trước khi kích hoạt).
  const hopThuong = await moHopThoai(page, page.locator("button").filter({ hasText: "Không có mức riêng cho campaign" }).first());
  await hopThuong.getByLabel(/Lý do/).fill(tenDuLieu(DOT, "campaign không có mức riêng"));
  await hopThuong.getByRole("button", { name: "Chọn", exact: true }).click();
  await expect(hopThuong).toBeHidden({ timeout: 30_000 });
  // 3 · Gắn website A.
  const oSite = page.locator("select[id$=-site]");
  await expect(oSite).toBeVisible({ timeout: 30_000 });
  await oSite.selectOption({ label: (await oSite.locator("option").allInnerTexts()).find((t) => t.includes(tenWebA)) });
  await page.getByRole("button", { name: "Gắn website" }).click();
  await expect(page.locator(`:not(option):text("${tenWebA}")`).first()).toBeVisible({ timeout: 30_000 });
  // 4 · Thêm đối tác (đối tác đầu tiên đang hoạt động).
  const oDoiTac = page.locator("select[id$=-doitac]");
  const dsDoiTac = (await oDoiTac.locator("option").allInnerTexts()).filter((t) => t.trim() !== "" && !/Chọn đối tác/.test(t));
  if (dsDoiTac.length === 0) ca.biChan("Không có đối tác nào để thêm vào campaign (trang Affiliate chưa có đối tác đang hoạt động).");
  const doiTac = dsDoiTac[0]!;
  await oDoiTac.selectOption({ label: doiTac });
  await page.getByRole("button", { name: "Thêm đối tác" }).click();
  await expect(page.getByRole("row").filter({ hasText: doiTac.split(" (")[0]! }).first()).toBeVisible({ timeout: 30_000 });
  ca.buoc({ actor, action: `Gắn website A, bật «không có mức riêng», thêm đối tác «${doiTac}» vào campaign`, input: { website: tenWebA, doiTac }, expected: "website + đối tác hiện trong chi tiết campaign", actual: "có", pass: true, screenshots: [await ca.chup(page, "campaign-da-gan")] });

  // 5 · «Xem trước nguồn» (form GET không JS): đối tác này ghi nhận khách vào nguồn nào, và QUYẾT ĐỊNH BỞI cái gì.
  const tenNgan = doiTac.split(" (")[0]!;
  const oXem = page.locator("#xem-truoc-doi-tac");
  await oXem.selectOption({ label: (await oXem.locator("option").allInnerTexts()).find((t) => t.includes(tenNgan)) });
  await page.locator("form").filter({ has: oXem }).getByRole("button", { name: "Xem trước" }).click();
  await page.waitForURL((u) => u.searchParams.has("xemTruoc"), { timeout: 60_000 });
  const khoiXem = page.getByText("Nguồn sẽ được gán");
  await expect(khoiXem).toBeVisible({ timeout: 60_000 });
  const chuXem = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const vung = chuXem.slice(chuXem.indexOf("Nguồn sẽ được gán"), chuXem.indexOf("Nguồn sẽ được gán") + 200);
  ca.buoc({ actor, action: "«Xem trước nguồn» cho đối tác vừa thêm: nguồn sẽ gán = «Nguồn từ đối tác», quyết định bởi «Nguồn mặc định của campaign»", input: doiTac, expected: { nguon: "Nguồn từ đối tác", quyetDinhBoi: "Nguồn mặc định của campaign" }, actual: vung, pass: /Nguồn sẽ được gán Nguồn từ đối tác/.test(vung) && /Quyết định bởi Nguồn mặc định của campaign/.test(vung), screenshots: [await ca.chup(page, "xem-truoc-nguon")] });

  // 6 · Duyệt thành viên (mới thêm ở «Chờ duyệt»).
  const hangTv = page.getByRole("row").filter({ hasText: tenNgan }).first();
  const hopDuyet = await moHopThoai(page, hangTv.getByRole("button", { name: /^Duyệt/ }));
  await hopDuyet.getByRole("button", { name: "Duyệt", exact: true }).click();
  await expect(hopDuyet).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("row").filter({ hasText: tenNgan }).filter({ hasText: "Đang tham gia" }).first()).toBeVisible({ timeout: 30_000 });
  // 7 · Kích hoạt campaign (Nháp → Đang chạy).
  const hopKich = await moHopThoai(page, page.getByRole("button", { name: "Kích hoạt", exact: true }).first());
  await hopKich.getByRole("button", { name: "Kích hoạt", exact: true }).click();
  await expect(hopKich).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText("Đang chạy").first()).toBeVisible({ timeout: 30_000 });
  ca.buoc({ actor, action: "Duyệt đối tác vào campaign rồi KÍCH HOẠT campaign (Nháp → Đang chạy)", input: ma, expected: "đối tác «Đang tham gia», campaign «Đang chạy»", actual: "đạt", pass: true, screenshots: [await ca.chup(page, "campaign-dang-chay")] });

  // 8 · Phát link (đối tác · campaign · website · trang đích) và đọc dòng link: có mã `aff`, mã campaign `cmp`, đúng tên miền thử.
  await di(page, duongAffiliate.link);
  const hopLink = await moHopThoai(page, page.getByRole("button", { name: "Phát link" }).first());
  const chon = async (hau: string, kt: (t: string) => boolean): Promise<void> => {
    const o = hopLink.locator(`select[id$=${hau}]`);
    await expect(o).toBeEnabled({ timeout: 30_000 });
    const nhan = (await o.locator("option").allInnerTexts()).find(kt);
    canCo(ca, nhan, `Ô «${hau}» của hộp thoại Phát link không có lựa chọn mong đợi (đối tác/campaign/website chưa hiện — kiểm campaign đã Đang chạy và đối tác Đang tham gia).`);
    await o.selectOption({ label: nhan });
  };
  await chon("-partyId", (t) => t.includes(tenNgan));
  await chon("-membershipId", (t) => t.includes(ma));
  await chon("-siteId", (t) => t.includes(DOT.toLowerCase()));
  await chon("-landingPath", (t) => /\/khoa\//.test(t));
  await hopLink.getByRole("radio", { name: /^QR/ }).check();
  await hopLink.locator("input[id$=-label]").fill(tenDuLieu(DOT, "link QR"));
  await hopLink.getByRole("button", { name: "Phát link" }).click();
  await expect(hopLink).toBeHidden({ timeout: 60_000 });
  const hangLink = page.getByRole("row").filter({ hasText: ma }).first();
  await expect(hangLink).toBeVisible({ timeout: 60_000 });
  const chuLink = (await hangLink.innerText()).replace(/\s+/g, " ");
  const url = /https:\/\/\S+/.exec(chuLink)?.[0] ?? "";
  ca.buoc({ actor, action: "Phát link QR: dòng link có địa chỉ đích đúng website A, mã đối tác `aff=` và mã campaign `cmp=`, trạng thái «Đang hoạt động»", input: { doiTac, ma }, expected: { url: `https://uatsf-…a.example.test/khoa/?aff=…&cmp=${ma}`, trangThai: "Đang hoạt động" }, actual: chuLink.slice(0, 260), pass: url.includes(`cmp=${ma}`) && /[?&]aff=[A-Z0-9]{6,}/.test(url) && url.includes(DOT.toLowerCase()) && /Đang hoạt động/.test(chuLink), screenshots: [await ca.chup(page, "link-da-phat")] });
  luuTrangThai(DOT, "link-aff-doi-tac", tenNgan);
  luuTrangThai(DOT, "link-aff-campaign", ma);
});

test("[SRC-12b] Mã QR của link affiliate: nút «Xem mã QR» mở hộp thoại «Mã QR giới thiệu» có HÌNH QR và «Tải về (SVG)» (Admin)", async ({ ca, moVai }) => {
  const doiTac = docTrangThai(DOT, "link-aff-doi-tac");
  const ma = docTrangThai(DOT, "link-aff-campaign");
  canCo(ca, doiTac, "Chưa có link affiliate của SRC-12 trong lượt chạy này — chạy SRC-12 trước.");
  canCo(ca, ma, "Chưa có link affiliate của SRC-12 trong lượt chạy này — chạy SRC-12 trước.");
  const ad = await moVai("admin");
  const page = ad.page;
  await di(page, duongAffiliate.link);
  const hang = page.getByRole("row").filter({ hasText: ma }).first();
  await expect(hang).toBeVisible({ timeout: 60_000 });
  const nutQr = hang.getByRole("button", { name: new RegExp(`^Xem mã QR của ${doiTac}`) });
  if (!(await coThay(nutQr, 15_000))) ca.biChan("Dòng link không có nút «Xem mã QR» (link ngắn cần AFFILIATE_PUBLIC_ORIGIN — «Chưa cấu hình gốc địa chỉ công khai cho link ngắn» ở chân trang link).");
  await nutQr.click();
  const hop = page.getByRole("dialog");
  await expect(hop.getByText("Mã QR giới thiệu")).toBeVisible({ timeout: 30_000 });
  const coHinh = await coThay(hop.getByRole("img", { name: /Mã QR giới thiệu/ }), 30_000);
  const chu = (await hop.innerText()).replace(/\s+/g, " ");
  canCo(ca, coHinh, `Hộp thoại QR không dựng được hình: «${chu.slice(0, 200)}» — thiếu AFFILIATE_PUBLIC_ORIGIN hoặc quyền affiliate_links:manage.`);
  ca.buoc({ actor: nhanActor("admin"), action: "Hộp thoại QR: có HÌNH QR (img data:image/svg+xml) và liên kết «Tải về (SVG)»", input: doiTac, expected: { hinh: true, taiVe: true }, actual: { hinh: coHinh, taiVe: /Tải về \(SVG\)/.test(chu) }, pass: coHinh && /Tải về \(SVG\)/.test(chu), screenshots: [await ca.chup(page, "qr-dialog", { fullPage: false })] });
});
