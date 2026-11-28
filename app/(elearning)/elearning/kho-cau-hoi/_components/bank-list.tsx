"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/admin/ui/states";
import { Checkbox } from "@/components/ui/checkbox";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { nhanLoaiCau } from "@/lib/elearning/nhan-loai-cau";
import { GhiChu, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG } from "../../_components/ui/trang";
import { NUT_CHINH, NUT_NHO, NUT_PHU, O_NHAP_GOC } from "../../_components/ui/dieu-khien";
import { ThanhChonNhieu } from "../../_components/ui/thanh-chon-nhieu";
import { useChonNhieu } from "../../_components/ui/use-chon-nhieu";
import { chuyenNhanhCauHoiAction, nhanBanCauHoiAction } from "../_actions";
import { QuestionForm, type CauHoiHienCo } from "./question-form";

/**
 * EL-14b + P8 — DANH SÁCH KHO CÂU HỎI (thiết kế `QtCauHoi`): bảng Câu hỏi · Dạng · Độ khó · % đúng, chọn nhiều → Chuyển nhánh / Nhân bản.
 *
 * ⚠️ `xemNoiDung` quyết định người này có thấy ĐỀ BÀI và ĐÁP ÁN không. Nó được cắt
 * ở SERVER (trang không gửi nội dung xuống nếu thiếu quyền), còn ở đây chỉ là vẽ.
 * Ẩn bằng CSS là để nội dung nằm trong HTML — mở F12 ra là đọc được, và cả kho câu
 * hỏi mất giá trị.
 *
 * Thao tác hàng loạt chỉ vẽ khi `xemNoiDung` (người không thấy nội dung không chọn được gì) và id gửi lên chỉ là TIỆN LỢI: server kiểm `can()` + `scopedDb`
 * trên TỪNG id, tất cả hoặc không câu nào.
 */

const NHAN_KHO: Record<string, string> = {
  EASY: "Dễ",
  MEDIUM: "Trung bình",
  HARD: "Khó",
};

/** Trần chọn một lượt = trần nhỏ nhất của hai thao tác (nhân bản tối đa 50 câu/lượt). */
const TRAN_CHON = 50;

export type DongKho = {
  id: string;
  bankPath: string;
  type: string;
  difficulty: string;
  defaultPoints: number;
  /** `null` khi người xem không có quyền thấy nội dung. */
  stem: string | null;
  daVaoDe: boolean;
  /** Số đề đang dùng câu này. */
  soDe: number;
  /** `null` khi chưa đủ lượt để kết luận (< 5) — KHÔNG phải 0%. */
  tiLeDung: number | null;
  chiTiet: CauHoiHienCo | null;
};

