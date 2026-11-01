// @vitest-environment jsdom
// Giao diện màn «Hồ sơ chờ AI»: logic HIỂN THỊ (che PII theo quyền, nút khoá + lý do, hành vi gửi, link ẩn khi thiếu mẫu). Action giả — cổng thật do `tests/ai-lead/duyet.spec.ts` canh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bangNut, type DauVaoNut } from "@/lib/ai-lead/dich-vu/hanh-dong-kha-dung";
import type { HangDanhSach } from "@/lib/ai-lead/dich-vu/duyet";

const m = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastOk: vi.fn(),
  toastErr: vi.fn(),
  duyet: vi.fn(),
  tuChoi: vi.fn(),
  boSung: vi.fn(),
  nhan: vi.fn(),
  chuyen: vi.fn(),
  tra: vi.fn(),
  baoNhan: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: m.toastOk, error: m.toastErr } }));
vi.mock("../_actions", () => ({
  duyetAction: m.duyet,
  tuChoiAction: m.tuChoi,
  boSungAction: m.boSung,
  nhanXuLyAction: m.nhan,
  chuyenNguoiAction: m.chuyen,
  traHoSoAction: m.tra,
  baoDaNhanAction: m.baoNhan,
}));

import { KhoiXuLy, type DauVaoKhoiXuLy } from "./khoi-xu-ly";
import { BangHoSo } from "./bang-ho-so";
import { BoLoc } from "./bo-loc";

const NUT_GOC: DauVaoNut = { state: "READY_FOR_REVIEW", claimedById: "me", claimedBoiToi: true, claimedTen: null, coQuyenReview: true, thieu: [], ownerState: "AI_ACTIVE" };
const ban = { fbName: "Nguyễn Thị Lan", phone: "84905123456", goiYFbName: "", goiYPhone: "" };

function dung(over: Partial<DauVaoKhoiXuLy> & { nut?: Partial<DauVaoNut> } = {}) {
  const { nut, ...rest } = over;
  return render(
    <KhoiXuLy
      draftId="ho-so-1"
      version={7}
      bang={bangNut({ ...NUT_GOC, ...nut })}
      ban={ban}
      coSoCoThe={[{ id: "cs-b", ten: "Cơ sở B" }]}
      coSoHienTai="Cơ sở A"
      ungVien={[{ id: "u2", ten: "Chị Hoa" }]}
      {...rest}
    />,
  );
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.duyet.mockResolvedValue({ ok: true, data: { leadId: "l1" } });
  m.tuChoi.mockResolvedValue({ ok: true, data: {} });
  m.boSung.mockResolvedValue({ ok: true, data: {} });
});
afterEach(cleanup);

describe("[GD-XL] khối xử lý — nút nói thật", () => {
  it("[GD-XL-01] thiếu điều kiện: «Duyệt» TỐI và lý do hiện NGAY cạnh nút (không giấu trong tooltip), gắn aria-describedby", () => {
    dung({ nut: { thieu: ["fbName", "campus"] } });
    const nut = screen.getByRole("button", { name: /Duyệt, tạo lead/ });
    expect(nut).toBeDisabled();
    const id = nut.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toMatch(/Tên Facebook[\s\S]*cơ sở/);
    // đối chứng DƯƠNG: đủ điều kiện thì sáng
    cleanup();
    dung();
    expect(screen.getByRole("button", { name: /Duyệt, tạo lead/ })).toBeEnabled();
  });

  it("[GD-XL-02] chỉ có quyền XEM: không nút ghi nào được vẽ, có lời giải thích nêu đúng quyền", () => {
    dung({ nut: { coQuyenReview: false } });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/ai-leads:review/)).toBeInTheDocument();
  });

  it("[GD-XL-03] người khác đang giữ: nút ghi tối kèm tên người giữ", () => {
    dung({ nut: { claimedById: "u9", claimedBoiToi: false, claimedTen: "Chị Hoa" } });
    expect(screen.getByRole("button", { name: /Duyệt, tạo lead/ })).toBeDisabled();
    expect(screen.getAllByText(/Đang do Chị Hoa xử lý/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Chuyển người khác/ })).toBeNull();
  });
});

