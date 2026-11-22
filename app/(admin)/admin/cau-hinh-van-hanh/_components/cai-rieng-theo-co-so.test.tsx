// @vitest-environment jsdom
/**
 * KHỐI "CÀI RIÊNG THEO CƠ SỞ" [PHIÊN H · 22/09/2026].
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Ba trạng thái của một cơ sở — **theo toàn hệ** · **bật riêng** · **tắt riêng** — phải ĐỌC
 * ĐƯỢC trên màn hình. Nếu chỉ vẽ một cái công tắc thì "tắt riêng" và "theo toàn hệ mà toàn
 * hệ đang tắt" trông **y hệt nhau**, trong khi hậu quả khác hẳn: bật mức toàn hệ thì cái thứ
 * hai bật theo, cái thứ nhất thì không.
 *
 * Và "Trả về theo toàn hệ" phải CHỈ hiện khi có gì để trả — một nút gỡ trên một cơ sở vốn
 * không có mức riêng là một lời hứa suông (luật 12).
 *
 * ⚠️ Đây là bộ test GIAO DIỆN, nên nó không chứng minh gì về đường ghi. Đường ghi (ba trạng
 * thái trong DB, cổng quyền, nhật ký, gỡ ≠ tắt) đo ở `tests/nen/cai-rieng-co-so.spec.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  luu: vi.fn(async () => ({ ok: true as const })),
  xoa: vi.fn(async () => ({ ok: true as const })),
  loi: vi.fn(),
}));

vi.mock("../actions", () => ({
  saveCenterSettingAction: h.luu,
  xoaCenterSettingAction: h.xoa,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: h.loi, warning: vi.fn() },
}));

import { nhanCuaKey } from "@/lib/settings/nhan-van-hanh";
import {
  CaiRiengTheoCoSo,
  nhanTrangThai,
  trangThaiCuaCoSo,
  type CoSoCauHinh,
} from "./cai-rieng-theo-co-so";

const KHOA = "billing.flexV1Enabled" as const;
const NHAN = nhanCuaKey(KHOA);

const CS1_THEO = { orgUnitId: "ou_cs1", ten: "CS1 — Nguyễn Hữu Thọ" };
const CS2_BAT: CoSoCauHinh = { orgUnitId: "ou_cs2", ten: "CS2 — Hoàng Diệu", giaTriRieng: true };
const CS2_TAT: CoSoCauHinh = { orgUnitId: "ou_cs2", ten: "CS2 — Hoàng Diệu", giaTriRieng: false };

function dung(coSo: CoSoCauHinh[], giaTriToanHe: unknown = false, choSua = true) {
  return render(
    <CaiRiengTheoCoSo
      settingKey={KHOA}
      nhan={NHAN}
      giaTriToanHe={giaTriToanHe}
      coSo={coSo}
      choSua={choSua}
    />,
  );
}

/** Mở khối gấp (mặc định đóng) rồi trả lại cho ca gọi. */
function mo() {
  fireEvent.click(screen.getByText(/Cài riêng theo cơ sở/));
}