export function BankList(props: {
  dong: DongKho[];
  xemNoiDung: boolean;
  bankPathMacDinh: string;
  /** Các nhánh đang có — gợi ý cho ô "Chuyển nhánh". */
  nhanhCo: string[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [themMoi, setThemMoi] = useState(false);
  const [moChuyen, setMoChuyen] = useState(false);
  const [nhanhDich, setNhanhDich] = useState("");
  const chon = useChonNhieu(
    props.dong.map((d) => d.id),
    TRAN_CHON,
  );

  const nhanhHopLe = /^\/([a-z0-9-]+\/)+$/.test(nhanhDich.trim());

  const chuyen = () =>
    batDau(async () => {
      const r = await chuyenNhanhCauHoiAction({ questionIds: chon.idGui, bankPath: nhanhDich.trim() });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(`Đã chuyển ${r.data.soCau} câu sang ${nhanhDich.trim()}`);
      chon.boChon();
      setMoChuyen(false);
      setNhanhDich("");
      router.refresh();
    });

  const nhanBan = () =>
    batDau(async () => {
      const r = await nhanBanCauHoiAction({ questionIds: chon.idGui });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(`Đã nhân bản ${r.data.questionIds.length} câu — bản sao nằm cùng nhánh, sửa được tại chỗ`);
      chon.boChon();
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {props.xemNoiDung ? (
        themMoi ? (
          <QuestionForm bankPathMacDinh={props.bankPathMacDinh} onXong={() => setThemMoi(false)} />
        ) : null
      ) : (
        // Nói THẲNG vì sao trống, thay vì để họ tưởng kho chưa có gì.
        <GhiChu sac="info">
          Bạn xem được thống kê kho câu hỏi nhưng không xem được nội dung câu và đáp
          án — phần đó dành cho Đào tạo.
        </GhiChu>
      )}

      {props.xemNoiDung && !themMoi ? (
        <div className="flex justify-end">
          <button type="button" onClick={() => setThemMoi(true)} className={`${NUT_CHINH} inline-flex items-center gap-2`}>
            <Plus className="size-4" aria-hidden />
            Thêm câu hỏi
          </button>
        </div>
      ) : null}

      {props.xemNoiDung && props.dong.length > 0 ? (
        <ThanhChonNhieu chon={chon} tenDonVi="câu">
          {moChuyen ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <input
                value={nhanhDich}
                onChange={(e) => setNhanhDich(e.target.value)}
                list="nhanh-kho-cau-hoi"
                placeholder="/nhom-cha/nhom-con/"
                aria-label="Nhánh đích"
                className={`${O_NHAP_GOC} w-56 font-mono text-sm`}
              />
              <datalist id="nhanh-kho-cau-hoi">
                {props.nhanhCo.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <button type="button" disabled={dangChay || !nhanhHopLe} onClick={chuyen} className={NUT_CHINH}>
                {dangChay ? "Đang chuyển…" : "Chuyển"}
              </button>
              <button type="button" onClick={() => setMoChuyen(false)} className={NUT_PHU}>
                Thôi
              </button>
            </span>
          ) : (
            <>
              <button type="button" disabled={dangChay} onClick={() => setMoChuyen(true)} className={NUT_PHU}>
                Chuyển nhánh
              </button>
              <button type="button" disabled={dangChay} onClick={nhanBan} className={NUT_PHU}>
                {dangChay ? "Đang nhân bản…" : "Nhân bản"}
              </button>
            </>
          )}
        </ThanhChonNhieu>
      ) : null}

      {props.dong.length === 0 ? (
        <EmptyState
          title="Chưa có câu hỏi nào ở nhánh này"
          description={props.xemNoiDung ? "Bấm “Thêm câu hỏi” để soạn câu đầu tiên." : "Khi Đào tạo thêm câu hỏi, thống kê sẽ hiện ở đây."}
        />
      ) : (
        <PhanTrangBang cuonNgang tenDonVi="câu" soDongMacDinh={25}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className={THEAD_BANG}>
                {props.xemNoiDung ? (
                  <th scope="col" className={`${TH_BANG} w-10`}>
                    <span className="sr-only">Chọn</span>
                  </th>
                ) : null}
                <th scope="col" className={TH_BANG}>Câu hỏi</th>
                <th scope="col" className={TH_BANG}>Dạng</th>
                <th scope="col" className={TH_BANG}>Độ khó</th>
                <th scope="col" className={`${TH_BANG} text-right`}>% đúng</th>
                {props.xemNoiDung ? (
                  <th scope="col" className={TH_BANG}>
                    <span className="sr-only">Thao tác</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {props.dong.map((d) => (
                <Fragment key={d.id}>
                  <tr className={`${TR_BANG} align-top`}>
                    {props.xemNoiDung ? (
                      <td className={TD_BANG}>
                        <Checkbox
                          checked={chon.laChon(d.id)}
                          onCheckedChange={() => chon.doi(d.id)}
                          aria-label={`Chọn câu: ${d.stem ?? d.id}`}
                        />
                      </td>
                    ) : null}
                    <td className={TD_BANG}>
                      <span className={d.stem ? "block font-medium text-foreground" : "block italic text-muted-foreground"}>{d.stem ?? "(nội dung ẩn)"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {d.soDe > 0 ? `đã dùng trong ${d.soDe} đề · ` : ""}
                        <span className="font-mono">{d.bankPath}</span> · {d.defaultPoints} điểm
                      </span>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>{nhanLoaiCau(d.type)}</td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>{NHAN_KHO[d.difficulty] ?? d.difficulty}</td>
                    <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`} title={d.tiLeDung === null ? "Chưa đủ lượt để kết luận (cần ít nhất 5)" : undefined}>
                      {d.tiLeDung === null ? <span className="text-muted-foreground">—</span> : `${d.tiLeDung}%`}
                    </td>
                    {props.xemNoiDung ? (
                      <td className={`${TD_BANG} text-right`}>
                        {d.chiTiet ? (
                          <button
                            type="button"
                            onClick={() => setDangSua(d.id)}
                            // Câu đã vào đề thì server từ chối sửa. Khoá nút luôn để họ
                            // không gõ xong mới bị báo lỗi.
                            disabled={d.daVaoDe}
                            title={d.daVaoDe ? "Câu đã nằm trong đề — nhân bản thay vì sửa" : ""}
                            className={`${NUT_NHO} shrink-0`}
                          >
                            Sửa
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                  {dangSua === d.id && d.chiTiet ? (
                    <tr className={TR_BANG}>
                      <td className={TD_BANG} colSpan={props.xemNoiDung ? 6 : 4}>
                        <QuestionForm cauHienCo={d.chiTiet} bankPathMacDinh={props.bankPathMacDinh} onXong={() => setDangSua(null)} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </div>
  );
}
