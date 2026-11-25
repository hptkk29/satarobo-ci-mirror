"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeOwnPasswordAction } from "./_actions";

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
    <form onSubmit={submit} style={{ display: "grid", gap: "14px" }}>
      <div className="fld">
        <label htmlFor="dm-moi">Mật khẩu mới</label>
        <input
          id="dm-moi"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          maxLength={72}
          required
          autoFocus
          placeholder="Tối thiểu 8 ký tự"
          className="inp"
        />
      </div>
      <div className="fld">
        <label htmlFor="dm-lai">Nhập lại mật khẩu mới</label>
        <input
          id="dm-lai"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          maxLength={72}
          required
          placeholder="Nhập lại để xác nhận"
          className="inp"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-acc"
        style={{ width: "100%", minHeight: "54px" }}
      >
        {pending ? "Đang lưu…" : "Đổi mật khẩu & tiếp tục"}
      </button>
    </form>
  );
}
