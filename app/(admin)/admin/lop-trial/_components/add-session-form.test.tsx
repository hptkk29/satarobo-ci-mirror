// @vitest-environment jsdom
/**
 * Khối "Thêm buổi học" — ô Giáo viên sau chốt 17/09/2026.
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────
 * Đúng MỘT lớp lỗi, và nó là lớp lỗi KHÔNG cổng nào khác trong repo bắt được: một
 * `<select>` bị lọc còn ít (hoặc còn 0) dòng mà **không nói vì sao**. Nó không ném lỗi,
 * không làm đỏ test nào, console vẫn sạch — chỉ người dùng bấm vào mới biết, và thứ họ
 * kết luận là "hệ thống hỏng" rồi đi nhập tay chỗ khác (luật 12: affordance nói dối).
 *
 * Kèm theo: hai cái nhãn ` · TRÙNG LỊCH` / ` · CA LINH ĐỘNG` và khối cảnh báo đỏ cũng là
 * LỜI HỨA — hứa suông được y như trên.
 *
 * ── CẤY LẠI LỖI (luật 15) — đã làm THẬT, đây là kết quả ĐO chứ không phải dự đoán ────
 *   · bỏ khối `{lyDoRong !== null && …}` trong `chon-gv-buoi.tsx` → **3 ĐỎ / 9**
 *     (ca "không GV nào có ca" · ca "server trả lỗi" · ca "xoá ngày").
 *   · đổi `hauToGv` trả `""` cho `muc === "DO"` → **1 ĐỎ / 9** (ca nhãn TRÙNG LỊCH).
 *   · bỏ `aria-invalid={doTrung}` trên `<select>` → **1 ĐỎ / 9** (cùng ca đó).
 *   · (VÁ 17/09 — câu luật nói dối lúc chưa chọn ngày) bỏ vế `!daLoc` khỏi `GiaiThichLuatGv`
 *     → **2 ĐỎ / 26**; bỏ vế `ds === null` khỏi chữ cạnh ô tích → **2 ĐỎ / 26**.
 *   · bỏ vế `if (!date || !startTime || !endTime)` trong `useGvChoBuoi.tai` →
 *     **1 ĐỎ / 9**, và nó đỏ ở ca "xoá ngày" chứ KHÔNG phải ca "chưa chọn ngày".
 *     Ghi ra vì chỗ này dễ đoán sai: lúc dựng component `tai` chưa hề được gọi (ngày
 *     rỗng là trạng thái ban đầu, không phải một lượt đổi), nên ca đầu tiên xanh vì
 *     một lý do khác với lý do người viết tưởng. Đường duy nhất chạm được vế đó là
 *     XOÁ ngày sau khi đã chọn.
 *
 * Ngày trong bộ này là hằng TUYỆT ĐỐI, không hàm nào đọc đồng hồ thật (luật 19).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DongGv } from "@/lib/trial/gv-kha-dung";
import type { CheDoChonGv } from "../_lib/che-do-gv";

/** Mốc cố định — đổi tờ lịch không được làm bộ này đỏ. */
const NGAY = "2026-09-19";

type KetQua =
  | { ok: true; ds: DongGv[]; lyDoRong: string | null }
  | { ok: false; error: string };

const h = vi.hoisted(() => ({
  // Khai kiểu tham số tại đây thay vì `vi.fn()` trần: không có nó thì `mock.calls[0]`
  // mang kiểu tuple rỗng và mọi khẳng định về đối số phải ép kiểu — tức tự bịt mắt đúng
  // chỗ cần nhìn nhất (đối số `excludeSessionId` là thứ dễ quên nhất).
  layGv: vi.fn(
    async (_input: {
      trialClassId: string;
      date: string;
      startTime: string;
      endTime: string;
      excludeSessionId?: string | null;
      hienTatCa: boolean;
    }): Promise<unknown> => ({ ok: true, ds: [], lyDoRong: null }),
  ),
  themBuoi: vi.fn(async (_input: unknown) => ({ ok: true as const })),
  loi: vi.fn((_x: string) => undefined),
  thanhCong: vi.fn((_x: string) => undefined),
  refresh: vi.fn(),
}));

vi.mock("../_actions", () => ({
  layGvChoBuoiAction: h.layGv,
  addLopTrialSessionAction: h.themBuoi,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: h.thanhCong, error: h.loi },
}));

import { AddSessionForm } from "./add-session-form";
import { hauToNguoiNgoaiDs } from "./chon-gv-buoi";

const GIAO_VIEN = [
  { id: "gv-kiet", name: "Nguyễn Tuấn Kiệt" },
  { id: "gv-toai", name: "Trần Văn Toại" },
  { id: "gv-lan", name: "Lê Thị Lan" },
];

