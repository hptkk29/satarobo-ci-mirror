"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { tomTatKetQuaNhac } from "@/lib/elearning/nhac-hoc-pure";
import { TienDoDam } from "../../_components/ui/tien-do";
import { ThanhChonNhieu } from "../../_components/ui/thanh-chon-nhieu";
import { useChonNhieu } from "../../_components/ui/use-chon-nhieu";
import { NUT_CHINH, NUT_PHU } from "../../_components/ui/dieu-khien";
import { TD_BANG, TH_BANG, THEAD_BANG, TR_BANG } from "../../_components/ui/trang";
import { nhacHocAction } from "../_actions";

export type DongBang = {
  userId: string;
  ten: string;
  viet: string;
  ma: string;
  vaiTro: string;
  coSo: string;
  batBuoc: number;
  batBuocDat: number;
  coDangHoc: boolean;
  chuTre: string;
  sacTre: "danger" | "warning" | "muted";
  chungNhan: number;
  /** "09:12" nếu hôm nay đã nhắc thủ công. */
  daNhacLuc: string | null;
};

const MAU_TRE = { danger: "text-state-danger-ink", warning: "text-state-warning-ink", muted: "text-muted-foreground" } as const;

/**
 * Bảng "Người học" (client): chọn nhiều + "Nhắc học" từng người / cả nhóm. Mọi quyền và phạm vi do SERVER kiểm (`nhacHocAction`);
 * danh sách id ở đây chỉ là tiện lợi giao diện.
 */
export function NguoiHocBang({ dong, kieu, coNhac, coGiao }: { dong: DongBang[]; kieu: "can-chu-y" | "tat-ca"; coNhac: boolean; coGiao: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const chon = useChonNhieu(dong.map((d) => d.userId));

  const nhac = (ids: string[]) =>
    chuyen(async () => {
      const r = await nhacHocAction({ userIds: ids });
      if (!r.ok) return void toast.error(r.error.message);
      const t = tomTatKetQuaNhac(r.data);
      (t.sac === "success" ? toast.success : t.sac === "warning" ? toast.warning : toast.info)(t.chu);
      chon.boChon();
      router.refresh();
    });

  const hrefGiao = `/elearning/giao-bai?nguoi=${encodeURIComponent(chon.idGui.join(","))}`;
  return (
    <div className="space-y-3">
      <ThanhChonNhieu chon={chon} tenDonVi="người">
        {coNhac && (
          <button type="button" disabled={dangChay} onClick={() => nhac(chon.idGui)} className={kieu === "can-chu-y" ? NUT_CHINH : NUT_PHU}>
            {kieu === "can-chu-y" ? "Nhắc học người đã chọn" : "Nhắc học"}
          </button>
        )}
        {coGiao && (
          <Link href={hrefGiao} className="text-sm text-muted-foreground hover:text-foreground">
            Giao khoá
          </Link>
        )}
      </ThanhChonNhieu>
      <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={25}>
        <table className="w-full border-collapse">
          <thead className={THEAD_BANG}>
            <tr>
              <th className={TH_BANG}>Người</th>
              <th className={TH_BANG}>Cơ sở</th>
              <th className={TH_BANG}>Bắt buộc</th>
              <th className={TH_BANG}>Đang trễ</th>
              <th className={TH_BANG}>Chứng nhận</th>
              <th className={`${TH_BANG} text-right`}>
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => (
              <tr key={d.userId} className={TR_BANG}>
                <td className={TD_BANG}>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={chon.laChon(d.userId)} onCheckedChange={() => chon.doi(d.userId)} aria-label={`Chọn ${d.ten}`} />
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-medium text-foreground">
                      {d.viet}
                    </span>
                    <div className="min-w-0">
                      <Link href={`/elearning/nguoi-hoc/${d.userId}`} className="block truncate text-sm text-foreground hover:underline">
                        {d.ten}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{d.vaiTro}</span>
                    </div>
                  </div>
                </td>
                <td className={TD_BANG}>{d.coSo || "—"}</td>
                <td className={TD_BANG}>
                  {d.batBuoc === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <TienDoDam tong={d.batBuoc} xong={d.batBuocDat} dangHoc={d.coDangHoc ? d.batBuocDat : undefined} nhan={`${d.ten}: ${d.batBuocDat} trên ${d.batBuoc} khoá bắt buộc`} />
                  )}
                </td>
                <td className={`${TD_BANG} ${MAU_TRE[d.sacTre]}`}>{d.chuTre}</td>
                <td className={TD_BANG}>{d.chungNhan}</td>
                <td className={`${TD_BANG} text-right`}>
                  {kieu === "tat-ca" ? (
                    <Link href={`/elearning/nguoi-hoc/${d.userId}`} className="text-sm text-muted-foreground hover:text-foreground">
                      Xem
                    </Link>
                  ) : d.daNhacLuc ? (
                    <span className="text-sm text-muted-foreground">Đã nhắc {d.daNhacLuc}</span>
                  ) : coNhac ? (
                    <button type="button" disabled={dangChay} onClick={() => nhac([d.userId])} className={NUT_PHU}>
                      Nhắc học
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