describe("[GD-XL] gửi action", () => {
  it("[GD-XL-04] Duyệt: hộp xác nhận → gọi duyetAction với ĐÚNG draftId + version đang xem → toast + làm mới", async () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Duyệt, tạo lead/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Duyệt, tạo lead/ }).at(-1)!);
    await waitFor(() => expect(m.duyet).toHaveBeenCalledWith({ draftId: "ho-so-1", version: 7 }));
    await waitFor(() => expect(m.toastOk).toHaveBeenCalled());
    expect(m.refresh).toHaveBeenCalled();
  });

  it("[GD-XL-05] lỗi từ server hiện trong khung role=alert + toast, KHÔNG làm mới như thể thành công", async () => {
    m.duyet.mockResolvedValue({ ok: false, error: { code: "THIEU_DIEU_KIEN", message: "Số điện thoại chưa hợp lệ. Bổ sung rồi duyệt lại." } });
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Duyệt, tạo lead/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Duyệt, tạo lead/ }).at(-1)!);
    expect((await screen.findByRole("alert")).textContent).toContain("Số điện thoại chưa hợp lệ");
    expect(m.toastErr).toHaveBeenCalled();
    expect(m.toastOk).not.toHaveBeenCalled();
  });

  it("[GD-XL-06] xung đột phiên bản ⇒ tự tải lại để thấy bản mới (không để bấm lại trên dữ liệu cũ)", async () => {
    m.duyet.mockResolvedValue({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN", message: "Hồ sơ vừa được cập nhật" } });
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Duyệt, tạo lead/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Duyệt, tạo lead/ }).at(-1)!);
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  it("[GD-XL-07] Từ chối: nút xác nhận TỐI cho tới khi lý do ≥ 5 ký tự; gửi lý do đã nhập", async () => {
    dung();
    fireEvent.click(screen.getByRole("button", { name: /Từ chối/ }));
    const xacNhan = await screen.findByRole("button", { name: /Từ chối hồ sơ/ });
    expect(xacNhan).toBeDisabled();
    const o = screen.getByLabelText(/Lý do/);
    fireEvent.change(o, { target: { value: "abc" } });
    expect(xacNhan).toBeDisabled();
    fireEvent.change(o, { target: { value: "Khách không có nhu cầu" } });
    expect(xacNhan).toBeEnabled();
    fireEvent.click(xacNhan);
    await waitFor(() => expect(m.tuChoi).toHaveBeenCalledWith({ draftId: "ho-so-1", version: 7, lyDo: "Khách không có nhu cầu" }));
  });
});

