"use client";

// Tab "Chính sách & cổng PROD". Agent PROD chỉ phục vụ khi CẢ HAI khoá mở: ai.prodEnabled = bật VÀ ai.consentPolicyStatus = APPROVED (OD-08).
// Hệ thống KHÔNG tự phê duyệt chính sách: người có quyền ai-leads:policy (Quản trị tối cao) đổi ở đây, có lý do, có nhật ký.
import { useState } from "react";
import Link from "next/link";
import type { CauHinhView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { doiChinhSachAction } from "../_actions";
import { NhanDon } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";
import { LOP_O_CHON, LOP_THE } from "../../_components/lop";

export function ChinhSach({ chinhSach, coQuyenChinhSach }: { chinhSach: CauHinhView["chinhSach"]; coQuyenChinhSach: boolean }) {
  const { prodEnabled, consentPolicyStatus, congProd } = chinhSach;
  const [trangThaiMoi, datTrangThaiMoi] = useState<"PENDING_LEGAL" | "APPROVED">(consentPolicyStatus === "APPROVED" ? "PENDING_LEGAL" : "APPROVED");

  return (
    <div className="grid gap-5">
      <section className={LOP_THE} aria-labelledby="cp-cong">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cp-cong" className="text-base font-semibold">
            Cổng PROD
          </h2>
          <NhanDon tone={congProd.allowed ? "info" : "warning"}>{congProd.allowed ? "Đang MỞ" : "Đang ĐÓNG"}</NhanDon>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {congProd.allowed
            ? "Cả hai điều kiện đã đạt: Agent môi trường PROD được phục vụ."
            : `Agent PROD bị chặn (503 NOT_CONFIGURED) — chờ chủ dự án: còn thiếu ${congProd.thieu.join(", ")}.`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Agent TEST không đi qua cổng này.</p>
      </section>

      <section className={LOP_THE} aria-labelledby="cp-prod">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cp-prod" className="text-base font-semibold">
            Cho phép Agent PROD gửi hồ sơ
          </h2>
          <NhanDon tone={prodEnabled ? "info" : "muted"}>{prodEnabled ? "Bật" : "Tắt"}</NhanDon>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Khoá <code className="font-mono">ai.prodEnabled</code>. Bật khi chính sách chưa duyệt vẫn KHÔNG mở được cổng — cần cả hai.
        </p>
        {coQuyenChinhSach ? (
          <div className="mt-3">
            <NutLyDo
              nhan={prodEnabled ? "Tắt cho phép PROD" : "Bật cho phép PROD"}
              tieuDe={prodEnabled ? "Tắt cho phép Agent PROD?" : "Bật cho phép Agent PROD?"}
              moTa={prodEnabled ? "Agent PROD bị chặn ngay từ yêu cầu kế tiếp." : "Chỉ có tác dụng khi chính sách đồng ý liên hệ cũng đã được duyệt (APPROVED)."}
              nhanXacNhan={prodEnabled ? "Tắt" : "Bật"}
              nguyHiem={!prodEnabled}
              thongBaoXong="Đã đổi cài đặt."
              chay={(lyDo) => doiChinhSachAction({ key: "ai.prodEnabled", value: !prodEnabled, lyDo })}
            />
          </div>
        ) : null}
      </section>

      <section className={LOP_THE} aria-labelledby="cp-dy">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cp-dy" className="text-base font-semibold">
            Chính sách đồng ý liên hệ & lưu dữ liệu
          </h2>
          <NhanDon tone={consentPolicyStatus === "APPROVED" ? "info" : "warning"}>{consentPolicyStatus === "APPROVED" ? "Đã duyệt" : "Chờ pháp lý"}</NhanDon>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Khoá <code className="font-mono">ai.consentPolicyStatus</code>. Mặc định “Chờ pháp lý”. Chỉ đặt “Đã duyệt” khi chính sách đã được chủ dự án và pháp lý chấp thuận bằng văn bản.
        </p>
        {coQuyenChinhSach ? (
          <div className="mt-3">
            <NutLyDo
              nhan="Đổi trạng thái chính sách…"
              tieuDe="Đổi trạng thái chính sách đồng ý?"
              moTa="Thay đổi này ảnh hưởng điều kiện mở cổng PROD và được ghi nhật ký kèm người đổi."
              nhanXacNhan="Đổi trạng thái"
              thongBaoXong="Đã đổi cài đặt."
              truongThem={
                <div className="grid gap-1.5">
                  <label htmlFor="cp-moi" className="text-sm font-medium">
                    Trạng thái mới
                  </label>
                  <select id="cp-moi" className={LOP_O_CHON} value={trangThaiMoi} onChange={(e) => datTrangThaiMoi(e.target.value as "PENDING_LEGAL" | "APPROVED")}>
                    <option value="PENDING_LEGAL">Chờ pháp lý</option>
                    <option value="APPROVED">Đã duyệt</option>
                  </select>
                </div>
              }
              kiemThem={() => (trangThaiMoi === consentPolicyStatus ? "Chọn một trạng thái KHÁC trạng thái hiện tại." : null)}
              chay={(lyDo) => doiChinhSachAction({ key: "ai.consentPolicyStatus", value: trangThaiMoi, lyDo })}
            />
          </div>
        ) : null}
      </section>

      {!coQuyenChinhSach ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Bạn chỉ xem được trạng thái. Đổi cổng PROD cần quyền <code className="font-mono">ai-leads:policy</code> (hiện chỉ Quản trị tối cao). Muốn xin quyền, liên hệ quản trị hệ thống.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Lưu ý: ghi hai khoá này còn đòi tài khoản Quản trị tối cao (cổng của Cấu hình vận hành) — cấp thêm <code className="font-mono">ai-leads:policy</code> cho vai khác chưa đủ để họ đổi được. Các tham số khác (nhịp,
          hạn mức, TTL…) chỉnh ở{" "}
          <Link href="/cau-hinh-van-hanh" className="underline underline-offset-2">
            Cấu hình vận hành
          </Link>
          .
        </p>
      )}
    </div>
  );
}
