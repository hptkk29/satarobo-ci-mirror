"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import type { DongNguoiNhan } from "@/lib/elearning/luot-giao-view";
import { nhomMauCuaTrangThai } from "@/lib/elearning/nhom-mau-trang-thai";
import { giaHanLuotGiaoAction, thuHoiLuotGiaoAction } from "../_actions";
import { DanhSachDuLieu, type CotDuLieu } from "../../_components/ui/danh-sach-du-lieu";
import { ThanhChonNhieu } from "../../_components/ui/thanh-chon-nhieu";
import { useChonNhieu } from "../../_components/ui/use-chon-nhieu";
import { TienDo } from "../../_components/ui/tien-do";
import { chuCaiDau } from "@/lib/elearning/luot-giao-thong-ke";
import { GhiChu } from "../../_components/ui/trang";
import { NHAN_O, NUT_CHINH, NUT_NGUY, NUT_PHU, O_NHAP, O_NHAP_GOC } from "../../_components/ui/dieu-khien";

const NHAN_TT: Record<string, string> = {
  NOT_STARTED: "Chưa bắt đầu",
  IN_PROGRESS: "Đang học",
  COMPLETED: "Hoàn thành",
  COMPLETED_LATE: "Hoàn thành trễ",
  OVERDUE: "Quá hạn",
  REVOKED: "Đã thu hồi",
};

const ngay = (d: Date | null) => (d ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(d)) : "—");

/**
 * Danh sách người nhận của MỘT lượt giao + chọn nhiều → gia hạn / thu hồi đã chọn. Danh sách id gửi lên là TIỆN LỢI giao diện: server
 * (`assignment-lifecycle`) chỉ thao tác trên dòng thật sự thuộc lượt giao và nằm trong tầm nhìn của người bấm, id còn lại được báo lại.
 */
