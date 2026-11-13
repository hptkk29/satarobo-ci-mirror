// SRC-30 … SRC-35 — T1 «XỬ LÝ HÀNG CHỜ» hoa hồng (INPUT_DRIFT · PAYMENT_WITHDRAWN) bằng GIAO DIỆN THẬT trên test (suite `t1`). Theo `docs/source-commission/13-uat-tay-t1-xu-ly-hang-cho.md`.
//
// TIỀN ĐỀ (thiếu thì ca BLOCKED, không FAIL): engine hoa hồng BẬT + mốc cutover đặt + chính sách chung ACTIVE (suite `chuan-bi`), và bộ nạp UAT SOURCE FINAL đã chạy LẦN 2 sau khi engine bật
// (nút `uat-nap-ghi` — lần 1 chỉ báo `THIEU` cho hai hàng chờ). Hai hàng chờ do ENGINE THẬT sinh ra: «Bé UAT SOURCE FINAL DRIFT» (INPUT_DRIFT) và «Bé UAT SOURCE FINAL WITHDRAWN» (PAYMENT_WITHDRAWN),
// mỗi khoản thu 10.000.000đ, 4 dòng sổ (Sale 4% · Sale Admin 1% · Marketing 1% · QLCS 2%).
//
// ⚠️ CA NÀY GHI SỔ THẬT: xử lý xong một hàng chờ thì hàng chờ đóng và sổ có dòng điều chỉnh MỚI — chạy lại lượt sau sẽ thấy hàng chờ đã xử lý ⇒ BLOCKED «không còn hàng chờ mở». Muốn có lại hàng chờ phải
// dựng lại DB test (hoặc nạp lại bằng mã khác) — đó là việc của lane dữ liệu, không phải của ca này.
//
// Số tiền ảnh hưởng của mỗi hàng chờ là 800.000đ — DƯỚI ngưỡng hai cấp mặc định 10.000.000đ nên «Xử lý» sẽ quyết MỘT người. Để chạy đúng luồng bốn mắt của T1 (13 §0 P6), SRC-30 HẠ ngưỡng
// `hoaHong.nguongDuyetHaiCap` xuống 500.000đ ở Cấu hình vận hành (Admin, kèm lý do) và SRC-35 TRẢ LẠI giá trị cũ ở cuối — nếu lượt chạy chết giữa chừng, ngưỡng còn thấp; xem `uat-harness.md` §11.
//
// Thứ tự trong tệp LÀ thứ tự chạy (workers: 1). KHÔNG dùng describe.serial: ca đỏ giữa chừng không được làm mất bằng chứng các ca sau.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./_lib/fixtures";
import { tenDuLieu } from "./_lib/an-toan";
import { DUONG_SO, chupSo, docXemTruoc, dongCuBiDoi, dongHangCho, dongMoi, gon, moHangCho, moXuLy, soTien } from "./_lib/hoa-hong-ui";
import { canCo, type NhatKyCa } from "./_lib/nhat-ky";
import { nhanActor, type Phien } from "./_lib/phien";
import { choHydrate, coThay, di } from "./_lib/thao-tac";
import type { KhoaVai } from "./_lib/vai";

const DOT = process.env.UAT_RUN_CODE ?? "LOCAL";
const LY_DO = (viec: string): string => `${tenDuLieu(DOT, viec)} — nghiệm thu T1 trên test`;
const BANG_CHUNG = (viec: string): string => `${tenDuLieu(DOT, viec)} — đối chiếu màn Sổ và nhật ký của hàng chờ (UAT)`;
const NGUONG_THU = 500_000;
const NGUONG_MAC_DINH = 10_000_000;
const DUONG_CAU_HINH = "/cau-hinh-van-hanh?tab=hoa-hong";
const HOC_VIEN = { DRIFT: "Bé UAT SOURCE FINAL DRIFT", WITHDRAWN: "Bé UAT SOURCE FINAL WITHDRAWN" } as const;
/** Chữ NHẬN RA dòng hàng chờ ở tab Sổ. PAYMENT_WITHDRAWN KHÔNG hiện tên học viên (cột «Học viên» là «—»: khoản thu bị rút không còn gắn học viên) nên nhận bằng nhãn việc; INPUT_DRIFT nhận bằng tên bé. */
const NHAN_HANG = { DRIFT: HOC_VIEN.DRIFT, WITHDRAWN: "Khoản thu bị rút lại" } as const;
const THU_MUC_PHIEN = process.env.UAT_PHIEN_DIR?.trim() || join(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "/tmp", "uat-nguon-phien");
const TEP_NGUONG_GOC = join(THU_MUC_PHIEN, "t1-nguong-goc.txt");

