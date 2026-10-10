// @vitest-environment jsdom
/**
 * Ca [HCS-*] — HAI CỬA SỬA TRÊN CÙNG MỘT DÒNG CẤU HÌNH [24/09/2026].
 *
 * ── VÌ SAO BỘ NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Một dòng cấu hình có HAI đường ghi, và chúng đòi HAI quyền khác nhau:
 *
 *   · ô giá trị TOÀN HỆ THỐNG  → `setGlobalSetting` → `settings:edit` (Quản trị tối cao)
 *   · khối "Cài riêng theo cơ sở" → `setCenterSetting` → vai quản lý tại ĐÚNG `orgUnitId`
 *
 * Trước 24/09 cả hai cùng nhận một prop `choSua`. Hệ quả đo được: Quản lý cơ sở mở được tab
 * "Tiền & thanh toán" bằng quyền `settings:view-center` nhưng thấy MỌI ô `disabled`, kể cả
 * khối cài riêng — trong khi `saveCenterSettingAction` KHÔNG gác gì ở đầu hàm và server sẵn
 * sàng cho họ ghi. Giao diện nói KHÔNG, server nói CÓ, và người dùng tin giao diện.
 *
 * ⚠️ Đây là lớp lỗi luật 12: không ném lỗi, không làm test đỏ, console sạch — chỉ người bấm
 * mới biết. Nên ca dưới đây khẳng định THUỘC TÍNH `disabled` THẬT trên phần tử THẬT, không
 * grep mã nguồn (luật 11).
 *
 * ⚠️ Bộ này KHÔNG chứng minh gì về quyền: nó chứng minh prop nào điều khiển ô nào. Cổng thật
 * nằm ở `setCenterSetting` và đo ở `lib/settings/quyen-cau-hinh-co-so.test.ts` ([QCS-03]).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../actions", () => ({
  saveCenterSettingAction: vi.fn(async () => ({ ok: true as const })),
  xoaCenterSettingAction: vi.fn(async () => ({ ok: true as const })),
  saveSettingAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { nhanCuaKey } from "@/lib/settings/nhan-van-hanh";
import { BangCauHinhTab } from "./settings-editor";

/** Khoá SỐ (không phải công tắc) để ô toàn hệ là một `<input>` tra được bằng nhãn. */
const KHOA = "orders.maxInstallments" as const;
const NHAN = nhanCuaKey(KHOA);
const CS1 = { orgUnitId: "ou_cs1", ten: "CS1 — Nguyễn Hữu Thọ" };

function dung(choSua: boolean, choSuaCoSo: boolean) {
  return render(
    <BangCauHinhTab
      rows={[{ key: KHOA, value: 4, nhan: NHAN, coSo: [CS1] }]}
      choSua={choSua}
      choSuaCoSo={choSuaCoSo}
    />,
  );
}

/** Khối cài riêng mặc định GẤP LẠI — phải bấm mở mới có ô trong DOM. */
function moKhoiCoSo() {
  fireEvent.click(screen.getByText("Cài riêng theo cơ sở"));
}

/** Ô giá trị toàn hệ thống của dòng. */
function oToanHe(): HTMLInputElement {
  return screen.getByLabelText(NHAN.ten) as HTMLInputElement;
}

/** Ô giá trị riêng của CS1. */
function oCoSo(): HTMLInputElement {
  return screen.getByLabelText(`${NHAN.ten} — ${CS1.ten}`) as HTMLInputElement;
}

describe("[HCS-01] Quản lý cơ sở: khoá ô toàn hệ, MỞ ô của cơ sở mình", () => {
  it("ô toàn hệ `disabled`, ô cơ sở KHÔNG `disabled`", () => {
    // Đây là ca chính. Trước bản vá nó ĐỎ ở dòng thứ hai: `choSua=false` chảy thẳng xuống
    // `CaiRiengTheoCoSo` nên ô cơ sở cũng `disabled`, và quyền `settings:view-center` trở
    // thành quyền CHẾT — vào được màn, không làm được gì.
    dung(false, true);
    expect(oToanHe().disabled, "ô toàn hệ phải khoá với người không có settings:edit").toBe(true);
    moKhoiCoSo();
    expect(
      oCoSo().disabled,
      "ô của cơ sở đang bị khoá — `choSuaCoSo` không tới nơi, hoặc ai đó nối lại vào `choSua`",
    ).toBe(false);
  });

  it("ô lý do + nút Lưu của cơ sở có mặt — không có thì ghi được cũng không gửi đi được", () => {
    // `setCenterSetting` đòi `reason` bắt buộc. Mở ô giá trị mà giấu ô lý do là mở một nửa,
    // và nửa thiếu là nửa chặn.
    dung(false, true);
    moKhoiCoSo();
    expect(screen.getByLabelText(`Lý do thay đổi cho ${CS1.ten}`)).toBeTruthy();
  });
});

describe("[HCS-02] người chỉ XEM: khoá cả hai", () => {
  it("cả ô toàn hệ lẫn ô cơ sở đều `disabled`", () => {
    dung(false, false);
    expect(oToanHe().disabled).toBe(true);
    moKhoiCoSo();
    expect(oCoSo().disabled).toBe(true);
  });

  it("không bày ô lý do — không có gì để lưu thì không hứa là lưu được", () => {
    dung(false, false);
    moKhoiCoSo();
    expect(screen.queryByLabelText(`Lý do thay đổi cho ${CS1.ten}`)).toBeNull();
  });
});

describe("[HCS-03] Quản trị tối cao: mở cả hai", () => {
  it("cả ô toàn hệ lẫn ô cơ sở đều sửa được", () => {
    // Ca ĐỐI CHỨNG. Thiếu nó thì một bản vá "khoá hết cho chắc" vẫn làm [HCS-02] xanh.
    dung(true, true);
    expect(oToanHe().disabled).toBe(false);
    moKhoiCoSo();
    expect(oCoSo().disabled).toBe(false);
  });
});
