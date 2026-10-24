// components/admin/nguon-hoa-hong/giai-thich-noi-dung.tsx — CHỮ + KHUNG của «vì sao 0đ» (Hướng G). Thuần trình bày, không state, dùng chung cho:
//   · mục «Vai không phát sinh tiền ở khoản này» trong ngăn «Vì sao» (vi-sao-noi-dung.tsx),
//   · ngăn riêng mở từ một dòng của góc nhìn «Không đủ điều kiện» (giai-thich-sheet.tsx),
//   · dòng «Khoản ngoài cửa sổ» ở chi tiết nguồn.
//
// Yêu cầu chủ dự án: «Không để user chỉ thấy tổng giảm 1% mà không biết lý do» ⇒ MỘT khối nói đủ năm điều, theo thứ tự đọc:
//   Nguồn · Chính sách và tỉ lệ · Điều kiện · Lý do (kèm mã máy) · Hoa hồng 0đ (kèm «Lẽ ra»).
//
// Thiết kế: «Không đủ điều kiện» là kết quả BÌNH THƯỜNG và tất định của luật cửa sổ, không phải lỗi hay việc cần xử lý ⇒ chip TRUNG TÍNH (muted), không đỏ/cam. 0đ là chữ mờ `tabular-nums`;
// «Lẽ ra» là dòng phụ, nói rõ KHÔNG phải khoản nợ. Mã máy là dữ liệu nên dùng `code` cỡ nhỏ, một dòng riêng.
import Link from "next/link";

import { StatusPill } from "@/components/admin/ui/status-pill";
import type { NhanGiaiThich } from "@/lib/hoa-hong/giai-thich-khong-tien";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { soVN } from "./nhan-nguon";

export function ChipKhongDuDieuKien({ className }: { className?: string }) {
  return <StatusPill tone="muted" className={className}>Không đủ điều kiện</StatusPill>;
}

/** Danh sách định nghĩa dọc, cùng khuôn với thân ngăn «Vì sao»: cột nhãn 9rem ở màn rộng, xếp dọc ở 375px. */
export function GiaiThichBang({ nhan, className }: { nhan: NhanGiaiThich; className?: string }) {
  return (
    <dl data-giai-thich="" className={cn("grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[9rem_minmax(0,1fr)]", className)}>
      <Dong nhan="Nguồn">{nhan.nguon}</Dong>
      <Dong nhan="Chính sách">{nhan.chinhSach}</Dong>
      <Dong nhan="Điều kiện">
        <ChipKhongDuDieuKien />
      </Dong>
      <Dong nhan="Lý do">
        {nhan.lyDo}
        <code className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{nhan.lyDoMa}</code>
      </Dong>
      <Dong nhan="Hoa hồng">
        <span className="tabular-nums text-muted-foreground">{nhan.hoaHong}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {nhan.leRa} <span aria-hidden>·</span> không phải khoản nợ
        </span>
      </Dong>
    </dl>
  );
}

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-sm text-muted-foreground sm:pt-px">{nhan}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Một vai không phát sinh tiền: tên vai · người, rồi khối năm điều. Dùng trong danh sách của ngăn «Vì sao». */
export function VaiKhongPhatSinhView({ vai, nguoiHuong, nhan }: { vai: string; nguoiHuong: string | null; nhan: NhanGiaiThich }) {
  return (
    <li data-vai-khong-phat-sinh="">
      <p className="mb-2 text-sm font-medium text-foreground">
        {vai}
        {nguoiHuong ? <span className="font-normal text-muted-foreground"> · {nguoiHuong}</span> : null}
      </p>
      <GiaiThichBang nhan={nhan} />
      {nhan.thayThe && <p className="mt-2 text-xs text-muted-foreground">{nhan.thayThe}</p>}
    </li>
  );
}

/**
 * Dòng ở chi tiết nguồn: «Khoản ngoài cửa sổ: N khoản, lẽ ra X». Chỉ vẽ khi N > 0. `href` = góc nhìn «Không đủ điều kiện» đã lọc theo nguồn; `null` ⇒ không có đường dẫn
 * (bộ máy hoa hồng tắt ⇒ tab Sổ 404) — vẫn nói con số, không vẽ liên kết chết.
 */
export function DongKhoanNgoaiCuaSo({ soKhoan, leRa, href }: { soKhoan: number; leRa: number; href: string | null }) {
  if (soKhoan <= 0) return null;
  return (
    <p data-ngoai-cua-so="" className="mt-2 text-sm text-foreground">
      Khoản ngoài cửa sổ ghi công: <span className="font-semibold tabular-nums">{soVN(soKhoan)}</span> khoản, hoa hồng thu hút 0đ — lẽ ra{" "}
      <span className="font-semibold tabular-nums">{dinhDangDong(leRa)}</span> <span className="text-xs text-muted-foreground">(không phải khoản nợ).</span>{" "}
      {href && (
        <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2 hover:no-underline sm:min-h-0">
          Xem các khoản này
        </Link>
      )}
    </p>
  );
}