/** Một dòng đã lọc, mặc định "bình thường". */
function dong(p: Partial<DongGv> & { id: string; name: string }): DongGv {
  return { phu: "PHU_TRON", muc: "KHONG", nhan: "", ...p };
}

function dung(over: { cheDoChonGv?: CheDoChonGv; locGvTheoCa?: boolean } = {}) {
  return render(
    <AddSessionForm
      trialClassId="lop-1"
      teachers={GIAO_VIEN}
      rooms={[]}
      defaultStartTime="18:00"
      defaultEndTime="19:30"
      cheDoChonGv={over.cheDoChonGv ?? "LOC_THEO_CA"}
      locGvTheoCa={over.locGvTheoCa ?? true}
      soGvMienLoc={2}
      // Các ca trong tệp này là form của lớp CŨ (có ô ngày) — đúng hành vi họ ghim.
      ngayCoDinh={null}
      khung={null}
    />,
  );
}

function oGiaoVien(): HTMLSelectElement {
  return screen.getByLabelText("Giáo viên") as HTMLSelectElement;
}

/** Công tắc "Hiện tất cả giáo viên" — `null` khi nó KHÔNG được vẽ. */
function congTac(): HTMLInputElement | null {
  return screen.queryByLabelText(/Hiện tất cả giáo viên/) as HTMLInputElement | null;
}

/** Nhãn của mọi `<option>` trong ô Giáo viên, bỏ dòng "— chưa xếp —". */
function cacLuaChon(): string[] {
  return [...oGiaoVien().options]
    .map((o) => o.textContent ?? "")
    .filter((t) => !t.startsWith("—"));
}

/**
 * Chọn ngày ⇒ đủ cả ba ô (giờ đã điền sẵn) ⇒ form hỏi server.
 *
 * Phải CHỜ lượt gọi đi qua `useTransition` rồi mới khẳng định, nếu không mọi ca đều đọc
 * trạng thái TRƯỚC khi server trả lời và sẽ xanh vì lý do sai.
 */
async function chonNgay(ngay = NGAY) {
  fireEvent.change(screen.getByLabelText("Ngày *"), { target: { value: ngay } });
  await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.layGv.mockResolvedValue({ ok: true, ds: [], lyDoRong: null } satisfies KetQua);
});