describe("[GD-BS] bổ sung — không ghi đè bằng giá trị đã che", () => {
  it("[GD-BS-01] thiếu quyền PII: ô tên/SĐT RỖNG (server không đưa giá trị thật), gợi ý đã che nằm ở placeholder; chưa nhập gì ⇒ nút Lưu tối", () => {
    dung({ ban: { fbName: "", phone: "", goiYFbName: "Nguyễn T. L.", goiYPhone: "849xxxxx456" } });
    const ten = screen.getByLabelText(/Tên Facebook của khách/) as HTMLInputElement;
    const sdt = screen.getByLabelText(/Số điện thoại/) as HTMLInputElement;
    expect(ten.value).toBe("");
    expect(sdt.value).toBe("");
    expect(ten.placeholder).toBe("Nguyễn T. L.");
    expect(sdt.placeholder).toBe("849xxxxx456");
    expect(screen.getByRole("button", { name: /Lưu bổ sung/ })).toBeDisabled();
    expect(document.body.textContent).not.toContain("84905123456");
  });

  it("[GD-BS-02] chỉ gửi trường ĐÃ ĐỔI: sửa SĐT thôi thì không gửi fbName", async () => {
    dung();
    fireEvent.change(screen.getByLabelText(/Số điện thoại/), { target: { value: "0912345678" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu bổ sung/ }));
    await waitFor(() => expect(m.boSung).toHaveBeenCalledTimes(1));
    expect(m.boSung.mock.calls[0]![0]).toEqual({ draftId: "ho-so-1", version: 7, phone: "0912345678" });
  });

  it("[GD-BS-03] giữ nguyên tên nhưng tick «đã đối chiếu» ⇒ gửi fbName (dấu xác minh); không tick ⇒ không gửi gì", async () => {
    dung();
    const luu = screen.getByRole("button", { name: /Lưu bổ sung/ });
    expect(luu).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/đã đối chiếu tên này/));
    expect(luu).toBeEnabled();
    fireEvent.click(luu);
    await waitFor(() => expect(m.boSung).toHaveBeenCalledWith({ draftId: "ho-so-1", version: 7, fbName: "Nguyễn Thị Lan" }));
  });

  it("[GD-BS-04] đổi cơ sở gửi campusCenterId; lỗi gắn với ô hiện đúng thông điệp", async () => {
    m.boSung.mockResolvedValue({ ok: false, error: { code: "CO_SO_KHONG_HOP_LE", message: "Bạn không phụ trách cơ sở này.", field: "campusCenterId" } });
    dung();
    fireEvent.change(screen.getByLabelText("Cơ sở"), { target: { value: "cs-b" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu bổ sung/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("không phụ trách");
    expect(m.boSung.mock.calls[0]![0]).toEqual({ draftId: "ho-so-1", version: 7, campusCenterId: "cs-b" });
  });
});

describe("[GD-BG] bảng danh sách", () => {
  const hang = (o: Partial<HangDanhSach> = {}): HangDanhSach => ({
    id: "ckabcdefgh12345678",
    state: "READY_FOR_REVIEW",
    intent: "ENROLLMENT_REQUEST",
    version: 1,
    fbName: "Nguyễn T. L.",
    phone: "849xxxxx456",
    pageId: "PAGE-1",
    campusCode: "CS1",
    centerId: "c1",
    centerTen: "Trụ sở chính - Nguyễn Hữu Thọ",
    claimedById: null,
    claimedTen: null,
    slaClaimDueAt: new Date("2026-11-07T09:00:00.000Z"),
    slaResolveDueAt: null,
    mucSla: "QUA_HAN_NHAN",
    createdAt: new Date("2026-11-07T08:00:00.000Z"),
    thieu: [],
    leadId: null,
    ...o,
  });
  const NOW = new Date("2026-11-07T10:00:00.000Z");

  it("[GD-BG-01] hiện đúng dữ liệu ĐÃ che từ server (bảng không tự bỏ che), link tới chi tiết phủ cả dòng, nhãn SLA bằng CHỮ", () => {
    render(<BangHoSo hang={[hang()]} now={NOW} khoaTrang="t" />);
    expect(screen.getByText("849xxxxx456")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Nguyễn T\. L\./ });
    expect(link).toHaveAttribute("href", "/ai-lead/ckabcdefgh12345678");
    expect(link.className).toContain("after:inset-0");
    expect(link.closest("tr")?.className).toContain("cursor-pointer");
    expect(screen.getByText("Quá hạn nhận")).toBeInTheDocument();
    expect(screen.getByText("Trụ sở chính - Nguyễn Hữu Thọ")).toBeInTheDocument();
  });

  it("[GD-BG-02] mỗi ô có nhãn cột (data-nhan) cho dạng thẻ trên điện thoại; tiêu đề cột vẫn còn cho trình đọc màn hình", () => {
    const { container } = render(<BangHoSo hang={[hang()]} now={NOW} khoaTrang="t" />);
    const nhan = [...container.querySelectorAll("tbody td[data-nhan]")].map((e) => e.getAttribute("data-nhan"));
    expect(nhan).toEqual(["SĐT", "Khách muốn", "Cơ sở", "Trạng thái", "SLA", "Người xử lý", "Nhận lúc"]);
    expect(container.querySelector("thead")?.className).toContain("max-2xl:sr-only");
  });

  it("[GD-BG-03] hồ sơ chưa có tên/SĐT/cơ sở nói rõ «chưa có», không để ô trống", () => {
    render(<BangHoSo hang={[hang({ fbName: null, phone: null, centerTen: null, mucSla: "KHONG_AP_DUNG" })]} now={NOW} khoaTrang="t2" />);
    expect(screen.getByText("(chưa có tên Facebook)")).toBeInTheDocument();
    expect(screen.getByText("Chưa có")).toBeInTheDocument();
    expect(screen.getByText("Chưa chọn")).toBeInTheDocument();
  });
});

