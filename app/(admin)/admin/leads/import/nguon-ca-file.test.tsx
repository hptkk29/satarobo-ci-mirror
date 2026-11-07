// @vitest-environment jsdom
/**
 * [NCF-UI-*] — «NGUỒN CỦA CẢ FILE» ở HAI màn nhập Excel lead (28/10/2026), trên PHẦN TỬ THẬT (jsdom), fetch được giả.
 *
 *   [NCF-UI-01]  màn nhập sự kiện, module TẮT (`nguon={null}`): KHÔNG có ô chọn, nút Nhập bấm được, request mang `nguonChon: null` (hành vi cũ)
 *   [NCF-UI-02]  module BẬT: có ô chọn; CHƯA chọn ⇒ nút Nhập KHOÁ + câu nói vì sao; chọn xong ⇒ nút mở, request mang ĐÚNG `nguonChon`
 *   [NCF-UI-03]  nguồn ĐÒI NGƯỜI mà chưa chọn người ⇒ nút vẫn khoá và lỗi hiện cạnh ô (cùng câu máy chủ sẽ trả); không gửi request nào
 *   [NCF-UI-04]  màn «đã đăng ký»: chưa chọn nguồn ⇒ CẢ «Xem thử» lẫn «Xác nhận ghi» khoá; chọn ⇒ xem thử gửi `nguonChon` (FormData, chuỗi JSON); đổi nguồn sau khi xem thử ⇒ bản xem thử bị BỎ (buộc xem thử lại)
 * Cổng thật nằm ở route (`docVaEpNguonCaFile`, ca DB [XCF-*]) — ở đây chỉ canh giao diện không hứa suông và không gửi thiếu.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Ô chọn người (ReferrerPicker) import Server Action tìm người — kéo next-auth vào jsdom. Ca nào cần tìm người thì tự đặt kết quả.
const TIM = vi.hoisted(() => vi.fn(async (_: unknown) => ({ ok: true as const, ketQua: [] as unknown[] })));
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({ timNguoiGioiThieuAction: TIM, moGanNguonAction: vi.fn(), doiNguonLeadAction: vi.fn() }));
// Khung nhập Excel đọc file bằng `xlsx` ở trình duyệt: thay tầng đọc nhị phân, giữ nguyên mọi đường còn lại (cùng cách `components/admin/ExcelImporter.test.tsx`).
vi.mock("xlsx", () => ({
  read: () => ({ SheetNames: ["S"], Sheets: { S: {} } }),
  utils: { sheet_to_json: () => (globalThis as { __dong?: Record<string, unknown>[] }).__dong ?? [] },
}));

import { ManNhapLead } from "./_components/man-nhap-lead";
import { ManNhapDaDangKy } from "./registered/_components/man-nhap-da-dang-ky";
import { GHI_CHU_MOT_FILE_MOT_NGUON } from "@/lib/nguon/nguon-ca-file-ghi-chu";
import type { NhomChon } from "@/lib/nguon/chon-nguon";
import type { NguonChoFormNhap } from "@/lib/nguon/nguon-cho-form-nhap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const g = (p: Partial<NhomChon> & Pick<NhomChon, "id" | "code" | "name">): NhomChon => ({
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  sortOrder: 1,
  ...p,
});
const NGUON: NguonChoFormNhap = {
  danhMuc: [
    g({ id: "g2", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo" }),
    g({ id: "g5", code: "EMPLOYEE_REFERRAL", name: "Nguồn từ nhân sự giới thiệu", referrerRequirement: "EMPLOYEE" }),
  ],
  epMacDinh: true,
  epTheoCoSo: {},
};

const oNguon = () => screen.getByRole("combobox", { name: /Nguồn khách hàng/ });
function chonNguon(ten: RegExp | string) {
  const o = oNguon();
  if (o.getAttribute("aria-expanded") !== "true") fireEvent.click(o);
  fireEvent.click(screen.getByRole("option", { name: ten }));
}

// ── Màn nhập sự kiện ──
type Goi = { url: string; body: Record<string, unknown> | null };
function giaFetchSuKien(): Goi[] {
  const goi: Goi[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      goi.push({ url, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
      if (url.includes("/precheck")) return { ok: true, status: 200, json: async () => ({ matches: [] }) };
      return { ok: true, status: 200, json: async () => ({ success: 1, errors: [] }) };
    }),
  );
  return goi;
}
async function napFileSuKien() {
  (globalThis as { __dong?: Record<string, unknown>[] }).__dong = [{ "Tên phụ huynh": "Chị An", SĐT: "0905123456" }];
  const o = document.querySelector('input[type="file"]') as HTMLInputElement;
  const f = new File([new Uint8Array([1])], "thu.xlsx");
  Object.defineProperty(f, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  Object.defineProperty(o, "files", { value: [f], configurable: true });
  fireEvent.change(o);
  await screen.findByRole("tab", { name: /Hợp lệ/ });
}
const nutNhap = () => screen.getByRole("button", { name: /^Nhập \d+ dòng/ });
const laiGoiNhap = (goi: Goi[]) => goi.filter((x) => x.url === "/api/admin/import/leads");

describe("[NCF-UI] màn nhập lead sự kiện", () => {
  it("[NCF-UI-01] module TẮT (`nguon={null}`) ⇒ KHÔNG có ô chọn nguồn, nút Nhập bấm được, request mang `nguonChon: null` — hành vi cũ", async () => {
    const goi = giaFetchSuKien();
    render(<ManNhapLead duocDe={false} nguon={null} />);
    expect(screen.queryByTestId("nguon-ca-file")).toBeNull();
    await napFileSuKien();
    expect(nutNhap()).not.toBeDisabled();
    expect(screen.queryByTestId("khong-cho-nhap")).toBeNull();
    fireEvent.click(nutNhap());
    await waitFor(() => expect(laiGoiNhap(goi)).toHaveLength(1));
    expect(laiGoiNhap(goi)[0]!.body).toMatchObject({ nguonChon: null });
  });

  it("[NCF-UI-02] module BẬT ⇒ có ô chọn; CHƯA chọn ⇒ nút Nhập KHOÁ + câu nói vì sao; chọn xong ⇒ nút mở, request mang ĐÚNG `nguonChon`", async () => {
    // Cấy: bỏ `khongChoNhap={nguonCaFile.khongChoNhap}` khỏi `<ExcelImporter>` ⇒ nút bấm được khi chưa chọn nguồn ⇒ khẳng định khoá đỏ.
    // Cấy: bỏ `nguonChon: nguonCaFile.nguonChon` khỏi thân request ⇒ request không mang lựa chọn ⇒ khẳng định cuối đỏ.
    const goi = giaFetchSuKien();
    render(<ManNhapLead duocDe={false} nguon={NGUON} />);
    expect(screen.getByTestId("nguon-ca-file")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Nguồn của cả file/ })).toBeTruthy();
    await napFileSuKien();
    expect(nutNhap()).toBeDisabled();
    expect(screen.getByTestId("khong-cho-nhap").textContent).toMatch(/«Nguồn của cả file»/);

    chonNguon(/Nguồn từ Quảng Cáo/);
    expect(nutNhap()).not.toBeDisabled();
    expect(screen.queryByTestId("khong-cho-nhap")).toBeNull();
    fireEvent.click(nutNhap());
    await waitFor(() => expect(laiGoiNhap(goi)).toHaveLength(1));
    expect(laiGoiNhap(goi)[0]!.body).toMatchObject({
      nguonChon: { groupId: "g2", employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null },
    });
  });

  it("[NCF-UI-03] nguồn ĐÒI NGƯỜI mà chưa chọn người ⇒ nút vẫn khoá, lỗi đúng câu máy chủ hiện cạnh ô, KHÔNG gửi request nhập nào", async () => {
    const goi = giaFetchSuKien();
    render(<ManNhapLead duocDe={false} nguon={NGUON} />);
    await napFileSuKien();
    chonNguon(/Nguồn từ nhân sự giới thiệu/);
    expect(nutNhap()).toBeDisabled();
    expect(await screen.findByText("Nguồn này cần chọn nhân sự giới thiệu.")).toBeTruthy();
    fireEvent.click(nutNhap());
    expect(laiGoiNhap(goi)).toHaveLength(0);
  });
});

/**
 * Ghi chú «MỘT FILE = MỘT nguồn + MỘT người giới thiệu» phải: có mặt, đúng câu chung, IN ĐẬM ở đúng phần tử chứa chữ, KHÔNG ẩn (ancestor nào cũng không `hidden` / `aria-hidden` / `sr-only`),
 * và nằm SAU ô chọn nguồn ngay trong khối «Nguồn của cả file» (không phải tooltip / chú thích nhỏ).
 */
