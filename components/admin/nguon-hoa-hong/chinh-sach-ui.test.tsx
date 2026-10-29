// @vitest-environment jsdom
/**
 * [NHH-FE-05] · [NHH-FE-UI-*] — các mảnh giao diện DÙNG LẠI của tab Chính sách, trên PHẦN TỬ THẬT:
 * PercentageInput · Stepper · HangRaoBar · StickyActionBar · PolicyVersionBadge / TrangThaiPhienBanPill.
 *
 * Lưới này canh những thứ `tsc` không thấy: ô phần trăm in lại ĐÚNG con số sẽ lưu (lỗi ×100), trình đọc màn hình nghe được
 * "chưa đạt / chưa kiểm" (màu không phải nghĩa duy nhất), và "chưa kiểm" không bao giờ trông như "đạt".
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { dungHangRao } from "@/lib/hoa-hong/hang-rao-ui";
import { dungHuongXuLyTran } from "@/lib/hoa-hong/huong-xu-ly-tran";
import { HangRaoBar } from "./hang-rao-bar";
import { PercentageInput } from "./phan-tram-input";
import { PolicyVersionBadge, TrangThaiPhienBanPill } from "./policy-version-badge";
import { StickyActionBar } from "./sticky-action-bar";
import { Stepper } from "./stepper";

afterEach(cleanup);

function Giu({ dau = "", error, disabled }: { dau?: string; error?: string | null; disabled?: boolean }) {
  const [v, setV] = useState(dau);
  return <PercentageInput value={v} onChange={setV} ariaLabel="Tỉ lệ Sale" error={error} disabled={disabled} truong="o.NEW|SALE" />;
}

describe("[NHH-FE-05] PercentageInput trên phần tử thật", () => {
  it("[NHH-FE-05i] gõ 3 ⇒ ô giữ chữ '3', dưới ô in '= 0,03 trên mỗi đồng thực thu', hậu tố % cố định", () => {
    render(<Giu />);
    const o = screen.getByLabelText("Tỉ lệ Sale") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "3" } });
    expect(o.value).toBe("3");
    expect(screen.getByText("= 0,03 trên mỗi đồng thực thu")).toBeTruthy();
    expect(o.getAttribute("aria-invalid")).toBeNull();
    // hậu tố là trang trí (aria-hidden), không nằm trong giá trị
    expect(document.querySelector('[aria-hidden="true"]')?.textContent).toBe("%");
  });

  it("[NHH-FE-05j] gõ 3,5 ⇒ '= 0,035'; xoá sạch ⇒ không in gì (không đoán 0%)", () => {
    render(<Giu />);
    const o = screen.getByLabelText("Tỉ lệ Sale");
    fireEvent.change(o, { target: { value: "3,5" } });
    expect(screen.getByText("= 0,035 trên mỗi đồng thực thu")).toBeTruthy();
    fireEvent.change(o, { target: { value: "" } });
    expect(screen.queryByText(/trên mỗi đồng thực thu/)).toBeNull();
  });

  it("[NHH-FE-05k] quá 4 chữ số thập phân ⇒ lỗi CẠNH ô (aria-invalid + aria-describedby trỏ dòng lỗi), không in số sẽ lưu", () => {
    render(<Giu />);
    const o = screen.getByLabelText("Tỉ lệ Sale");
    fireEvent.change(o, { target: { value: "3,12345" } });
    expect(o.getAttribute("aria-invalid")).toBe("true");
    const mo = document.getElementById(o.getAttribute("aria-describedby")!);
    expect(mo?.textContent).toMatch(/Tối đa 4 chữ số thập phân/);
    expect(screen.queryByText(/trên mỗi đồng thực thu/)).toBeNull();
  });

  it("[NHH-FE-05l] lỗi từ NGOÀI (server) thắng lỗi tự suy; ô có data-truong để cuộn + focus; inputMode=decimal; disabled thật", () => {
    const { rerender } = render(<Giu dau="4" error="Vượt trần" />);
    const o = screen.getByLabelText("Tỉ lệ Sale") as HTMLInputElement;
    expect(o.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(o.getAttribute("aria-describedby")!)?.textContent).toBe("Vượt trần");
    expect(o.getAttribute("data-truong")).toBe("o.NEW|SALE");
    expect(o.getAttribute("inputmode")).toBe("decimal");
    rerender(<Giu dau="4" disabled />);
    expect((screen.getByLabelText("Tỉ lệ Sale") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("[NHH-FE-UI-01] Stepper", () => {
  const buoc = [
    { khoa: "a", nhan: "Bối cảnh" },
    { khoa: "b", nhan: "Người hưởng" },
    { khoa: "c", nhan: "Cách tính" },
  ] as const;

  it("bước đang đứng có aria-current='step'; bấm một bước gọi onChon đúng khoá", () => {
    const onChon = vi.fn();
    render(<Stepper buoc={buoc} dangO="b" daXong={new Set<string>(["a"])} coLoi={new Set<string>()} onChon={onChon} />);
    expect(screen.getByRole("button", { name: /Người hưởng/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: /Bối cảnh/ }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cách tính/ }));
    expect(onChon).toHaveBeenCalledWith("c");
  });

  it("[NHH-FE-UI-01b] trạng thái có CHỮ cho trình đọc màn hình: 'có lỗi cần sửa' / 'đã xong' (không chỉ màu)", () => {
    render(<Stepper buoc={buoc} dangO="c" daXong={new Set<string>(["a"])} coLoi={new Set<string>(["b"])} onChon={() => {}} />);
    expect(screen.getByRole("button", { name: /Người hưởng.*có lỗi cần sửa/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bối cảnh.*đã xong/ })).toBeTruthy();
    // bước đang đứng không tự nhận "đã xong"
    expect(screen.getByRole("button", { name: /^Cách tính$|^3\s*Cách tính$/ })).toBeTruthy();
  });

  it("[NHH-FE-UI-01c] cờ khoa ⇒ mọi nút disabled", () => {
    render(<Stepper buoc={buoc} dangO="a" daXong={new Set<string>()} coLoi={new Set<string>()} onChon={() => {}} khoa />);
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[NHH-FE-UI-02] HangRaoBar", () => {
  it("[NHH-FE-UI-02a] chưa kiểm: nói 'Chưa kiểm', KHÔNG có chữ 'đạt' nào, và có dòng giải thích vì sao", () => {
    const h = dungHangRao(null, { tran: 0.09 });
    render(<HangRaoBar coQuyenSuaTran hangRao={h} moTaChuaKiem="Lưu nháp để máy chủ kiểm" />);
    const bar = screen.getByRole("complementary", { name: "Điều kiện kích hoạt" });
    expect(within(bar).getByText("Chưa kiểm")).toBeTruthy();
    expect(within(bar).getByText("Lưu nháp để máy chủ kiểm")).toBeTruthy();
    expect(bar.textContent).not.toMatch(/\bđạt\b/i);
    expect(within(bar).getAllByText(/chưa kiểm/)).toHaveLength(7); // bảy dòng, mỗi dòng một chữ cho trình đọc
  });

  it("[NHH-FE-UI-02b] có lỗi: số 'N chưa đạt', lý do nguyên văn dưới đúng dòng, chữ 'chưa đạt' cho trình đọc; dòng khác 'đạt'", () => {
    const h = dungHangRao(
      { loi: [{ ma: "VAN_BAN_THIEU", thongBao: "Văn bản thiếu: coTep." }, { ma: "VUOT_TRAN", thongBao: "Vượt trần ở CS1" }], canhBao: [], somNhat: "2026-03-23" },
      { tran: 0.09 },
    );
    render(<HangRaoBar coQuyenSuaTran hangRao={h} />);
    const bar = screen.getByRole("complementary", { name: "Điều kiện kích hoạt" });
    expect(within(bar).getByText("2 chưa đạt")).toBeTruthy();
    expect(within(bar).getByText("Văn bản thiếu: tệp đính kèm.")).toBeTruthy(); // đã Việt hoá
    expect(within(bar).getByText("Vượt trần ở CS1")).toBeTruthy();
    expect(within(bar).getAllByText(/— chưa đạt/)).toHaveLength(2);
    expect(within(bar).getAllByText(/— đạt/)).toHaveLength(5);
  });

  it("[NHH-FE-UI-02b2] VUOT_TRAN chỉ đường (09/10/2026): dòng «Tổng tỉ lệ ≤ trần» chưa đạt có KHỐI (tổng · trần · vượt) + LIÊN KẾT tới Cấu hình vận hành khi người xem CÓ quyền sửa trần; tổng vượt cả giới hạn ô ⇒ không liên kết; lỗi khác không có khối; không lỗi ⇒ không có", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
    const co = dungHangRao({ loi: [{ ma: "VUOT_TRAN", thongBao: "Vượt trần hoa hồng: tổng cao nhất 11% so với trần hiện tại 9%", huongXuLy: h }], canhBao: [], somNhat: "2026-03-23" }, { tran: 0.09 });
    const { unmount } = render(<HangRaoBar coQuyenSuaTran hangRao={co} />);
    const lk = screen.getByRole("link", { name: "Mở Cấu hình vận hành để nâng trần" });
    expect(lk.getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    // liên kết nằm TRONG dòng trần (không trôi sang dòng khác)
    expect(lk.closest("li")?.textContent).toContain("Tổng tỉ lệ ≤ trần 9%");
    // khối nói đủ ba số của MÁY CHỦ (không phải của client)
    const khoi = screen.getByTestId("khoi-vuot-tran");
    expect(khoi.textContent).toContain("11%");
    expect(khoi.textContent).toContain("9%");
    expect(khoi.textContent).toContain("2 điểm phần trăm");
    unmount();

    const qua = dungHuongXuLyTran({ tongToiDa: 0.25, tran: 0.09 });
    const { unmount: u2 } = render(<HangRaoBar coQuyenSuaTran hangRao={dungHangRao({ loi: [{ ma: "VUOT_TRAN", thongBao: "Vượt trần", huongXuLy: qua }], canhBao: [], somNhat: "2026-03-23" }, { tran: 0.09 })} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("khoi-vuot-tran").textContent).toMatch(/chỉnh lại tỉ lệ/);
    u2();

    const khac = dungHangRao({ loi: [{ ma: "VAN_BAN_THIEU", thongBao: "Văn bản thiếu: coTep." }], canhBao: [], somNhat: "2026-03-23" }, { tran: 0.09 });
    const { unmount: u3 } = render(<HangRaoBar coQuyenSuaTran hangRao={khac} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("khoi-vuot-tran")).toBeNull();
    u3();

    render(<HangRaoBar coQuyenSuaTran hangRao={dungHangRao({ loi: [], canhBao: [], somNhat: "2026-03-23" }, { tran: 0.09 })} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("khoi-vuot-tran")).toBeNull();
  });

  it("[NHH-FE-UI-02b3] KHÔNG có quyền sửa trần ⇒ cùng khối, KHÔNG liên kết, nói Quản trị hệ thống nâng (đối chứng âm của 02b2); lý do nguyên văn của máy chủ vẫn xem được (gập)", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
    const kq = dungHangRao({ loi: [{ ma: "VUOT_TRAN", thongBao: "Vượt trần hoa hồng: Σ 11.0000% > trần 9.0000% @/", huongXuLy: h }], canhBao: [], somNhat: "2026-03-23" }, { tran: 0.09 });
    render(<HangRaoBar coQuyenSuaTran={false} hangRao={kq} />);
    expect(screen.queryByRole("link")).toBeNull();
    const khoi = screen.getByTestId("khoi-vuot-tran");
    expect(khoi.textContent).toContain("11%");
    expect(khoi.textContent).toContain("Quản trị hệ thống");
    expect(khoi.textContent).toContain("kích hoạt lại");
    // KHÔNG nút nào để tự nâng trần trong thanh điều kiện
    expect(within(screen.getByRole("complementary", { name: "Điều kiện kích hoạt" })).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/Σ 11\.0000% > trần 9\.0000% @\//)).toBeTruthy();
  });

  it("[NHH-FE-UI-02c] đạt hết ⇒ 'Đạt 7/7'; nhãn trần đọc từ tham số (10% khi trần 0.1)", () => {
    render(<HangRaoBar coQuyenSuaTran hangRao={dungHangRao({ loi: [], canhBao: [], somNhat: "2026-03-23" }, { tran: 0.1 })} />);
    expect(screen.getByText("Đạt 7/7")).toBeTruthy();
    expect(screen.getByText("Tổng tỉ lệ ≤ trần 10%", { exact: false })).toBeTruthy();
  });

  it("[NHH-FE-UI-02d] cảnh báo hiện thành khối riêng 'cần xác nhận khi kích hoạt', không lẫn vào dòng lỗi", () => {
    render(<HangRaoBar coQuyenSuaTran hangRao={dungHangRao({ loi: [], canhBao: [{ ma: "UNKNOWN_TANG", thongBao: "Mức nguồn không rõ tăng" }], somNhat: "2026-03-23" }, { tran: 0.09 })} />);
    expect(screen.getByText(/Cảnh báo — cần xác nhận khi kích hoạt/)).toBeTruthy();
    expect(screen.getByText("Mức nguồn không rõ tăng")).toBeTruthy();
    expect(screen.getByText("Đạt 7/7")).toBeTruthy();
  });

  it("[NHH-FE-UI-02e] nút Kiểm lại chỉ khi có onKiemLai; bấm gọi đúng một lần; đang kiểm ⇒ disabled", () => {
    const h = dungHangRao(null, { tran: 0.09 });
    const { rerender } = render(<HangRaoBar coQuyenSuaTran hangRao={h} />);
    expect(screen.queryByRole("button", { name: /Kiểm lại/ })).toBeNull();
    const f = vi.fn();
    rerender(<HangRaoBar coQuyenSuaTran hangRao={h} onKiemLai={f} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm lại" }));
    expect(f).toHaveBeenCalledTimes(1);
    rerender(<HangRaoBar coQuyenSuaTran hangRao={h} onKiemLai={f} dangKiem />);
    expect((screen.getByRole("button", { name: /Đang kiểm/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[NHH-FE-UI-03] StickyActionBar · PolicyVersionBadge · pill trạng thái", () => {
  it("StickyActionBar: nhóm có nhãn, trái là trạng thái, phải là nút", () => {
    render(<StickyActionBar trai={<span>Đã lưu v1</span>}><button type="button">Lưu</button></StickyActionBar>);
    const g = screen.getByRole("group", { name: "Thao tác" });
    expect(within(g).getByText("Đã lưu v1")).toBeTruthy();
    expect(within(g).getByRole("button", { name: "Lưu" })).toBeTruthy();
  });

  it("PolicyVersionBadge in 'v2' (không lặp chữ 'Phiên bản' trong từng ô)", () => {
    render(<PolicyVersionBadge versionNo={2} />);
    expect(screen.getByText("v2").getAttribute("title")).toBe("Phiên bản 2");
  });

  it("Pill: ACTIVE chưa tới ngày là 'Chờ hiệu lực' (KHÔNG phải 'Đang áp dụng'); đã tới ngày là 'Đang áp dụng'", () => {
    const now = new Date("2026-10-08T03:00:00.000Z");
    const { rerender } = render(<TrangThaiPhienBanPill status="ACTIVE" effectiveFrom={new Date("2026-11-01T00:00:00Z")} effectiveTo={null} now={now} />);
    expect(screen.getByText("Chờ hiệu lực")).toBeTruthy();
    expect(screen.queryByText("Đang áp dụng")).toBeNull();
    rerender(<TrangThaiPhienBanPill status="ACTIVE" effectiveFrom={new Date("2026-09-01T00:00:00Z")} effectiveTo={null} now={now} />);
    expect(screen.getByText("Đang áp dụng")).toBeTruthy();
  });
});