export function LuotGiaoChiTiet(props: { assignmentId: string; dong: DongNguoiNhan[]; coQuyenGiaHan: boolean; coQuyenThuHoi: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const chon = useChonNhieu(props.dong.map((d) => d.id));
  const [viec, setViec] = useState<"gia-han" | "thu-hoi" | null>(null);
  const [themNgay, setThemNgay] = useState("7");
  const [lyDo, setLyDo] = useState("");
  const duLyDo = lyDo.trim().length >= 10;

  const dong = () => {
    setViec(null);
    setLyDo("");
    chon.boChon();
  };

  const chay = () =>
    chuyen(async () => {
      const pham = { kieu: "NHIEU_NGUOI" as const, assignmentId: props.assignmentId, enrollmentIds: chon.idGui };
      if (viec === "gia-han") {
        const r = await giaHanLuotGiaoAction({ pham, themNgay: Number(themNgay) }, { reason: lyDo.trim() });
        if (!r.ok) return void toast.error(r.error.message);
        toast.success(`Đã gia hạn cho ${r.data.soGiaHan} người`);
        if (r.data.boQua.length) toast.warning(`${r.data.boQua.length} người không được gia hạn (đã hoàn thành, đã thu hồi hoặc không có hạn)`);
        if (r.data.khongThay.length) toast.warning(`${r.data.khongThay.length} dòng không thuộc lượt giao này hoặc ngoài phạm vi của bạn — đã bỏ qua`);
      } else if (viec === "thu-hoi") {
        const r = await thuHoiLuotGiaoAction({ pham }, { reason: lyDo.trim() });
        if (!r.ok) return void toast.error(r.error.message);
        toast.success(`Đã thu hồi ${r.data.soThuHoi} người`);
        if (r.data.boQua.length) toast.warning(`${r.data.boQua.length} người không thu hồi được (đã hoàn thành hoặc đã thu hồi)`);
        if (r.data.khongThay.length) toast.warning(`${r.data.khongThay.length} dòng không thuộc lượt giao này hoặc ngoài phạm vi của bạn — đã bỏ qua`);
      }
      dong();
      router.refresh();
    });

  const cot: CotDuLieu<DongNguoiNhan>[] = [
    {
      id: "chon",
      nhan: "Chọn",
      hien: (h) => (
        <Checkbox checked={chon.laChon(h.id)} onCheckedChange={() => chon.doi(h.id)} aria-label={`Chọn ${h.hoTen}`} />
      ),
    },
    {
      id: "ten",
      nhan: "Người học",
      dienThoai: "tieu-de",
      hien: (h) => (
        <span className="inline-flex items-center gap-2.5">
          <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {chuCaiDau(h.hoTen)}
          </span>
          <span className="font-medium text-foreground">{h.hoTen}</span>
        </span>
      ),
    },
    {
      id: "tien-do",
      nhan: "Tiến độ",
      dienThoai: "thong-tin",
      hien: (h) => (
        <span className="inline-flex w-36 items-center gap-2">
          <TienDo phanTram={h.tienDo} nhan={h.hoTen} />
          <span className="text-[13px] tabular-nums text-muted-foreground">{h.tienDo}%</span>
        </span>
      ),
    },
    { id: "han", nhan: "Hạn", dienThoai: "thong-tin", hien: (h) => ngay(h.dueAt) },
    {
      id: "gia-han",
      nhan: "Gia hạn",
      hien: (h) =>
        h.dueAt && h.dueAtOriginal && new Date(h.dueAt).getTime() > new Date(h.dueAtOriginal).getTime()
          ? `Từ ${ngay(h.dueAtOriginal)}${h.lyDoGiaHan ? ` — ${h.lyDoGiaHan}` : ""}`
          : "—",
    },
  ];

  return (
    <div className="space-y-3">
      {/* Lối tắt theo thiết kế ("Gia hạn cả lượt"): chọn MỌI người đang hiển thị rồi mở đúng form gia hạn đã chọn — cùng action, cùng lý do ≥ 10 ký tự, cùng cổng quyền. */}
      {props.coQuyenGiaHan ? (
        <div className="flex justify-end">
          <button
            type="button"
            className={NUT_PHU}
            onClick={() => {
              chon.chonTatCa();
              setViec("gia-han");
            }}
          >
            Gia hạn cả lượt
          </button>
        </div>
      ) : null}
      <ThanhChonNhieu chon={chon} tenDonVi="người nhận">
        {props.coQuyenGiaHan ? (
          <button type="button" className={NUT_PHU} onClick={() => setViec("gia-han")}>
            Gia hạn đã chọn
          </button>
        ) : null}
        {props.coQuyenThuHoi ? (
          <button type="button" className={NUT_NGUY} onClick={() => setViec("thu-hoi")}>
            Thu hồi đã chọn
          </button>
        ) : null}
      </ThanhChonNhieu>

      {viec ? (
        <div className="space-y-3 rounded-xl border border-border bg-background p-4" role="group" aria-label={viec === "gia-han" ? "Gia hạn đã chọn" : "Thu hồi đã chọn"}>
          <p className="text-sm font-medium">
            {viec === "gia-han" ? "Gia hạn" : "Thu hồi"} {chon.soDangChon} người đã chọn
          </p>
          {viec === "gia-han" ? (
            <label className="block">
              <span className={NHAN_O}>Thêm bao nhiêu ngày</span>
              <input type="number" min={1} max={365} value={themNgay} onChange={(e) => setThemNgay(e.target.value)} className={`mt-1 ${O_NHAP_GOC} w-28`} />
            </label>
          ) : (
            <GhiChu sac="warning">Thu hồi rút người học khỏi khoá. Tiến độ đã có được giữ lại, nhưng khoá sẽ không bao giờ tính là hoàn thành.</GhiChu>
          )}
          <label className="block">
            <span className={NHAN_O}>Lý do (bắt buộc, ít nhất 10 ký tự — đi vào nhật ký kiểm toán)</span>
            <input value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} className={`mt-1 ${O_NHAP}`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={dangChay || !duLyDo || chon.soDangChon === 0} onClick={chay} className={viec === "thu-hoi" ? NUT_NGUY : NUT_CHINH}>
              {dangChay ? "Đang thực hiện…" : viec === "gia-han" ? "Gia hạn" : "Thu hồi"}
            </button>
            <button type="button" disabled={dangChay} onClick={dong} className={NUT_PHU}>
              Đóng
            </button>
          </div>
        </div>
      ) : null}

      <DanhSachDuLieu
        hang={props.dong}
        khoa={(h) => h.id}
        cot={cot}
        nhomMau={(h) => nhomMauCuaTrangThai("TrnEnrollmentStatus", h.status)}
        nhanTrangThai={(h) => NHAN_TT[h.status] ?? h.status}
        tenDonVi="người nhận"
        nhanDanhSach="Người nhận của lượt giao"
      />
    </div>
  );
}
