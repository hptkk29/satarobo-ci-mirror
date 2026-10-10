// @vitest-environment jsdom
/**
 * [HN2-MP-R*] — mục "Máy POS quẹt thẻ" DỰNG THẬT trong `CenterForm` (docs/pos-hai-nut-khai-may.md §2, Việc 2).
 *
 * Lớp test này tồn tại vì MỘT câu của đặc tả: *"màn Cơ sở nằm trong form lớn — đo xem dialog sửa máy có bị lồng form không"*.
 * Mục máy POS nằm BÊN TRONG `<form action>` của `CenterForm`, và `components/ui/button.tsx` KHÔNG đặt `type` mặc định — nên một
 * `<Button>` để trần trong mục là nút submit của form cơ sở (Enter ở "Tên cơ sở" hoặc một cú bấm lạc ⇒ `updateCenter` + rời trang).
 * Hàm thuần xanh vĩnh viễn kể cả khi có nút như vậy; chỉ dựng thật rồi bấm thật mới biết.
 *
 * Hộp thoại (base-ui `DialogPortal`) ra `document.body` nên `<form>` của nó KHÔNG lồng trong DOM — nhưng sự kiện React vẫn nổi qua
 * portal. Các ca dưới đo CẢ HAI: DOM không lồng, và gửi hộp thoại KHÔNG chạm `updateCenter`.
 *
 * Câu chữ chủ dự án chốt được viết lại NGUYÊN VĂN ở đây thay vì import hằng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MucMayPosView } from "@/lib/payments/pos/may-o-co-so";

const h = vi.hoisted(() => ({
  createCenter: vi.fn(),
  updateCenter: vi.fn(),
  taoMayPosAction: vi.fn(),
  suaMayPosAction: vi.fn(),
  batTatMayPosAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("../_actions", () => ({ createCenter: h.createCenter, updateCenter: h.updateCenter }));
vi.mock("../_may-pos-actions", () => ({
  taoMayPosAction: h.taoMayPosAction,
  suaMayPosAction: h.suaMayPosAction,
  batTatMayPosAction: h.batTatMayPosAction,
}));
vi.mock("@/components/admin/ImageUploader", () => ({ ImageUploader: () => null }));

import { CenterForm } from "./center-form";
import { MucMayPos } from "./muc-may-pos";

// ⚠️ jsdom KHÔNG có `ResizeObserver`, mà Radix `Switch` nằm TRONG một <form> (đúng chỗ của mục này) dựng thêm một <input> ẩn và
// đo kích thước nó bằng `ResizeObserver` không kiểm tra — nên dựng thật trong jsdom là `ReferenceError`. Trình duyệt thật có sẵn;
// đây chỉ là chỗ thiếu của môi trường test (cùng nếp `phan-trang-bang.tsx`, nơi mã sản phẩm tự gác `typeof ResizeObserver`).
class ResizeObserverGia {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverGia);

const CAU_NHAC = "Khai máy xong, import lại file để khớp các giao dịch đang 'Thiết bị chưa gán cơ sở'.";

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

const MAY_1 = {
  id: "m1",
  maThietBi: "SP_GINI_X990_V9E1013321",
  maQuay: "QTT45XWQT",
  ten: "Máy quầy lễ tân",
  maCuaHang: "CH9TSGU9",
  maNhaCungCap: "NCCPH6KE",
  maTcbQuay: null,
  active: true,
  taoLuc: "2026-10-05T03:00:00.000Z",
  agent: null,
} as const;
const MAY_2 = { ...MAY_1, id: "m2", maThietBi: "T002", maQuay: null, ten: null, maCuaHang: null, maNhaCungCap: null, active: false };

function view(p: Partial<MucMayPosView> = {}): MucMayPosView {
  return {
    coSo: { id: "cs1", ten: CENTER.name, dangHoatDong: true },
    quyen: { xem: true, sua: true, them: true, lyDoKhongThem: null },
    moDuocBienDong: true,
    may: [MAY_1, MAY_2],
    ...p,
  };
}

function dung(v: MucMayPosView) {
  return render(
    <CenterForm
      center={CENTER}
      suaDuocHoSo
      payment={{ methods: [], sharedCount: 2, canManage: false }}
      mayPos={<MucMayPos view={v} />}
    />,
  );
}

const mucMayPos = () => document.getElementById("may-pos") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  h.taoMayPosAction.mockResolvedValue({ ok: true, id: "moi" });
  h.suaMayPosAction.mockResolvedValue({ ok: true, id: "m1" });
  h.batTatMayPosAction.mockResolvedValue({ ok: true, id: "m1" });
  h.updateCenter.mockResolvedValue({});
  h.createCenter.mockResolvedValue({});
});
afterEach(() => cleanup());

describe("[HN2-MP-R01] mục nằm ĐÚNG chỗ: bên trong form cơ sở, ngay sau 'Thanh toán', trước 'Hình ảnh'", () => {
  it("có phần tử #may-pos là <section> nằm trong <form>, tiêu đề 'Máy POS quẹt thẻ'", () => {
    dung(view());
    const sec = mucMayPos();
    expect(sec).not.toBeNull();
    expect(sec.tagName).toBe("SECTION");
    expect(sec.closest("form")).not.toBeNull();
    expect(within(sec).getByRole("heading", { name: /Máy POS quẹt thẻ/ })).toBeInTheDocument();
  });

  it("thứ tự tiêu đề: Thanh toán → Máy POS quẹt thẻ → Hình ảnh", () => {
    dung(view());
    const ten = screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent ?? "");
    const iTT = ten.findIndex((t) => /^Thanh toán/.test(t));
    const iMay = ten.findIndex((t) => /^Máy POS quẹt thẻ/.test(t));
    const iAnh = ten.findIndex((t) => /^Hình ảnh/.test(t));
    expect(iTT, "có mục Thanh toán").toBeGreaterThan(-1);
    expect(iMay).toBe(iTT + 1);
    expect(iAnh).toBe(iMay + 1);
  });

  it("khi tạo cơ sở MỚI (không có `center`) mục KHÔNG hiện — máy cần một cơ sở đã tồn tại", () => {
    render(<CenterForm suaDuocHoSo mayPos={<MucMayPos view={view()} />} />);
    expect(mucMayPos()).toBeNull();
  });
});

describe("[HN2-MP-R02] KHÔNG có nút nào trong mục là nút submit của form cơ sở", () => {
  it("tĩnh: không <button> nào trong mục có type=submit — kể cả khi có hộp thoại mở; đối chứng: nút 'Cập nhật' của form cơ sở LÀ submit", () => {
    dung(view());
    const sec = mucMayPos();
    const botBat = Array.from(sec.querySelectorAll("button")).filter((b) => b.type === "submit");
    expect(botBat.map((b) => b.textContent)).toEqual([]);
    // Đối chứng dương: phép đo `b.type` thấy được nút submit khi nó có (nếu không, ca trên xanh vì phép đo mù).
    const capNhat = screen.getByRole("button", { name: "Cập nhật" }) as HTMLButtonElement;
    expect(capNhat.type).toBe("submit");
    expect(sec.contains(capNhat)).toBe(false);
  });

  it("động: bấm lần lượt MỌI nút của mục (trừ công tắc) không gửi form cơ sở — `updateCenter` không được gọi", async () => {
    dung(view());
    const nut = Array.from(mucMayPos().querySelectorAll("button")).filter((b) => b.getAttribute("role") !== "switch");
    expect(nut.length, "mục có nút để bấm (Thêm · Sửa × 2 · …)").toBeGreaterThanOrEqual(3);
    for (const n of nut) {
      fireEvent.click(n);
      await Promise.resolve();
    }
    expect(h.updateCenter).not.toHaveBeenCalled();
    expect(h.createCenter).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
  });
});

describe("[HN2-MP-R03] hộp thoại Thêm: không lồng form, gửi đúng cơ sở của trang, không chạm form cơ sở", () => {
  async function moHopThoaiThem() {
    dung(view());
    fireEvent.click(within(mucMayPos()).getByRole("button", { name: /Thêm máy POS/ }));
    return screen.findByRole("dialog");
  }

  it("hộp thoại ra ngoài <form> cơ sở (DOM không lồng), và không có <form> nào lồng <form>", async () => {
    const hop = await moHopThoaiThem();
    const formHop = hop.querySelector("form");
    expect(formHop).not.toBeNull();
    const formCoSo = mucMayPos().closest("form")!;
    expect(formCoSo.contains(formHop)).toBe(false);
    expect(document.querySelectorAll("form form")).toHaveLength(0);
  });

  it("gửi ⇒ `taoMayPosAction` được gọi ĐÚNG MỘT lần với centerId của trang; `updateCenter` KHÔNG; không rời trang", async () => {
    const hop = await moHopThoaiThem();
    fireEvent.change(within(hop).getByLabelText(/^Mã thiết bị/), { target: { value: "T777" } });
    fireEvent.change(within(hop).getByLabelText(/^Mã quầy/), { target: { value: "Q9" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Khai máy" }));
    await waitFor(() => expect(h.taoMayPosAction).toHaveBeenCalledTimes(1));
    expect(h.taoMayPosAction.mock.calls[0]![0]).toMatchObject({ maThietBi: "T777", maQuay: "Q9", centerId: "cs1" });
    expect(h.updateCenter).not.toHaveBeenCalled();
    expect(h.createCenter).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(expect.stringContaining("Đã khai máy T777")));
    expect(h.success).toHaveBeenCalledWith(expect.stringContaining(CAU_NHAC));
  });

  it("KHÔNG có ô chọn cơ sở — cơ sở là chữ chỉ-đọc, đúng tên cơ sở của trang", async () => {
    const hop = await moHopThoaiThem();
    expect(within(hop).queryByRole("combobox")).toBeNull();
    expect(within(hop).queryByLabelText(/Cơ sở đặt máy/)).toBeNull();
    expect(hop.textContent).toContain("Cơ sở đặt máy");
    expect(within(hop).getByText(CENTER.name)).toBeInTheDocument();
  });

  it("server từ chối ⇒ hộp thoại GIỮ NGUYÊN và in lỗi (không mất thứ vừa gõ)", async () => {
    h.taoMayPosAction.mockResolvedValueOnce({ ok: false, error: 'Mã thiết bị "T777" đã được khai.' });
    const hop = await moHopThoaiThem();
    fireEvent.change(within(hop).getByLabelText(/^Mã thiết bị/), { target: { value: "T777" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Khai máy" }));
    expect(await within(hop).findByRole("alert")).toHaveTextContent('"T777" đã được khai');
    expect((within(hop).getByLabelText(/^Mã thiết bị/) as HTMLInputElement).value).toBe("T777");
  });
});

describe("[HN2-MP-R12] gửi hộp thoại KHÔNG nổi bọt lên tổ tiên trong cây React (sự kiện React đi xuyên portal)", () => {
  // Hộp thoại ra `document.body` nên `<form>` của nó không lồng trong form cơ sở ở DOM — NHƯNG React gửi sự kiện theo cây React,
  // không theo cây DOM: một `onSubmit` ở tổ tiên của `CenterForm` vẫn nhận submit của hộp thoại nếu không ai `stopPropagation`.
  function dungTrongTo(tamNghe: () => void) {
    return render(
      <div onSubmit={tamNghe}>
        <CenterForm
          center={CENTER}
          suaDuocHoSo
          payment={{ methods: [], sharedCount: 2, canManage: false }}
          mayPos={<MucMayPos view={view()} />}
        />
      </div>,
    );
  }

  it("submit của hộp thoại Thêm máy không tới `onSubmit` của tổ tiên", async () => {
    const tamNghe = vi.fn();
    dungTrongTo(tamNghe);
    fireEvent.click(within(mucMayPos()).getByRole("button", { name: /Thêm máy POS/ }));
    const hop = await screen.findByRole("dialog");
    fireEvent.change(within(hop).getByLabelText(/^Mã thiết bị/), { target: { value: "T888" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Khai máy" }));
    await waitFor(() => expect(h.taoMayPosAction).toHaveBeenCalledTimes(1));
    expect(tamNghe).not.toHaveBeenCalled();
  });

  it("đối chứng dương: phép đo THẤY được — submit THẬT của form cơ sở ('Cập nhật') đi tới tổ tiên", async () => {
    // Không có vế này thì ca trên xanh cả khi `onSubmit` của tổ tiên không bao giờ nhận được gì (phép đo mù).
    const tamNghe = vi.fn();
    dungTrongTo(tamNghe);
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật" }));
    await waitFor(() => expect(tamNghe).toHaveBeenCalledTimes(1));
  });
});

describe("[HN2-MP-R04] hộp thoại Sửa: mã thiết bị khoá, cơ sở cố định, không gửi mã thiết bị", () => {
  it("bấm Sửa ⇒ ô mã thiết bị bị khoá; lưu ⇒ `suaMayPosAction` mang id + các ô sửa, KHÔNG mang maThietBi và KHÔNG mang centerId ([HN2-RD-01])", async () => {
    dung(view());
    fireEvent.click(within(mucMayPos()).getByRole("button", { name: `Sửa máy ${MAY_1.maThietBi}` }));
    const hop = await screen.findByRole("dialog");
    expect(within(hop).getByLabelText(/^Mã thiết bị/)).toBeDisabled();
    expect(within(hop).queryByRole("combobox")).toBeNull();
    fireEvent.change(within(hop).getByLabelText(/^Tên máy/), { target: { value: "Quầy 2" } });
    fireEvent.click(within(hop).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(h.suaMayPosAction).toHaveBeenCalledTimes(1));
    const goi = h.suaMayPosAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(goi).toMatchObject({ id: "m1", ten: "Quầy 2" });
    expect(goi).not.toHaveProperty("maThietBi");
    // [HN2-RD-01] Sửa KHÔNG được gửi `centerId` của TRANG: trang CS1 cũ đổi tên một máy vừa được chuyển sang CS2 mà gửi nó thì
    // kéo máy về CS1. Đối chứng dương: ca tạo ([HN2-MP-R02]) khẳng định lời gọi TẠO VẪN mang `centerId` của trang.
    expect(goi).not.toHaveProperty("centerId");
    expect(h.updateCenter).not.toHaveBeenCalled();
  });

  it("hộp thoại Sửa nói thật về việc đổi cơ sở (V30): báo bên kỹ thuật, không hứa một nút không có", async () => {
    dung(view());
    fireEvent.click(within(mucMayPos()).getByRole("button", { name: `Sửa máy ${MAY_1.maThietBi}` }));
    const hop = await screen.findByRole("dialog");
    expect(hop.textContent).toMatch(/bên kỹ thuật/);
  });
});

describe("[HN2-MP-R05] chỉ-xem: thấy máy nhưng KHÔNG có nút thêm / sửa / công tắc (luật 12)", () => {
  const CHI_XEM = view({ quyen: { xem: true, sua: false, them: false, lyDoKhongThem: null } });

  it("liệt kê máy, không có nút nào ghi, có câu nói rõ ai khai", () => {
    dung(CHI_XEM);
    const sec = mucMayPos();
    expect(within(sec).getByText(MAY_1.maThietBi)).toBeInTheDocument();
    expect(within(sec).getByText(MAY_2.maThietBi)).toBeInTheDocument();
    expect(within(sec).queryByRole("button", { name: /Thêm máy POS/ })).toBeNull();
    expect(within(sec).queryAllByRole("button", { name: /^Sửa máy/ })).toHaveLength(0);
    expect(within(sec).queryAllByRole("switch")).toHaveLength(0);
    expect(sec.textContent).toMatch(/Bạn chỉ xem/);
    expect(sec.textContent).toMatch(/Kế toán Hội sở/);
    expect(sec.textContent).not.toContain(CAU_NHAC);
  });

  it("đối chứng dương: cùng dữ liệu, người sửa được THẤY đủ Thêm · Sửa × 2 · công tắc × 2", () => {
    dung(view());
    const sec = mucMayPos();
    expect(within(sec).getByRole("button", { name: /Thêm máy POS/ })).toBeInTheDocument();
    expect(within(sec).getAllByRole("button", { name: /^Sửa máy/ })).toHaveLength(2);
    expect(within(sec).getAllByRole("switch")).toHaveLength(2);
    expect(sec.textContent).not.toMatch(/Bạn chỉ xem/);
    expect(sec.textContent).toContain(CAU_NHAC);
  });
});

describe("[HN2-MP-R06] công tắc: tắt phải xác nhận, bật thì không", () => {
  it("tắt máy đang dùng ⇒ hộp xác nhận ⇒ xác nhận mới gọi `batTatMayPosAction({active:false})`", async () => {
    dung(view());
    const congTac = within(mucMayPos()).getByRole("switch", { name: `Tắt máy ${MAY_1.maThietBi}` });
    fireEvent.click(congTac);
    const hop = await screen.findByRole("dialog");
    expect(h.batTatMayPosAction).not.toHaveBeenCalled();
    expect(hop.textContent).toContain(`Tắt máy ${MAY_1.maThietBi}?`);
    fireEvent.click(within(hop).getByRole("button", { name: "Tắt máy" }));
    await waitFor(() => expect(h.batTatMayPosAction).toHaveBeenCalledWith({ id: "m1", active: false }));
    expect(h.updateCenter).not.toHaveBeenCalled();
  });

  it("bật lại máy đã tắt ⇒ gọi thẳng, không hỏi, kèm câu nhắc import lại", async () => {
    dung(view());
    fireEvent.click(within(mucMayPos()).getByRole("switch", { name: `Bật máy ${MAY_2.maThietBi}` }));
    await waitFor(() => expect(h.batTatMayPosAction).toHaveBeenCalledWith({ id: "m2", active: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(expect.stringContaining(CAU_NHAC)));
  });
});

describe("[HN2-MP-R07] cơ sở đã đóng: không có 'Thêm máy', nói lý do; Sửa / công tắc vẫn có", () => {
  it("ẩn nút Thêm, in lý do, giữ Sửa", () => {
    dung(
      view({
        coSo: { id: "cs1", ten: CENTER.name, dangHoatDong: false },
        quyen: { xem: true, sua: true, them: false, lyDoKhongThem: "Cơ sở đã đóng — không khai thêm máy được. Máy đã khai vẫn sửa, tắt, bật được." },
      }),
    );
    const sec = mucMayPos();
    expect(within(sec).queryByRole("button", { name: /Thêm máy POS/ })).toBeNull();
    expect(sec.textContent).toContain("Cơ sở đã đóng — không khai thêm máy được");
    expect(within(sec).getAllByRole("button", { name: /^Sửa máy/ })).toHaveLength(2);
  });
});

describe("[HN2-MP-R08] trạng thái rỗng nói VÌ SAO và LÀM GÌ", () => {
  it("người sửa được: giải thích hậu quả + có nút Thêm máy POS", () => {
    dung(view({ may: [] }));
    const sec = mucMayPos();
    expect(sec.textContent).toContain("Chưa khai máy POS nào ở cơ sở này");
    expect(sec.textContent).toMatch(/Thiết bị chưa gán cơ sở/);
    expect(within(sec).getByRole("button", { name: /Thêm máy POS/ })).toBeInTheDocument();
  });

  it("người chỉ xem: nói cơ sở chưa có máy, KHÔNG có nút", () => {
    dung(view({ may: [], quyen: { xem: true, sua: false, them: false, lyDoKhongThem: null } }));
    const sec = mucMayPos();
    expect(sec.textContent).toContain("Cơ sở này chưa có máy POS nào");
    expect(within(sec).queryByRole("button", { name: /Thêm máy POS/ })).toBeNull();
  });
});

describe("[HN2-MP-R09] dòng trạng thái POS Agent cạnh máy", () => {
  it("KHOP: in nhãn + phiên + link tới đúng thẻ của agent trên màn Sức khoẻ POS Agent", () => {
    dung(
      view({
        may: [
          {
            ...MAY_1,
            agent: {
              kieu: "KHOP",
              agentId: "ag1",
              nhan: "Đang làm việc",
              tone: "success",
              phien: "Sống · hết hạn 21:30",
              phienTone: null,
            },
          },
        ],
      }),
    );
    const sec = mucMayPos();
    expect(sec.textContent).toContain("POS Agent");
    expect(sec.textContent).toContain("Đang làm việc");
    expect(sec.textContent).toContain("Sống · hết hạn 21:30");
    const lienKet = within(sec).getByRole("link", { name: /sức khoẻ POS Agent/i });
    expect(lienKet).toHaveAttribute("href", "/bien-dong-so-du/pos-agent#the-ag1");
  });

  it("CHUA_KHOP: in câu nêu thiếu gì, không có link", () => {
    dung(
      view({
        may: [{ ...MAY_1, agent: { kieu: "CHUA_KHOP", cau: "POS Agent chưa khớp máy này — thiếu mã quầy." } }],
      }),
    );
    const sec = mucMayPos();
    expect(sec.textContent).toContain("POS Agent chưa khớp máy này — thiếu mã quầy.");
    expect(within(sec).queryByRole("link", { name: /sức khoẻ POS Agent/i })).toBeNull();
  });

  it("agent = null ⇒ KHÔNG in chữ 'POS Agent' nào (người không có import-pos, hoặc cơ sở chưa dùng agent)", () => {
    dung(view());
    expect(mucMayPos().textContent).not.toContain("POS Agent");
  });
});

describe("[HN2-MP-R10] câu nhắc import + link Biến động số dư", () => {
  it("người sửa được + mở được màn Biến động số dư ⇒ có link; không mở được ⇒ vẫn có câu nhắc nhưng KHÔNG link", () => {
    const { unmount } = dung(view());
    expect(within(mucMayPos()).getByRole("link", { name: /Mở Biến động số dư/ })).toHaveAttribute(
      "href",
      "/bien-dong-so-du?nguon=the",
    );
    unmount();
    dung(view({ moDuocBienDong: false }));
    expect(mucMayPos().textContent).toContain(CAU_NHAC);
    expect(within(mucMayPos()).queryByRole("link", { name: /Mở Biến động số dư/ })).toBeNull();
  });
});

describe("[HN2-MP-R11] mã thiết bị dài không làm vỡ hàng (tiếng Việt / mã dài là mặc định)", () => {
  it("mã dài được phép ngắt dòng (`break-all`) và tên máy có `title` đầy đủ", () => {
    const tenDai = "Máy quầy lễ tân tầng một — cạnh cửa ra vào chính, gần phòng giáo vụ";
    dung(view({ may: [{ ...MAY_1, ten: tenDai }] }));
    const ma = within(mucMayPos()).getByText(MAY_1.maThietBi);
    expect(ma.className).toMatch(/break-all|\[overflow-wrap:anywhere\]/);
    expect(within(mucMayPos()).getByText(tenDai)).toHaveAttribute("title", tenDai);
  });
});