/** Đọc/ghi ngưỡng hai cấp ở Cấu hình vận hành (Admin). Trả giá trị ĐỌC TỪ Ô sau khi tải lại. */
async function docNguong(admin: Phien): Promise<number | null> {
  await di(admin.page, DUONG_CAU_HINH);
  const o = admin.page.locator("#o-hoaHong-nguongDuyetHaiCap");
  if (!(await coThay(o, 90_000))) return null;
  await choHydrate(o);
  const so = Number((await o.inputValue()).replace(/[^\d]/g, ""));
  return Number.isFinite(so) ? so : null;
}
async function datNguong(ca: NhatKyCa, admin: Phien, gia: number, viec: string): Promise<void> {
  const o = admin.page.locator("#o-hoaHong-nguongDuyetHaiCap");
  await o.fill(String(gia));
  const oLyDo = admin.page.getByPlaceholder("Vì sao đổi? (bắt buộc)");
  await expect(oLyDo).toBeVisible({ timeout: 15_000 });
  await oLyDo.fill(LY_DO(viec));
  await admin.page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect.poll(() => docNguong(admin), { timeout: 90_000, intervals: [2_000, 4_000] }).toBe(gia);
  ca.thongTin(nhanActor("admin"), `Đặt ngưỡng duyệt hai cấp = ${gia}`, { viec });
}

type TinhTrangHold = { co: boolean; chu: string };
const docHold = async (page: Phien["page"], tenHv: string): Promise<TinhTrangHold> => {
  const hang = dongHangCho(page, tenHv).first();
  const co = await coThay(hang, 20_000);
  return { co, chu: co ? gon(await hang.innerText()) : "" };
};

test("[SRC-30] Chuẩn bị T1: engine bật, hai hàng chờ (INPUT_DRIFT · PAYMENT_WITHDRAWN) đang mở, ngưỡng duyệt hai cấp hạ để ép bốn mắt (Admin → N1)", async ({ ca, moVai }) => {
  const n1 = await moVai("nguonduyet1");
  const actor = nhanActor("nguonduyet1");
  if (!(await moHangCho(n1.page))) ca.biChan("N1 không mở được tab Sổ ở chế độ «Cần xử lý» — engine hoa hồng chưa bật, hoặc chưa chạy suite chuan-bi, hoặc N1 thiếu `commission_periods:manage`/`commission:view-center` ở CS1.");
  ca.buoc({ actor, action: "Mở tab Sổ — chế độ «Cần xử lý»", input: DUONG_SO, expected: "có bảng «Vì sao chưa ghi sổ»", actual: "có bảng", pass: true, screenshots: [await ca.chup(n1.page, "so-can-xu-ly")] });
  const dr = await docHold(n1.page, NHAN_HANG.DRIFT);
  const wd = await docHold(n1.page, NHAN_HANG.WITHDRAWN);
  ca.thongTin(actor, "Hai hàng chờ fixture", { INPUT_DRIFT: dr.chu.slice(0, 200), PAYMENT_WITHDRAWN: wd.chu.slice(0, 200) });
  if (!dr.co && !wd.co) ca.biChan("Không còn hàng chờ nào của UAT SOURCE FINAL đang mở: chưa nạp lần 2 sau khi bật engine (nút uat-nap-ghi), hoặc đã được xử lý ở lượt trước.");
  ca.buoc({ actor, action: "Hàng chờ INPUT_DRIFT (Bé … DRIFT) hiện ở «Cần xử lý»", input: HOC_VIEN.DRIFT, expected: "có", actual: dr.co ? "có" : "không", pass: dr.co });
  ca.buoc({ actor, action: "Hàng chờ PAYMENT_WITHDRAWN (Bé … WITHDRAWN) hiện ở «Cần xử lý»", input: HOC_VIEN.WITHDRAWN, expected: "có", actual: wd.co ? "có" : "không", pass: wd.co });

  const ad = await moVai("admin");
  const hienTai = await docNguong(ad);
  canCo(ca, hienTai, "Admin không đọc được ô «ngưỡng duyệt hai cấp» ở Cấu hình vận hành › Hoa hồng.");
  mkdirSync(THU_MUC_PHIEN, { recursive: true });
  if (hienTai > NGUONG_THU) {
    // Chỉ GHI ngưỡng gốc khi lần đầu hạ (chạy lại lúc ngưỡng đã thấp thì giữ giá trị gốc cũ để SRC-35 trả đúng).
    try {
      readFileSync(TEP_NGUONG_GOC, "utf8");
    } catch {
      writeFileSync(TEP_NGUONG_GOC, String(hienTai), "utf8");
    }
    await datNguong(ca, ad, NGUONG_THU, "ha nguong duyet hai cap de ep bon mat");
    ca.buoc({ actor: nhanActor("admin"), action: `Hạ ngưỡng duyệt hai cấp ${hienTai.toLocaleString("vi-VN")}đ → ${NGUONG_THU.toLocaleString("vi-VN")}đ`, input: { hienTai, moi: NGUONG_THU }, expected: "ô hiển thị giá trị mới sau khi tải lại", actual: NGUONG_THU, pass: true });
  } else {
    ca.buoc({ actor: nhanActor("admin"), action: "ALREADY_DONE — ngưỡng duyệt hai cấp đã ≤ 500.000đ", input: { hienTai }, expected: "không đổi", actual: hienTai, pass: true });
  }
});