function kiemGhiChuMotNguoi() {
  const khoi = screen.getByTestId("nguon-ca-file");
  const ghiChu = screen.getByTestId("nguon-ca-file-ghi-chu");
  expect(khoi.contains(ghiChu)).toBe(true);
  expect(ghiChu.textContent).toBe(GHI_CHU_MOT_FILE_MOT_NGUON);
  expect(ghiChu.textContent).toMatch(/MỘT nguồn và MỘT người giới thiệu/);
  expect(ghiChu.textContent).toMatch(/chia thành các file riêng/);
  // In đậm: chính phần tử chứa chữ có `font-semibold`/`font-bold`, hoặc chữ nằm trọn trong `<strong>`/`<b>`.
  const dam = /\bfont-(semibold|bold)\b/.test(ghiChu.className) || ghiChu.closest("strong, b") !== null || ghiChu.querySelector("strong, b")?.textContent === GHI_CHU_MOT_FILE_MOT_NGUON;
  expect(dam).toBe(true);
  // Không ẩn.
  for (let el: HTMLElement | null = ghiChu; el && el !== document.body; el = el.parentElement) {
    expect(el.hidden).toBe(false);
    expect(el.getAttribute("aria-hidden")).not.toBe("true");
    expect(el.className).not.toMatch(/(^|\s)(hidden|sr-only)(\s|$)/);
  }
  // Ngay dưới ô chọn nguồn.
  expect(oNguon().compareDocumentPosition(ghiChu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe("[NCF-GC] ghi chú «một file = một nguồn + một người giới thiệu» ở HAI màn nhập", () => {
  it("[NCF-GC-01] màn nhập sự kiện (module BẬT) có ghi chú in đậm, không ẩn, nằm dưới ô nguồn", () => {
    // Cấy: bỏ `<p … data-testid="nguon-ca-file-ghi-chu">` khỏi `KhoiNguonCaFile` ⇒ ca này VÀ [NCF-GC-02] đỏ.
    render(<ManNhapLead duocDe={false} nguon={NGUON} />);
    kiemGhiChuMotNguoi();
  });

  it("[NCF-GC-02] màn «đã đăng ký» (module BẬT) có ghi chú in đậm, không ẩn, nằm dưới ô nguồn", () => {
    render(<ManNhapDaDangKy nguon={NGUON} />);
    kiemGhiChuMotNguoi();
  });

  it("[NCF-GC-03] module TẮT ⇒ không có ô chọn nên cũng KHÔNG có ghi chú (không nói về thứ màn không có)", () => {
    render(<ManNhapLead duocDe={false} nguon={null} />);
    expect(screen.queryByTestId("nguon-ca-file-ghi-chu")).toBeNull();
    cleanup();
    render(<ManNhapDaDangKy nguon={null} />);
    expect(screen.queryByTestId("nguon-ca-file-ghi-chu")).toBeNull();
  });
});

// ── Màn «đã đăng ký» ──
const BASE = {
  mode: "dry-run",
  tongDongDoc: 1,
  boQua: 0,
  hopLe: 1,
  gopTrongFile: 0,
  loi: [],
  phuHuynh: 1,
  hocVien: 1,
  seTao: [{ sdt: "0907000001", tenPH: "A", soCon: 1 }],
  seGop: [],
  salesKhongKhop: [],
  khoaKhongKhop: [],
  coSoKhongKhop: [],
};
function giaFetchDangKy(): FormData[] {
  const forms: FormData[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: FormData }) => {
      if (init?.body) forms.push(init.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { ...BASE, mode: String(init?.body?.get("mode") ?? "dry-run") } }) };
    }),
  );
  return forms;
}
function chonFileDangKy(container: HTMLElement) {
  const o = container.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(o, { target: { files: [new File(["x"], "dang-ky.xlsx")] } });
}
const nutXemThu = () => screen.getByRole("button", { name: /Xem thử/ });

