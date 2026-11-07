// @vitest-environment jsdom
/**
 * [DISC-MN-*] Màn thành công + mã nhận. Dữ liệu BỊA ("giả"). Không mạng, không clipboard thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KHOA_LOCAL_MA_NHAN } from "@/lib/disc/nhan-ma-local";
import { ManThanhCong } from "./man-thanh-cong";
import { dinhDangMaNhan } from "./ma-nhan";

const TB = { chinh: "Câu chính giả — đã lưu an toàn.", email: null };

function datLocalStorageGia() {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), clear: () => map.clear() },
  });
}
function datClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

beforeEach(datLocalStorageGia);
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("[DISC-MN-01] hiển thị mã nhận", () => {
  it("định dạng ABCDE-FGHJK; độ dài lạ thì giữ nguyên, không đoán", () => {
    expect(dinhDangMaNhan("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
    expect(dinhDangMaNhan("ABC")).toBe("ABC");
  });
  it("có mã ⇒ hiện mã, cảnh báo 'mất mã thì không xem lại được', CTA /kich-hoat?disc=1", () => {
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    expect(screen.getByTestId("disc-ma-nhan").textContent).toBe("ABCDE-FGHJK");
    const canhBao = screen.getByTestId("disc-ma-nhan-canh-bao").textContent ?? "";
    expect(canhBao).toMatch(/chỉ hiện một lần/);
    expect(canhBao).toMatch(/không xem lại được/);
    const cta = screen.getByTestId("disc-nhan-ket-qua");
    expect(cta.getAttribute("href")).toBe("/kich-hoat?disc=1");
    expect(cta.textContent).toBe("Nhận kết quả vào tài khoản");
  });
  it("mã KHÔNG lọt vào bất kỳ liên kết nào (không lộ qua URL)", () => {
    const { container } = render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    for (const a of Array.from(container.querySelectorAll("a"))) expect(a.getAttribute("href") ?? "").not.toMatch(/ABCDE|FGHJK/);
  });
  it("ghi mã vào máy (để form nhận bài tự điền)", () => {
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBe("ABCDEFGHJK");
  });
  it("localStorage ném lỗi ⇒ màn vẫn hiện mã (mất bản trong máy cũng không sao)", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("chặn");
        },
        setItem: () => {
          throw new Error("chặn");
        },
      },
    });
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    expect(screen.getByTestId("disc-ma-nhan").textContent).toBe("ABCDE-FGHJK");
  });
  it("maNhan null ⇒ KHÔNG có ô mã, không ghi vào máy, CTA đổi nhãn, không chữ 'mã nhận kết quả của bạn'", () => {
    render(<ManThanhCong thongBao={TB} maNhan={null} onLamLai={() => {}} />);
    expect(screen.queryByTestId("disc-ma-nhan-khung")).toBeNull();
    expect(screen.queryByTestId("disc-ma-nhan")).toBeNull();
    expect(screen.queryByText(/Mã nhận kết quả của bạn/)).toBeNull();
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBeNull();
    expect(screen.getByTestId("disc-nhan-ket-qua").textContent).toBe("Kích hoạt hoặc đăng nhập để xem lại");
    expect(screen.getByTestId("disc-nhan-ket-qua").getAttribute("href")).toBe("/kich-hoat?disc=1");
  });
  it("không truyền maNhan (mặc định) ⇒ coi như null, không dựng ô mã", () => {
    render(<ManThanhCong thongBao={TB} onLamLai={() => {}} />);
    expect(screen.queryByTestId("disc-ma-nhan-khung")).toBeNull();
  });
});

describe("[DISC-MN-02] nút chép mã", () => {
  it("chép thành công ⇒ writeText nhận ĐÚNG chuỗi hiển thị và báo 'Đã chép'", async () => {
    const writeText = vi.fn(async () => {});
    datClipboard(writeText);
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    fireEvent.click(screen.getByTestId("disc-ma-nhan-chep"));
    await waitFor(() => expect(screen.getByTestId("disc-ma-nhan-chep-tb").textContent).toMatch(/Đã chép/));
    expect(writeText).toHaveBeenCalledWith("ABCDE-FGHJK");
    expect(screen.getByTestId("disc-ma-nhan-chep").textContent).toBe("Đã chép mã");
  });
  it("clipboard bị từ chối ⇒ KHÔNG nói 'đã chép'; hướng dẫn chép tay", async () => {
    datClipboard(async () => {
      throw new Error("không có quyền");
    });
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    fireEvent.click(screen.getByTestId("disc-ma-nhan-chep"));
    await waitFor(() => expect(screen.getByTestId("disc-ma-nhan-chep-tb").textContent).toMatch(/không cho chép tự động/));
    expect(screen.getByTestId("disc-ma-nhan-chep").textContent).toBe("Chép mã");
    expect(screen.getByTestId("disc-ma-nhan-chep-tb").textContent).not.toMatch(/Đã chép vào/);
  });
  it("không có navigator.clipboard ⇒ vẫn không văng, báo chép tay", async () => {
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    fireEvent.click(screen.getByTestId("disc-ma-nhan-chep"));
    await waitFor(() => expect(screen.getByTestId("disc-ma-nhan-chep-tb").textContent).toMatch(/không cho chép tự động/));
  });
  it("vùng báo kết quả chép là role=status (trình đọc màn hình nghe được)", () => {
    render(<ManThanhCong thongBao={TB} maNhan="ABCDEFGHJK" onLamLai={() => {}} />);
    expect(screen.getByTestId("disc-ma-nhan-chep-tb").getAttribute("role")).toBe("status");
  });
});

describe("[DISC-MN-03] nội dung thông báo của server được giữ nguyên", () => {
  it("chỉ có dòng email khi server gửi email", () => {
    const { rerender } = render(<ManThanhCong thongBao={TB} maNhan={null} onLamLai={() => {}} />);
    expect(screen.queryByTestId("disc-tb-email")).toBeNull();
    rerender(<ManThanhCong thongBao={{ chinh: "c", email: "Đã gửi tới a***@gmail.com." }} maNhan={null} onLamLai={() => {}} />);
    expect(screen.getByTestId("disc-tb-email").textContent).toBe("Đã gửi tới a***@gmail.com.");
  });
});
