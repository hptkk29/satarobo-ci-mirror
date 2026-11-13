// tests/uat-nguon/_lib/thao-tac.ts — thao tác giao diện dùng chung của các ca UAT Nguồn.
// Chỉ dùng thứ NGƯỜI DÙNG THẤY (role / nhãn / chữ) — không testid, không class. Ô đã có nhãn `<label htmlFor>` nên `getByLabel` đủ.
import { expect, type Locator, type Page } from "@playwright/test";

export const DUONG_DAN = {
  danhSach: "/nguon-hoa-hong/nguon?xem=tat-ca",
  tao: "/nguon-hoa-hong/nguon/tao",
  chiTiet: (ma: string) => `/nguon-hoa-hong/nguon/${encodeURIComponent(ma)}`,
  sua: (ma: string) => `/nguon-hoa-hong/nguon/${encodeURIComponent(ma)}/sua`,
  nhapKhach: "/nhap-khach-hang",
  leads: (q: string) => `/leads?q=${encodeURIComponent(q)}`,
} as const;

/** Đi tới đường dẫn và đợi DOM sẵn sàng (trang admin là RSC + loading.tsx: `networkidle` không đáng tin). */
export async function di(page: Page, duong: string): Promise<void> {
  await page.goto(duong, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

/**
 * Đợi React gắn xong vào phần tử (hydrate). Điền/bấm TRƯỚC lúc đó là mất: biểu mẫu `<form>` chưa có `onSubmit` sẽ gửi GET thuần (ô nhập
 * hiện thành query string) hoặc hydrate xoá trắng ô đã điền. React gắn khoá `__reactProps$…` lên nút DOM khi đã hydrate xong.
 */
export async function choHydrate(loc: Locator): Promise<void> {
  await expect
    .poll(() => loc.first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))).catch(() => false), {
      timeout: 90_000,
      message: "trang chưa hydrate xong (React chưa gắn vào ô nhập)",
    })
    .toBe(true);
}

/**
 * Phần tử có hiện ra TRONG thời hạn không. KHÔNG dùng `locator.isVisible({ timeout })`: tuỳ chọn `timeout` của nó bị bỏ qua (trả ngay), nên trang
 * đang biên dịch/tải chậm bị đọc nhầm thành "không có" ⇒ ca BLOCKED oan. `waitFor` mới thật sự đợi.
 */
export async function coThay(loc: Locator, timeoutMs: number): Promise<boolean> {
  return loc.first().waitFor({ state: "visible", timeout: timeoutMs }).then(() => true, () => false);
}

/**
 * Số điện thoại thử trong một lượt chạy (đầu 03 + 8 chữ số suy từ mã đợt và số thứ tự). Hợp lệ với `canonicalPhone` (chỉ cần đầu số 3/5/7/8/9 + 9 chữ số) nên không bị chuẩn hoá làm lệch,
 * NHƯNG nhìn như số Viettel thật: KHÔNG có gì đảm bảo nó chưa thuộc về một khách khác trên test. Vì vậy mọi nơi dùng phải đọc kết quả lưu — «trùng số» ⇒ DỪNG và báo (không gắn tín hiệu
 * nguồn vào lead của người khác), xem `taoLeadThu` và SRC-05.
 */
export function soDienThoaiThu(dot: string, n: number): string {
  let h = 0;
  for (const c of `${dot}#${n}`) h = (h * 131 + c.charCodeAt(0)) % 100_000_000;
  return `03${String(h).padStart(8, "0")}`;
}

export type TaoNguonInput = {
  ten: string;
  ma: string;
  /** Nhãn hiển thị của nhóm nguồn trong ô chọn («Quảng cáo», «Khác»…). */
  nhom: string;
  moTa?: string;
  baoGiaiTrinh?: boolean;
  kichHoatNgay: boolean;
};