// ── SRC-31: đối chứng vai (vai chỉ-xem thấy hàng chờ nhưng KHÔNG có nút Xử lý; N1 thấy nút) ──────────────────────────────────────────────────────────────
test("[SRC-31] Đối chứng vai: Kế toán cơ sở chỉ-xem THẤY hàng chờ nhưng KHÔNG có nút «Xử lý»; N1 có nút (T1 bước 2)", async ({ ca, moVai }) => {
  const xem = await moVai("nguonxem");
  const n1 = await moVai("nguonduyet1");
  if (!(await moHangCho(n1.page))) ca.biChan("N1 không mở được tab Sổ — chưa chuẩn bị engine (suite chuan-bi).");
  const hangN1 = dongHangCho(n1.page, NHAN_HANG.DRIFT).first();
  if (!(await coThay(hangN1, 20_000))) ca.biChan("Hàng chờ INPUT_DRIFT không còn mở (đã xử lý ở lượt trước hoặc chưa nạp) — không đo được đối chứng.");
  // Đối chứng DƯƠNG trước: N1 THẤY nút «Xử lý» ở đúng dòng đó — nếu không thì mọi khẳng định «không thấy nút» bên dưới đúng vì tính năng hỏng.
  const nutN1 = await coThay(hangN1.getByRole("button", { name: "Xử lý", exact: true }), 20_000);
  ca.buoc({ actor: nhanActor("nguonduyet1"), action: "N1 thấy nút «Xử lý» ở dòng INPUT_DRIFT (đối chứng dương)", input: NHAN_HANG.DRIFT, expected: "có nút", actual: nutN1 ? "có nút" : "không có nút", pass: nutN1, screenshots: [await ca.chup(n1.page, "n1-thay-nut", { fullPage: false })] });

  const okXem = await moHangCho(xem.page);
  ca.buoc({ actor: nhanActor("nguonxem"), action: "Chỉ-xem mở được tab Sổ «Cần xử lý» (có quyền xem hàng chờ)", input: DUONG_SO, expected: "thấy bảng hàng chờ", actual: okXem ? "thấy bảng" : "không thấy bảng", pass: okXem, screenshots: [await ca.chup(xem.page, "xem-so", { fullPage: false })] });
  if (!okXem) return;
  const thayDong = await coThay(dongHangCho(xem.page, NHAN_HANG.DRIFT).first(), 20_000);
  const thayDongWd = await coThay(dongHangCho(xem.page, NHAN_HANG.WITHDRAWN).first(), 5_000);
  ca.buoc({ actor: nhanActor("nguonxem"), action: "Chỉ-xem THẤY dòng INPUT_DRIFT và PAYMENT_WITHDRAWN", input: [NHAN_HANG.DRIFT, NHAN_HANG.WITHDRAWN], expected: "thấy cả hai dòng", actual: { drift: thayDong, withdrawn: thayDongWd }, pass: thayDong && thayDongWd });
  const soNut = await xem.page.getByRole("button", { name: "Xử lý", exact: true }).count();
  ca.buoc({ actor: nhanActor("nguonxem"), action: "Chỉ-xem KHÔNG có nút «Xử lý» ở bất kỳ dòng nào", input: DUONG_SO, expected: 0, actual: soNut, pass: soNut === 0 });
});

