// @vitest-environment jsdom
/**
 * [NHH-UI-RP-*] ReferrerPicker · [NHH-UI-SP-*] SourcePicker/ChonNguonFields · [NHH-UI-GS-*] GanNguonSheet · [NHH-UI-KN-*] KhoiNguonLead
 * — trên PHẦN TỬ THẬT (jsdom), hàm gọi máy chủ được TIÊM.
 *
 * Fixture CỐ Ý LỆCH nhau: người được chọn là GIÁO VIÊN trong khi radio bấm là "Sale" (để phép cấy "gửi nhóm radio thay vì nhóm suy
 * từ vai" ra đỏ); `capNhatLuc` là một chuỗi ISO cụ thể (để phép cấy "bỏ mốc khoá lạc quan" ra đỏ); tổng thực thu khác số khoản.
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
// Server Action không được chạy ở đây — `GanNguonSheet`/`ReferrerPicker` nhận hàm tiêm; module chỉ cần tồn tại.
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({
  moGanNguonAction: vi.fn(),
  doiNguonLeadAction: vi.fn(),
  timNguoiGioiThieuAction: vi.fn(),
}));

import type { NguoiDaChon, NhomChon } from "@/lib/nguon/chon-nguon";
import type { ChoGanNguon } from "@/lib/nguon/doc-gan-nguon";
import { ChonNguonFields, CHUA_CHON_NGUON, type TrangThaiChonNguon } from "./chon-nguon-fields";
import { GanNguonSheet } from "./gan-nguon-sheet";
import { KhoiNguonLead } from "./khoi-nguon-lead";
import { ReferrerPicker, type HamTim } from "./referrer-picker";
import { SourcePicker } from "./source-picker";
import { TbodyDieuHuong } from "./tbody-dieu-huong";
import { useState } from "react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const g = (p: Partial<NhomChon> & Pick<NhomChon, "id" | "code" | "name">): NhomChon => ({
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  sortOrder: 1,
  ...p,
});

const NHOM: NhomChon[] = [
  g({ id: "g1", code: "PARENT_REFERRAL", name: "Nguồn từ phụ huynh giới thiệu", referrerRequirement: "PARENT", sortOrder: 1 }),
  g({ id: "g2", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo", sortOrder: 2 }),
  g({ id: "g5", code: "EMPLOYEE_REFERRAL", name: "Nguồn từ nhân sự giới thiệu", referrerRequirement: "EMPLOYEE", sortOrder: 5 }),
  // Nguồn do ADMIN tạo (không nằm trong 9 mã gốc) cũng yêu cầu nhân sự — dựng ca "bấm một nhóm, ghi ĐÚNG nhóm đó" (nguồn động).
  g({ id: "g7", code: "TRUONG_HOC", name: "Nguồn từ Trường học", referrerRequirement: "EMPLOYEE", sortOrder: 7 }),
  g({ id: "g9", code: "EVENT", name: "Nguồn từ sự kiện", referrerRequirement: "EVENT", sortOrder: 9 }),
  g({ id: "g10", code: "PARTNER", name: "Nguồn từ đối tác", referrerRequirement: "AFFILIATE_ORG", sortOrder: 10 }),
  g({ id: "g11", code: "OTHER", name: "Nguồn khác", requiresNote: true, sortOrder: 11 }),
];

const GV: NguoiDaChon = { loai: "NHAN_SU", employeeId: "e-gv", ten: "Cô Lan Anh", ma: "SR.NV.07 · CS1", vai: "TEACHER" };
const NV_SALE: NguoiDaChon = { loai: "NHAN_SU", employeeId: "e-sale", ten: "Lê Thị Liên", ma: "SR.NV.02", vai: "SALE" };
const PH: NguoiDaChon = { loai: "PHU_HUYNH", studentId: "s1", parentUserId: "u1", ten: "Nguyễn Thị Mận", ma: "HV01", moTa: "phụ huynh của bé An · CS1" };

// ═══ ReferrerPicker ═════════════════════════════════════════════════════════════════════════════════════
describe("[NHH-UI-RP-01] ReferrerPicker — gõ tìm, chọn bằng bàn phím và chuột", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  function dung(tim: HamTim, value: NguoiDaChon | null = null) {
    const onChange = vi.fn();
    const r = render(<ReferrerPicker idPrefix="t" loai="NHAN_SU" value={value} onChange={onChange} tim={tim} />);
    return { onChange, ...r };
  }
  const go = async (q: string) => {
    fireEvent.change(screen.getByRole("combobox"), { target: { value: q } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  };

  it("dưới 2 ký tự ⇒ KHÔNG gọi máy chủ, có gợi ý 'Gõ ít nhất 2 ký tự'; từ 2 ký tự ⇒ gọi đúng MỘT lần với (loại, chuỗi đã trim)", async () => {
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV] }));
    dung(tim);
    await go("L");
    expect(tim).not.toHaveBeenCalled();
    expect(screen.getByText(/Gõ ít nhất 2 ký tự/)).toBeTruthy();
    await go("  Lan ");
    expect(tim).toHaveBeenCalledTimes(1);
    expect(tim).toHaveBeenCalledWith("NHAN_SU", "Lan");
  });

  it("gõ liên tục trong 250ms ⇒ CHỈ lượt cuối được gọi (không bắn mỗi phím một lượt)", async () => {
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [] }));
    dung(tim);
    const o = screen.getByRole("combobox");
    for (const q of ["La", "Lan", "Lan A"]) {
      fireEvent.change(o, { target: { value: q } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(tim).toHaveBeenCalledTimes(1);
    expect(tim).toHaveBeenCalledWith("NHAN_SU", "Lan A");
  });

  it("↓ rồi Enter chọn dòng thứ hai; chuột bấm một dòng cũng chọn; kết quả trả đúng đối tượng", async () => {
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV, NV_SALE] }));
    const { onChange } = dung(tim);
    await go("Li");
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(NV_SALE);
    // chuột
    cleanup();
    const t2 = dung(vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV, NV_SALE] })));
    await go("Li");
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(t2.onChange).toHaveBeenCalledWith(GV);
  });

  it("dòng kết quả nhân sự in VAI bằng chữ (Giáo viên), KHÔNG in số nhóm", async () => {
    dung(async () => ({ ok: true, ketQua: [GV] }));
    await go("Lan");
    const o = screen.getByRole("option");
    expect(within(o).getByText("Giáo viên")).toBeTruthy();
    expect(o.textContent).not.toMatch(/\b[5-8]\b/);
  });

  it("phản hồi CŨ về chậm không đè danh sách của lượt gõ mới (gõ 'Lan' rồi 'Lan Anh')", async () => {
    let xongCu: (v: { ok: true; ketQua: NguoiDaChon[] }) => void = () => {};
    const tim = vi
      .fn<HamTim>()
      .mockImplementationOnce(() => new Promise((res) => (xongCu = res)))
      .mockImplementationOnce(async () => ({ ok: true, ketQua: [GV] }));
    dung(tim);
    await go("Lan");
    await go("Lan Anh");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    // lượt CŨ về sau với danh sách khác — không được thay
    await act(async () => xongCu({ ok: true, ketQua: [NV_SALE, NV_SALE, NV_SALE] }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Cô Lan Anh")).toBeTruthy();
  });

  it("Enter KHI DANH SÁCH ĐÃ ĐÓNG (đang tìm lượt mới) KHÔNG chọn người của lượt gõ TRƯỚC — ca có kết quả cũ còn nằm trong state", async () => {
    const tim = vi
      .fn<HamTim>()
      .mockResolvedValueOnce({ ok: true, ketQua: [GV] })
      .mockImplementationOnce(() => new Promise(() => {})); // lượt hai không bao giờ về
    const onChange = vi.fn();
    render(<ReferrerPicker idPrefix="t" loai="NHAN_SU" value={null} onChange={onChange} tim={tim} />);
    await go("Lan");
    expect(screen.getAllByRole("option")).toHaveLength(1); // kết quả cũ ĐANG hiện
    await go("Lan Anh"); // gõ tiếp ⇒ đang tìm ⇒ danh sách đóng, nhưng `ketQua` cũ vẫn còn trong state
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter trong ô tìm KHÔNG gửi biểu mẫu bao quanh (kể cả khi chưa có danh sách)", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ReferrerPicker idPrefix="t" loai="NHAN_SU" value={null} onChange={vi.fn()} tim={vi.fn<HamTim>(() => new Promise(() => {}))} />
        <button type="submit">Lưu</button>
      </form>,
    );
    await go("Lan");
    const o = screen.getByRole("combobox");
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    o.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // implicit submission bị chặn ở đây
  });

  it("[NHH-UI-RP-02] Esc khi ô CÓ chữ ⇒ chỉ xoá ô, KHÔNG nổi bọt lên (Sheet bao quanh không bị đóng); ô TRỐNG thì Esc đi tiếp (đối chứng dương)", () => {
    // Cấy bỏ `e.stopPropagation()`: gõ nhầm rồi bấm Esc để xoá thì cả Sheet đóng, mất lý do vừa gõ.
    const lenTren = vi.fn();
    render(
      <div onKeyDown={lenTren}>
        <ReferrerPicker idPrefix="t" loai="NHAN_SU" value={null} onChange={vi.fn()} tim={vi.fn<HamTim>(async () => ({ ok: true, ketQua: [] }))} />
      </div>,
    );
    const o = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "Lan" } });
    fireEvent.keyDown(o, { key: "Escape" });
    expect(lenTren).not.toHaveBeenCalled();
    expect(o.value).toBe("");
    fireEvent.keyDown(o, { key: "Escape" }); // ô đã trống
    expect(lenTren).toHaveBeenCalledTimes(1);
  });

  it("[NHH-UI-RP-03] xoá ô khi lượt tìm đang BAY ⇒ kết quả về sau KHÔNG mọc lại danh sách dưới ô trống", async () => {
    // Cấy bỏ `lanTim.current += 1` ở nhánh dưới ngưỡng: lượt đang bay vẫn "mới nhất" nên đè danh sách lên một ô đã xoá.
    let xong: (v: { ok: true; ketQua: NguoiDaChon[] }) => void = () => {};
    const tim = vi.fn<HamTim>(() => new Promise((res) => (xong = res)));
    dung(tim);
    await go("Lan");
    expect(tim).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    await act(async () => xong({ ok: true, ketQua: [GV] }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText("Cô Lan Anh")).toBeNull();
  });

  it("[NHH-UI-RP-04] ↓ không vượt quá dòng cuối, ↑ không xuống dưới dòng đầu: bấm thừa rồi Enter vẫn chọn đúng dòng cuối / dòng đầu", async () => {
    // Cấy bỏ `Math.min` / `Math.max`: chỉ số trượt ra ngoài danh sách ⇒ Enter không chọn ai (hoặc chọn undefined) mà không báo gì.
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV, NV_SALE] }));
    const { onChange } = dung(tim);
    await go("Li");
    const o = screen.getByRole("combobox");
    for (let i = 0; i < 5; i++) fireEvent.keyDown(o, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(o, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(NV_SALE);
    cleanup();
    const t2 = dung(vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV, NV_SALE] })));
    await go("Li");
    const o2 = screen.getByRole("combobox");
    for (let i = 0; i < 4; i++) fireEvent.keyDown(o2, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(o2, { key: "Enter" });
    expect(t2.onChange).toHaveBeenLastCalledWith(GV);
  });

  it("[NHH-UI-RP-05] rời màn khi còn hẹn giờ gõ ⇒ KHÔNG gọi máy chủ sau khi đã gỡ (không bắn truy vấn mồ côi)", async () => {
    // Cấy bỏ `clearTimeout` ở cleanup: gõ rồi đóng Sheet trong 250ms vẫn có một lượt tìm bay lên máy chủ.
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV] }));
    const { unmount } = dung(tim);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Lan" } });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(tim).not.toHaveBeenCalled();
  });

  it("[NHH-UI-RP-06] jsdom KHÔNG có scrollIntoView: callback rAF sau khi kết quả hiện ra KHÔNG được ném (lỗi ấy nổ SAU khi ca test kết thúc ⇒ 'Unhandled Error', vitest thoát mã 1 dù mọi ca xanh)", async () => {
    // Cấy lại `scrollIntoView({…})` trần (bỏ `?.`): ca này đỏ. rAF được BẮT rồi chạy ngay trong thân ca — không để nó nổ ở nơi không ai thấy.
    expect(Element.prototype.scrollIntoView).toBeUndefined();
    const cho: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cho.push(cb);
      return cho.length;
    });
    try {
      dung(vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV] })));
      await go("Lan");
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(cho.length, "kéo danh sách vào tầm nhìn phải đi qua rAF").toBeGreaterThanOrEqual(1);
      expect(() => cho.forEach((cb) => cb(0))).not.toThrow();
    } finally {
      raf.mockRestore();
    }
  });

  it("[NHH-UI-RP-07] FOCUS KHÔNG rơi về <body>: chọn người bằng Enter/chuột ⇒ focus sang nút 'Đổi' (ô tìm vừa biến mất); bấm 'Đổi' ⇒ focus về ô tìm; mới mở (chưa thao tác) ⇒ KHÔNG tự cướp focus", async () => {
    // Cấy bỏ ref-focus ở nút 'Đổi' hoặc ở ô tìm: người dùng bàn phím mất vị trí trong Sheet modal, phải Tab lại từ đầu.
    function Bao() {
      const [v, setV] = useState<NguoiDaChon | null>(null);
      return <ReferrerPicker idPrefix="t" loai="NHAN_SU" value={v} onChange={setV} tim={async () => ({ ok: true, ketQua: [GV, NV_SALE] })} />;
    }
    render(<Bao />);
    expect(document.activeElement).toBe(document.body); // đối chứng: mở ra không cướp focus
    const o = screen.getByRole("combobox");
    o.focus();
    await go("Li");
    fireEvent.keyDown(o, { key: "ArrowDown" });
    fireEvent.keyDown(o, { key: "Enter" });
    expect(screen.queryByRole("combobox")).toBeNull();
    const doi = screen.getByRole("button", { name: /Đổi nhân sự giới thiệu, đang chọn Lê Thị Liên/ });
    expect(document.activeElement).toBe(doi);
    fireEvent.click(doi);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    // chọn bằng CHUỘT cũng giữ focus trong cụm
    await go("Li");
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Đổi nhân sự giới thiệu, đang chọn Cô Lan Anh/ }));
  });

  it("[NHH-UI-RP-08] combobox ARIA trọn vẹn: ô trỏ `aria-controls` tới đúng phần tử role=listbox; dòng sáng là `aria-activedescendant`", async () => {
    // Cấy đổi role='listbox' thành 'list': trình đọc màn hình mất khái niệm danh sách chọn, không ca nào đỏ.
    dung(vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV, NV_SALE] })));
    const o = screen.getByRole("combobox");
    expect(o.getAttribute("aria-expanded")).toBe("false");
    await go("Li");
    const ds = screen.getByRole("listbox");
    expect(o.getAttribute("aria-expanded")).toBe("true");
    expect(o.getAttribute("aria-controls")).toBe(ds.id);
    expect(o.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]!.id);
    fireEvent.keyDown(o, { key: "ArrowDown" });
    expect(o.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id);
  });

  it("không có ai khớp ⇒ nói rõ phạm vi (phụ huynh: 'trong các cơ sở bạn được xem'); lỗi ⇒ có nút Thử lại gọi lại", async () => {
    const tim = vi.fn<HamTim>().mockResolvedValueOnce({ ok: false, error: "Mất kết nối" }).mockResolvedValueOnce({ ok: true, ketQua: [] });
    render(<ReferrerPicker idPrefix="t" loai="PHU_HUYNH" value={null} onChange={() => {}} tim={tim} />);
    await go("zzz");
    expect(screen.getByRole("alert").textContent).toContain("Mất kết nối");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(tim).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Không có phụ huynh nào khớp “zzz” trong các cơ sở bạn được xem/)).toBeTruthy();
  });

  it("phụ huynh đã chọn ⇒ tóm tắt nói rõ 'phụ huynh của bé …' + mã học viên (để người nhập biết đúng nhà nào), không SĐT", () => {
    render(<ReferrerPicker idPrefix="t" loai="PHU_HUYNH" value={PH} onChange={() => {}} tim={vi.fn()} />);
    expect(screen.getByText("Nguyễn Thị Mận")).toBeTruthy();
    expect(screen.getByText("phụ huynh của bé An · CS1 · HV01")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/0\d{9}/);
  });

  it("đã chọn ⇒ hiện tóm tắt + nút Đổi (bỏ chọn); câu lỗi của máy chủ hiện CẠNH ô", () => {
    const { onChange } = dung(vi.fn(), GV);
    expect(screen.getByText("Cô Lan Anh")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Đổi nhân sự giới thiệu/ }));
    expect(onChange).toHaveBeenCalledWith(null);
    cleanup();
    render(<ReferrerPicker idPrefix="t" loai="NHAN_SU" value={null} onChange={() => {}} tim={vi.fn()} invalid="Nguồn này cần chọn nhân sự giới thiệu." />);
    expect(screen.getByRole("alert").textContent).toBe("Nguồn này cần chọn nhân sự giới thiệu.");
    expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe("true");
  });
});

// ═══ TbodyDieuHuong ═════════════════════════════════════════════════════════════════════════════════════
describe("[NHH-UI-TB-01] TbodyDieuHuong — ↑/↓ đổi dòng hàng chờ; hai đầu danh sách đứng yên (không ném, không chặn cuộn)", () => {
  function dung() {
    render(
      <table>
        <TbodyDieuHuong>
          {["a", "b", "c"].map((id) => (
            <tr key={id}>
              <td>
                <button data-nut-hang="" aria-label={`dong-${id}`}>
                  {id}
                </button>
                <input aria-label={`o-${id}`} />
              </td>
            </tr>
          ))}
        </TbodyDieuHuong>
      </table>,
    );
    const nut = (id: string) => screen.getByRole("button", { name: `dong-${id}` });
    return { nut };
  }

  it("↓ sang dòng kế, ↑ về dòng trước; phím mũi tên bị chặn mặc định (không cuộn trang)", () => {
    const { nut } = dung();
    nut("a").focus();
    expect(fireEvent.keyDown(nut("a"), { key: "ArrowDown" })).toBe(false); // false = preventDefault đã gọi
    expect(document.activeElement).toBe(nut("b"));
    expect(fireEvent.keyDown(nut("b"), { key: "ArrowUp" })).toBe(false);
    expect(document.activeElement).toBe(nut("a"));
  });

  it("đầu/cuối danh sách: ↑ ở dòng đầu, ↓ ở dòng cuối KHÔNG ném lỗi, KHÔNG đổi focus, KHÔNG chặn mặc định (không vòng)", () => {
    // Cấy bỏ `!tiep` khỏi nhánh thoát sớm: `tiep.focus()` chạy trên undefined ⇒ TypeError ở dòng cuối.
    const { nut } = dung();
    nut("a").focus();
    expect(() => fireEvent.keyDown(nut("a"), { key: "ArrowUp" })).not.toThrow();
    expect(document.activeElement).toBe(nut("a"));
    expect(fireEvent.keyDown(nut("a"), { key: "ArrowUp" })).toBe(true);
    nut("c").focus();
    expect(() => fireEvent.keyDown(nut("c"), { key: "ArrowDown" })).not.toThrow();
    expect(document.activeElement).toBe(nut("c"));
    expect(fireEvent.keyDown(nut("c"), { key: "ArrowDown" })).toBe(true);
  });

  it("phím đi kèm Ctrl/⌘/Alt/Shift, phím khác, hoặc focus KHÔNG ở nút dòng (vd đang gõ trong ô) ⇒ bỏ qua", () => {
    const { nut } = dung();
    nut("a").focus();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(fireEvent.keyDown(nut("a"), { key: "ArrowDown", ...mod }), JSON.stringify(mod)).toBe(true);
      expect(document.activeElement).toBe(nut("a"));
    }
    expect(fireEvent.keyDown(nut("a"), { key: "Enter" })).toBe(true);
    const o = screen.getByLabelText("o-a");
    o.focus();
    expect(fireEvent.keyDown(o, { key: "ArrowDown" })).toBe(true);
    expect(document.activeElement).toBe(o);
  });
});

// ═══ SourcePicker + ChonNguonFields ═════════════════════════════════════════════════════════════════════
describe("[NHH-UI-SP-01] SourcePicker — radio gom 'có người / không có người', không UNKNOWN", () => {
  it("hai cụm đúng thuộc tính; mỗi nguồn một radio; chọn gọi onChange đúng nhóm", () => {
    const onChange = vi.fn();
    render(<SourcePicker idPrefix="t" nhom={NHOM} value={null} onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByText("Có người giới thiệu")).toBeTruthy();
    expect(screen.getByText("Không có người giới thiệu")).toBeTruthy();
    // sự kiện (EVENT) thuộc cụm KHÔNG có người; đối tác thuộc cụm CÓ người
    const co = screen.getByText("Có người giới thiệu").parentElement!;
    expect(within(co).getByLabelText(/Nguồn từ đối tác/)).toBeTruthy();
    expect(within(co).queryByLabelText(/Nguồn từ sự kiện/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Trường học/));
    expect(onChange).toHaveBeenCalledWith(NHOM[3]);
  });

  it("dòng phụ nói việc phải làm tiếp: 'Chọn nhân sự', 'Phải giải trình'; sự kiện KHÔNG hứa ô chọn sự kiện", () => {
    render(<SourcePicker idPrefix="t" nhom={NHOM} value={null} onChange={() => {}} />);
    const lab = (t: RegExp) => screen.getByLabelText(t).closest("label")!.textContent!;
    expect(lab(/Nguồn từ nhân sự giới thiệu/)).toContain("Chọn nhân sự");
    expect(lab(/Nguồn khác/)).toContain("Phải giải trình");
    expect(lab(/Nguồn từ sự kiện/)).not.toMatch(/Chọn/);
  });

  it("khoá (disabled) ⇒ mọi radio disabled (CẢ ở fieldset LẪN ở từng radio — hai lớp, bỏ một lớp vẫn khoá); lỗi hiện CẠNH nhóm", () => {
    render(<SourcePicker idPrefix="t" nhom={NHOM} value="g2" onChange={() => {}} disabled invalid="Chọn một nguồn." />);
    for (const r of screen.getAllByRole("radio")) expect((r as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector("fieldset")!.disabled).toBe(true);
    // mỗi radio TỰ mang `disabled` (không chỉ thừa hưởng từ fieldset): đọc thuộc tính trên phần tử
    for (const r of screen.getAllByRole("radio")) expect(r.hasAttribute("disabled")).toBe(true);
    expect((screen.getByLabelText(/Nguồn từ Quảng Cáo/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Chọn một nguồn.");
  });

  it("[NHH-UI-SP-01b] có lỗi ⇒ nhóm radio mang `aria-invalid` (trình đọc màn hình biết ô này sai); không lỗi ⇒ không có thuộc tính", () => {
    // Cấy bỏ `aria-invalid` ở fieldset: lỗi chỉ hiện bằng chữ đỏ, người dùng trình đọc màn hình không nghe thấy gì.
    render(<SourcePicker idPrefix="t" nhom={NHOM} value={null} onChange={() => {}} invalid="Chọn một nguồn." />);
    expect(document.querySelector("fieldset")!.getAttribute("aria-invalid")).toBe("true");
    cleanup();
    render(<SourcePicker idPrefix="t" nhom={NHOM} value={null} onChange={() => {}} />);
    expect(document.querySelector("fieldset")!.hasAttribute("aria-invalid")).toBe(false);
  });

  it("danh sách rỗng ⇒ nói thật, không vẽ nhóm trống", () => {
    render(<SourcePicker idPrefix="t" nhom={[]} value={null} onChange={() => {}} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(/Chưa có nguồn nào được bật để chọn/)).toBeTruthy();
  });
});

describe("[NHH-UI-SP-02] ChonNguonFields — ô thứ hai chỉ hiện khi nguồn cần; nhóm suy từ vai nói bằng chữ", () => {
  function Bao({ tim, dau }: { tim?: HamTim; dau?: TrangThaiChonNguon }) {
    const [v, setV] = useState<TrangThaiChonNguon>(dau ?? CHUA_CHON_NGUON);
    return <ChonNguonFields idPrefix="t" nhom={NHOM} value={v} onChange={setV} errors={{}} tim={tim} />;
  }

  it("nguồn KHÔNG cần người ⇒ không có ô tìm; nguồn cần người ⇒ có ô tìm đúng loại; nguồn 'Khác' ⇒ có ô giải trình", () => {
    render(<Bao />);
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText(/Giải trình nguồn/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Nguồn từ phụ huynh giới thiệu/));
    expect(screen.getByLabelText("Phụ huynh giới thiệu")).toBeTruthy(); // nhãn ô tìm theo loại
    fireEvent.click(screen.getByLabelText(/Nguồn khác/));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByLabelText(/Giải trình nguồn/)).toBeTruthy();
  });

  it("bộ đếm giải trình: 0/10 → đủ 10 ký tự đổi sang tông thành công (đếm sau trim)", () => {
    render(<Bao dau={{ nhomId: "g11", nguoi: null, giaiTrinh: "" }} />);
    expect(screen.getByText("0/10 ký tự tối thiểu")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Giải trình nguồn/), { target: { value: "  khách hội thảo  " } });
    const dem = screen.getByText("14/10 ký tự tối thiểu");
    expect(dem.className).toContain("text-state-success-ink");
  });

  it("chọn nhóm nhân sự do admin tạo rồi chọn người là GIÁO VIÊN ⇒ ghi chú nói VAI bằng chữ và nói rõ nguồn KHÔNG đổi; không còn câu 'Tính là …' (lời hứa sai); không có số", async () => {
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV] }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Bao tim={tim} />);
    fireEvent.click(screen.getByLabelText(/Nguồn từ Trường học/));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Lan" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(screen.getByRole("option"));
    const note = screen.getByTestId("nhom-suy-ra");
    expect(note.textContent).toContain("Giáo viên");
    expect(note.textContent).toContain("nguồn vẫn là nguồn bạn vừa chọn");
    expect(note.textContent).not.toContain("Tính là");
    expect(note.textContent).not.toMatch(/\b[5-8]\b/);
  });

  it("[NHH-UI-SP-02b] đổi từ nguồn 'Khác' sang nguồn không cần giải trình ⇒ chữ giải trình bị XOÁ (quay lại không thấy chữ của nguồn trước); đổi giữa hai nguồn CÙNG cần giải trình ⇒ giữ", () => {
    // Cấy `giaiTrinh: truoc.giaiTrinh` (bỏ nhánh xoá): chữ giải trình của "Khác" mọc lại dưới một nguồn khác, dễ bị gửi đi nhầm.
    render(<Bao dau={{ nhomId: "g11", nguoi: null, giaiTrinh: "" }} />);
    fireEvent.change(screen.getByLabelText(/Giải trình nguồn/), { target: { value: "khách đến từ hội thảo STEM" } });
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    expect(screen.queryByLabelText(/Giải trình nguồn/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Nguồn khác/));
    expect((screen.getByLabelText(/Giải trình nguồn/) as HTMLTextAreaElement).value).toBe("");
  });

  it("[NHH-UI-SP-02c] ô giải trình theo NHÓM SẼ GHI = nhóm đang bấm (nguồn động: không còn nhóm 'suy từ vai'): nhóm admin tạo CẦN giải trình ⇒ có ô; nhóm nhân sự gốc cần giải trình mà không bấm nó ⇒ KHÔNG ô", () => {
    // Cấy `nhomGhi?.requiresNote` → hằng true/false: máy chủ đo giải trình trên nhóm GHI nên báo lỗi ở một ô mà giao diện không vẽ (hoặc ngược lại).
    const nhomLech = NHOM.map((n) => (n.code === "TRUONG_HOC" ? { ...n, requiresNote: true } : n));
    function BaoLech({ dau }: { dau: TrangThaiChonNguon }) {
      const [v, setV] = useState<TrangThaiChonNguon>(dau);
      return <ChonNguonFields idPrefix="t" nhom={nhomLech} value={v} onChange={setV} errors={{}} />;
    }
    render(<BaoLech dau={{ nhomId: "g7", nguoi: GV, giaiTrinh: "" }} />);
    expect(screen.getByLabelText(/Giải trình nguồn/)).toBeTruthy();
    cleanup();
    // đối chứng: cùng thao tác trên DANH MỤC GỐC (nhóm g7 KHÔNG cần giải trình) ⇒ KHÔNG có ô
    function BaoGoc({ dau }: { dau: TrangThaiChonNguon }) {
      const [v, setV] = useState<TrangThaiChonNguon>(dau);
      return <ChonNguonFields idPrefix="t" nhom={NHOM} value={v} onChange={setV} errors={{}} />;
    }
    render(<BaoGoc dau={{ nhomId: "g7", nguoi: NV_SALE, giaiTrinh: "" }} />);
    expect(screen.queryByLabelText(/Giải trình nguồn/)).toBeNull();
  });

  it("[NHH-UI-SP-02d] lỗi `thamChieu` của nhóm KHÔNG cần người (người lạc loại) không có ô nào để gắn ⇒ nói NGAY dưới danh sách nguồn (role=alert); nhóm cần người thì lỗi nằm CẠNH ô tìm, không lặp ở đây", () => {
    // Cấy bỏ khối `!loaiNguoi && errors.thamChieu`: máy chủ từ chối vì 'nguồn này không có người giới thiệu' mà người nhập không thấy chữ nào.
    const lop = (nhomId: string) => (
      <ChonNguonFields idPrefix="t" nhom={NHOM} value={{ nhomId, nguoi: null, giaiTrinh: "" }} onChange={() => {}} errors={{ thamChieu: "Nguồn này không có người giới thiệu — bỏ phần đã chọn." }} />
    );
    render(lop("g2")); // Quảng cáo: không cần người
    expect(screen.getByRole("alert").textContent).toBe("Nguồn này không có người giới thiệu — bỏ phần đã chọn.");
    expect(screen.queryByRole("combobox")).toBeNull();
    cleanup();
    render(lop("g5")); // Sale: cần người ⇒ lỗi nằm cạnh ô tìm, ĐÚNG MỘT chỗ
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe("true");
  });

  it("đổi sang nhóm cần LOẠI NGƯỜI KHÁC ⇒ bỏ người đã chọn (đối tác không thể là nhân sự); cùng loại ⇒ giữ", () => {
    render(<Bao dau={{ nhomId: "g5", nguoi: NV_SALE, giaiTrinh: "" }} />);
    expect(screen.getByText("Lê Thị Liên")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Trường học/)); // cùng NHAN_SU
    expect(screen.getByText("Lê Thị Liên")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Nguồn từ phụ huynh giới thiệu/)); // khác loại
    expect(screen.queryByText("Lê Thị Liên")).toBeNull();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});

// ═══ GanNguonSheet ══════════════════════════════════════════════════════════════════════════════════════
const MOC = "2026-10-05T03:00:00.000Z";
const du = (p: Partial<ChoGanNguon> = {}): ChoGanNguon => ({
  leadId: "lead-1",
  tenLead: "Ngô Mai My",
  coSo: { code: "CS1", name: "Trụ sở chính" },
  duongVao: "qua-tang",
  nguon: {
    groupId: "g5",
    groupCode: "EMPLOYEE_REFERRAL",
    groupName: "Nguồn từ nhân sự giới thiệu",
    giaiTrinh: null,
    nguoi: null,
    thieuNguoi: true,
    khoa: false,
    canhBao: [],
    xemTay: ["THIEU_NGUOI"],
    vanDe: ["THIEU_NGUOI"],
    cachXacDinh: "MANUAL",
    luat: "KHAI_TAY",
    ngayGhiCong: "2026-09-29T03:00:00.000Z",
    hanGhiCong: "2026-12-28T16:59:59.999Z",
    conHanGhiCong: true,
    nhanGoc: null,
    capNhatLuc: MOC,
  },
  danhMuc: NHOM,
  quyen: { ok: true },
  boSungSale: { kieu: "KHONG_CAN" },
  thucThu: null,
  ...p,
});

describe("[NHH-UI-GS-01] GanNguonSheet — mở ⇒ tải ⇒ form; mỗi lần mở là một lần tải mới", () => {
  function dung(d: ChoGanNguon | (() => Promise<ChoGanNguon>), extra: Partial<React.ComponentProps<typeof GanNguonSheet>> = {}) {
    const mo = vi.fn(async () => ({ ok: true as const, du: typeof d === "function" ? await d() : d }));
    const doi = vi.fn(async () => ({ ok: true as const, canDieuChinh: false }));
    render(
      <GanNguonSheet leadId="lead-1" tenLead="Ngô Mai My" coTheMoLead mo={mo} doi={doi} triggerAriaLabel="Gán nguồn cho Ngô Mai My" {...extra}>
        Ngô Mai My
      </GanNguonSheet>,
    );
    return { mo, doi };
  }
  const moSheet = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Gán nguồn cho Ngô Mai My" }));
    await screen.findByText("Hiện tại");
  };

  it("CHƯA mở ⇒ không gọi máy chủ; mở ⇒ gọi `mo(leadId)` ĐÚNG MỘT lần và vẽ 'Hiện tại' + danh sách nguồn", async () => {
    const { mo } = dung(du());
    expect(mo).not.toHaveBeenCalled();
    await moSheet();
    expect(mo).toHaveBeenCalledTimes(1);
    expect(mo).toHaveBeenCalledWith("lead-1");
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByText("Nguồn từ nhân sự giới thiệu", { selector: "dd *, dd" })).toBeTruthy();
    // đóng rồi mở lại ⇒ tải lại (mốc khoá lạc quan cũ không sống sang lượt sau)
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
    await waitFor(() => expect(screen.queryByText("Hiện tại")).toBeNull());
    await moSheet();
    expect(mo).toHaveBeenCalledTimes(2);
  });

  it("lúc tải có khung chờ (role=status 'Đang tải nguồn'), không để trắng; tải xong ⇒ khung chờ biến mất, form hiện", async () => {
    // Cấy bỏ `role="status"` của KhungCho: người dùng đọc màn hình không biết Sheet đang tải.
    let xong: (v: { ok: true; du: ChoGanNguon }) => void = () => {};
    const mo = vi.fn(() => new Promise<{ ok: true; du: ChoGanNguon }>((res) => (xong = res)));
    render(
      <GanNguonSheet leadId="lead-1" tenLead="Ngô Mai My" coTheMoLead mo={mo} triggerAriaLabel="mở">
        Ngô Mai My
      </GanNguonSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    expect(screen.getByRole("status", { name: "Đang tải nguồn" })).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await act(async () => xong({ ok: true, du: du() }));
    await screen.findByText("Hiện tại");
    expect(screen.queryByRole("status", { name: "Đang tải nguồn" })).toBeNull();
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });

  it("tải lỗi ⇒ câu tiếng Việt + 'Thử lại' THẬT SỰ gọi lại máy chủ rồi vẽ form (lần hai OK); không còn câu lỗi", async () => {
    // Cấy `onClick={() => {}}` cho nút 'Thử lại': nút vẽ ra mà không làm gì.
    const mo = vi
      .fn<() => Promise<{ ok: false; error: string } | { ok: true; du: ChoGanNguon }>>()
      .mockResolvedValueOnce({ ok: false, error: "Lead không tồn tại." })
      .mockResolvedValueOnce({ ok: true, du: du() });
    render(
      <GanNguonSheet leadId="x" tenLead="X" coTheMoLead mo={mo} triggerAriaLabel="mở">
        X
      </GanNguonSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    await screen.findByText("Lead không tồn tại.");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("Hiện tại");
    expect(mo).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Lead không tồn tại.")).toBeNull();
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });

  it("Page tự gán, nguồn KHOÁ + không có sources:manage ⇒ KHÔNG vẽ form/nút Lưu; nêu TÊN khoá thật và hỏi ai", async () => {
    dung(
      du({
        nguon: { ...du().nguon!, khoa: true },
        quyen: { ok: false, loi: "Nguồn này do hệ thống tự xác định và đã khoá — cần quyền quản lý nguồn để đổi.", thieu: ["sources:manage"] },
      }),
    );
    await moSheet();
    expect(screen.getByText("Nguồn này đã khoá")).toBeTruthy();
    expect(screen.getByText("sources:manage").tagName).toBe("CODE");
    expect(screen.getByText(/Hỏi quản lý cơ sở hoặc quản trị viên hệ thống/)).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: /Lưu nguồn mới/ })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    // vẫn có đường thoát và đường sang hồ sơ
    expect(screen.getByRole("button", { name: "Đóng" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mở hồ sơ lead" }).getAttribute("href")).toBe("/leads/lead-1");
  });

  it("nguồn KHOÁ nhưng quyền thiếu là THỨ KHÁC (không phải sources:manage) ⇒ tiêu đề KHÔNG nói 'đã khoá' (nói vậy là chỉ sai khoá cần xin)", async () => {
    // Cấy bỏ vế `thieu.includes("sources:manage")`: người thiếu leads:overwrite được bảo "Nguồn này đã khoá" rồi đi xin sai quyền.
    dung(
      du({
        nguon: { ...du().nguon!, khoa: true },
        quyen: { ok: false, loi: "Bạn không có quyền đổi nguồn lead.", thieu: ["leads:overwrite"] },
      }),
    );
    await moSheet();
    expect(screen.queryByText("Nguồn này đã khoá")).toBeNull();
    expect(screen.getByText("Bạn chưa đổi được nguồn lead này")).toBeTruthy();
    expect(screen.getByText("leads:overwrite").tagName).toBe("CODE");
  });

  it("đối chứng dương: quyền đủ ⇒ CÓ form, CÓ nút Lưu, và không có khối 'chưa đổi được'", async () => {
    dung(du());
    await moSheet();
    expect(screen.getByRole("form", { name: "Đổi nguồn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lưu nguồn mới/ })).toBeTruthy();
    expect(screen.queryByText(/chưa đổi được nguồn lead này/)).toBeNull();
  });

  it("coTheMoLead=false ⇒ KHÔNG có link sang hồ sơ lead (người không có leads:view-* bị đá về /dashboard thầm lặng)", async () => {
    dung(du(), { coTheMoLead: false });
    await moSheet();
    expect(screen.queryByRole("link", { name: "Mở hồ sơ lead" })).toBeNull();
  });

  it("lead CHƯA có quy nguồn ⇒ nói thật, không form", async () => {
    dung(du({ nguon: null }));
    await moSheet();
    expect(screen.getByText(/chưa có quy nguồn/)).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("đã có thực thu ⇒ cảnh báo hệ quả BẰNG SỐ (số khoản + tổng tiền), nói rõ dòng đã tính không bị sửa", async () => {
    dung(du({ thucThu: { soKhoan: 3, tong: 12_000_000 } }));
    await moSheet();
    const w = screen.getByRole("status");
    expect(w.textContent).toContain("3");
    expect(w.textContent).toContain("12.000.000");
    expect(w.textContent).toMatch(/không bị sửa/);
  });

  it("chưa có thực thu ⇒ KHÔNG có cảnh báo tiền (đối chứng)", async () => {
    dung(du());
    await moSheet();
    expect(screen.queryByText(/khoản thu/)).toBeNull();
  });
});

describe("[NHH-UI-GS-02] GanNguonSheet — Lưu: kiểm trước, gửi đúng thứ đang hiển thị, lỗi về đúng ô", () => {
  async function moForm(extra: { doi?: ReturnType<typeof vi.fn>; du?: ChoGanNguon } = {}) {
    const mo = vi.fn(async () => ({ ok: true as const, du: extra.du ?? du() }));
    const doi = extra.doi ?? vi.fn(async () => ({ ok: true as const, canDieuChinh: false }));
    const tim = vi.fn<HamTim>(async () => ({ ok: true, ketQua: [GV] }));
    render(
      <GanNguonSheet leadId="lead-1" tenLead="Ngô Mai My" coTheMoLead mo={mo} doi={doi as never} tim={tim} triggerAriaLabel="mở">
        Ngô Mai My
      </GanNguonSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    await screen.findByText("Hiện tại");
    return { doi, tim };
  }
  const luu = () => fireEvent.click(screen.getByRole("button", { name: /Lưu nguồn mới/ }));
  async function chonGiaoVien() {
    fireEvent.click(screen.getByLabelText(/Nguồn từ Trường học/));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Lan" } });
    await waitFor(() => expect(screen.getByRole("option")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("option"));
  }

  it("bấm Lưu khi chưa chọn gì ⇒ lỗi 'Chọn một nguồn' CẠNH nhóm radio, KHÔNG gọi máy chủ", async () => {
    const { doi } = await moForm();
    luu();
    expect(await screen.findByText("Chọn một nguồn.")).toBeTruthy();
    expect(doi).not.toHaveBeenCalled();
  });

  it("lỗi CŨ biến mất khi người dùng SỬA ô tương ứng (lỗi còn nằm đó sau khi đã sửa là nói dối): chọn nguồn xoá 'Chọn một nguồn', gõ lý do xoá lỗi lý do", async () => {
    await moForm();
    luu();
    expect(await screen.findByText("Chọn một nguồn.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    expect(screen.queryByText("Chọn một nguồn.")).toBeNull();
    // lỗi lý do (do lần Lưu trên) còn tới khi sửa CHÍNH ô lý do
    luu();
    expect(await screen.findByText(/Lý do đổi nguồn phải từ 10 ký tự/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Nguồn từ phụ huynh giới thiệu/)); // sửa ô KHÁC — lỗi lý do phải còn
    expect(screen.getByText(/Lý do đổi nguồn phải từ 10 ký tự/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "đủ mười ký tự rồi" } });
    expect(screen.queryByText(/Lý do đổi nguồn phải từ 10 ký tự/)).toBeNull();
  });

  it("thiếu LÝ DO (luôn bắt buộc) ⇒ lỗi cạnh ô lý do, focus nhảy tới ô đó, KHÔNG gọi máy chủ", async () => {
    const { doi } = await moForm();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    luu();
    const loi = await screen.findByText(/Lý do đổi nguồn phải từ 10 ký tự \(hiện 0\)/);
    expect(loi.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText(/Lý do đổi nguồn/).getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement?.id).toBe("gn-ly-do"));
    expect(doi).not.toHaveBeenCalled();
  });

  it("gửi ĐÚNG payload: nhóm GHI = nhóm đang bấm (g7 do admin tạo — KHÔNG bị đổi sang nhóm theo vai), id người, lý do đã trim, mốc khoá lạc quan của màn hình đã xem", async () => {
    const { doi } = await moForm();
    await chonGiaoVien();
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "  Phụ huynh xác nhận cô Lan giới thiệu  " } });
    luu();
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect(doi).toHaveBeenCalledWith({
      leadId: "lead-1",
      groupId: "g7", // nhóm admin tạo đang bấm — vai giáo viên không đổi nhóm
      employeeId: "e-gv",
      parentUserId: null,
      studentId: null,
      affiliateId: null,
      giaiTrinh: null,
      lyDo: "Phụ huynh xác nhận cô Lan giới thiệu",
      expectedUpdatedAt: MOC,
    });
  });

  it("ĐANG LƯU ⇒ ô nhập đóng băng (lý do · radio · nút Lưu 'Đang lưu…'), không gửi hai lần: bấm Lưu lần nữa không gọi máy chủ thêm", async () => {
    // Cấy `disabled={dangLuu}` → `disabled={false}` ở ChonNguonFields hoặc ở ô lý do: sửa được nguồn khi lượt lưu đang bay.
    let xong: (v: { ok: true; canDieuChinh: boolean }) => void = () => {};
    const doi = vi.fn(() => new Promise<{ ok: true; canDieuChinh: boolean }>((res) => (xong = res)));
    await moForm({ doi: doi as never });
    await chonGiaoVien();
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "Phụ huynh xác nhận cô Lan giới thiệu" } });
    luu();
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText(/Lý do đổi nguồn/) as HTMLTextAreaElement).disabled).toBe(true);
    for (const r of screen.getAllByRole("radio")) expect((r as HTMLInputElement).disabled, r.getAttribute("value") ?? "").toBe(true);
    const nut = screen.getByRole("button", { name: /Đang lưu/ }) as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.click(nut);
    expect(doi).toHaveBeenCalledTimes(1);
    await act(async () => xong({ ok: true, canDieuChinh: false }));
  });

  it("thành công ⇒ toast + đóng Sheet + làm mới trang; lead đã thu ⇒ thêm toast nói sẽ điều chỉnh hoa hồng", async () => {
    const doi = vi.fn(async () => ({ ok: true as const, canDieuChinh: true }));
    await moForm({ doi, du: du({ thucThu: { soKhoan: 1, tong: 3_000_000 } }) });
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "Khách tự đến theo quảng cáo" } });
    luu();
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith("Đã đổi nguồn sang “Nguồn từ Quảng Cáo”.");
    expect(TOAST.info).toHaveBeenCalledWith(expect.stringContaining("điều chỉnh hoa hồng"));
    await waitFor(() => expect(screen.queryByText("Hiện tại")).toBeNull());
  });

  it("lỗi server field 'lyDo' ⇒ hiện CẠNH ô lý do, Sheet VẪN mở, không toast thành công", async () => {
    const doi = vi.fn(async () => ({ ok: false as const, error: "Lý do đổi nguồn phải từ 10 ký tự.", field: "lyDo" }));
    await moForm({ doi });
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "đủ mười ký tự rồi" } });
    luu();
    expect(await screen.findByText("Lý do đổi nguồn phải từ 10 ký tự.")).toBeTruthy();
    expect(screen.getByText("Hiện tại")).toBeTruthy();
    expect(TOAST.success).not.toHaveBeenCalled();
    expect(ROUTER.refresh).not.toHaveBeenCalled();
  });

  it("lỗi server 'nguonVuaDoi' ⇒ dải báo ĐẦU Sheet kèm 'Tải lại'; bấm ⇒ tải lại dữ liệu (mốc mới)", async () => {
    const doi = vi.fn(async () => ({ ok: false as const, error: "Nguồn của lead vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "nguonVuaDoi" }));
    const mo = vi.fn(async () => ({ ok: true as const, du: du() }));
    render(
      <GanNguonSheet leadId="lead-1" tenLead="X" coTheMoLead mo={mo} doi={doi as never} triggerAriaLabel="mở">
        X
      </GanNguonSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    await screen.findByText("Hiện tại");
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "đủ mười ký tự rồi" } });
    luu();
    const dai = await screen.findByText(/vừa được người khác thay đổi/);
    expect(dai.closest('[role="alert"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    await waitFor(() => expect(mo).toHaveBeenCalledTimes(2));
  });

  it("Ctrl+Enter trong ô lý do LƯU (ô nhiều dòng, Enter trần là xuống dòng)", async () => {
    const { doi } = await moForm();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    const o = screen.getByLabelText(/Lý do đổi nguồn/);
    fireEvent.change(o, { target: { value: "đủ mười ký tự rồi" } });
    fireEvent.keyDown(o, { key: "Enter" });
    expect(doi).not.toHaveBeenCalled();
    fireEvent.keyDown(o, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
  });

  it("⌘+Enter (Mac) cũng LƯU như Ctrl+Enter; Shift+Enter hay Alt+Enter thì không", async () => {
    // Cấy `(e.ctrlKey || e.metaKey)` → `e.ctrlKey`: người dùng Mac bấm ⌘+Enter như dòng gợi ý nhưng không có gì xảy ra.
    const { doi } = await moForm();
    fireEvent.click(screen.getByLabelText(/Nguồn từ Quảng Cáo/));
    const o = screen.getByLabelText(/Lý do đổi nguồn/);
    fireEvent.change(o, { target: { value: "đủ mười ký tự rồi" } });
    fireEvent.keyDown(o, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(o, { key: "Enter", altKey: true });
    expect(doi).not.toHaveBeenCalled();
    fireEvent.keyDown(o, { key: "Enter", metaKey: true });
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
  });

  it("nguồn 'Khác' ⇒ giải trình ĐƯỢC GỬI (đã trim); nguồn không cần giải trình ⇒ gửi null dù ô cũ còn chữ", async () => {
    const { doi } = await moForm();
    fireEvent.click(screen.getByLabelText(/Nguồn khác/));
    fireEvent.change(screen.getByLabelText(/Giải trình nguồn/), { target: { value: " khách đến từ hội thảo STEM " } });
    fireEvent.change(screen.getByLabelText(/Lý do đổi nguồn/), { target: { value: "đủ mười ký tự rồi" } });
    luu();
    await waitFor(() => expect(doi).toHaveBeenCalledTimes(1));
    expect((doi.mock.calls[0] as unknown as [{ giaiTrinh: string | null; groupId: string }])[0]).toMatchObject({ groupId: "g11", giaiTrinh: "khách đến từ hội thảo STEM" });
  });
});

// ═══ KhoiNguonLead ══════════════════════════════════════════════════════════════════════════════════════
describe("[NHH-UI-KN-01] KhoiNguonLead — sáu mục + nút 'Đổi nguồn' vẽ THEO QUYỀN", () => {
  it("sáu mục có mặt và đúng giá trị; còn hạn / quá hạn nói đúng", () => {
    render(<KhoiNguonLead coTheMoLead du={du({ duongVao: "qua-tang" })} />);
    for (const nhan of ["Nguồn", "Người giới thiệu", "Cách xác định", "Ngày ghi công", "Còn hạn tới", "Đường vào (cũ)"]) {
      expect(screen.getByText(nhan, { selector: "dt" }), nhan).toBeTruthy();
    }
    expect(screen.getByText("29/09/2026")).toBeTruthy();
    expect(screen.getByText("28/12/2026")).toBeTruthy();
    expect(screen.getByText("Người nhập chọn tay")).toBeTruthy();
    expect(screen.getByText("qua-tang")).toBeTruthy();
    expect(screen.queryByText(/Đã hết hạn ghi công/)).toBeNull();
    cleanup();
    const base = du();
    render(<KhoiNguonLead coTheMoLead du={du({ nguon: { ...base.nguon!, conHanGhiCong: false } })} />);
    expect(screen.getByText(/Đã hết hạn ghi công — vẫn giữ nguồn/)).toBeTruthy();
  });

  it("có quyền ⇒ CÓ nút 'Đổi nguồn'; không đủ quyền ⇒ KHÔNG nút (không có nút xám) và nêu tên khoá còn thiếu", () => {
    render(<KhoiNguonLead coTheMoLead du={du()} />);
    expect(screen.getByRole("button", { name: "Đổi nguồn của lead này" })).toBeTruthy();
    cleanup();
    render(
      <KhoiNguonLead
        coTheMoLead
        du={du({ quyen: { ok: false, loi: "x", thieu: ["sources:override-after-payment"], maChan: "DOI_SAU_TT" } })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("sources:override-after-payment")).toBeTruthy();
  });

  it("lead chưa có quy nguồn ⇒ không nút, nói thật", () => {
    render(<KhoiNguonLead coTheMoLead du={du({ nguon: null })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/chưa có quy nguồn/)).toBeTruthy();
  });

  it("người giới thiệu: có ⇒ tên + loại + mã; thiếu mà nhóm cần ⇒ câu cảnh báo; không cần ⇒ 'Không có'", () => {
    const base = du().nguon!;
    render(<KhoiNguonLead coTheMoLead du={du({ nguon: { ...base, thieuNguoi: false, nguoi: { loai: "NHAN_SU", ten: "Lê Thị Liên", ma: "SR.NV.02", moTa: null } } })} />);
    expect(screen.getByText("Lê Thị Liên")).toBeTruthy();
    expect(screen.getByText(/Nhân sự · SR\.NV\.02/)).toBeTruthy();
    cleanup();
    render(<KhoiNguonLead coTheMoLead du={du()} />);
    expect(screen.getByText(/Chưa có — nguồn này cần chọn người giới thiệu/)).toBeTruthy();
    cleanup();
    render(<KhoiNguonLead coTheMoLead du={du({ nguon: { ...base, thieuNguoi: false, nguoi: null } })} />);
    expect(screen.getByText("Không có")).toBeTruthy();
  });

  it("KHÔNG BAO GIỜ in tiền hoa hồng của ai (PRD §56): không có chữ 'hoa hồng' kèm số tiền trong khối", () => {
    render(<KhoiNguonLead coTheMoLead du={du({ thucThu: { soKhoan: 2, tong: 5_000_000 } })} />);
    expect(document.body.textContent).not.toMatch(/\d[\d.]*\s*đ/);
  });
});