describe("[CRUI] ba trạng thái trên màn hình", () => {
  it("[CRUI-00] hàm thuần phân biệt bằng SỰ CÓ MẶT, không bằng falsy", () => {
    // Ca chống TAUTOLOGY cho cả bộ: đổi `=== undefined` thành một phép kiểm falsy thì mọi
    // ca dưới về "tắt riêng" đọc thành "theo toàn hệ" — và đây là chỗ nó lộ ra sớm nhất.
    expect(trangThaiCuaCoSo(CS1_THEO)).toBe("THEO_TOAN_HE");
    expect(trangThaiCuaCoSo(CS2_TAT)).toBe("RIENG");
    expect(trangThaiCuaCoSo({ orgUnitId: "x", ten: "x", giaTriRieng: 0 })).toBe("RIENG");
  });

  it("[CRUI-01] nhãn nói rõ MỨC TOÀN HỆ đang bật hay tắt cho cơ sở theo toàn hệ", () => {
    // Chỉ nói "Theo toàn hệ" là bắt người vận hành cuộn ngược lên đọc công tắc chung rồi
    // tự suy — mà họ đang đứng ở đây đúng vì muốn biết cơ sở này CÓ ĐANG BẬT KHÔNG.
    expect(nhanTrangThai(CS1_THEO, true)).toBe("Theo toàn hệ (đang bật)");
    expect(nhanTrangThai(CS1_THEO, false)).toBe("Theo toàn hệ (đang tắt)");
  });

  it("[CRUI-02] TẮT RIÊNG ≠ THEO TOÀN HỆ (ĐANG TẮT) — hai nhãn KHÁC NHAU", () => {
    // Ca cốt lõi của PHIÊN H. Hai trạng thái này cho ra cùng một hành vi HÔM NAY và khác
    // nhau vào ngày ai đó bật mức toàn hệ; nếu màn hình gọi chúng bằng một tên thì không ai
    // biết mình đang ở cái nào.
    const tatRieng = nhanTrangThai(CS2_TAT, false);
    const theoToanHe = nhanTrangThai(CS1_THEO, false);
    expect(tatRieng).toBe("Tắt riêng");
    expect(tatRieng).not.toBe(theoToanHe);
  });

  it("[CRUI-03] mở ra thấy ĐỦ cơ sở, mỗi cơ sở một nhãn trạng thái", () => {
    dung([CS1_THEO, CS2_BAT], false);
    mo();
    expect(screen.getByText(/CS1 — Nguyễn Hữu Thọ/)).toBeTruthy();
    expect(screen.getByText(/· Theo toàn hệ \(đang tắt\)/)).toBeTruthy();
    expect(screen.getByText(/· Bật riêng/)).toBeTruthy();
  });

  it("[CRUI-04] đếm số cơ sở CÀI RIÊNG ngay trên nút gấp", () => {
    // Một mục gấp lại không có dấu hiệu gì là một mục không ai mở — và cơ sở đang lệch khỏi
    // mức chung là đúng thứ phải thấy mà không cần mở.
    dung([CS1_THEO, CS2_BAT], false);
    expect(screen.getByText("1 cơ sở cài riêng")).toBeTruthy();
  });

  it("[CRUI-05] không cơ sở nào cài riêng ⇒ KHÔNG in con số nào", () => {
    dung([CS1_THEO], false);
    expect(screen.queryByText(/cơ sở cài riêng/)).toBeNull();
  });

  it("[CRUI-06] nút 'Trả về theo toàn hệ' CHỈ hiện ở cơ sở ĐANG có mức riêng", () => {
    dung([CS1_THEO, CS2_BAT], false);
    mo();
    // Đúng MỘT nút, không phải hai: cơ sở theo toàn hệ không có gì để trả, và một nút bấm
    // vào không làm gì là lời hứa suông (luật 12).
    expect(screen.getAllByRole("button", { name: "Trả về theo toàn hệ" })).toHaveLength(1);
  });

  it("[CRUI-07] công tắc của cơ sở theo toàn hệ mở sẵn ở MỨC TOÀN HỆ", () => {
    // Mở sẵn ở `false` trong khi toàn hệ đang bật thì người vận hành bấm Lưu để "giữ
    // nguyên" và vô tình TẮT RIÊNG cơ sở đó.
    dung([CS1_THEO], true);
    mo();
    const o = screen.getByRole("switch", { name: `${NHAN.ten} — ${CS1_THEO.ten}` });
    expect(o.getAttribute("aria-checked")).toBe("true");
  });

  it("[CRUI-08] công tắc của cơ sở TẮT RIÊNG mở sẵn ở MỨC RIÊNG, không theo toàn hệ", () => {
    dung([CS2_TAT], true);
    mo();
    const o = screen.getByRole("switch", { name: `${NHAN.ten} — ${CS2_TAT.ten}` });
    expect(o.getAttribute("aria-checked")).toBe("false");
  });
});

