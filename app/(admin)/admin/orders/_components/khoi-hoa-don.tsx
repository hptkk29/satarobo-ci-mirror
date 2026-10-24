"use client";

import { useEffect } from "react";
import { Download, Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToneDong } from "@/lib/finance/hoa-don/dong-hang-cho";
import type { DongHoaDonDon, KhoiHoaDonDon } from "@/lib/finance/hoa-don/khoi-hoa-don-don";

/**
 * Khối "Hoá đơn điện tử" ở cột phải trang chi tiết đơn (GĐ 7, docs/ke-toan-hoa-don/PLAN.md §8).
 *
 * Người đọc là SALE, không phải kế toán: câu họ hỏi là "khách đã có hoá đơn chưa, và nếu email không
 * tới được thì tôi lấy tệp ở đâu để gửi Zalo". Nên khối chỉ ĐỌC — mỗi lần thu một mục, trạng thái
 * nói bằng lời của hoá đơn, và nút tải nằm ngay dưới dòng báo email hỏng.
 *
 * Dữ liệu đã dựng + che ở server (`lib/finance/hoa-don/khoi-hoa-don-don.ts`); component này không
 * quyết định gì về quyền: `taiPdf`/`taiXml` là `null` thì không vẽ nút, vì route sẽ từ chối.
 *
 * Danh sách, KHÔNG bảng: cột phải rộng 20rem — một bảng 5 cột ở đó là cuộn ngang.
 */

const CHU: Record<ToneDong, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  muted: "text-muted-foreground",
};

const CHAM: Record<ToneDong, string> = {
  success: "bg-state-success",
  warning: "bg-state-warning",
  danger: "bg-state-danger",
  info: "bg-state-info",
  muted: "bg-muted-foreground/50",
};

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

function MucLanThu({ d }: { d: DongHoaDonDon }) {
  const moTa = [`Thu ${d.ngayThuLabel}`, d.nhanDot, d.nguonLabel].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums text-foreground">{tien(d.soTien)}</p>
        <p className="break-words text-xs text-muted-foreground">{moTa}</p>
      </div>

      <p className={cn("flex items-start gap-2 text-sm font-medium", CHU[d.tone])}>
        <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", CHAM[d.tone])} />
        <span className="min-w-0 break-words">{d.nhan}</span>
      </p>

      {d.huyTruoc ? <p className="break-words text-xs text-state-danger-ink">{d.huyTruoc}</p> : null}

      {d.soHoaDon ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          Hoá đơn {d.soHoaDon}
          {d.ngayPhatHanhLabel ? ` · ngày ${d.ngayPhatHanhLabel}` : ""}
        </p>
      ) : null}

      {d.lyDoKhongXuat ? (
        <p className="break-words text-xs text-muted-foreground">Kế toán ghi: {d.lyDoKhongXuat}</p>
      ) : null}

      {d.taiPdf || d.taiXml ? (
        <div className="flex flex-wrap gap-2">
          {d.taiPdf ? (
            <a
              href={d.taiPdf}
              target="_blank"
              rel="noopener"
              aria-label={`Tải PDF hoá đơn ${d.soHoaDon ?? ""}`.trim()}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download aria-hidden /> Tải PDF
            </a>
          ) : null}
          {d.taiXml ? (
            <a
              href={d.taiXml}
              target="_blank"
              rel="noopener"
              aria-label={`Tải XML hoá đơn ${d.soHoaDon ?? ""}`.trim()}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download aria-hidden /> Tải XML
            </a>
          ) : null}
        </div>
      ) : null}

      {d.lyDoKhongTai ? (
        // Xuất ở MISA là chuyện BÌNH THƯỜNG (hoá đơn cũ) — màu nhạt; các lý do khác là trục trặc cần báo.
        <p
          className={cn(
            "text-xs",
            d.trangThai === "DA_XUAT_NGOAI" ? "text-muted-foreground" : "text-state-warning-ink",
          )}
        >
          {d.lyDoKhongTai}
        </p>
      ) : null}

      {d.email ? (
        <div className={cn("flex items-start gap-2 text-xs", CHU[d.email.tone])}>
          <Mail aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="break-words">{d.email.nhan}</p>
            {d.email.chiTiet ? (
              <p className="mt-0.5 break-words text-muted-foreground">{d.email.chiTiet}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function KhoiHoaDon({ khoi }: { khoi: KhoiHoaDonDon }) {
  const canXuat = khoi.dong.filter((d) => d.trangThai !== "KHONG_XUAT");
  const daXuat = canXuat.filter((d) => d.trangThai === "DA_XUAT" || d.trangThai === "DA_XUAT_NGOAI").length;
  const trong = khoi.dong.length === 0 && khoi.thieuCoSo === 0 && khoi.lichSu === 0;

  // Thông báo "hoá đơn chưa gửi được" trỏ `/orders/<id>#hoa-don`. Đi bằng điều hướng trong app thì
  // khung chờ (`loading.tsx`) nhận neo lúc khối CHƯA có ⇒ trình duyệt không cuộn; hỏi lại khi khối
  // đã gắn. Hiệu ứng DOM thuần, không lấy dữ liệu.
  useEffect(() => {
    if (window.location.hash === "#hoa-don") {
      document.getElementById("hoa-don")?.scrollIntoView({ block: "start" });
    }
  }, []);

  return (
    <section
      id="hoa-don"
      aria-labelledby="hoa-don-tieu-de"
      className="scroll-mt-4 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="hoa-don-tieu-de"
          className="text-sm font-bold uppercase tracking-wider text-muted-foreground"
        >
          Hoá đơn điện tử
        </h2>
        {canXuat.length > 0 ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {daXuat}/{canXuat.length} lần thu đã có hoá đơn
          </p>
        ) : null}
      </div>

      {khoi.thieuCoSo > 0 ? (
        <p className="mb-3 rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Đơn chưa gắn cơ sở nên {khoi.thieuCoSo} khoản thu chưa lên hoá đơn được — báo quản lý cơ sở
          gắn cơ sở cho đơn.
        </p>
      ) : null}

      {khoi.lichSu > 0 ? (
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {khoi.lichSu} khoản thu từ trước khi lên hệ thống — hoá đơn (nếu có) kế toán đã xuất ngoài hệ
          thống; cần bản thì nhờ kế toán gửi.
        </p>
      ) : null}

      {trong ? (
        <p className="text-sm text-muted-foreground">
          Chưa có khoản thu nào cần hoá đơn. Hoá đơn được xuất theo từng lần thu, sau khi tiền về.
        </p>
      ) : null}

      {khoi.dong.length > 0 ? (
        <ul className="divide-y divide-border">
          {khoi.dong.map((d) => (
            <MucLanThu key={d.key} d={d} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