// ── Quy trình BỐN MẮT dùng chung cho INPUT_DRIFT (SRC-32) và PAYMENT_WITHDRAWN (SRC-33) ─────────────────────────────────────────────────────────────────────
// xem trước (không ghi) → kiểm tiền → chụp sổ → N1 đề nghị → sổ chưa đổi → N1 tự duyệt bị chặn → N2 duyệt (đề nghị của N1 hiện ra) → hàng chờ đóng → điều chỉnh MỚI, dòng sổ cũ NGUYÊN VĂN.
async function quyTrinhBonMat(ca: NhatKyCa, moVai: (v: KhoaVai) => Promise<Phien>, k: { nhan: string; hocVien: string; ten: string }): Promise<void> {
  const n1 = await moVai("nguonduyet1");
  const a1 = nhanActor("nguonduyet1");
  const a2 = nhanActor("nguonduyet2");
  if (!(await moHangCho(n1.page))) ca.biChan("N1 không mở được tab Sổ — chưa chuẩn bị engine (suite chuan-bi).");
  let hang = dongHangCho(n1.page, k.nhan).first();
  if (!(await coThay(hang, 20_000))) ca.biChan(`Hàng chờ ${k.ten} không còn mở: đã xử lý ở lượt trước, hoặc chưa nạp UAT SOURCE FINAL lần 2 sau khi bật engine.`);

  // 1 · Xem trước — KHÔNG ghi (13 bước 3). Đọc kỳ ghi + tiền ảnh hưởng, rồi ĐÓNG.
  let hop = await moXuLy(n1.page, hang);
  const xem = await docXemTruoc(hop);
  const cap = await hop.locator("[data-cap-duyet]").first().getAttribute("data-cap-duyet");
  ca.buoc({
    actor: a1,
    action: `Mở «Xử lý» ở hàng chờ ${k.ten} — xem trước (chưa ghi gì)`,
    input: k.nhan,
    expected: "có «Nếu giải phóng bây giờ», kỳ ghi, tiền ảnh hưởng, cấp duyệt = hai cấp (ngưỡng đã hạ)",
    actual: { tienAnhHuong: xem.tienAnhHuong, tongTuyetDoi: xem.tongTuyetDoi, ky: xem.ky, cap },
    pass: xem.coGiaiPhong && xem.ky !== null && xem.tongTuyetDoi !== null && cap !== "MOT_CAP",
    screenshots: [await ca.chup(n1.page, "xem-truoc", { fullPage: false })],
  });
  if (!xem.ky) return;
  ca.buoc({ actor: a1, action: "Kiểm tiền: «Tiền bị ảnh hưởng» = «Tổng tuyệt đối» của lần xử lý (một lần, không tách theo ô/người)", input: null, expected: "hai số bằng nhau và > 0", actual: { tienAnhHuong: xem.tienAnhHuong, tongTuyetDoi: xem.tongTuyetDoi }, pass: xem.tienAnhHuong !== null && xem.tienAnhHuong === xem.tongTuyetDoi && xem.tongTuyetDoi > 0 });
  await hop.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(n1.page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

  // 2 · Chụp sổ TRƯỚC (đã mở xem trước ⇒ chứng minh xem trước không ghi: chụp sau đó vẫn là sổ gốc, so ở bước cuối).
  const truoc = await chupSo(n1.page, k.hocVien);
  ca.thongTin(a1, `Sổ của «${k.hocVien}» (mọi kỳ) TRƯỚC khi xử lý`, { soDong: truoc.length, dong: truoc });
  if (truoc.length === 0) ca.biChan(`Sổ không có dòng nào của «${k.hocVien}» — không có gì để đối chiếu sổ cũ.`);

  // 3 · N1 lập đề nghị.
  await moHangCho(n1.page);
  hang = dongHangCho(n1.page, k.nhan).first();
  hop = await moXuLy(n1.page, hang);
  await hop.getByRole("radio", { name: /Giải phóng/ }).check();
  await hop.getByLabel(/^Lý do/).fill(LY_DO(`de nghi ${k.ten}`));
  await hop.getByLabel(/^Bằng chứng/).fill(BANG_CHUNG(k.ten));
  const nutGui = hop.locator("[data-xac-nhan=XU_LY_HANG_CHO]");
  const nhanNut = gon(await nutGui.innerText());
  await nutGui.click();
  await expect(n1.page.getByRole("dialog")).toBeHidden({ timeout: 60_000 });
  await moHangCho(n1.page);
  const sauDeNghi = gon(await dongHangCho(n1.page, k.nhan).first().innerText());
  ca.buoc({ actor: a1, action: "N1 lập đề nghị cấp 1 (Giải phóng) kèm lý do + bằng chứng", input: { nhanNut }, expected: "nút nói «Lập đề nghị (chờ người khác duyệt)» và dòng chuyển «Chờ người khác duyệt»", actual: { nhanNut, trangThai: /Chờ người khác duyệt/.test(sauDeNghi) }, pass: /Lập đề nghị/.test(nhanNut) && /Chờ người khác duyệt/.test(sauDeNghi), screenshots: [await ca.chup(n1.page, "sau-de-nghi", { fullPage: false })] });
  const giuaChung = await chupSo(n1.page, k.hocVien);
  ca.buoc({ actor: a1, action: "Sổ CHƯA đổi sau khi mới có đề nghị cấp 1", input: null, expected: "đúng các dòng như trước", actual: { truoc: truoc.length, sau: giuaChung.length }, pass: JSON.stringify(giuaChung) === JSON.stringify(truoc) });

  // 4 · N1 tự duyệt bị chặn (người đề nghị ≠ người duyệt).
  await moHangCho(n1.page);
  hop = await moXuLy(n1.page, dongHangCho(n1.page, k.nhan).first());
  await hop.getByRole("radio", { name: /Giải phóng/ }).check();
  await hop.getByLabel(/^Lý do/).fill(LY_DO(`n1 tu duyet ${k.ten}`));
  await hop.getByLabel(/^Bằng chứng/).fill(BANG_CHUNG(k.ten));
  const chuN1 = gon(await hop.innerText());
  const khoaN1 = await hop.locator("[data-xac-nhan=XU_LY_HANG_CHO]").isDisabled();
  ca.buoc({ actor: a1, action: "N1 mở lại hàng chờ của chính mình: có thông báo «cần một người KHÁC duyệt» và nút gửi bị KHOÁ", input: null, expected: { thongBao: true, nutKhoa: true }, actual: { thongBao: /cần một người KHÁC duyệt|chờ người KHÁC duyệt/.test(chuN1), nutKhoa: khoaN1 }, pass: /KHÁC duyệt/.test(chuN1) && khoaN1, screenshots: [await ca.chup(n1.page, "n1-tu-duyet-bi-chan", { fullPage: false })] });
  await hop.getByRole("button", { name: "Đóng", exact: true }).click();

  // 5 · N2 duyệt cấp 2.
  const n2 = await moVai("nguonduyet2");
  if (!(await moHangCho(n2.page))) ca.biChan("N2 không mở được tab Sổ.");
  const hop2 = await moXuLy(n2.page, dongHangCho(n2.page, k.nhan).first());
  const chuN2 = gon(await hop2.innerText());
  ca.buoc({ actor: a2, action: "N2 mở hàng chờ: thấy «Đề nghị cấp 1» của N1 (lý do, người, giờ)", input: null, expected: "có khối «Đề nghị cấp 1 (Giải phóng) bởi …»", actual: chuN2.match(/Đề nghị cấp 1[^:]*:[^:]*/)?.[0] ?? null, pass: /Đề nghị cấp 1 \(Giải phóng\) bởi/.test(chuN2) && !/chính bạn/.test(chuN2), screenshots: [await ca.chup(n2.page, "n2-thay-de-nghi", { fullPage: false })] });
  await hop2.getByRole("radio", { name: /Giải phóng/ }).check();
  await hop2.getByLabel(/^Lý do/).fill(LY_DO(`duyet cap 2 ${k.ten}`));
  await hop2.getByLabel(/^Bằng chứng/).fill(BANG_CHUNG(k.ten));
  const nutDuyet = hop2.locator("[data-xac-nhan=XU_LY_HANG_CHO]");
  const nhanDuyet = gon(await nutDuyet.innerText());
  const duocBam = await nutDuyet.isEnabled();
  ca.buoc({ actor: a2, action: "N2 (người KHÁC) có nút «Duyệt cấp 2 và giải phóng» bấm được", input: null, expected: "nút «Duyệt cấp 2 và giải phóng», bật", actual: { nhanDuyet, duocBam }, pass: /Duyệt cấp 2 và giải phóng/.test(nhanDuyet) && duocBam });
  await nutDuyet.click();
  await expect(n2.page.getByRole("dialog")).toBeHidden({ timeout: 90_000 });
  await moHangCho(n2.page);
  const conHang = await coThay(dongHangCho(n2.page, k.nhan).first(), 6_000);
  ca.buoc({ actor: a2, action: "Hàng chờ đóng sau khi N2 duyệt", input: k.nhan, expected: "dòng biến khỏi «Cần xử lý»", actual: conHang ? "còn dòng" : "đã đóng", pass: !conHang, screenshots: [await ca.chup(n2.page, "sau-duyet", { fullPage: false })] });

  // 6 · Sổ cũ KHÔNG đổi; chỉ THÊM dòng điều chỉnh.
  const sau = await chupSo(n2.page, k.hocVien);
  const matDoi = dongCuBiDoi(truoc, sau);
  const them = dongMoi(truoc, sau);
  ca.buoc({ actor: a2, action: "Sổ chỉ-thêm: MỌI dòng cũ còn NGUYÊN VĂN (kỳ · người hưởng · vai · tiền gốc · tỉ lệ · hoa hồng · trạng thái)", input: null, expected: { dongCuBiMatHoacDoi: 0 }, actual: { dongCuBiMatHoacDoi: matDoi.length, matDoi }, pass: matDoi.length === 0 });
  const tongMoi = them.reduce((t, d) => t + Math.abs(soTien(d.slice(d.lastIndexOf("%") + 1)) ?? 0), 0);
  ca.buoc({ actor: a2, action: "Có dòng điều chỉnh MỚI sau khi duyệt, tổng |tiền| các dòng mới = «Tổng tuyệt đối» đã xem ở bước xem trước", input: { tongTuyetDoiDaXem: xem.tongTuyetDoi }, expected: "≥ 1 dòng mới và tổng |tiền| bằng số đã xem", actual: { soDongMoi: them.length, dongMoi: them, tongTuyetDoiMoi: tongMoi }, pass: them.length >= 1 && tongMoi === xem.tongTuyetDoi, screenshots: [await ca.chup(n2.page, "so-sau-dieu-chinh")] });
}

test("[SRC-32] T1 · INPUT_DRIFT bốn mắt: xem trước → kiểm tiền → N1 đề nghị → N1 tự duyệt bị chặn → N2 duyệt → điều chỉnh MỚI, sổ cũ không đổi", async ({ ca, moVai }) => {
  await quyTrinhBonMat(ca, moVai, { nhan: NHAN_HANG.DRIFT, hocVien: HOC_VIEN.DRIFT, ten: "INPUT_DRIFT" });
});

test("[SRC-33] T1 · PAYMENT_WITHDRAWN bốn mắt: cùng quy trình, hướng xử lý của khoản thu bị rút (không còn khoản hưởng)", async ({ ca, moVai }) => {
  await quyTrinhBonMat(ca, moVai, { nhan: NHAN_HANG.WITHDRAWN, hocVien: HOC_VIEN.WITHDRAWN, ten: "PAYMENT_WITHDRAWN" });
});

// ── SRC-34: reopen — KHÔNG có đường giao diện để sinh lại một hàng chờ ĐÃ ĐÓNG ───────────────────────────────────────────────────────────────────────────
// «Reopen» (13 bước 10) = hàng chờ đã RESOLVED mở lại cùng `holdKey` khi đầu vào của đúng ô ấy đổi lần nữa; đề nghị cấp 1 lập TRƯỚC lúc mở lại phải hết hiệu lực (ảnh chụp `moLaiCuoiId`). Muốn có nó
// trên test phải (a) đổi lại đầu vào của khoản (người chốt / rút khoản thu) rồi (b) chạy quét — thao tác (a) trên dữ liệu fixture và (b) là cron/«Tính lại» của cả kỳ: không phải thứ một ca UAT giao diện được
// phép làm lên dữ liệu dùng chung. Nên ca này CHỈ ghi nhận hai điều đo được trên giao diện (hàng chờ đã đóng thật; không còn đề nghị nào treo) rồi BLOCKED, KHÔNG báo PASS cho phần reopen.
// Bằng chứng máy của phần reopen: `tests/hoa-hong/hang-cho-de-nghi-snapshot.spec.ts` (dòng REOPEN + đề nghị cũ vô hiệu) và `lib/hoa-hong/hang-cho-xu-ly.test.ts` (`ganDauVoHieu`) + `tests/hoa-hong/hang-cho-mo-lai-ap-dung-lai.spec.ts` (`[RAL-01..04]`: áp dụng lại sau khi mở lại, bước 10b của tài liệu 13).
test("[SRC-34] T1 · Reopen: đề nghị cũ vô hiệu sau khi hàng chờ mở lại — BLOCKED_NO_UI (không sinh lại hàng chờ đã đóng từ giao diện)", async ({ ca, moVai }) => {
  const n1 = await moVai("nguonduyet1");
  if (!(await moHangCho(n1.page))) ca.biChan("N1 không mở được tab Sổ — chưa chuẩn bị engine.");
  const dr = await coThay(dongHangCho(n1.page, NHAN_HANG.DRIFT).first(), 8_000);
  const wd = await coThay(dongHangCho(n1.page, NHAN_HANG.WITHDRAWN).first(), 4_000);
  ca.buoc({ actor: nhanActor("nguonduyet1"), action: "Hai hàng chờ fixture đều ĐÃ ĐÓNG sau SRC-32/33 (không còn đề nghị treo)", input: null, expected: { drift: false, withdrawn: false }, actual: { drift: dr, withdrawn: wd }, pass: !dr && !wd, screenshots: [await ca.chup(n1.page, "hang-cho-da-dong", { fullPage: false })] });
  ca.biChan("BLOCKED_NO_UI: không có thao tác giao diện nào sinh lại một hàng chờ đã đóng (cần đổi đầu vào khoản + chạy quét kỳ). Phần «đề nghị cũ vô hiệu sau reopen» được đo bằng tests/hoa-hong/hang-cho-de-nghi-snapshot.spec.ts (REOPEN), hang-cho-mo-lai-ap-dung-lai.spec.ts ([RAL-01..04]) và lib/hoa-hong/hang-cho-xu-ly.test.ts (ganDauVoHieu).");
});

// ── SRC-35: trả ngưỡng duyệt hai cấp về giá trị cũ (SRC-30 đã hạ) ─────────────────────────────────────────────────────────────────────────────────────
test("[SRC-35] T1 · Trả ngưỡng duyệt hai cấp về giá trị trước khi hạ (Admin)", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const hienTai = await docNguong(ad);
  canCo(ca, hienTai, "Admin không đọc được ô «ngưỡng duyệt hai cấp».");
  let goc = NGUONG_MAC_DINH;
  let nguon = "mặc định của hệ thống (không có tệp ghi giá trị gốc — SRC-30 chưa hạ ở lượt này)";
  try {
    goc = Number(readFileSync(TEP_NGUONG_GOC, "utf8"));
    nguon = "giá trị SRC-30 đã ghi trước khi hạ";
  } catch {
    /* giữ mặc định */
  }
  if (hienTai === goc) {
    ca.buoc({ actor: nhanActor("admin"), action: "ALREADY_DONE — ngưỡng đang đúng giá trị gốc", input: { hienTai, goc }, expected: "không đổi", actual: hienTai, pass: true });
    return;
  }
  if (hienTai !== NGUONG_THU) ca.biChan(`Ngưỡng hiện ${hienTai.toLocaleString("vi-VN")}đ không phải giá trị mà SRC-30 đặt (${NGUONG_THU.toLocaleString("vi-VN")}đ) — có người khác đã đổi; KHÔNG ghi đè.`);
  await datNguong(ca, ad, goc, "tra nguong duyet hai cap ve gia tri cu");
  ca.buoc({ actor: nhanActor("admin"), action: `Trả ngưỡng ${hienTai.toLocaleString("vi-VN")}đ → ${goc.toLocaleString("vi-VN")}đ (${nguon})`, input: { hienTai, goc }, expected: "ô hiển thị giá trị gốc sau khi tải lại", actual: goc, pass: true });
});