/** Điền biểu mẫu Tạo nguồn (chưa bấm Tạo). */
export async function dienFormTaoNguon(page: Page, i: TaoNguonInput): Promise<void> {
  await choHydrate(page.getByLabel("Tên nguồn"));
  await page.getByLabel("Tên nguồn").fill(i.ten);
  await page.getByLabel("Mã nguồn").fill(i.ma);
  await page.getByLabel("Nhóm nguồn").selectOption({ label: i.nhom });
  if (i.moTa) await page.getByLabel("Mô tả").fill(i.moTa);
  if (i.baoGiaiTrinh) await page.getByRole("switch", { name: "Bắt buộc giải trình" }).click();
  await page.getByRole("radio", { name: i.kichHoatNgay ? /Kích hoạt ngay/ : /Lưu nháp/ }).check();
}

/** Hàng của một nguồn trong bảng danh mục, tìm theo tên. */
export const hangNguon = (page: Page, ten: string): Locator => page.getByRole("row").filter({ hasText: ten });

/** Mở ô chọn nguồn («Nguồn khách hàng») ở biểu mẫu nhập khách và trả về listbox. */
export async function moOChonNguon(goc: Page | Locator): Promise<Locator> {
  const nut = goc.getByRole("combobox", { name: "Nguồn khách hàng" });
  await expect(nut).toBeVisible({ timeout: 30_000 });
  await nut.click();
  const ds = goc.getByRole("listbox", { name: "Danh sách nguồn khách hàng" });
  await expect(ds).toBeVisible();
  return ds;
}

/** Tên (chữ) của mọi lựa chọn đang hiện trong listbox. */
export async function tenCacLuaChon(ds: Locator): Promise<string[]> {
  const ra = await ds.getByRole("option").evaluateAll((os) => os.map((o) => (o.querySelector("span span")?.textContent ?? o.textContent ?? "").trim()));
  return ra.filter((s) => s !== "");
}

/**
 * Bấm nút mở một hộp thoại cho tới khi hộp thoại THẬT SỰ hiện. Bấm trước lúc React hydrate xong thì không có gì xảy ra (không lỗi, không hộp thoại) và
 * ca đứng chờ một nút xác nhận không bao giờ xuất hiện — nên mở bằng vòng thử-lại thay vì một cú bấm.
 */
export async function moHopThoai(page: Page, nut: Locator): Promise<Locator> {
  const hop = page.getByRole("dialog");
  await expect(async () => {
    await nut.click();
    await expect(hop).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 90_000, intervals: [500, 1_000, 2_000] });
  return hop;
}

/** Danh sách nguồn lọc theo MỘT trạng thái — danh sách đầy đủ có phân trang và mỗi lượt chạy để lại thêm nguồn «Tạm ngừng», nên dòng nguồn thử phải tìm trong danh sách ĐÃ LỌC (ngắn), không trong danh sách đầy. */
export const danhSachTheoTrangThai = (t: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED"): string => `/nguon-hoa-hong/nguon?xem=tat-ca&trangthai=${t}`;

/** Khai «Người phụ trách» ở biểu mẫu Tạo/Sửa nguồn bằng bộ chọn nhân sự (gõ mã nhân sự, chọn kết quả đầu). */
export async function khaiNguoiPhuTrach(page: Page, maNhanSu: string): Promise<void> {
  const o = page.getByRole("combobox", { name: /Người phụ trách/ });
  await choHydrate(o);
  await o.fill(maNhanSu);
  const ds = page.getByRole("listbox", { name: /Kết quả tìm/ });
  await expect(ds).toBeVisible({ timeout: 30_000 });
  await ds.getByRole("option").first().click();
}

/** Chữ giải thích đang hiện ở chân biểu mẫu (nút Lưu bị khoá nói lý do bằng `role=status`) — bỏ vùng thông báo rỗng. */
export async function chuGiaiThichChanLuu(page: Page): Promise<string> {
  const ds = await page.getByRole("status").allInnerTexts();
  return ds.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t !== "").join(" | ");
}