describe("[GD-BL] bộ lọc", () => {
  const loc = {};
  it("[GD-BL-01] thiếu quyền PII: ô tìm CHỈ nhận mã hồ sơ (không dò được theo tên/SĐT); có quyền thì nói rõ nhận tên/SĐT", () => {
    render(<BoLoc loc={loc} pages={[]} coSo={[]} coTheTimTheoTen={false} />);
    expect(screen.getByLabelText("Tìm theo mã hồ sơ")).toBeInTheDocument();
    cleanup();
    render(<BoLoc loc={loc} pages={[]} coSo={[]} coTheTimTheoTen />);
    expect(screen.getByLabelText(/Tìm theo tên, SĐT/)).toBeInTheDocument();
  });
  it("[GD-BL-02] «Xoá lọc» chỉ có khi đang lọc; mọi ô có nhãn", () => {
    render(<BoLoc loc={loc} pages={["P1"]} coSo={[{ id: "c", ten: "CS" }]} coTheTimTheoTen />);
    expect(screen.queryByText("Xoá lọc")).toBeNull();
    cleanup();
    render(<BoLoc loc={{ quaHanSla: true }} pages={["P1"]} coSo={[{ id: "c", ten: "CS" }]} coTheTimTheoTen />);
    expect(screen.getByText("Xoá lọc")).toHaveAttribute("href", "/ai-lead");
    for (const nhan of ["Trạng thái", "Page Facebook", "Cơ sở", "Người xử lý"]) expect(screen.getByLabelText(nhan)).toBeInTheDocument();
    expect((screen.getByLabelText(/quá hạn SLA/) as HTMLInputElement).checked).toBe(true);
  });
});

describe("[GD-QA3] lỗi giao diện đo thật ngày 28/10 (lần QA 3)", () => {
  const hang1 = (): HangDanhSach => ({
    id: "ckabcdefgh12345678", state: "READY_FOR_REVIEW", intent: "ENROLLMENT_REQUEST", version: 1,
    fbName: "Nguyễn Thị Phương Anh Thư rất dài", phone: "849xxxxx456", pageId: "PAGE-1", campusCode: "CS1", centerId: "c1", centerTen: "Trụ sở chính - Nguyễn Hữu Thọ",
    claimedById: null, claimedTen: null, slaClaimDueAt: null, slaResolveDueAt: null, mucSla: "KHONG_AP_DUNG", createdAt: new Date("2026-11-07T08:00:00.000Z"), thieu: [], leadId: null,
  });
  it("[GD-QA3-01] ô tên và ô cơ sở bị cắt «…» ở ≥2000px phải có title mang đủ chữ (không mất tên khi cắt)", () => {
    render(<BangHoSo hang={[hang1()]} now={new Date("2026-11-07T10:00:00.000Z")} khoaTrang="t" />);
    expect(screen.getByRole("link", { name: /Nguyễn Thị Phương Anh Thư rất dài/ })).toHaveAttribute("title", "Nguyễn Thị Phương Anh Thư rất dài");
    expect(screen.getByText("Trụ sở chính - Nguyễn Hữu Thọ")).toHaveAttribute("title", "Trụ sở chính - Nguyễn Hữu Thọ");
  });
  it("[GD-QA3-02] ô nhập ≥16px ở di động (iOS phóng to khi focus nếu <16px): bộ lọc và ô «Bổ sung» dùng text-base, chỉ thu về text-sm từ sm", () => {
    const { container } = render(<BoLoc loc={{}} pages={["P1"]} coSo={[{ id: "c", ten: "CS" }]} coTheTimTheoTen />);
    const o = [...container.querySelectorAll("input:not([type=checkbox]), select")];
    expect(o.length).toBeGreaterThanOrEqual(5);
    for (const e of o) {
      expect(e.className).toContain("text-base");
      expect(e.className).toContain("sm:text-sm");
      expect(e.className.split(/\s+/)).not.toContain("text-sm");
    }
    cleanup();
    dung();
    for (const e of [screen.getByLabelText(/Tên Facebook của khách/), screen.getByLabelText(/Số điện thoại/), screen.getByLabelText(/Cơ sở/)]) {
      expect(e.className).toContain("text-base");
      expect(e.className.split(/\s+/)).not.toContain("text-sm");
    }
  });
});

