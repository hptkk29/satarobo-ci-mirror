// @vitest-environment jsdom
/**
 * Bấm "Bắt đầu làm bài" — HÀNH VI của màn chuyển trạng thái (hotfix 26/10/2026).
 *
 * Giữa lúc bấm và lúc RSC mới về, trang server còn là bản CŨ (chưa có lượt) nên vẫn vẽ "Bài trước / Bài sau" ngay dưới nút
 * "Đang mở…". Lượt thi lúc đó ĐÃ tạo ở máy chủ và đang tính giờ: bấm nối trang là rời một lượt mà người học chưa hề thấy đề.
 * Cổng ở đây khẳng định HÀNH VI (nút biến mất ngay khi bấm, và quay lại đúng lúc), không grep mã nguồn.
 *
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: "nút không còn" luôn đạt nếu component hỏng hẳn (không vẽ nút nào), nên ca đầu tiên khẳng
 * định nút CÓ MẶT trước khi bấm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useTransition, type ComponentProps } from "react";

const h = vi.hoisted(() => ({
  nop: vi.fn(),
  batDau: vi.fn(),
  luu: vi.fn(),
  refresh: vi.fn(),
  toastLoi: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.toastLoi, message: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
// Server action — import thật kéo cả chuỗi next-auth/prisma vào jsdom.
vi.mock("../_actions", () => ({
  batDauThiAction: h.batDau,
  luuCauTraLoiAction: h.luu,
  nopBaiAction: h.nop,
}));

import { ExamRunner } from "./exam-runner";
import { ChuyenBaiNav, datDangMoLuotThi } from "./chuyen-bai";

type Props = ComponentProps<typeof ExamRunner>;
const CO_BAN: Props = {
  enrollmentId: "e1",
  lessonId: "l1",
  tenDe: "Đề thử",
  durationMin: 15,
  passScore: 6,
  maxScore: 10,
  soLuotConLai: 1,
  luotDangLam: null,
  ketQuaGanNhat: null,
  moLaiLuc: null,
  chungNhanCode: null,
};
const LUOT: NonNullable<Props["luotDangLam"]> = {
  attemptId: "a1",
  conLaiGiay: 900,
  cacCau: [
    { examQuestionId: "q1", stem: "Câu một?", type: "SINGLE", points: 1, luaChon: [{ ma: "0", nhan: "A" }], daChon: [], textAnswer: null },
  ],
};

const NOI = { enrollmentId: "e1", truoc: { lessonId: "l0", title: "Bài 0" }, sau: { lessonId: "l2", title: "Bài 2" } };

function Cay({ luot = null }: { luot?: Props["luotDangLam"] }) {
  return (
    <>
      <ExamRunner {...CO_BAN} luotDangLam={luot} />
      <ChuyenBaiNav {...NOI} />
    </>
  );
}

const nutNoi = () => screen.queryByRole("navigation", { name: "Chuyển bài" });
/**
 * Xả vi tác vụ: React 19 chỉ trả `isPending` về false ở một lượt render SAU khi hàm async của transition xong. Một `act` không
 * đủ — kiểm ngay là thấy nhãn còn "Đang mở…". (Trên trình duyệt thật khoảng đó là ~vài chục ms: màn thi hiện ở 277 ms.)
 */
const xa = async () => {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const bam = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu làm bài" }));
  });
  await xa();
};

beforeEach(() => {
  vi.clearAllMocks();
  h.luu.mockResolvedValue({ ok: true, data: { daLuu: true } });
  performance.clearMarks();
  performance.clearMeasures();
});
afterEach(() => {
  cleanup();
  datDangMoLuotThi(false);
  vi.useRealTimers();
});

/**
 * Từ 18/11/2026 nút "Nộp bài" của trình làm bài chỉ MỞ hộp xác nhận (`HopXacNhanNop`); việc nộp thật nằm ở nút "Nộp bài" TRONG hộp.
 * Các ca dưới đây đo đường nộp ⇒ đi đủ hai bước (viết lại có chủ đích — ý nghĩa của nút đổi, không phải gỡ lưới).
 */
async function nopQuaHop() {
  // Hai `act` RIÊNG: hộp chỉ có trong cây DOM sau khi React flush lần bấm thứ nhất.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài" }));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Nộp bài" }));
  });
}

