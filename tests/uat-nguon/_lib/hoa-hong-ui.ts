// tests/uat-nguon/_lib/hoa-hong-ui.ts — thao tác giao diện dùng chung cho các ca đụng vào SỔ HOA HỒNG / HÀNG CHỜ (T1, nguồn → hoa hồng, hiển thị tiền theo quyền).
// Chỉ đọc thứ NGƯỜI DÙNG THẤY (role / nhãn / chữ); không testid mới.
import { expect, type Locator, type Page } from "@playwright/test";
import { coThay, di, moHopThoai } from "./thao-tac";

export const DUONG_SO = "/nguon-hoa-hong/so";
export const DUONG_SO_TAT_CA = (thang?: string): string => `${DUONG_SO}?xem=tat-ca${thang ? `&thang=${thang}` : ""}`;

export const gon = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Số tiền «800.000đ» → 800000 (bỏ dấu chấm ngăn nghìn). `null` nếu không có số. */
export function soTien(s: string): number | null {
  const m = /(-?\d{1,3}(?:\.\d{3})*)\s*đ/.exec(s);
  return m ? Number(m[1]!.replace(/\./g, "")) : null;
}

/** Dòng hàng chờ ở tab Sổ (chế độ «Cần xử lý») của một học viên. */
export const dongHangCho = (page: Page, tenHocVien: string): Locator => page.getByRole("row").filter({ hasText: tenHocVien });

/**
 * Đi tới tab Sổ ở chế độ «Cần xử lý». Trả `true` khi TRANG SỔ mở được (tiêu đề «Sổ hoa hồng» hiện) — kể cả khi không còn hàng chờ nào (trạng thái rỗng không có bảng);
 * `false` khi trang 404 (cờ engine tắt) hoặc báo thiếu quyền. Người gọi tự kiểm dòng hàng chờ mình cần bằng `dongHangCho`.
 */
export async function moHangCho(page: Page): Promise<boolean> {
  await di(page, DUONG_SO);
  if (!(await coThay(page.getByRole("heading", { name: "Sổ hoa hồng", exact: true }), 90_000))) return false;
  // Đợi phần thân tải xong: bảng hàng chờ, hoặc trạng thái rỗng, hoặc dòng «Chưa có quyền».
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  return true;
}

/** Mở hộp thoại «Xử lý hàng chờ …» của một dòng và đợi xem trước dựng xong (chạy các cổng, KHÔNG ghi). */
export async function moXuLy(page: Page, hang: Locator): Promise<Locator> {
  const hop = await moHopThoai(page, hang.getByRole("button", { name: "Xử lý", exact: true }));
  await expect(hop.getByText(/Nếu giải phóng bây giờ|Chưa giải phóng được/).first()).toBeVisible({ timeout: 90_000 });
  return hop;
}

export type XemTruocXuLy = { tienAnhHuong: number | null; tongTuyetDoi: number | null; ky: string | null; coGiaiPhong: boolean; chu: string };

/** Đọc xem trước của hộp thoại xử lý: «Tiền bị ảnh hưởng», «Tổng tuyệt đối», «ghi vào kỳ YYYY-MM», dòng cấp duyệt. */
export async function docXemTruoc(hop: Locator): Promise<XemTruocXuLy> {
  const chu = gon(await hop.innerText());
  const tien = /Tiền bị ảnh hưởng:\s*([\d.]+\s*đ)/.exec(chu)?.[1] ?? null;
  const tong = /Tổng tuyệt đối\s*([\d.]+\s*đ)/.exec(chu)?.[1] ?? null;
  return {
    tienAnhHuong: tien ? soTien(tien) : null,
    tongTuyetDoi: tong ? soTien(tong) : null,
    ky: /ghi vào kỳ (\d{4}-\d{2})/.exec(chu)?.[1] ?? null,
    coGiaiPhong: /Nếu giải phóng bây giờ/.test(chu),
    chu,
  };
}

/**
 * Ảnh chụp các dòng SỔ của một học viên ở MỌI kỳ (tab Sổ «Tất cả», đi hết các trang): mỗi phần tử là chữ chuẩn hoá của MỘT dòng — kỳ · người hưởng · vai · học viên · nguồn · loại · tiền gốc · tỉ lệ · hoa hồng · trạng thái.
 * Không lọc theo kỳ vì KỲ GHI của dòng điều chỉnh khác kỳ của dòng gốc (điều chỉnh ghi vào kỳ đang mở, dòng gốc ở kỳ của khoản thu).
 */
export async function chupSo(page: Page, tenHocVien: string): Promise<string[]> {
  const ra: string[] = [];
  for (let trang = 1; trang <= 12; trang++) {
    await di(page, `${DUONG_SO_TAT_CA()}&trang=${trang}`);
    if (!(await coThay(page.getByRole("columnheader", { name: /^Người hưởng$/ }), 90_000))) break;
    await page.waitForTimeout(400);
    const dongTrang = page.locator("tbody tr");
    const tong = await dongTrang.count();
    if (tong === 0) break;
    ra.push(...(await dongTrang.evaluateAll((trs, ten) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, " ").trim()).filter((t) => t.includes(ten)), tenHocVien)));
    if (tong < 25) break;
  }
  return ra.sort();
}

/** `truoc` có phải TẬP CON (đa tập) của `sau` không — mọi dòng cũ vẫn còn NGUYÊN VĂN. Trả danh sách dòng cũ bị mất/đổi (rỗng = sổ cũ không đổi). */
export function dongCuBiDoi(truoc: readonly string[], sau: readonly string[]): string[] {
  const con = [...sau];
  const mat: string[] = [];
  for (const d of truoc) {
    const i = con.indexOf(d);
    if (i < 0) mat.push(d);
    else con.splice(i, 1);
  }
  return mat;
}

/** Dòng MỚI của `sau` so với `truoc` (đa tập). */
export function dongMoi(truoc: readonly string[], sau: readonly string[]): string[] {
  const con = [...sau];
  for (const d of truoc) {
    const i = con.indexOf(d);
    if (i >= 0) con.splice(i, 1);
  }
  return con;
}