describe("AddSessionForm — ô Giáo viên lọc theo ca", () => {
  it("chưa chọn ngày thì KHÔNG hỏi server, và hiện ĐỦ danh sách giáo viên", () => {
    dung();
    expect(h.layGv).not.toHaveBeenCalled();
    expect(cacLuaChon()).toEqual([
      "Nguyễn Tuấn Kiệt",
      "Trần Văn Toại",
      "Lê Thị Lan",
    ]);
  });

  it("KHÔNG giáo viên nào có ca ⇒ ô chọn KHÔNG im lặng, lý do hiện thành CHỮ", async () => {
    // Đây là ca của đề bài. Hình dạng dữ liệu lấy đúng hợp đồng `locGiaoVienChoBuoi`:
    // lọc còn 0 người thì nó trả ĐỦ danh sách kèm `lyDoRong`, chứ không trả mảng rỗng.
    h.layGv.mockResolvedValue({
      ok: true,
      ds: GIAO_VIEN.map((g) =>
        dong({ ...g, phu: "KHONG_CO_CA", nhan: "chưa xếp ca ngày này" }),
      ),
      lyDoRong: `Không giáo viên nào có ca phủ trọn 18:00–19:30 ngày ${NGAY} — đang hiện tất cả để bạn tự chọn.`,
    } satisfies KetQua);

    dung();
    await chonNgay();

    const ly = await screen.findByText(/Không giáo viên nào có ca phủ trọn/);
    expect(ly.getAttribute("aria-live")).toBe("polite");
    expect(h.layGv).toHaveBeenCalledWith({
      trialClassId: "lop-1",
      date: NGAY,
      startTime: "18:00",
      endTime: "19:30",
      // Thêm buổi MỚI ⇒ không có buổi nào để loại khỏi phép so trùng.
      excludeSessionId: null,
      // Công tắc "Hiện tất cả" mặc định TẮT — lượt hỏi đầu tiên phải ĐANG LỌC.
      hienTatCa: false,
    });
  });

  it("danh sách lọc còn RỖNG THẬT vẫn phải có chữ — không có `<select>` trống câm", async () => {
    // Hợp đồng hứa không bao giờ trả rỗng-câm; đây là chỗ câu hứa đó được KIỂM chứ không
    // phải chỗ nó được tin. Một bản vá sai ở tầng dưới không được biến màn hình thành câm.
    h.layGv.mockResolvedValue({ ok: true, ds: [], lyDoRong: null } satisfies KetQua);
    dung();
    await chonNgay();

    expect(
      await screen.findByText("Không có giáo viên nào để chọn cho khung giờ này."),
    ).toBeTruthy();
    expect(cacLuaChon()).toEqual([]);
  });

  it("server trả lỗi ⇒ nói ra lỗi, KHÔNG lặng lẽ quay về danh sách đầy đủ", async () => {
    h.layGv.mockResolvedValue({
      ok: false,
      error: "Không có quyền xếp giáo viên cho buổi trải nghiệm",
    } satisfies KetQua);
    dung();
    await chonNgay();

    expect(
      await screen.findByText("Không có quyền xếp giáo viên cho buổi trải nghiệm"),
    ).toBeTruthy();
  });

  it("trùng lịch ⇒ nhãn · TRÙNG LỊCH, khối role=alert, và aria-invalid trên ô chọn", async () => {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [
        dong({
          id: "gv-kiet",
          name: "Nguyễn Tuấn Kiệt",
          muc: "DO",
          nhan: "TRÙNG LỊCH: buổi lớp chính 18:00–19:30",
        }),
        dong({ id: "gv-lan", name: "Lê Thị Lan" }),
      ],
      lyDoRong: null,
    } satisfies KetQua);

    dung();
    await chonNgay();
    await screen.findByText(/Nguyễn Tuấn Kiệt · TRÙNG LỊCH/);

    const o = oGiaoVien();
    // Chưa chọn ai ⇒ chưa được báo động: nhãn trong danh sách là đủ.
    expect(o.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(o, { target: { value: "gv-kiet" } });
    expect(oGiaoVien().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "TRÙNG LỊCH: buổi lớp chính 18:00–19:30",
    );

    // Đổi sang người không trùng ⇒ báo động phải TẮT. Cảnh báo dính lại là một lời nói
    // dối theo chiều ngược, và nó dạy người dùng bỏ qua màu đỏ.
    fireEvent.change(oGiaoVien(), { target: { value: "gv-lan" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(oGiaoVien().getAttribute("aria-invalid")).toBe("false");
  });

  it("ca không mang giờ (LD/D1/D2) ⇒ nhãn · CA LINH ĐỘNG, KHÔNG phải trùng lịch", async () => {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [
        dong({
          id: "gv-toai",
          name: "Trần Văn Toại",
          phu: "KHONG_GIO",
          muc: "CANH",
          nhan: "ca linh động — không rõ giờ",
        }),
      ],
      lyDoRong: null,
    } satisfies KetQua);

    dung();
    await chonNgay();
    await screen.findByText("Trần Văn Toại · CA LINH ĐỘNG");

    fireEvent.change(oGiaoVien(), { target: { value: "gv-toai" } });
    // CANH không phải DO ⇒ không được dựng khối đỏ.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("người đang chọn bị lọc mất vẫn còn trong ô — `<select>` không được tự đổi người", async () => {
    // Mất dữ liệu CÂM: `<select>` có `value` không khớp option nào sẽ nhảy về dòng đầu,
    // và lượt Lưu kế tiếp ghi đè một giáo viên người dùng chưa từng chọn.
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: "gv-lan", name: "Lê Thị Lan" })],
      lyDoRong: null,
    } satisfies KetQua);

    dung();
    // Chọn người TRƯỚC khi có ngày (lúc đó danh sách còn đầy đủ).
    fireEvent.change(oGiaoVien(), { target: { value: "gv-kiet" } });
    await chonNgay();

    await screen.findByText(/Nguyễn Tuấn Kiệt · NGOÀI DANH SÁCH LỌC/);
    expect(oGiaoVien().value).toBe("gv-kiet");
  });

  it("xoá ngày ⇒ quay về 'chưa biết': đủ danh sách, hết lý do", async () => {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: "gv-lan", name: "Lê Thị Lan" })],
      lyDoRong: "Chưa sinh lưới ca tháng này nên chưa lọc được theo ca.",
    } satisfies KetQua);

    dung();
    await chonNgay();
    await screen.findByText(/Chưa sinh lưới ca tháng này/);

    fireEvent.change(screen.getByLabelText("Ngày *"), { target: { value: "" } });
    expect(screen.queryByText(/Chưa sinh lưới ca tháng này/)).toBeNull();
    expect(cacLuaChon()).toEqual([
      "Nguyễn Tuấn Kiệt",
      "Trần Văn Toại",
      "Lê Thị Lan",
    ]);
  });

  it("action NÉM (không phải trả {ok:false}) ⇒ vẫn phải hiện CHỮ, không đứng im", async () => {
    // Ca này KHÁC ca "server trả lỗi" ở trên, và khác ở đúng chỗ nguy hiểm: ở đó action
    // trả `{ ok: false, error }` — một đường đi bình thường. Ở đây promise bị TỪ CHỐI, nên
    // nhánh `!res.ok` không bao giờ chạy. Không bắt thì đây là unhandled rejection bên
    // trong `startTransition`: `dangTai` tắt, danh sách giữ nguyên bản CŨ, console của
    // người dùng sạch, và màn hình trông y hệt lúc chạy đúng (luật 12).
    //
    // Cách xảy ra thật: mạng rớt giữa chừng · lỗi 500 · Vercel đang đổi bản nên id của
    // Server Action không còn khớp. Không ca nào trong số đó là hiếm.
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: "gv-lan", name: "Lê Thị Lan" })],
      lyDoRong: null,
    } satisfies KetQua);
    dung();
    await chonNgay();
    expect(cacLuaChon()).toEqual(["Lê Thị Lan"]);

    // Lượt thứ hai NÉM.
    h.layGv.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.change(screen.getByLabelText("Giờ kết thúc"), { target: { value: "20:00" } });

    expect(
      await screen.findByText(/Không lọc được giáo viên theo ca lúc này/),
    ).toBeTruthy();
    // Và câu chữ phải nói ĐÚNG thứ đang hiện: về `ds = null` là danh sách ĐẦY ĐỦ trở lại,
    // nên "đang hiện tất cả" là sự thật kiểm được, không phải câu an ủi.
    expect(cacLuaChon()).toEqual([
      "Nguyễn Tuấn Kiệt",
      "Trần Văn Toại",
      "Lê Thị Lan",
    ]);
  });

  // ⚠️ CA NÀY ĐÃ SỬA 17/09/2026 — bản cũ ĐÓNG ĐINH MỘT LỜI HỨA SAI.
  //
  // Bản cũ chỉ gọi `dung()` (KHÔNG chọn ngày) rồi khẳng định câu luật phải chứa "ca phủ
  // TRỌN khung giờ buổi". Nhưng lúc đó `date === ""` nên hook chưa hỏi server lần nào,
  // `ds === null`, và `<select>` đang vẽ NGUYÊN danh sách đầy đủ — chính ca test ở đầu
  // tệp này khẳng định điều đó ("chưa chọn ngày thì KHÔNG hỏi server, và hiện ĐỦ danh
  // sách giáo viên"). Tức bộ test đang BẢO VỆ tình trạng: màn hình in "danh sách chỉ hiện
  // giáo viên có ca phủ TRỌN" ngay dưới một danh sách chưa hề được lọc. Sale đọc câu đó,
  // lướt các tên, và kết luận cả danh sách đều rảnh vào khung giờ họ chưa chọn (luật 12).
  //
  // Nay tách làm HAI ca, vì đó thật sự là hai trạng thái khác nhau.
  it("CHƯA chọn ngày ⇒ câu luật KHÔNG được hứa đã lọc, phải bảo người dùng chọn ngày/giờ", () => {
    dung();
    const cau = screen.getByText(/Note đỏ đối chiếu buổi/);
    expect(cau.textContent).toContain("Chọn ngày và giờ để lọc theo ca làm việc");
    expect(cau.textContent).toContain("đang xem tất cả giáo viên");
    expect(cau.textContent).not.toContain("ca phủ TRỌN khung giờ buổi");
    // Và câu đó phải nói đúng thứ `<select>` ĐANG vẽ — đối chiếu hai cửa, không đọc lại
    // cùng một biến.
    expect(cacLuaChon()).toEqual(["Nguyễn Tuấn Kiệt", "Trần Văn Toại", "Lê Thị Lan"]);
  });

  it("ĐÃ chọn ngày ⇒ nói rõ luật đang chạy, và nói rõ KHÔNG tính ca chấm công", async () => {
    // Câu này là thứ duy nhất ngăn người dùng tin nhầm rằng note đỏ đã phủ hết lịch.
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: "gv-lan", name: "Lê Thị Lan" })],
      lyDoRong: null,
    } satisfies KetQua);
    dung();
    await chonNgay();

    const cau = screen.getByText(/Note đỏ đối chiếu buổi/);
    expect(cau.textContent).toContain("ca phủ TRỌN khung giờ buổi");
    expect(cau.textContent).toContain("không");
    expect(cau.textContent).toContain("bảng chấm công");
    expect(cau.textContent).toContain("2 giáo viên được khai luôn hiện");
  });

  it("tầng TAT_CA / cờ lọc TẮT ⇒ câu luật GIỮ NGUYÊN dù chưa chọn ngày (không có gì để lọc)", () => {
    // Ranh giới của bản vá, viết ra để lần sau ai nới/thu cũng thấy ngay: hai câu này
    // đúng ở MỌI lúc vì chúng nói "không có bộ lọc nào", chứ không hứa một danh sách đã
    // lọc. Kéo chúng vào nhánh "chưa chọn ngày" là sửa nhầm hai câu đang nói thật.
    const a = dung({ cheDoChonGv: "TAT_CA" });
    expect(screen.getByText(/Note đỏ đối chiếu buổi/).textContent).toContain("quyền Đào tạo");
    a.unmount();

    dung({ locGvTheoCa: false });
    expect(screen.getByText(/Note đỏ đối chiếu buổi/).textContent).toContain(
      "Chưa bật lọc giáo viên theo ca làm",
    );
  });

  // ── ĐẢO 17/09/2026 — ca này trước đây đòi ô chọn IN ra "· CHƯA VÀO LƯỚI CA" ─────────
  //
  // Chủ dự án báo hai lần, lần sau kèm ảnh prod: nhãn ấy nói SAI. Phép đếm ô-trong-tháng
  // đi qua `scopedDb` nên nó không phân biệt nổi "chưa được xếp ca" với "cả tháng làm ở
  // cơ sở bạn không nhìn thấy" — Kiệt & Toại có 48 ô mã `HC` vẫn bị dán nhãn đó.
  //
  // Nay tầng thuần trả `nhan: ""` cho trạng thái này, và ô chọn phải IM THEO. Ca này
  // khoá đúng vế "im theo": nó là vế đã trôi lệch lần trước — `hauToGv` tự suy lại từ
  // `phu` nên bản vá ở tầng thuần không chạm tới, và prod vẫn in nguyên chữ cũ.
  it("GV chưa vào lưới ca ⇒ hiện TÊN TRẦN, không nhãn nào (nhan rỗng ⇒ ô chọn im)", async () => {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [
        dong({
          id: "gv-lan",
          name: "Lê Thị Lan",
          phu: "CHUA_VAO_LUOI",
          muc: "KHONG",
          nhan: "",
        }),
      ],
      lyDoRong: null,
    } satisfies KetQua);

    dung();
    await chonNgay();
    await screen.findByText("Lê Thị Lan");
    expect(screen.queryByText(/CHƯA VÀO LƯỚI CA/)).toBeNull();

    fireEvent.change(oGiaoVien(), { target: { value: "gv-lan" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(oGiaoVien().getAttribute("aria-invalid")).toBe("false");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// VÁ (B) — CÔNG TẮC "HIỆN TẤT CẢ GIÁO VIÊN"
//
// Lớp lỗi được canh ở đây: một công tắc TRÔNG NHƯ có tác dụng. Nó không ném khi bấm
// hụt, không đỏ test nào, console sạch — người dùng bấm, danh sách y nguyên, và họ học
// được rằng công tắc ở màn này vô nghĩa (luật 12, chiều "hứa có tác dụng").
//
// Hai hướng hỏng phải canh RIÊNG, vì chúng khác nhau:
//   · vẽ công tắc ở nơi KHÔNG có gì để tắt (tầng Đào tạo / cờ lọc đang tắt);
//   · bấm mà server không hề nhận cờ — đây là hướng dễ dính nhất, vì `setState` chưa
//     phản ánh trong cùng lượt xử lý sự kiện nên đọc state thay vì ref là gửi giá trị CŨ.
// ═══════════════════════════════════════════════════════════════════════════════════

// ⚠️ Từ đây xuống, mọi lượt dựng dùng tầng `THEO_CO_SO` (Quản lý cơ sở) — ĐỔI 18/09/2026.
// Chủ dự án chốt "bỏ luôn tick hiện tất cả giáo viên khỏi site sale", nên tầng `LOC_THEO_CA`
// KHÔNG còn vẽ công tắc và không thể dùng để thử hành vi của nó nữa. Tầng giữ công tắc là
// Quản lý cơ sở — cũng chính là người Sale sẽ nhờ khi danh sách rỗng.
// Ca khoá "tầng nào được thấy công tắc" nằm ở `chon-gv-buoi.test.tsx`.
describe("Công tắc 'Hiện tất cả giáo viên'", () => {
  // ⚠️ CA NÀY CŨNG SỬA 17/09/2026, cùng lý do với ca câu-luật ở trên: bản cũ khẳng định ô
  // tích in "· đang lọc theo ca" NGAY KHI MỞ MÀN, lúc chưa có lượt lọc nào chạy. Hai cửa
  // trên CÙNG một màn hình (câu luật + chữ cạnh ô tích) cùng hứa một điều cho một danh
  // sách chưa lọc — vá một cửa mà để nguyên cửa kia thì người dùng vẫn đọc ra lời hứa cũ.
  it("có mặt ở tầng LOC_THEO_CA, mặc định TẮT; nói 'chưa lọc' trước, 'đang lọc' sau khi có ngày", async () => {
    dung({ cheDoChonGv: "THEO_CO_SO" });
    const o = congTac();
    expect(o).not.toBeNull();
    expect(o!.checked).toBe(false);
    expect(screen.getByText("· chưa lọc (chọn ngày & giờ)")).toBeTruthy();
    expect(screen.queryByText("· đang lọc theo ca")).toBeNull();

    await chonNgay();
    expect(screen.getByText("· đang lọc theo ca")).toBeTruthy();
    expect(screen.queryByText("· chưa lọc (chọn ngày & giờ)")).toBeNull();
  });

  it("xoá ngày ⇒ ô tích quay lại 'chưa lọc' (không dính lại lời hứa của lượt trước)", async () => {
    dung({ cheDoChonGv: "THEO_CO_SO" });
    await chonNgay();
    expect(screen.getByText("· đang lọc theo ca")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Ngày *"), { target: { value: "" } });
    expect(screen.getByText("· chưa lọc (chọn ngày & giờ)")).toBeTruthy();
    expect(screen.getByText(/Note đỏ đối chiếu buổi/).textContent).toContain(
      "Chọn ngày và giờ để lọc theo ca làm việc",
    );
  });

  it("KHÔNG vẽ ở tầng TAT_CA và khi cờ lọc đang tắt — không dựng nút vô nghĩa", () => {
    const a = render(
      <AddSessionForm
        trialClassId="lop-1"
        teachers={GIAO_VIEN}
        rooms={[]}
        defaultStartTime="18:00"
        defaultEndTime="19:30"
        cheDoChonGv="TAT_CA"
        locGvTheoCa
        soGvMienLoc={0}
        ngayCoDinh={null}
        khung={null}
      />,
    );
    expect(congTac()).toBeNull();
    a.unmount();

    dung({ cheDoChonGv: "THEO_CO_SO", locGvTheoCa: false });
    expect(congTac()).toBeNull();
  });

  // ⭐ CA KHOÁ: cờ phải THẬT SỰ tới server, ngay lượt bấm ĐẦU TIÊN.
  it("bấm BẬT ⇒ hỏi lại server với hienTatCa=true, đúng khung giờ đang chọn", async () => {
    dung({ cheDoChonGv: "THEO_CO_SO" });
    await chonNgay();
    expect(h.layGv).toHaveBeenCalledTimes(1);

    fireEvent.click(congTac()!);
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(2));
    expect(h.layGv.mock.calls[1][0]).toEqual({
      trialClassId: "lop-1",
      date: NGAY,
      startTime: "18:00",
      endTime: "19:30",
      excludeSessionId: null,
      hienTatCa: true,
    });
  });

  it("bấm TẮT lại ⇒ hỏi lại với hienTatCa=false (quay về đang lọc)", async () => {
    dung({ cheDoChonGv: "THEO_CO_SO" });
    await chonNgay();
    fireEvent.click(congTac()!);
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(2));

    fireEvent.click(congTac()!);
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(3));
    expect(h.layGv.mock.calls[2][0].hienTatCa).toBe(false);
    expect(congTac()!.checked).toBe(false);
  });

  it("BẬT rồi đổi giờ ⇒ lượt hỏi kế tiếp GIỮ cờ, không lặng lẽ bật lại bộ lọc", async () => {
    // Cờ nằm ở ref của hook chứ không ở tham số của `tai`, nên đây là chỗ nó dễ rơi mất:
    // rơi mất thì bộ lọc tự bật lại giữa chừng và danh sách co lại mà người dùng không
    // hề bấm gì — công tắc trông như "tự tắt".
    dung({ cheDoChonGv: "THEO_CO_SO" });
    await chonNgay();
    fireEvent.click(congTac()!);
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("Giờ kết thúc"), { target: { value: "20:00" } });
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(3));
    expect(h.layGv.mock.calls[2][0]).toMatchObject({ endTime: "20:00", hienTatCa: true });
    expect(congTac()!.checked).toBe(true);
  });

  it("BẬT ⇒ câu giải thích luật phải ĐỔI, không được còn hứa 'chỉ hiện GV có ca phủ TRỌN'", async () => {
    // Câu mô tả luật mà không đổi theo luật là lời hứa suông ngay giữa màn hình: không
    // ném, không đỏ, console sạch — chỉ sai.
    //
    // ⚠️ `chonNgay()` thêm 17/09/2026: bản cũ bấm công tắc khi CHƯA chọn ngày, nên câu
    // XUẤT PHÁT mà nó khẳng định ("ca phủ TRỌN…") chính là câu nói dối đang được vá. Nay
    // ca này đi từ một trạng thái CÓ THẬT: đã lọc cho một khung giờ, rồi mới bỏ lọc.
    // 18/09 — tầng thử là `THEO_CO_SO` (Sale không còn công tắc), nên câu XUẤT PHÁT là câu
    // lọc theo CƠ SỞ, không phải câu lọc theo ca. Khẳng định đúng câu đang hiện, đừng
    // khẳng định câu của tầng khác — đó lại là một lời hứa suông, chỉ nằm trong test.
    dung({ cheDoChonGv: "THEO_CO_SO" });
    await chonNgay();
    expect(screen.getByText(/Note đỏ đối chiếu buổi/).textContent).toContain(
      "lọc theo cơ sở",
    );

    fireEvent.click(congTac()!);
    await waitFor(() => expect(congTac()!.checked).toBe(true));
    const cau = screen.getByText(/Note đỏ đối chiếu buổi/).textContent ?? "";
    expect(cau).toContain("HIỆN TẤT CẢ");
    expect(cau).not.toContain("lọc theo cơ sở");
    expect(screen.getByText("· đang BỎ lọc theo ca")).toBeTruthy();
  });

  it("BẬT vẫn giữ note ĐỎ trùng lịch — đó là thứ KHÔNG được tắt cùng bộ lọc", async () => {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [
        dong({
          id: "gv-kiet",
          name: "Nguyễn Tuấn Kiệt",
          phu: "NGHI",
          muc: "DO",
          nhan: "TRÙNG LỊCH: buổi lớp chính 18:00–19:30",
        }),
      ],
      lyDoRong: "Đang HIỆN TẤT CẢ giáo viên — luật ca tạm bỏ cho lượt chọn này.",
    } satisfies KetQua);

    dung({ cheDoChonGv: "THEO_CO_SO" });
    await chonNgay();
    fireEvent.click(congTac()!);
    await screen.findByText(/Nguyễn Tuấn Kiệt · TRÙNG LỊCH/);

    fireEvent.change(oGiaoVien(), { target: { value: "gv-kiet" } });
    expect(screen.getByRole("alert").textContent).toContain("TRÙNG LỊCH");
    expect(oGiaoVien().getAttribute("aria-invalid")).toBe("true");
    // `findAllByText` chứ không `findByText`: câu "đang hiện tất cả" xuất hiện ở HAI chỗ
    // cố ý — `lyDoRong` (khối `aria-live`, do server trả) và câu mô tả luật ở dưới. Khối
    // phải kiểm là khối `aria-live`, vì đó là thứ người dùng trình đọc màn hình nghe được.
    const noi = await screen.findAllByText(/Đang HIỆN TẤT CẢ giáo viên/);
    expect(noi.some((p) => p.getAttribute("aria-live") === "polite")).toBe(true);
  });

  it("chưa chọn ngày mà bấm công tắc ⇒ KHÔNG gọi server (chưa đủ ba ô thì không có gì để hỏi)", () => {
    dung({ cheDoChonGv: "THEO_CO_SO" });
    fireEvent.click(congTac()!);
    expect(h.layGv).not.toHaveBeenCalled();
    // Nhưng trạng thái công tắc vẫn phải ghi nhận, nếu không nó "tự bật lại" khi người
    // dùng chọn ngày sau đó.
    expect(congTac()!.checked).toBe(true);
  });

  it("bấm TRƯỚC rồi chọn ngày SAU ⇒ lượt hỏi đầu tiên đã mang cờ", async () => {
    dung({ cheDoChonGv: "THEO_CO_SO" });
    fireEvent.click(congTac()!);
    await chonNgay();
    expect(h.layGv.mock.calls[0][0].hienTatCa).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ 17/09/2026 — NHÃN CỦA NGƯỜI KHÔNG CÓ TRONG DANH SÁCH VỪA LỌC
//
// Dòng chèn thêm cho "người đang được chọn nhưng không nằm trong `ds`" trước đây LUÔN dán
// " · NGOÀI DANH SÁCH LỌC" — một câu quy trách nhiệm cho bộ lọc. Hai cảnh nó nói sai:
//   1. công tắc "Hiện tất cả" đang BẬT — màn hình vừa nói mọi luật lọc đã tạm bỏ, mà dòng
//      này lại bảo có bộ lọc đang loại người (hai câu ngược nhau trên cùng màn hình);
//   2. người đó KHÔNG có cả trong danh sách đầy đủ — `getAssignableTeachers` AND
//      `deletedAt: null` lên cả nhánh `includeIds`, nên tài khoản đã xoá mềm không bao giờ
//      có mặt ở đâu để mà bị lọc (bằng chứng ở `_lib/gv-hop-le.ts`).
//
// ── CẤY LẠI LỖI (luật 15) — đã chạy THẬT ────────────────────────────────────────────
//   · `hauToNguoiNgoaiDs` trả thẳng " · NGOÀI DANH SÁCH LỌC"     → **2 ĐỎ / 26**
//   · bỏ vế `!input.coTrongDsDay` (chỉ còn xét `hienTatCa`)      → **1 ĐỎ / 26**
//   · bỏ phép tra tên ở `teachers` (luôn "(không rõ tên)")       → **3 ĐỎ / 26**
// ═════════════════════════════════════════════════════════════════════════════════════

describe("dòng người đang chọn mà không có trong danh sách vừa lọc", () => {
  /** Danh sách lọc chỉ còn một người khác — người đang chọn rơi ra ngoài. */
  function chiConLan() {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: "gv-lan", name: "Lê Thị Lan" })],
      lyDoRong: null,
    } satisfies KetQua);
  }

  it("đang LỌC và người đó CÓ trong danh sách đầy đủ ⇒ đúng là bộ lọc loại họ", async () => {
    // Vế đối chứng: chữ "NGOÀI DANH SÁCH LỌC" vẫn phải còn ở đúng cảnh nó nói thật.
    chiConLan();
    dung({ cheDoChonGv: "THEO_CO_SO" });
    fireEvent.change(oGiaoVien(), { target: { value: "gv-kiet" } });
    await chonNgay();

    await screen.findByText(/Nguyễn Tuấn Kiệt · NGOÀI DANH SÁCH LỌC/);
    expect(oGiaoVien().value).toBe("gv-kiet");
  });

  // ⭐ CA KHOÁ (1): công tắc BẬT thì không có bộ lọc nào để đổ lỗi.
  it("công tắc 'Hiện tất cả' BẬT ⇒ KHÔNG được dùng chữ 'ngoài danh sách lọc'", async () => {
    chiConLan();
    dung({ cheDoChonGv: "THEO_CO_SO" });
    fireEvent.change(oGiaoVien(), { target: { value: "gv-kiet" } });
    await chonNgay();
    fireEvent.click(congTac()!);
    await waitFor(() => expect(congTac()!.checked).toBe(true));

    // Tên THẬT phải còn, chỉ hậu tố đổi.
    await screen.findByText(/Nguyễn Tuấn Kiệt · KHÔNG CÒN TRONG DANH SÁCH CHỌN/);
    expect(screen.queryByText(/NGOÀI DANH SÁCH LỌC/)).toBeNull();
    expect(oGiaoVien().value).toBe("gv-kiet");
  });

  // ⭐ CA KHOÁ (2) — tài khoản đã XOÁ MỀM — nằm ở `attendance-board.test.tsx`, KHÔNG ở đây.
  //
  // Lý do (luật 9): cổng phải được cho ăn bằng thứ đường THẬT cho nó ăn. Cửa "Thêm buổi"
  // luôn mở với `teacherId = ""`, nên muốn dựng cảnh "người đang gán không có trong danh
  // sách đầy đủ" ở đây thì phải gõ tay `value` vào component — tức kiểm cái cổng chứ không
  // kiểm hệ thống. Đường THẬT của cảnh đó là cửa SỬA BUỔI: `SuaBuoiForm` khởi tạo
  // `teacherId` từ `session.teacherId`, và giáo viên đã xoá mềm thì không có trong
  // `teachers` (điều kiện `deletedAt: null` đè cả nhánh `includeIds` —
  // xem `_lib/gv-hop-le.ts`). Ca đó tên là "buổi cũ đang gán một tài khoản đã xoá mềm…".

  it("hauToNguoiNgoaiDs — bảng đầy đủ bốn ô, đọc một lượt", () => {
    // Hàm THUẦN nên canh được cả bốn tổ hợp, kể cả ô mà giao diện khó dựng.
    expect(hauToNguoiNgoaiDs({ coTrongDsDay: true, hienTatCa: false })).toBe(
      " · NGOÀI DANH SÁCH LỌC",
    );
    expect(hauToNguoiNgoaiDs({ coTrongDsDay: true, hienTatCa: true })).toBe(
      " · KHÔNG CÒN TRONG DANH SÁCH CHỌN",
    );
    expect(hauToNguoiNgoaiDs({ coTrongDsDay: false, hienTatCa: false })).toBe(
      " · KHÔNG CÒN TRONG DANH SÁCH CHỌN",
    );
    expect(hauToNguoiNgoaiDs({ coTrongDsDay: false, hienTatCa: true })).toBe(
      " · KHÔNG CÒN TRONG DANH SÁCH CHỌN",
    );
  });
});

describe("[ASF-CASE] lớp THEO KHUNG — form thêm case KHÔNG có ô ngày (chủ dự án 23/09)", () => {
  it("không vẽ ô ngày, tiêu đề + nút là \"Thêm case\", ô giờ mang min/max của khung lớp", () => {
    render(
      <AddSessionForm
        trialClassId="lop-1"
        teachers={GIAO_VIEN}
        rooms={[]}
        defaultStartTime="17:30"
        defaultEndTime="21:00"
        cheDoChonGv="TAT_CA"
        locGvTheoCa={false}
        soGvMienLoc={0}
        ngayCoDinh="2026-09-23"
        khung={{ startTime: "17:30", endTime: "21:00" }}
      />,
    );
    expect(screen.queryByLabelText("Ngày *")).toBeNull();
    expect(screen.getAllByText("Thêm case").length).toBe(2); // tiêu đề + nút
    const gio = screen.getByLabelText("Giờ bắt đầu") as HTMLInputElement;
    expect(gio.min).toBe("17:30");
    expect(gio.max).toBe("21:00");
  });
});