describe("[NCF-UI] màn «đã đăng ký»", () => {
  it("[NCF-UI-04] CHƯA chọn nguồn ⇒ «Xem thử» KHOÁ + câu nói vì sao; chọn ⇒ xem thử gửi `nguonChon` (chuỗi JSON); đổi nguồn sau khi xem thử ⇒ bản xem thử bị BỎ, phải xem thử lại", async () => {
    // Cấy: bỏ `|| !!nguonCaFile.khongChoNhap` khỏi nút «Xem thử» ⇒ khẳng định khoá đỏ. Cấy: bỏ `setPreview(null)` ở `doiNguonCaFile` ⇒ khẳng định cuối đỏ
    // (xem thử đo theo lựa chọn CŨ vẫn nằm đó, nút ghi vẫn bấm được với lựa chọn MỚI).
    const forms = giaFetchDangKy();
    const { container } = render(<ManNhapDaDangKy nguon={NGUON} />);
    expect(screen.getByTestId("nguon-ca-file")).toBeTruthy();
    chonFileDangKy(container);
    expect(nutXemThu()).toBeDisabled();
    expect(screen.getByTestId("khong-cho-nhap").textContent).toMatch(/«Nguồn của cả file»/);

    chonNguon(/Nguồn từ Quảng Cáo/);
    expect(nutXemThu()).not.toBeDisabled();
    fireEvent.click(nutXemThu());
    await waitFor(() => expect(forms).toHaveLength(1));
    expect(forms[0]!.get("mode")).toBe("dry-run");
    expect(JSON.parse(String(forms[0]!.get("nguonChon")))).toMatchObject({ groupId: "g2", employeeId: null });
    // Có bản xem thử ⇒ «Xác nhận ghi» mở được.
    const nutGhi = await screen.findByRole("button", { name: /Xác nhận ghi 1 phụ huynh/ });
    expect(nutGhi).not.toBeDisabled();

    // Đổi nguồn: bản xem thử CŨ bị bỏ ⇒ nút ghi quay về trạng thái chưa xem thử (khoá).
    chonNguon(/Nguồn từ nhân sự giới thiệu/); // đòi người, chưa chọn ⇒ cũng khoá «Xem thử»
    expect(screen.queryByText(/Phụ huynh sẽ ghi/)).toBeNull();
    expect(screen.getByRole("button", { name: /Xác nhận ghi vào hệ thống/ })).toBeDisabled();
    expect(nutXemThu()).toBeDisabled();
  });

  it("[NCF-UI-05] module TẮT (`nguon={null}`) ⇒ không ô chọn, «Xem thử» bấm được ngay sau khi chọn file, FormData KHÔNG có khoá `nguonChon`", async () => {
    const forms = giaFetchDangKy();
    const { container } = render(<ManNhapDaDangKy nguon={null} />);
    expect(screen.queryByTestId("nguon-ca-file")).toBeNull();
    chonFileDangKy(container);
    expect(nutXemThu()).not.toBeDisabled();
    fireEvent.click(nutXemThu());
    await waitFor(() => expect(forms).toHaveLength(1));
    expect(forms[0]!.has("nguonChon")).toBe(false);
  });
});
