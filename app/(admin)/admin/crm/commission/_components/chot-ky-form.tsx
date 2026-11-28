"use client";

// Màn chốt kỳ hoa hồng — vế NGƯỜI DÙNG của chính sách "hoa hồng trên tiền đã thu".
//
// Chỗ đáng chú ý nhất không phải cái nút, mà là khối kết quả: nó NÓI RA phần tiền
// KHÔNG chi được vì tầng chưa có người hưởng. Nuốt con số đó đi thì kế toán chốt kỳ
// xong sẽ tưởng đã trả đủ 8%, trong khi thực tế mới trả 5%.
//
// 27/08/2026 — QC 1% và QL TT 2% ĐÃ có nguồn người hưởng (`/admin/crm/commission/nguoi-huong`).
// Nên câu chữ ở khối treo phải đổi theo: trước đây nó nói "hệ thống không có dữ liệu,
// cần BGĐ chốt" — nay dữ liệu có rồi, việc còn lại là ĐI KHAI, và màn hình phải chỉ
// đúng CƠ SỞ NÀO còn thiếu chứ không chỉ đưa ra một con số tổng.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chotKyHoaHongAction } from "../actions";
import type { KetQuaChotKy } from "@/lib/crm/commission-run";

const NHAN_TANG: Record<string, string> = {
  QC: "Quảng cáo (QC)",
  SALE_ADMIN: "Sale Admin",
  SALE: "Sale",
  QL_TT: "Quản lý TT",
};

/** Kỳ mặc định = THÁNG TRƯỚC (giờ VN): chốt kỳ luôn là chốt tháng đã đóng sổ. */
function kyThangTruoc(): string {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth(); // 0-based ⇒ chính là tháng trước dạng 1-based
  const d = m === 0 ? { y: y - 1, m: 12 } : { y, m };
  return `${d.y}-${String(d.m).padStart(2, "0")}`;
}

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

export function ChotKyForm({
  // 27/08/2026 — `commission_periods:manage`, tính ở Server Component cha. Đây là
  // client nên prop này CHỈ để không vẽ ô nhập bấm không được; cổng thật ở Server Action.
  canChotKy,
}: {
  canChotKy: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(kyThangTruoc());
  const [ketQua, setKetQua] = useState<KetQuaChotKy | null>(null);
  const [pending, start] = useTransition();

  function chot() {
    start(async () => {
      const res = await chotKyHoaHongAction(period, `Chốt kỳ ${period} qua UI`);
      if (res.ok) {
        setKetQua(res.ketQua);
        toast.success(`Đã chốt kỳ ${period}: ${res.ketQua.soDong} dòng`);
        router.refresh();
      } else {
        setKetQua(null);
        toast.error(res.error);
      }
    });
  }

  const treo = ketQua
    ? Object.entries(ketQua.chuaCoNguoiHuong).filter(([, v]) => v !== 0)
    : [];

  return (
    <div className="mb-6 rounded-lg border p-4">
      <h2 className="mb-1 text-lg font-bold">Chốt kỳ từ tiền đã thu</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Hoa hồng tính trên <strong>số tiền thực thu trong tháng</strong> (không phải giá trị hợp
        đồng). Khoản hoàn tiền sinh dòng thu hồi âm ở <strong>tháng hoàn</strong>. Chốt lại một kỳ
        chưa duyệt là an toàn — hệ thống ghi đè cả kỳ, không cộng dồn.
      </p>

      {canChotKy ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Kỳ (tháng)</span>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-44"
            />
          </label>
          <Button onClick={chot} disabled={pending || !/^\d{4}-\d{2}$/.test(period)}>
            {pending ? "Đang tính…" : "Chốt kỳ"}
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-muted/50 p-2 text-sm text-muted-foreground">
          Bạn xem được bảng hoa hồng nhưng không chốt/duyệt kỳ được — kỳ hoa hồng là kỳ
          của TOÀN CÔNG TY, chỉ kế toán Hội sở và quản trị hệ thống chốt được. Cần chốt
          kỳ thì báo kế toán Hội sở.
        </p>
      )}

      {ketQua ? (
        <div className="mt-4 space-y-2 rounded-md bg-muted/50 p-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              Bút toán thực thu: <strong>{ketQua.soButToan}</strong>
            </span>
            <span>
              Số dòng: <strong>{ketQua.soDong}</strong>
            </span>
            <span>
              Tổng hoa hồng: <strong>{tien(ketQua.tongTien)}</strong>
            </span>
            {ketQua.tongThuHoi !== 0 ? (
              <span className="text-destructive">
                Thu hồi do hoàn tiền: <strong>{tien(ketQua.tongThuHoi)}</strong>
              </span>
            ) : null}
          </div>

          {treo.length > 0 ? (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
              <p className="font-medium">Chưa chi được — tầng chưa có người hưởng:</p>
              <ul className="ml-4 list-disc">
                {treo.map(([tier, v]) => (
                  <li key={tier}>
                    {NHAN_TANG[tier] ?? tier}: <strong>{tien(v as number)}</strong>
                  </li>
                ))}
              </ul>

              {ketQua.treoTheoCoSo.length > 0 ? (
                <>
                  <p className="mt-2 font-medium">Cơ sở còn thiếu:</p>
                  <ul className="ml-4 list-disc">
                    {ketQua.treoTheoCoSo.map((t) => (
                      <li key={`${t.centerId ?? "none"}|${t.tier}`}>
                        {t.centerId
                          ? (ketQua.tenCoSo[t.centerId] ?? t.centerId)
                          : "Không rõ cơ sở (bút toán không quy được về cơ sở nào)"}{" "}
                        — {NHAN_TANG[t.tier] ?? t.tier}: <strong>{tien(t.amount)}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <p className="mt-1 text-xs text-muted-foreground">
                Khai người phụ trách tại{" "}
                <Link href="/crm/commission/nguoi-huong" className="font-medium underline">
                  Người hưởng hoa hồng theo cơ sở
                </Link>{" "}
                rồi <strong>chốt lại kỳ này</strong> — phần treo sẽ chảy vào bảng kê. Hệ thống cố ý
                KHÔNG tự đoán người hưởng: gán bừa là chuyển tiền thật vào tài khoản sai, và sai
                theo kiểu con số vẫn &quot;đẹp&quot; nên không ai soi ra. Dòng &quot;không rõ cơ
                sở&quot; thì phải sửa cơ sở của phiếu thu/đơn hàng trước.
              </p>
            </div>
          ) : null}

          {ketQua.thucThuKhongCoLead !== 0 ? (
            <p className="text-muted-foreground">
              Thực thu không quy được về phiếu nào (khách vãng lai):{" "}
              <strong>{tien(ketQua.thucThuKhongCoLead)}</strong> — không sinh hoa hồng.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
