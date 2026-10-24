// tests/uat-nguon/_lib/nhap-khach.ts — nhập MỘT phiếu khách bằng form «Nhập khách hàng» (đường THẬT của Sale) và các thao tác đọc phiếu dùng chung của nhóm ca nguồn tích hợp.
// Dữ liệu thử mang tiền tố `UAT SOURCE FINAL <mã đợt>`; SĐT thử qua `soDienThoaiThu`; «trùng số» ⇒ DỪNG (không bao giờ gắn tín hiệu nguồn vào lead của người khác).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { NhatKyCa } from "./nhat-ky";
import { DUONG_DAN, choHydrate, coThay, di, moOChonNguon } from "./thao-tac";

const thoat = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type NguoiGioiThieu = {
  /** Nhãn ô tìm: «Nhân sự giới thiệu» · «Phụ huynh giới thiệu» · «Đối tác giới thiệu». */
  nhan: string;
  /** Chữ gõ vào ô tìm (≥ 2 ký tự): mã nhân viên, tên phụ huynh, tên bé… */
  tuKhoa: string;
  /** Chữ phải có trong lựa chọn được bấm. */
  chon: RegExp;
};

export type KetQuaNhap = { href: string | null; ghiChu: string; trung: boolean; daTao: boolean };

/**
 * Nhập một phiếu: chọn nguồn (theo chữ của lựa chọn) · chọn người giới thiệu nếu nguồn đòi · giải trình nếu nguồn đòi · bấm «Lưu và nhập phiếu tiếp».
 * Trả liên kết «Mở» của phiếu vừa tạo (từ danh sách «Đã nhập trong phiên này»).
 */
