"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeOwnPasswordAction } from "./_actions";

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    startTransition(async () => {
      const res = await changeOwnPasswordAction({ newPassword, confirmPassword });
      if (res.ok) {
        toast.success("Đã đổi mật khẩu — chào mừng bạn!");
        // TẢI LẠI TRANG, không `router.push`. Bản cũ push rồi refresh và người dùng
        // kẹt lại đây, phải tự F5 mới vào được khu làm việc.
        //
        // Vì sao: lúc đăng nhập bằng mật khẩu tạm, client ĐÃ điều hướng tới
        // `/dashboard` một lần và bị layout admin đá về đây (cờ `mustChangePassword`).
        // Router Cache của Next giữ lại kết quả đó cho URL `/dashboard`. Đổi mật khẩu
        // xong, `router.push("/dashboard")` ăn đúng bản đã nhớ ⇒ bật ngược về trang
        // này; `router.refresh()` gọi SAU nên đã muộn. F5 xoá Router Cache nên tay thì
        // được — đúng triệu chứng người dùng báo.
        //
        // Cũng là cách `portal/ho-so` làm sau khi đổi mật khẩu: cờ vừa đổi là thứ mọi
        // layout gác cửa đọc, nên nạp lại nguyên trang vừa chắc vừa đúng nghĩa —
        // sidebar, danh sách vai, quyền đều dựng lại từ đầu.
        window.location.assign("/dashboard");
      } else {
        toast.error(res.error ?? "Lỗi đổi mật khẩu");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Mật khẩu mới</span>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          maxLength={72}
          required
          autoFocus
          placeholder="Tối thiểu 8 ký tự"
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Nhập lại mật khẩu mới</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          maxLength={72}
          required
          placeholder="Nhập lại để xác nhận"
          className={inputCls}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
      >
        {pending ? "Đang lưu…" : "Đổi mật khẩu & tiếp tục"}
      </button>
    </form>
  );
}
