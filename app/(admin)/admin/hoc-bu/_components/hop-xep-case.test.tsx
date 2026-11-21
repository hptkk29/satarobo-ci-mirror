// @vitest-environment jsdom
// [HXC-*] Hộp "Xếp case" học bù — chốt lượt 2 điểm 1 (bắt buộc phòng) + GĐ5 (chọn sẵn người tự xếp). Hành vi trên phần tử thật.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_actions", () => ({
  layGvChoCaseAction: vi.fn(),
  layLuaChonCaseAction: vi.fn(),
  layTrucTrungAction: vi.fn(async () => ({ ok: true, truc: null, coTheQuyet: false })),
  taoCaseAction: vi.fn(),
  xepVaoCaseAction: vi.fn(),
}));

import { TaoCaseMoi } from "./hop-xep-case";

const GV = [
  { id: "gv1", name: "GV Một", ma: "C" },
  { id: "gv2", name: "GV Hai", ma: "C" },
];
const dung = (goiY: { userId: string | null; cau: string | null } | null) =>
  render(
    <TaoCaseMoi
      needIds={["n1"]}
      gvBanDau={{ ds: GV, lyDoRong: null, goiY }}
      phong={[{ id: "p1", name: "P1", sucChua: 10 }]}
      baiCuaNhom={[{ id: "b1", ten: "Bài 1" }]}
      baiCoTheThem={[]}
      homNay="2026-11-02"
      onXong={() => {}}
    />,
  );
const nut = () => screen.getByRole("button", { name: /Tạo case và xếp/ });

afterEach(cleanup);

describe("[HXC] hộp Xếp case", () => {
  it("[HXC-01] chưa chọn PHÒNG ⇒ nút Tạo case TẮT kể cả khi đã có giáo viên; chọn phòng ⇒ bật (đối chứng)", () => {
    dung({ userId: "gv2", cau: "Tự xếp: GV Hai — đang trực ca C." });
    expect(nut()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Phòng *"), { target: { value: "p1" } });
    expect(nut()).toBeEnabled();
  });
  it("[HXC-02] có người tự xếp ⇒ ô GV CHỌN SẴN người đó + hiện câu gợi ý; công tắc tắt (goiY null) ⇒ ô trống, không câu", () => {
    dung({ userId: "gv2", cau: "Tự xếp: GV Hai — đang trực ca C." });
    expect((screen.getByLabelText("Giáo viên trong ca") as HTMLSelectElement).value).toBe("gv2");
    expect(screen.getByText("Tự xếp: GV Hai — đang trực ca C.")).toBeTruthy();
    cleanup();
    dung(null);
    expect((screen.getByLabelText("Giáo viên trong ca") as HTMLSelectElement).value).toBe("");
    expect(document.querySelector("[data-tu-xep]")).toBeNull();
  });
  it("[HXC-03] không ai trực (userId null) ⇒ ô GV trống để chọn tay + câu nói rõ QLCS sẽ được báo", () => {
    dung({ userId: null, cau: "Không tự xếp được (không ai trực ca C) — chọn giáo viên; quản lý cơ sở sẽ được báo." });
    expect((screen.getByLabelText("Giáo viên trong ca") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/quản lý cơ sở sẽ được báo/)).toBeTruthy();
  });
});
