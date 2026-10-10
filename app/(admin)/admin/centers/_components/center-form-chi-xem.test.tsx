// @vitest-environment jsdom
/**
 * [HN2-RD-05] — form hồ sơ cơ sở NÓI THẬT với người không có `centers:edit` (rà đối kháng Việc 2, 09/10/2026).
 *
 * Sau Việc 2 trang `/centers/<id>/edit` là ĐIỂM ĐẾN CHÍNH của Kế toán Hội sở (ba lối "khai máy POS" đều trỏ về đây) — người có
 * `payments:import-pos` nhưng KHÔNG có `centers:edit`. Bản cũ vẽ nút "Cập nhật" bật sẵn + 20 ô hồ sơ sửa được: bấm ⇒ `updateCenter →
 * requireOrgAdmin` ⇒ `redirect('/dashboard?error=unauthorized')`, người dùng bị văng, không một câu giải thích, và dễ tưởng việc khai máy
 * vừa làm cũng hỏng (thực ra đã lưu). Đo bằng trình duyệt thật: nút `{"t":"Cập nhật","disabled":false}` → `/dashboard?error=unauthorized`,
 * 0 toast. Lời hứa suông không ném lỗi, không làm test đỏ — chỉ người bấm mới biết (luật 12).
 *
 * Bản vá: `suaDuocHoSo` (BẮT BUỘC) — false ⇒ các mục hồ sơ nằm trong `<fieldset disabled>`, nút "Cập nhật/Huỷ" đổi thành "Quay lại danh
 * sách" + một câu nói rõ. Mục Thanh toán và Máy POS đứng NGOÀI fieldset (`<fieldset disabled>` vô hiệu MỌI <button> con — bọc chúng là
 * làm chết nút Thêm / Sửa / công tắc, đúng việc người ta tới đây để làm).
 *
 * Đối chứng dương (luật 11): `suaDuocHoSo = true` ⇒ CÓ nút "Cập nhật", ô sửa được — không có vế này thì mọi khẳng định "không thấy" ở
 * dưới xanh được cả khi form chưa bao giờ vẽ nút cho bất kỳ ai.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MucMayPosView } from "@/lib/payments/pos/may-o-co-so";

const h = vi.hoisted(() => ({
  createCenter: vi.fn(),
  updateCenter: vi.fn(),
  taoMayPosAction: vi.fn(),
  suaMayPosAction: vi.fn(),
  batTatMayPosAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("../_actions", () => ({ createCenter: h.createCenter, updateCenter: h.updateCenter }));
vi.mock("../_may-pos-actions", () => ({
  taoMayPosAction: h.taoMayPosAction,
  suaMayPosAction: h.suaMayPosAction,
  batTatMayPosAction: h.batTatMayPosAction,
}));
vi.mock("@/components/admin/ImageUploader", () => ({
  // Một nút THẬT trong cụm "Hình ảnh" để đo được fieldset có vô hiệu nó không.
  ImageUploader: ({ label }: { label: string }) => <button type="button">{`Tải ảnh: ${label}`}</button>,
}));

class ResizeObserverGia {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverGia);

import { CenterForm } from "./center-form";
import { MucMayPos } from "./muc-may-pos";

const CENTER = {
  id: "cs1",
  name: "CS1 - 211 Nguyễn Hữu Thọ",
  slug: "cs1",
  address: "211 Nguyễn Hữu Thọ",
  ward: null,
  district: null,
  city: "Đà Nẵng",
  phone: null,
  email: null,
  googleMapUrl: null,
  workingHours: null,
  managerName: null,
  managerUserId: null,
  logoUrl: null,
  bannerUrl: null,
  description: null,
  isActive: true,
  displayOrder: 0,
  latitude: null,
  longitude: null,
  allowedRadiusMeters: 150,
};

const VIEW_GHI_DUOC: MucMayPosView = {
  coSo: { id: "cs1", ten: CENTER.name, dangHoatDong: true },
  quyen: { xem: true, sua: true, them: true, lyDoKhongThem: null },
  moDuocBienDong: true,
  may: [
    {
      id: "m1",
      maThietBi: "SP_GINI_X990_V9E1013321",
      maQuay: "QTT45XWQT",
      ten: "Máy quầy lễ tân",
      maCuaHang: null,
      maNhaCungCap: null,
      maTcbQuay: null,
      active: true,
      taoLuc: "2026-10-05T03:00:00.000Z",
      agent: null,
    },
  ],
};

function dung(suaDuocHoSo: boolean) {
  return render(
    <CenterForm
      center={CENTER}
      suaDuocHoSo={suaDuocHoSo}
      payment={{ methods: [], sharedCount: 2, canManage: true }}
      mayPos={<MucMayPos view={VIEW_GHI_DUOC} />}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.updateCenter.mockResolvedValue({});
});
afterEach(() => cleanup());

describe("[HN2-RD-05a] KHÔNG có `centers:edit` ⇒ form hồ sơ chỉ-xem, nói thật", () => {
  it("không có nút 'Cập nhật' / 'Huỷ'; có 'Quay lại danh sách' trỏ /centers và một câu nói rõ vì sao", () => {
    dung(false);
    expect(screen.queryByRole("button", { name: "Cập nhật" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Huỷ" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tạo cơ sở/ })).toBeNull();
    const lk = screen.getByRole("link", { name: /Quay lại danh sách/ });
    expect(lk.getAttribute("href")).toBe("/centers");
    expect(document.body.textContent).toMatch(/Hồ sơ cơ sở chỉ Quản trị tối cao sửa/);
  });

  it("các ô hồ sơ và nút ảnh bị khoá (Tên cơ sở · Địa chỉ · Vĩ độ · Display Order · Tải ảnh) — cả ba cụm", () => {
    dung(false);
    expect(screen.getByLabelText(/^Tên cơ sở/)).toBeDisabled();
    expect(screen.getByLabelText(/^Địa chỉ/)).toBeDisabled();
    expect(screen.getByLabelText(/^Vĩ độ/)).toBeDisabled();
    expect(screen.getByLabelText(/^Display Order/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Tải ảnh: Logo chi nhánh/ })).toBeDisabled();
  });

  it("ô bị khoá TRÔNG khác ô sửa được (luật 12): có kiểu `disabled:` — preflight xoá kiểu mặc định của trình duyệt, không tự vẽ thì hai trạng thái giống hệt nhau", () => {
    dung(false);
    const cls = screen.getByLabelText(/^Tên cơ sở/).className;
    expect(cls).toMatch(/disabled:bg-muted/);
    expect(cls).toMatch(/disabled:text-muted-foreground/);
    expect(cls).toMatch(/disabled:cursor-not-allowed/);
    // Ô chọn "Tài khoản quản lý cơ sở" (một <select> riêng, không đi qua `Field`) — chỉ có khi sửa cơ sở có `nguoiChon`; kiểm trên mã.
    const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/centers/_components/center-form.tsx"), "utf8");
    expect(ma.match(/<select[\s\S]*?className="([^"]*)"/)?.[1] ?? "").toMatch(/disabled:bg-muted/);
  });

  it("mục Máy POS và mục Thanh toán NGOÀI vùng khoá: nút Thêm / Sửa / công tắc vẫn bấm được, link 'Tạo phương thức thanh toán' còn", () => {
    dung(false);
    const may = document.getElementById("may-pos") as HTMLElement;
    expect(within(may).getByRole("button", { name: /Thêm máy POS/ })).toBeEnabled();
    expect(within(may).getByRole("button", { name: /^Sửa máy/ })).toBeEnabled();
    expect(within(may).getByRole("switch")).toBeEnabled();
    expect(may.closest("fieldset"), "mục máy POS không nằm trong fieldset").toBeNull();
    expect(screen.getByRole("link", { name: /Tạo phương thức thanh toán/ })).toBeInTheDocument();
    expect(screen.getByText("Thanh toán").closest("fieldset")).toBeNull();
  });

  it("phòng hờ: gửi form (Enter / sự kiện lạ) KHÔNG gọi `updateCenter` — máy chủ sẽ đá /dashboard", () => {
    dung(false);
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(h.updateCenter).not.toHaveBeenCalled();
    expect(h.createCenter).not.toHaveBeenCalled();
  });
});

describe("[HN2-RD-05b] đối chứng dương: CÓ `centers:edit` ⇒ hành vi y như trước", () => {
  it("có nút 'Cập nhật' + 'Huỷ'; không có 'Quay lại danh sách' và không có câu chỉ-xem", () => {
    dung(true);
    expect(screen.getByRole("button", { name: "Cập nhật" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Huỷ" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /Quay lại danh sách/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Hồ sơ cơ sở chỉ Quản trị tối cao sửa/);
  });

  it("các ô hồ sơ sửa được, nút ảnh bấm được", () => {
    dung(true);
    expect(screen.getByLabelText(/^Tên cơ sở/)).toBeEnabled();
    expect(screen.getByLabelText(/^Địa chỉ/)).toBeEnabled();
    expect(screen.getByRole("button", { name: /Tải ảnh: Logo chi nhánh/ })).toBeEnabled();
  });

  it("gửi form ⇒ `updateCenter` được gọi (đường ghi còn sống)", async () => {
    dung(true);
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật" }));
    await vi.waitFor(() => expect(h.updateCenter).toHaveBeenCalledTimes(1));
  });
});