export async function nhapPhieu(
  ca: NhatKyCa,
  page: Page,
  o: { ten: string; sdt: string; nguon: RegExp; nguoi?: NguoiGioiThieu; giaiTrinh?: string; coSo?: string },
): Promise<KetQuaNhap> {
  await di(page, DUONG_DAN.nhapKhach);
  if (!(await coThay(page.getByTestId("o-chon-nguon"), 60_000))) ca.biChan("Form nhập khách không có ô chọn nguồn: cờ nguon.enabled TẮT trên test (hoặc cơ sở chưa bật ép chọn nguồn).");
  await choHydrate(page.getByLabel("Tên phụ huynh"));
  await page.getByLabel("Tên phụ huynh").fill(o.ten);
  await page.getByLabel("SĐT phụ huynh").fill(o.sdt);
  if (o.coSo) await page.locator("#centerCode").selectOption({ label: o.coSo });
  const ds = await moOChonNguon(page);
  await ds.getByRole("option", { name: o.nguon }).first().click();
  if (o.nguoi) {
    const oTim = page.getByRole("combobox", { name: o.nguoi.nhan, exact: true });
    await expect(oTim).toBeVisible({ timeout: 30_000 });
    await oTim.click();
    await oTim.pressSequentially(o.nguoi.tuKhoa, { delay: 30 });
    const kq = page.getByRole("listbox", { name: /Kết quả tìm/ });
    await expect(kq).toBeVisible({ timeout: 30_000 });
    await kq.getByRole("option", { name: o.nguoi.chon }).first().click();
    await expect(page.getByRole("button", { name: new RegExp(`^Đổi ${thoat(o.nguoi.nhan.toLowerCase())}`) })).toBeVisible({ timeout: 15_000 });
  }
  if (o.giaiTrinh) await page.getByLabel("Giải trình nguồn").fill(o.giaiTrinh);
  await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
  const dong = page.getByRole("listitem").filter({ hasText: o.ten });
  await expect(dong.first()).toBeVisible({ timeout: 60_000 });
  const ghiChu = (await dong.first().innerText()).replace(/\s+/g, " ");
  const href = await dong.first().getByRole("link", { name: "Mở" }).getAttribute("href");
  return { href: href && /^\/leads\/[^/?#]+$/.test(href) ? href : null, ghiChu, trung: /trùng/i.test(ghiChu), daTao: /đã tạo/.test(ghiChu) };
}

export type KhoiNguon = { co: boolean; chu: string; truong: Record<string, string> };

/** Mở phiếu và đọc khối «Nguồn» (Server Component, stream muộn hơn phần đầu trang). `truong` = các cặp «nhãn → giá trị» của khối («Nguồn», «Người giới thiệu», «Cách xác định»…). */
export async function docKhoiNguon(page: Page, href: string, tenLead?: string): Promise<KhoiNguon> {
  await di(page, href);
  if (tenLead) await expect(page.locator("main")).toContainText(tenLead, { timeout: 90_000 });
  const khoi = page.locator("section[aria-labelledby='khoi-nguon-tieu-de']");
  if (!(await coThay(khoi, 60_000))) return { co: false, chu: "(không có khối «Nguồn» trên phiếu)", truong: {} };
  await expect(khoi.getByText(/Cách xác định|chưa có quy nguồn/).first()).toBeVisible({ timeout: 60_000 });
  const chu = (await khoi.first().innerText()).replace(/\s+/g, " ");
  const truong: Record<string, string> = {};
  const NHAN = ["Nguồn", "Người giới thiệu", "Cách xác định", "Ngày ghi công", "Còn hạn tới", "Đường vào (cũ)"];
  for (let i = 0; i < NHAN.length; i++) {
    const tu = chu.indexOf(` ${NHAN[i]} `, i === 0 ? 0 : 1);
    if (tu < 0) continue;
    let den = chu.length;
    for (let j = i + 1; j < NHAN.length; j++) {
      const k = chu.indexOf(` ${NHAN[j]} `, tu + 1);
      if (k >= 0 && k < den) den = k;
    }
    truong[NHAN[i]!] = chu.slice(tu + NHAN[i]!.length + 2, den).trim();
  }
  return { co: true, chu, truong };
}

/** Đọc một ô «NHÃN → giá trị» của phần «Thông tin khách hàng» (nhãn IN HOA: «SALE PHỤ TRÁCH», «CƠ SỞ»…): lấy chữ liền sau nhãn tới nhãn kế. */
export async function docThongTin(page: Page, nhan: string): Promise<string | null> {
  const chu = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const m = new RegExp(`${thoat(nhan)} (.+?) (?:TÊN CON|TUỔI|KHOÁ QUAN TÂM|CƠ SỞ|ĐƯỜNG VÀO|SALE PHỤ TRÁCH|NGÀY NHẬN LEAD|LẦN NHẬP GẦN NHẤT|GHI CHÚ|NHÂN VIÊN NHẬP|Nguồn)`, "i").exec(chu);
  return m ? m[1]!.trim() : null;
}

// ── Trạng thái dùng chung giữa các ca của MỘT lượt chạy (cùng mã đợt): liên kết phiếu đã tạo ở ca trước ─────────────────────────────────────────────────
const tepTrangThai = (dot: string): string => join(process.env.UAT_PHIEN_DIR?.trim() || join(process.env.RUNNER_TEMP ?? process.env.TEMP ?? "/tmp", "uat-nguon-phien"), `tich-hop-${dot}.json`);

export function luuTrangThai(dot: string, khoa: string, gia: string): void {
  const tep = tepTrangThai(dot);
  let hien: Record<string, string> = {};
  try {
    hien = JSON.parse(readFileSync(tep, "utf8")) as Record<string, string>;
  } catch {
    /* chưa có */
  }
  hien[khoa] = gia;
  mkdirSync(dirname(tep), { recursive: true });
  writeFileSync(tep, JSON.stringify(hien), "utf8");
}

export function docTrangThai(dot: string, khoa: string): string | null {
  try {
    return (JSON.parse(readFileSync(tepTrangThai(dot), "utf8")) as Record<string, string>)[khoa] ?? null;
  } catch {
    return null;
  }
}

/** Tìm một phiếu theo SĐT ở danh sách lead (admin) → liên kết `/leads/<id>`; null nếu không thấy. Đợi dòng tổng/trạng thái rỗng của bảng (ô tìm hiện trước bảng), và thử lại có tải lại vài lần (lead vừa tạo có thể chưa vào danh sách). */
export async function timPhieuTheoSdt(page: Page, sdt: string): Promise<string | null> {
  for (let lan = 1; lan <= 4; lan++) {
    await di(page, DUONG_DAN.leads(sdt));
    await coThay(page.getByText(/Tổng \d+ lead|Chưa có lead nào/), 60_000);
    const dong: Locator = page.getByRole("row").filter({ hasText: sdt }).first();
    if (await coThay(dong, lan === 1 ? 20_000 : 8_000)) return await dong.getByRole("link").first().getAttribute("href");
    await page.waitForTimeout(3_000);
  }
  return null;
}