describe("[CRUI] cổng lý do và đường ghi", () => {
  it("[CRUI-09] thiếu lý do ⇒ KHÔNG gọi action nào, báo lỗi tại chỗ", () => {
    h.luu.mockClear();
    h.xoa.mockClear();
    h.loi.mockClear();
    dung([CS2_BAT], false);
    mo();
    fireEvent.click(screen.getByRole("button", { name: "Cài riêng" }));
    fireEvent.click(screen.getByRole("button", { name: "Trả về theo toàn hệ" }));
    expect(h.luu).not.toHaveBeenCalled();
    expect(h.xoa).not.toHaveBeenCalled();
    expect(h.loi).toHaveBeenCalled();
  });

  it("[CRUI-10] 'Cài riêng' gửi ĐÚNG orgUnitId + khoá + giá trị + lý do", () => {
    h.luu.mockClear();
    dung([CS1_THEO], false);
    mo();
    fireEvent.click(screen.getByRole("switch", { name: `${NHAN.ten} — ${CS1_THEO.ten}` }));
    fireEvent.change(screen.getByRole("textbox", { name: `Lý do thay đổi cho ${CS1_THEO.ten}` }), {
      target: { value: "pilot CS1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cài riêng" }));
    expect(h.luu).toHaveBeenCalledWith({
      orgUnitId: CS1_THEO.orgUnitId,
      key: KHOA,
      value: true,
      reason: "pilot CS1",
    });
  });

  it("[CRUI-11] 'Trả về theo toàn hệ' gọi đường GỠ, KHÔNG gọi đường ghi `false`", () => {
    // Ca gắt nhất ở tầng giao diện. Nối nút này vào `saveCenterSettingAction({value:false})`
    // là "gỡ" hoá thành "tắt riêng": cơ sở mắc kẹt ở TẮT trong khi toàn hệ có thể đang BẬT.
    h.luu.mockClear();
    h.xoa.mockClear();
    dung([CS2_BAT], true);
    mo();
    fireEvent.change(screen.getByRole("textbox", { name: `Lý do thay đổi cho ${CS2_BAT.ten}` }), {
      target: { value: "hết pilot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Trả về theo toàn hệ" }));
    expect(h.xoa).toHaveBeenCalledWith({
      orgUnitId: CS2_BAT.orgUnitId,
      key: KHOA,
      reason: "hết pilot",
    });
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("[CRUI-12] chỉ có quyền XEM ⇒ không nút nào, không ô lý do nào", () => {
    dung([CS2_BAT], false, false);
    mo();
    expect(screen.queryByRole("button", { name: "Cài riêng" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trả về theo toàn hệ" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // …nhưng VẪN đọc được trạng thái: người chỉ có quyền xem cần biết cơ sở nào đang lệch.
    expect(screen.getByText(/· Bật riêng/)).toBeTruthy();
  });

  it("[CRUI-14] gỡ xong, trang dựng lại ⇒ CÔNG TẮC theo kịp NHÃN", () => {
    // `useState` khởi tạo từ prop và KHÔNG chạy lại khi prop đổi. Sau khi bấm "Trả về theo
    // toàn hệ", máy chủ dựng lại trang: nhãn đổi thành "Theo toàn hệ (đang bật)" còn công
    // tắc vẫn giữ mức riêng vừa gỡ — hai thứ cạnh nhau nói hai điều khác nhau, và không lỗi
    // nào báo. Vá bằng KHOÁ mang trạng thái để hàng dựng lại.
    const { rerender } = dung([CS2_TAT], true);
    mo();
    expect(
      screen.getByRole("switch", { name: `${NHAN.ten} — ${CS2_TAT.ten}` }).getAttribute("aria-checked"),
    ).toBe("false");

    rerender(
      <CaiRiengTheoCoSo
        settingKey={KHOA}
        nhan={NHAN}
        giaTriToanHe={true}
        coSo={[{ orgUnitId: CS2_TAT.orgUnitId, ten: CS2_TAT.ten }]}
        choSua
      />,
    );
    // KHÔNG bấm mở lại: khối vẫn đang mở (chỉ HÀNG dựng lại, khối thì không), và bấm thêm
    // một lần là gập nó lại.
    expect(screen.getByText(/· Theo toàn hệ \(đang bật\)/)).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: `${NHAN.ten} — ${CS2_TAT.ten}` }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("[CRUI-13] không cơ sở nào ⇒ không vẽ gì cả", () => {
    const { container } = dung([], false);
    expect(container.textContent).toBe("");
  });
});
