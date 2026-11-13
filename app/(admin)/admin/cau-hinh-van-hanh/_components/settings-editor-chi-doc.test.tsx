// @vitest-environment jsdom
/**
 * KHOÁ `ghiQuaActionRieng` (mốc cutover hoa hồng) CHỈ HIỆN GIÁ TRỊ — KHÔNG ô sửa, KHÔNG nút Lưu [PR5c · luật 12].
 *
 * `setGlobalSetting` từ chối khoá này (ca `[NHH-PER-03e]`), nên một ô sửa ở màn Cấu hình vận hành là ô mà MỌI lần bấm Lưu đều báo lỗi — affordance nói dối.
 * Bốn ca canh bốn lời hứa của bản vá, mỗi ca có đối chứng dương (khoá thường vẫn có ô sửa) vì ca chỉ khẳng định SỰ VẮNG MẶT luôn đạt khi trình sửa hỏng.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../actions", () => ({ saveGlobalSettingAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { nhanCuaKey } from "@/lib/settings/nhan-van-hanh";
import { BangCauHinhTab } from "./settings-editor";

const MOC = "hoaHong.kyCutover" as const;
const THUONG = "hoaHong.soThangDoiSoat" as const;

function dung(rows: Parameters<typeof BangCauHinhTab>[0]["rows"]) {
  return render(<BangCauHinhTab rows={rows} choSua choSuaCoSo />);
}

describe("[NHH-CFG-CD] khoá chỉ-đọc ở màn Cấu hình vận hành", () => {
  it("[NHH-CFG-CD-01] mốc đã đặt: HIỆN giá trị + 'chỉ xem'; KHÔNG ô nhập, KHÔNG công tắc, KHÔNG nút Lưu", () => {
    dung([{ key: MOC, value: "2026-11", nhan: nhanCuaKey(MOC), chiDoc: true }]);
    expect(screen.getByText("2026-11")).toBeInTheDocument();
    expect(screen.getByText("(chỉ xem)")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^lưu$/i })).toBeNull();
  });

  it("[NHH-CFG-CD-02] chưa đặt mốc (null) ⇒ 'Chưa đặt', không 'null'/'undefined' rơi ra màn hình", () => {
    const { container } = dung([{ key: MOC, value: null, nhan: nhanCuaKey(MOC), chiDoc: true }]);
    expect(screen.getByText("Chưa đặt")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null|undefined/);
  });

  it("[NHH-CFG-CD-03] vẫn có nhãn + câu giải thích + tên khoá kỹ thuật (tra nhật ký kiểm toán)", () => {
    const { container } = dung([{ key: MOC, value: "2026-11", nhan: nhanCuaKey(MOC), chiDoc: true }]);
    expect(screen.getByText(nhanCuaKey(MOC).ten)).toBeInTheDocument();
    expect(container.textContent).toContain("KHÔNG sửa ở đây");
    expect(container.querySelector(`[data-chi-doc="${MOC}"] code`)?.textContent).toBe(MOC);
  });

  it("[NHH-CFG-CD-04] ĐỐI CHỨNG: khoá thường (không chiDoc) vẫn có ô sửa — ca trên không xanh chỉ vì trình sửa hỏng hẳn", () => {
    dung([{ key: THUONG, value: 3, nhan: nhanCuaKey(THUONG) }]);
    expect(screen.getByRole("textbox")).toBeEnabled();
  });
});