describe("[GD-QA3-03] trang chi tiết: tên khách KHÔNG ngắt dòng được (300 ký tự liền) không được làm cuộn ngang vùng nội dung", () => {
  it("mọi đoạn <p> chèn tên Facebook (đoạn hướng dẫn đối chiếu trong khối «Hội thoại Facebook») mang break-words", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const nguon = readFileSync(resolve(process.cwd(), "app/(admin)/admin/ai-lead/[id]/page.tsx"), "utf8").split("\r\n").join("\n");
    const doan = [...nguon.matchAll(/<p className="([^"]*)">([\s\S]*?)<\/p>/g)].filter((x) => x[2].includes('«{ct.fbName ?? "—"}»'));
    expect(doan.length).toBe(2);
    for (const d of doan) expect(d[1].split(/\s+/)).toContain("break-words");
  });
});

describe("[GD-UX-01] bộ lọc ⇄ chuỗi truy vấn: nút «Tải lại» của màn lỗi GIỮ bộ lọc đang xem", () => {
  it("queryTuLoc là ngược của docBoLoc cho mọi trường; bộ lọc rỗng ⇒ chuỗi rỗng", async () => {
    const { docBoLoc, queryTuLoc } = await import("./doc-bo-loc");
    expect(queryTuLoc({})).toBe("");
    const loc = { trangThai: "WAITING_QLCS" as const, pageId: "104500000000777", coSoId: "co-so-hoang-dieu", nguoiXuLy: "toi", quaHanSla: true, q: "Nguyễn Văn A" };
    const sp = Object.fromEntries(new URLSearchParams(queryTuLoc(loc)));
    expect(docBoLoc(sp)).toEqual(loc);
  });
});

describe("[GD-NGUON-01] trang chi tiết: dấu «nguồn cần xem lại» sau khi tạo lead phải HIỆN (review độc lập 28/10: trước đây chỉ nằm trong resultNote, không ai thấy)", () => {
  it("khối «Lead đã tạo» có ghi chú role=note cho cả hai mã NGUON_UNKNOWN_SAU_TAO / NGUON_KHONG_GHI_SAU_TAO, nằm TRONG nhánh có leadId", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const nguon = readFileSync(resolve(process.cwd(), "app/(admin)/admin/ai-lead/[id]/page.tsx"), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
    const nhanh = nguon.slice(nguon.indexOf("{ct.leadId && ("), nguon.indexOf('{ct.state === "REJECTED"'));
    expect(nhanh).toMatch(/ct\.resultNote === "NGUON_UNKNOWN_SAU_TAO" \|\| ct\.resultNote === "NGUON_KHONG_GHI_SAU_TAO"/);
    expect(nhanh).toMatch(/role="note"/);
    expect(nhanh).toMatch(/Nguồn của lead này cần xem lại/);
  });
});

describe("[GD-QA3-04] WebKit/Safari: <select> có chữ tuỳ chọn dài làm vùng nội dung cuộn ngang (đo thật bằng WebKit: scrollWidth 614 > 375)", () => {
  it("mọi lớp dùng cho ô chọn/ô nhập mang overflow-hidden (ẩn nó đi thì scrollWidth về 375)", async () => {
    const { LOP_O_CHON, LOP_O_NHAP } = await import("../_components/lop");
    expect(LOP_O_CHON.split(/\s+/)).toContain("overflow-hidden");
    expect(LOP_O_NHAP.split(/\s+/)).toContain("overflow-hidden");
    const { container } = render(<BoLoc loc={{}} pages={["P1"]} coSo={[{ id: "c", ten: "CS" }]} coTheTimTheoTen />);
    for (const s of container.querySelectorAll("select")) expect(s.className.split(/\s+/)).toContain("overflow-hidden");
  });
});