describe("nút nối trang khi mở lượt thi", () => {
  it("[ER-01] ĐỐI CHỨNG DƯƠNG: trước khi bấm, nút Bài trước/Bài sau CÓ mặt", () => {
    render(<Cay />);
    expect(nutNoi()).not.toBeNull();
    expect(screen.getByText("Bài trước: Bài 0")).toBeTruthy();
    expect(screen.getByText("Bài sau: Bài 2")).toBeTruthy();
  });

  it("[ER-02] bấm Bắt đầu mà server còn treo ⇒ nút nối BIẾN MẤT ngay, nút bấm khoá + nhãn 'Đang mở…'", async () => {
    h.batDau.mockImplementation(() => new Promise(() => undefined));
    render(<Cay />);
    await bam();
    expect(nutNoi()).toBeNull();
    const nut = screen.getByRole("button", { name: "Đang mở…" }) as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    expect(document.querySelector("[data-trang-thai-thi]")?.getAttribute("data-trang-thai-thi")).toBe("dang-mo");
  });

  it("[ER-03] action trả lỗi nghiệp vụ ⇒ nút nối quay lại + báo đúng lời server", async () => {
    h.batDau.mockResolvedValue({ ok: false, error: { code: "HET_LUOT_THI", message: "Đã dùng hết 2 lượt thi" } });
    render(<Cay />);
    await bam();
    expect(h.toastLoi).toHaveBeenCalledWith("Đã dùng hết 2 lượt thi");
    expect(nutNoi()).not.toBeNull();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("[ER-04] action NÉM lỗi (mất mạng) ⇒ nút nối quay lại + báo rõ, không treo 'Đang mở…'", async () => {
    h.batDau.mockRejectedValue(new Error("Failed to fetch"));
    render(<Cay />);
    await bam();
    expect(h.toastLoi).toHaveBeenCalledWith("Không mở được bài thi — kiểm tra kết nối rồi thử lại");
    expect(nutNoi()).not.toBeNull();
    expect((screen.getByRole("button", { name: "Bắt đầu làm bài" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[ER-05] action OK nhưng RSC mới CHƯA về ⇒ nút nối VẪN ẩn (không hở khoảng giữa action và refresh)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    render(<Cay />);
    await bam();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(nutNoi()).toBeNull();
  });

  it("[ER-06] RSC về mang lượt dở ⇒ kho được trả (trang server tự ẩn nút từ đây), màn đổi sang 'dang-lam'", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    const { rerender } = render(<Cay />);
    await bam();
    expect(nutNoi()).toBeNull();
    await act(async () => {
      rerender(<Cay luot={LUOT} />);
    });
    // Trong khung thật, `anChuyenBai` (server) ẩn nút; ở đây ChuyenBaiNav luôn được dựng nên nó hiện lại ⇒ chứng minh kho đã được trả.
    expect(nutNoi()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Nộp bài" })).toBeTruthy();
    expect(document.querySelector("[data-trang-thai-thi]")?.getAttribute("data-trang-thai-thi")).toBe("dang-lam");
  });

  it("[ER-07] ExamRunner bị gỡ khi đang mở ⇒ kho được trả, nút nối KHÔNG biến mất mãi ở bài khác", async () => {
    h.batDau.mockImplementation(() => new Promise(() => undefined));
    const { rerender } = render(<Cay />);
    await bam();
    expect(nutNoi()).toBeNull();
    await act(async () => {
      rerender(<ChuyenBaiNav {...NOI} />);
    });
    expect(nutNoi()).not.toBeNull();
  });
});

describe("thông báo khi chờ lâu", () => {
  it("[ER-08] chưa tới 4 giây ⇒ im; quá 4 giây vẫn 'Đang mở…' ⇒ nói thật là lâu hơn thường", async () => {
    vi.useFakeTimers();
    h.batDau.mockImplementation(() => new Promise(() => undefined));
    render(<Cay />);
    await bam();
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("status").textContent).toContain("lâu hơn bình thường");
  });

  it("[ER-09] xong trước 4 giây ⇒ không bao giờ hiện thông báo chờ lâu", async () => {
    vi.useFakeTimers();
    h.batDau.mockResolvedValue({ ok: false, error: { code: "X", message: "lỗi" } });
    render(<Cay />);
    await bam();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("dấu đo hiệu năng (Performance API) — để lần sau thấy đoạn nào chậm", () => {
  it("[ER-10] bấm → action trả → màn thi hiện ⇒ có đủ ba phép đo, không gửi đi đâu", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    const { rerender } = render(<Cay />);
    await bam();
    await act(async () => {
      rerender(<Cay luot={LUOT} />);
    });
    const ten = (n: string) => performance.getEntriesByName(n, "measure").length;
    expect(ten("el-thi:action")).toBe(1);
    expect(ten("el-thi:sau-action")).toBe(1);
    expect(ten("el-thi:tong")).toBe(1);
  });

  it("[ER-11] tải lại trang có sẵn lượt dở (không bấm) ⇒ KHÔNG sinh phép đo giả", async () => {
    render(<Cay luot={LUOT} />);
    expect(performance.getEntriesByName("el-thi:tong", "measure")).toHaveLength(0);
  });
});

/** Một component KHÔNG LIÊN QUAN giữ một async transition mở mãi — mô phỏng "việc nền" làm ngưng cả lô transition của React 19. */
function TreoNen() {
  const [, batDau] = useTransition();
  return (
    <button type="button" onClick={() => batDau(async () => new Promise<void>(() => undefined))}>
      việc nền
    </button>
  );
}

describe("không phụ thuộc transition dùng chung của React", () => {
  it("[ER-12] có một async transition KHÁC treo mãi ⇒ lỗi action vẫn trả nút 'Bắt đầu làm bài' (không kẹt 'Đang mở…')", async () => {
    h.batDau.mockResolvedValue({ ok: false, error: { code: "X", message: "lỗi" } });
    render(
      <>
        <TreoNen />
        <Cay />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "việc nền" }));
    });
    await bam();
    const nut = screen.getByRole("button", { name: "Bắt đầu làm bài" }) as HTMLButtonElement;
    expect(nut.disabled).toBe(false);
    expect(nutNoi()).not.toBeNull();
  });

  it("[ER-13] có async transition KHÁC treo mãi ⇒ lượt về vẫn hiện NGAY, nút 'Nộp bài' không bị khoá 'Đang nộp…'", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    const { rerender } = render(
      <>
        <TreoNen />
        <Cay />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "việc nền" }));
    });
    await bam();
    await act(async () => {
      rerender(
        <>
          <TreoNen />
          <Cay luot={LUOT} />
        </>,
      );
    });
    await xa();
    const nop = screen.getByRole("button", { name: "Nộp bài" }) as HTMLButtonElement;
    expect(nop.disabled).toBe(false);
  });
});

