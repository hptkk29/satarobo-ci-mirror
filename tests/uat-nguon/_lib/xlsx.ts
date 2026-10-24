// tests/uat-nguon/_lib/xlsx.ts — dựng tệp Excel NHẬP LEAD ngay trong ca (không tệp mẫu nằm trong repo, không ghi đĩa): bộ nhớ → `setInputFiles`.
// Tiêu đề cột PHẢI trùng `LEAD_IMPORT_COLUMNS` của ứng dụng (`lib/lead/import.ts`) — lưới `[UTH-W2]` (lib/uat/uat-nguon-tich-hop.test.ts) so hai danh sách, nên đổi cột ở ứng dụng mà quên ở đây là đỏ.
import ExcelJS from "exceljs";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { choHydrate, coThay, di } from "./thao-tac";

export const COT_NHAP_LEAD = [
  "Tên phụ huynh",
  "SĐT",
  "Email",
  "Tên con",
  "Tuổi con",
  "Cơ sở (mã CS, để trống)",
  "Khoá quan tâm",
  "Nguồn",
  "Ghi chú",
  "Sale phụ trách (email hoặc mã NV, để trống)",
  "Mã NV giới thiệu",
] as const;

export type DongNhapLead = Partial<Record<(typeof COT_NHAP_LEAD)[number], string>>;

export async function taoXlsxNhapLead(dong: readonly DongNhapLead[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Lead");
  ws.addRow([...COT_NHAP_LEAD]);
  for (const d of dong) ws.addRow(COT_NHAP_LEAD.map((c) => d[c] ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type KetQuaTaiLen = { hopLe: number; loi: number; chu: string };

/** Mở màn «Nhập lead từ Excel», tải tệp lên bằng ô chọn tệp THẬT, đợi bảng xem trước, trả số dòng Hợp lệ / Lỗi người dùng thấy. */
export async function taiTepNhapLead(page: Page, tep: Buffer): Promise<KetQuaTaiLen> {
  await di(page, "/leads/import");
  const o = page.locator("input[type=file]").first();
  await expect(o).toBeAttached({ timeout: 60_000 });
  await choHydrate(o); // chọn tệp trước lúc React gắn xong = sự kiện change bị mất, không có lỗi nào
  await o.setInputFiles({ name: "uat-nhap-lead.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: tep });
  await expect(page.getByText(/dòng đọc được/)).toBeVisible({ timeout: 60_000 });
  const chu = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const so = (nhan: string): number => Number(new RegExp(`${nhan} (\\d+)`).exec(chu)?.[1] ?? "NaN");
  return { hopLe: so("Hợp lệ"), loi: so("Lỗi"), chu };
}

/** Bấm «Nhập N dòng» và đợi màn kết quả (có nút «Nhập file khác»). Trả chữ của màn kết quả. */
export async function bamNhapVaDocKetQua(page: Page): Promise<string> {
  await page.getByRole("button", { name: /^Nhập \d+ dòng/ }).click();
  await expect(page.getByRole("button", { name: /Nhập file khác/ })).toBeVisible({ timeout: 120_000 });
  if (!(await coThay(page.getByText(/Tạo mới/).first(), 15_000))) return "(không thấy dòng «Tạo mới» ở màn kết quả)";
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}
