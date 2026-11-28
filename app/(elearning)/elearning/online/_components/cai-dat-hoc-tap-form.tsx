"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { luuCaiDatAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";
import type { CaiDatHocTap } from "@/lib/elearning-online/cai-dat-hoc-tap";

const SO = (s: string, mac: number) => (s.trim() === "" || Number.isNaN(Number(s)) ? mac : Math.round(Number(s)));

/** QoCaiDat — CÀI ĐẶT HỌC TẬP của BẢN NHÁP. Bản đang chạy chỉ đọc. Mọi mục đều bắt buộc có giá trị (không có "mặc định ngầm" ở server). */
export function CaiDatHocTapForm({ versionId, caiDat, duocSua }: { versionId: string; caiDat: CaiDatHocTap; duocSua: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [daXem, setDaXem] = useState(String(caiDat.tinhDaXemPhanTramVideo));
  const [baiTap, setBaiTap] = useState(String(caiDat.baiTapDatPhanTram));
  const [mo, setMo] = useState(caiDat.moBaiTiepTheo);
  const [hoanThanh, setHoanThanh] = useState(String(caiDat.khoaHoanThanhPhanTramBaiBatBuoc));
  const [khongXemLai, setKhongXemLai] = useState(caiDat.khongChoXemLaiBaiDaQua);
  const [thiBat, setThiBat] = useState(caiDat.thiCuoiKhoa.bat);
  const [diemDat, setDiemDat] = useState(String(caiDat.thiCuoiKhoa.diemDat));
  const [soLan, setSoLan] = useState(caiDat.thiCuoiKhoa.soLanThi === null ? "" : String(caiDat.thiCuoiKhoa.soLanThi));
  const [phut, setPhut] = useState(caiDat.thiCuoiKhoa.phut === null ? "" : String(caiDat.thiCuoiKhoa.phut));
  const [xemKq, setXemKq] = useState(caiDat.xemKetQua);
  const khoa = !duocSua;

  return (
    <form
      className="flex flex-col gap-6 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const moi: CaiDatHocTap = {
          tinhDaXemPhanTramVideo: SO(daXem, 90),
          baiTapDatPhanTram: SO(baiTap, 70),
          moBaiTiepTheo: mo,
          khoaHoanThanhPhanTramBaiBatBuoc: SO(hoanThanh, 100),
          khongChoXemLaiBaiDaQua: khongXemLai,
          thiCuoiKhoa: { bat: thiBat, diemDat: SO(diemDat, 70), soLanThi: soLan.trim() ? SO(soLan, 1) : null, phut: phut.trim() ? SO(phut, 30) : null },
          xemKetQua: xemKq,
          // Cờ không còn tác dụng và không còn ô trên form (Owner 27/11/2026, phương án A); schema bắt buộc ⇒ gửi NGUYÊN giá trị đã lưu.
          choXemDiemBaiKhoaXemLai: caiDat.choXemDiemBaiKhoaXemLai,
        };
        chuyen(async () => {
          const r = await luuCaiDatAction({ versionId, caiDat: moi });
          if (!r.ok) return void toast.error(r.error.message);
          toast.success("Đã lưu cài đặt học tập");
          router.refresh();
        });
      }}
    >
      {khoa ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">Đây là bản đang chạy nên chỉ đọc. Mở bản nháp mới ở tab “Chương & bài” để đổi cài đặt.</p> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={khoa}>
        <legend className="mb-2 text-sm font-semibold">Hoàn thành bài</legend>
        <div>
          <label htmlFor="cd-xem" className={NHAN_O}>Bài video tính là đã xem khi xem ≥ (%)</label>
          <input id="cd-xem" inputMode="numeric" className={O_NHAP} value={daXem} onChange={(e) => setDaXem(e.target.value)} />
          <p className={GOI_Y_O}>1–100. Server tự quyết hoàn thành; tua nhanh không được tính.</p>
        </div>
        <div>
          <label htmlFor="cd-bt" className={NHAN_O}>Điểm đạt mặc định của bài tập (%)</label>
          <input id="cd-bt" inputMode="numeric" className={O_NHAP} value={baiTap} onChange={(e) => setBaiTap(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cd-mo" className={NHAN_O}>Mở bài tiếp theo</label>
          <select id="cd-mo" className={O_CHON} value={mo} onChange={(e) => setMo(e.target.value as CaiDatHocTap["moBaiTiepTheo"])}>
            <option value="KHI_BAI_TRUOC_XONG">Khi hoàn thành bài trước</option>
            <option value="THEO_CHUONG">Theo chương (xong chương trước mới mở chương sau)</option>
            <option value="MO_HET">Mở hết ngay từ đầu</option>
          </select>
          <p className={GOI_Y_O}>Áp ở server: bài chưa mở không trả nội dung dù người dùng gõ thẳng địa chỉ.</p>
        </div>
        <div>
          <label htmlFor="cd-kh" className={NHAN_O}>Khoá hoàn thành khi xong ≥ (% bài bắt buộc)</label>
          <input id="cd-kh" inputMode="numeric" className={O_NHAP} value={hoanThanh} onChange={(e) => setHoanThanh(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={khongXemLai} onChange={(e) => setKhongXemLai(e.target.checked)} />
          <span>
            Không cho xem lại bài đã qua
            <span className={`block ${GOI_Y_O}`}>Bật: bài đã hoàn thành không mở lại được nội dung (server chặn mọi đường: trang học, API, vé video). Tiến độ, điểm và lịch sử vẫn lưu.</span>
          </span>
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={khoa}>
        <legend className="mb-2 text-sm font-semibold">Thi cuối khoá</legend>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={thiBat} onChange={(e) => setThiBat(e.target.checked)} />
          Khoá có thi cuối — hoàn thành khoá cần ĐẠT bài thi cuối
        </label>
        <div>
          <label htmlFor="cd-diem" className={NHAN_O}>Điểm đạt (%)</label>
          <input id="cd-diem" inputMode="numeric" className={O_NHAP} value={diemDat} onChange={(e) => setDiemDat(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cd-lan" className={NHAN_O}>Số lần thi tối đa</label>
          <input id="cd-lan" inputMode="numeric" className={O_NHAP} value={soLan} onChange={(e) => setSoLan(e.target.value)} placeholder="Không giới hạn" />
        </div>
        <div>
          <label htmlFor="cd-phut" className={NHAN_O}>Thời gian làm bài (phút)</label>
          <input id="cd-phut" inputMode="numeric" className={O_NHAP} value={phut} onChange={(e) => setPhut(e.target.value)} placeholder="Không giới hạn" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={khoa}>
        <legend className="mb-2 text-sm font-semibold">Xem kết quả</legend>
        <div>
          <label htmlFor="cd-kq" className={NHAN_O}>Hiển thị kết quả</label>
          <select id="cd-kq" className={O_CHON} value={xemKq} onChange={(e) => setXemKq(e.target.value as CaiDatHocTap["xemKetQua"])}>
            <option value="DIEM_VA_DUNG_SAI">Điểm và câu đúng/sai</option>
            <option value="CA_DAP_AN_SAU_HET_LUOT">Cả đáp án — sau khi hết lượt</option>
            <option value="CHI_DIEM">Chỉ điểm</option>
          </select>
        </div>
      </fieldset>

      {duocSua ? (
        <div>
          <button type="submit" className={NUT_CHINH} disabled={dangChay}>{dangChay ? "Đang lưu…" : "Lưu cài đặt"}</button>
        </div>
      ) : null}
    </form>
  );
}