describe("lối thoát khi RSC mới không về (đường DỰ PHÒNG: server không trả `luot`)", () => {
  it("[ER-14] action xong mà RSC không mang lượt về sau 20 giây ⇒ trả nút + nút nối, báo 'bấm lại an toàn'", async () => {
    vi.useFakeTimers();
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    const message = (await import("sonner")).toast.message as ReturnType<typeof vi.fn>;
    message.mockClear();
    render(<Cay />);
    await bam();
    expect(nutNoi()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(19_000);
    });
    expect(nutNoi()).toBeNull(); // chưa tới hạn: vẫn giữ
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(nutNoi()).not.toBeNull();
    expect((screen.getByRole("button", { name: "Bắt đầu làm bài" }) as HTMLButtonElement).disabled).toBe(false);
    expect(String(message.mock.calls.at(-1)?.[0])).toContain("lượt của bạn vẫn được giữ");
  });

  it("[ER-15] RSC về ĐÚNG HẠN ⇒ hết hạn chờ KHÔNG bắn thông báo thừa", async () => {
    vi.useFakeTimers();
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    const message = (await import("sonner")).toast.message as ReturnType<typeof vi.fn>;
    message.mockClear();
    const { rerender } = render(<Cay />);
    await bam();
    await act(async () => {
      rerender(<Cay luot={LUOT} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("[ER-16] bấm đúp trong lúc đang mở ⇒ chỉ MỘT lần gọi action", async () => {
    h.batDau.mockImplementation(() => new Promise(() => undefined));
    render(<Cay />);
    await bam();
    const nut = screen.getByRole("button", { name: "Đang mở…" });
    await act(async () => {
      fireEvent.click(nut);
      fireEvent.click(nut);
    });
    expect(h.batDau).toHaveBeenCalledTimes(1);
  });
});

describe("đường Nộp bài", () => {
  it("[ER-17] nộp: nhãn 'Đang nộp…' + khoá; xong (lượt biến khỏi props) ⇒ về màn bắt đầu, nút mở lại", async () => {
    h.nop.mockResolvedValue({ ok: true, data: { choChamTay: false, passed: true, totalScore: 10 } });
    const { rerender } = render(<Cay luot={LUOT} />);
    await nopQuaHop();
    await xa();
    expect(h.nop).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Đang nộp…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      rerender(<Cay luot={null} />);
    });
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
  });

  it("[ER-18] nộp lỗi nghiệp vụ ⇒ nút 'Nộp bài' mở lại để bấm tiếp, báo đúng lời server", async () => {
    h.nop.mockResolvedValue({ ok: false, error: { code: "X", message: "Lượt này đã đóng" } });
    render(<Cay luot={LUOT} />);
    await nopQuaHop();
    await xa();
    expect(h.toastLoi).toHaveBeenCalledWith("Lượt này đã đóng");
    expect((screen.getByRole("button", { name: "Nộp bài" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[ER-19] nộp mà mạng đứt (action ném) ⇒ nút mở lại + báo rõ, không kẹt 'Đang nộp…'", async () => {
    h.nop.mockRejectedValue(new Error("Failed to fetch"));
    render(<Cay luot={LUOT} />);
    await nopQuaHop();
    await xa();
    expect(h.toastLoi).toHaveBeenCalledWith("Không nộp được bài — kiểm tra kết nối rồi bấm Nộp bài lại");
    expect((screen.getByRole("button", { name: "Nộp bài" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("vòng đời đầy đủ", () => {
  it("[ER-20] bắt đầu → lượt về → nộp → lượt biến mất ⇒ nút 'Bắt đầu làm bài' mở lại (không kẹt 'Đang mở…' từ lần bắt đầu trước)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    h.nop.mockResolvedValue({ ok: true, data: { choChamTay: false, passed: true, totalScore: 10 } });
    const { rerender } = render(<Cay />);
    await bam();
    await act(async () => {
      rerender(<Cay luot={LUOT} />);
    });
    await nopQuaHop();
    await xa();
    await act(async () => {
      rerender(<Cay luot={null} />);
    });
    const nut = screen.getByRole("button", { name: "Bắt đầu làm bài" }) as HTMLButtonElement;
    expect(nut.disabled).toBe(false);
    // Lượt KẾ TIẾP (được mở khoá): nút Nộp bài của lượt mới không được thừa kế trạng thái 'Đang nộp…' của lượt trước.
    await act(async () => {
      rerender(<Cay luot={{ ...LUOT, attemptId: "a2" }} />);
    });
    expect((screen.getByRole("button", { name: "Nộp bài" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

/**
 * CẦU NỐI — màn thi mở NGAY khi action xong, không chờ bản cập nhật RSC (sửa độ trễ ~4 s đo trên TEST 26/10/2026).
 *
 * Gốc: action `batDauThi` ~95 ms, nhưng commit của `router.refresh()` bị giữ ~3,9 s (đổi bộ đếm 4000→9000 ms thì màn thi hiện lúc
 * 9 s). Nay action trả luôn `luot` (server dựng, đã lọc đáp án đúng) và `ExamRunner` dựng từ đó; RSC chỉ còn đồng bộ nền.
 * Mọi ca ở đây chạy với RSC KHÔNG BAO GIỜ về (props luôn `luotDangLam: null`) — ca nào đòi props mới hiện màn thi sẽ ĐỎ.
 */
describe("cầu nối: mở màn thi từ kết quả của action", () => {
  const DATA = { attemptId: "a1", attemptNo: 1, luot: LUOT };

  it("[ER-21] action trả luot ⇒ màn thi hiện NGAY dù RSC chưa về (props vẫn null): có 'Nộp bài', không còn 'Bắt đầu', dấu đo đủ ba phép", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    render(<Cay />);
    await bam();
    expect(screen.getByRole("button", { name: "Nộp bài" })).toBeTruthy();
    expect(screen.getByText("Câu 1 (1 điểm)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bắt đầu làm bài|Đang mở…/ })).toBeNull();
    expect(document.querySelector("[data-trang-thai-thi]")?.getAttribute("data-trang-thai-thi")).toBe("dang-lam");
    const ten = (n: string) => performance.getEntriesByName(n, "measure").length;
    expect([ten("el-thi:action"), ten("el-thi:sau-action"), ten("el-thi:tong")]).toEqual([1, 1, 1]);
  });

  it("[ER-22] đang thi bằng cầu nối thì nút Bài trước/Bài sau VẪN ẩn (lượt đang tính giờ, trang server còn là bản cũ)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    render(<Cay />);
    await bam();
    expect(screen.getByRole("button", { name: "Nộp bài" })).toBeTruthy();
    expect(nutNoi()).toBeNull();
  });

  it("[ER-23] đồng bộ nền vẫn được gọi đúng một lần ngay sau action (RSC chỉ để xác nhận, không còn là điều kiện mở)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    render(<Cay />);
    await bam();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("[ER-24] RSC KHÔNG BAO GIỜ về, 60 giây trôi ⇒ vẫn đang thi, KHÔNG bắn 'Chưa tải được bài thi', KHÔNG trả nút 'Bắt đầu', nút nối vẫn ẩn; đồng bộ nền được thử lại im lặng", async () => {
    vi.useFakeTimers();
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    const message = (await import("sonner")).toast.message as ReturnType<typeof vi.fn>;
    message.mockClear();
    render(<Cay />);
    await bam();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("button", { name: "Nộp bài" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bắt đầu làm bài" })).toBeNull();
    expect(nutNoi()).toBeNull();
    expect(message).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalledTimes(2); // một lần ngay sau action + một lần thử lại sau hạn chờ
  });

  it("[ER-25] có một async transition KHÁC treo mãi (bệnh gốc: commit RSC bị giữ) ⇒ màn thi VẪN hiện ngay", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    render(
      <>
        <TreoNen />
        <Cay />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "việc nền" }));
    });
    await bam();
    expect(screen.getByRole("button", { name: "Nộp bài" })).toBeTruthy();
  });

  it("[ER-26] RSC về SAU, cùng lượt ⇒ lựa chọn người học bấm trong lúc chờ KHÔNG bị ghi đè; kho được trả (trang server tự ẩn nút từ đây)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    const { rerender } = render(<Cay />);
    await bam();
    const luaChonA = () => screen.getByRole("button", { name: /A$/ }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(luaChonA());
    });
    expect(luaChonA().getAttribute("aria-pressed")).toBe("true");
    expect(nutNoi()).toBeNull();
    await act(async () => {
      rerender(<Cay luot={LUOT} />); // bản server: `daChon` còn rỗng vì lệnh lưu chưa kịp tới
    });
    expect(luaChonA().getAttribute("aria-pressed")).toBe("true");
    expect(nutNoi()).not.toBeNull(); // chứng minh kho đã trả (ChuyenBaiNav luôn được dựng trong cây thử)
  });

  it("[ER-27] bấm Bắt đầu lần nữa khi đã thi bằng cầu nối ⇒ không có nút để bấm (không gọi action thừa, không tạo lượt)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    render(<Cay />);
    await bam();
    expect(screen.queryByRole("button", { name: "Bắt đầu làm bài" })).toBeNull();
    expect(h.batDau).toHaveBeenCalledTimes(1);
  });

  it("[ER-28] nộp khi mới có cầu nối (server chưa xác nhận) ⇒ màn thi KHÔNG ở lại mãi, kho trả về, không kẹt 'Đang nộp…'", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    h.nop.mockResolvedValue({ ok: true, data: { choChamTay: false, passed: true, totalScore: 10 } });
    render(<Cay />);
    await bam();
    await nopQuaHop();
    await xa();
    expect(screen.queryByRole("button", { name: /Nộp bài|Đang nộp…/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
    expect(nutNoi()).not.toBeNull();
  });

  it("[ER-31] vòng đời: cầu nối → RSC xác nhận → nộp → props rỗng ⇒ về màn bắt đầu (cầu nối đã bị gỡ khi xác nhận, không giữ màn thi cũ)", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: DATA });
    h.nop.mockResolvedValue({ ok: true, data: { choChamTay: false, passed: true, totalScore: 10 } });
    const { rerender } = render(<Cay />);
    await bam();
    await act(async () => {
      rerender(<Cay luot={LUOT} />); // server xác nhận
    });
    await nopQuaHop();
    await xa();
    await act(async () => {
      rerender(<Cay luot={null} />); // server: lượt đã nộp
    });
    expect(screen.queryByRole("button", { name: /Nộp bài|Đang nộp…/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
  });

  it("[ER-29] ĐỐI CHỨNG: action ok nhưng KHÔNG có luot (server cũ) ⇒ vẫn đường dự phòng: màn thi CHƯA hiện, nút nối ẩn, chờ RSC", async () => {
    h.batDau.mockResolvedValue({ ok: true, data: { attemptId: "a1", attemptNo: 1 } });
    render(<Cay />);
    await bam();
    expect(screen.queryByRole("button", { name: "Nộp bài" })).toBeNull();
    expect(nutNoi()).toBeNull();
  });

  it("[ER-30] action lỗi nghiệp vụ ⇒ KHÔNG dựng màn thi từ gì cả; nút Bắt đầu mở lại", async () => {
    h.batDau.mockResolvedValue({ ok: false, error: { code: "HET_LUOT_THI", message: "Đã dùng hết lượt" } });
    render(<Cay />);
    await bam();
    expect(screen.queryByRole("button", { name: "Nộp bài" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
    expect(nutNoi()).not.toBeNull();
  });
});

describe("[ER-TF] câu Đúng/Sai: hai nút lớn, dấu theo NHÃN", () => {
  // Lựa chọn được TRỘN tất định theo lượt thi ⇒ "Sai" có thể đứng TRƯỚC "Đúng". Nhãn đúng như `locCauHoiChoNguoiHoc` gửi cho câu boolean.
  const TF: NonNullable<Props["luotDangLam"]> = {
    attemptId: "a1",
    conLaiGiay: 900,
    cacCau: [
      {
        examQuestionId: "q1",
        stem: "Trời có mưa?",
        type: "TRUE_FALSE",
        points: 1,
        luaChon: [
          { ma: "false", nhan: "Sai" },
          { ma: "true", nhan: "Đúng" },
        ],
        daChon: [],
        textAnswer: null,
      },
    ],
  };
  it("lưới hai cột; ✓ đứng cạnh 'Đúng', ✕ cạnh 'Sai' DÙ thứ tự bị đảo", () => {
    render(<Cay luot={TF} />);
    const nhom = screen.getByRole("group", { name: "Lựa chọn của câu 1" });
    expect(nhom.className).toContain("grid-cols-2");
    const [nutSai, nutDung] = within(nhom).getAllByRole("button");
    expect(nutSai!.textContent).toBe("✕Sai");
    expect(nutDung!.textContent).toBe("✓Đúng");
  });
  it("ĐỐI CHỨNG: câu SINGLE 2 lựa chọn KHÔNG bị vẽ thành hai nút lớn", () => {
    const S = { ...TF, cacCau: [{ ...TF.cacCau[0]!, type: "SINGLE" }] };
    render(<Cay luot={S} />);
    const nhom = screen.getByRole("group", { name: "Lựa chọn của câu 1" });
    expect(nhom.className).not.toContain("grid-cols-2");
    expect(within(nhom).getAllByRole("button")[0]!.textContent).not.toContain("✕");
  });
});

describe("[ER-DC] đếm chữ ở câu tự luận / trả lời ngắn", () => {
  const LUOT_CHU: NonNullable<Props["luotDangLam"]> = {
    attemptId: "a2",
    conLaiGiay: 900,
    cacCau: [
      { examQuestionId: "t1", stem: "Giải thích?", type: "ESSAY", points: 2, luaChon: [], daChon: [], textAnswer: null },
      { examQuestionId: "t2", stem: "Một từ?", type: "SHORT_ANSWER", points: 1, luaChon: [], daChon: [], textAnswer: "đã gõ sẵn ba từ" },
      { examQuestionId: "s1", stem: "Chọn?", type: "SINGLE", points: 1, luaChon: [{ ma: "0", nhan: "A" }], daChon: [], textAnswer: null },
    ],
  };
  it("mỗi ô chữ có bộ đếm; gõ thì đếm đổi; nội dung lưu sẵn được đếm; câu chọn KHÔNG có bộ đếm", () => {
    render(<ExamRunner {...CO_BAN} luotDangLam={LUOT_CHU} />);
    expect(screen.getByTestId("dem-chu-1").textContent).toBe("0 từ · 0/10000 ký tự");
    expect(screen.getByTestId("dem-chu-2").textContent).toBe("5 từ · 15/10000 ký tự");
    fireEvent.change(screen.getByLabelText("Trả lời câu 1"), { target: { value: "một hai" } });
    expect(screen.getByTestId("dem-chu-1").textContent).toBe("2 từ · 7/10000 ký tự");
    expect(screen.queryByTestId("dem-chu-3")).toBeNull();
  });
  it("quá trần thì nói rõ", () => {
    render(<ExamRunner {...CO_BAN} luotDangLam={LUOT_CHU} />);
    fireEvent.change(screen.getByLabelText("Trả lời câu 1"), { target: { value: "a".repeat(10_001) } });
    expect(screen.getByTestId("dem-chu-1").textContent).toContain("quá dài");
  });
});

describe("[ER-KT] màn kết quả khi chưa làm bài: giờ mở lượt sau + chứng nhận", () => {
  const DA_NOP = { status: "GRADED", totalScore: 8, passed: true };
  it("còn giãn cách ⇒ nói GIỜ ĐƯỢC THI LẠI (giờ Việt Nam) và KHÔNG vẽ nút bắt đầu; đối chứng: không giãn cách ⇒ có nút", () => {
    vi.useFakeTimers({ now: new Date("2026-11-10T04:00:00.000Z") });
    const { rerender } = render(<ExamRunner {...CO_BAN} soLuotConLai={2} ketQuaGanNhat={DA_NOP} moLaiLuc="2026-11-11T03:00:00.000Z" />);
    expect(screen.getByText("10:00 ngày 11/11/2026")).toBeTruthy(); // 03:00Z = 10:00 giờ VN
    expect(screen.queryByRole("button", { name: "Bắt đầu làm bài" })).toBeNull();
    rerender(<ExamRunner {...CO_BAN} soLuotConLai={2} ketQuaGanNhat={DA_NOP} moLaiLuc={null} />);
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
    expect(screen.queryByText(/giãn cách/)).toBeNull();
  });
  it("tới giờ (đồng hồ chạy qua mốc) ⇒ nút bắt đầu tự hiện, không cần tải lại trang", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-11T02:59:59.000Z") });
    render(<ExamRunner {...CO_BAN} soLuotConLai={2} ketQuaGanNhat={DA_NOP} moLaiLuc="2026-11-11T03:00:00.000Z" />);
    expect(screen.queryByRole("button", { name: "Bắt đầu làm bài" })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
  });
  it("🔴 giãn cách MỚI sau khi cái cũ đã hết ⇒ nút lại khoá (cờ hết-chờ không được dính từ lần trước)", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-11T02:59:59.000Z") });
    const { rerender } = render(<ExamRunner {...CO_BAN} soLuotConLai={2} ketQuaGanNhat={DA_NOP} moLaiLuc="2026-11-11T03:00:00.000Z" />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Bắt đầu làm bài" })).toBeTruthy();
    rerender(<ExamRunner {...CO_BAN} soLuotConLai={1} ketQuaGanNhat={DA_NOP} moLaiLuc="2026-11-12T03:00:00.000Z" />);
    expect(screen.queryByRole("button", { name: "Bắt đầu làm bài" })).toBeNull();
    expect(screen.getByText("10:00 ngày 12/11/2026")).toBeTruthy();
  });
  it("hết lượt thì không nói giờ chờ (không còn gì để chờ)", () => {
    render(<ExamRunner {...CO_BAN} soLuotConLai={0} ketQuaGanNhat={DA_NOP} moLaiLuc="2026-11-11T03:00:00.000Z" />);
    expect(screen.queryByText(/giãn cách/)).toBeNull();
    expect(screen.getByText(/Đã dùng hết lượt thi/)).toBeTruthy();
  });
  it("🔴 đạt + có chứng nhận ⇒ liên kết tới ĐÚNG trang xem (số hiệu được mã hoá); chưa đạt hoặc chưa có chứng nhận ⇒ không có liên kết", () => {
    const { rerender } = render(<ExamRunner {...CO_BAN} ketQuaGanNhat={DA_NOP} chungNhanCode="SR.CN.2026.00012" />);
    expect(screen.getByRole("link", { name: "Xem chứng nhận của bạn" }).getAttribute("href")).toBe("/elearning/chung-nhan-cua-toi/SR.CN.2026.00012");
    rerender(<ExamRunner {...CO_BAN} ketQuaGanNhat={{ ...DA_NOP, passed: false }} chungNhanCode="SR.CN.2026.00012" />);
    expect(screen.queryByRole("link", { name: "Xem chứng nhận của bạn" })).toBeNull();
    rerender(<ExamRunner {...CO_BAN} ketQuaGanNhat={DA_NOP} chungNhanCode={null} />);
    expect(screen.queryByRole("link", { name: "Xem chứng nhận của bạn" })).toBeNull();
  });
});
