// @vitest-environment jsdom
/**
 * FORM ĐĂNG NHẬP — ba lời hứa, cả ba đều hứa suông được mà không test nào đỏ (luật 12):
 *  1. Ô định danh/mật khẩu TẮT tự viết hoa + tự sửa (bàn phím điện thoại làm "Abc@…" ≠ "abc@…";
 *     email so khớp phân biệt hoa/thường ở `lib/auth.ts`).
 *  2. signIn BÁO OK nhưng trình duyệt không giữ cookie phiên (trình duyệt nhúng Zalo/Facebook)
 *     ⇒ KHÔNG được chuyển trang: chuyển là bị proxy đá ngược về /login, form hiện lại y nguyên,
 *     người dùng bấm tiếp tới lần thứ 6 thì chạm rate-limit và thấy "sai mật khẩu".
 *  3. signIn ném lỗi (mất mạng) ⇒ nút không được kẹt ở trạng thái đang tải.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (p: any) => <span data-src={p.src} />,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const signIn = vi.fn();
const getSession = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...a: unknown[]) => signIn(...a),
  getSession: (...a: unknown[]) => getSession(...a),
}));

import { LoginForm } from "./login-form";

function dienVaBam() {
  fireEvent.change(document.getElementById("identifier")!, { target: { value: "gv@satarobo.vn" } });
  fireEvent.change(document.getElementById("password")!, { target: { value: "matkhau123" } });
  fireEvent.click(screen.getByRole("button", { name: /Đăng nhập/ }));
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  signIn.mockReset();
  getSession.mockReset();
});
afterEach(cleanup);

describe("LoginForm", () => {
  it("[LGF-01] hai ô tắt tự viết hoa / tự sửa", () => {
    render(<LoginForm />);
    for (const id of ["identifier", "password"]) {
      const el = document.getElementById(id)!;
      expect(el.getAttribute("autocapitalize"), id).toBe("none");
      expect(el.getAttribute("autocorrect"), id).toBe("off");
      expect(el.getAttribute("spellcheck"), id).toBe("false");
    }
  });

  it("[LGF-02] signIn OK + có phiên ⇒ chuyển trang", async () => {
    signIn.mockResolvedValue({ error: undefined, ok: true });
    getSession.mockResolvedValue({ user: { id: "u1" } });
    render(<LoginForm />);
    dienVaBam();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("[LGF-03] signIn OK nhưng KHÔNG có phiên ⇒ không chuyển trang, báo lỗi phiên", async () => {
    signIn.mockResolvedValue({ error: undefined, ok: true });
    getSession.mockResolvedValue(null);
    render(<LoginForm />);
    dienVaBam();
    await waitFor(() => expect(screen.getByText(/Không tạo được phiên/)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });

  it("[LGF-04] signIn ném lỗi ⇒ báo mạng và nút hết kẹt", async () => {
    signIn.mockRejectedValue(new Error("network"));
    render(<LoginForm />);
    dienVaBam();
    await waitFor(() => expect(screen.getByText(/Không kết nối được/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /Đăng nhập/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[LGF-05] sai thông tin vẫn hiện câu cũ", async () => {
    signIn.mockResolvedValue({ error: "CredentialsSignin", code: "credentials" });
    render(<LoginForm />);
    dienVaBam();
    await waitFor(() => expect(screen.getByText(/mật khẩu không đúng/)).toBeTruthy());
    expect(getSession).not.toHaveBeenCalled();
  });
});
