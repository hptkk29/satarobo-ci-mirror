"use client";
/**
 * Trang «Sức khỏe cả nhà» (08/11/2026): hộp «để lại thông tin» dùng chung + giao diện sinh từ artifact + logic view-model.
 * CSS nạp ở `app/(public)/suc-khoe/page.tsx` (`pub-design/cong-thong-tin.css` + `suc-khoe.css` + `suc-khoe-in.css`).
 * Câu trả lời / số đo / kết quả ở lại TRÊN MÁY; phiếu gửi Sata Robo chỉ mang thông tin liên hệ (xem `vm.ts`).
 */
import { CongThongTinProvider } from "@/components/public/cong-thong-tin/hop-de-lai-thong-tin";
import { SucKhoeView } from "./suc-khoe-view";
import { useSucKhoeVm } from "./vm";

const CAU_HINH = {
  tieuDe: "Để lại thông tin để nhận kết quả",
  moTa: "Thăm dò hoàn toàn miễn phí. Để xem kết quả chi tiết và tải bản PDF, anh chị để lại thông tin liên hệ một lần — dùng cho cả nhà.",
  nut: "Gửi và xem kết quả",
  okMoTa: "Kết quả của cả nhà đã mở. Câu trả lời sức khoẻ vẫn nằm trên máy anh chị, không gửi kèm phiếu.",
  okNut: "Xem kết quả",
} as const;

function NoiDung() {
  const vm = useSucKhoeVm();
  const { hop } = vm;
  return (
    <>
      <SucKhoeView vm={vm} />
      {vm.hopMo && (
        <div className="modal" onClick={hop.nen} role="dialog" aria-modal="true" aria-labelledby="sk-hop-t">
          <div className="modal-card sk-hop">
            <button type="button" className="modal-x" onClick={hop.huy} aria-label="Đóng">
              ×
            </button>
            <p id="sk-hop-t" className="sk-hop-t">
              {hop.tieuDe}
            </p>
            <p className="sk-hop-p">{hop.moTa}</p>
            {hop.coDs && (
              <div className="sk-hop-ds" role="radiogroup" aria-label="Chọn người cần xoá">
                {hop.ds.map((o) => (
                  <button key={o.t} type="button" role="radio" aria-checked={o.on} className={o.cls} onClick={o.pick}>
                    <span className="sk-radio" aria-hidden="true"></span>
                    {o.t}
                  </button>
                ))}
              </div>
            )}
            {hop.coSaoLuu && (
              <p className="dnote vi sk-hop-sl">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <path d="m7 10 5 5 5-5M12 15V3"></path>
                </svg>
                <span>
                  Anh chị nên tải bản sao lưu trước để giữ lại số đo cũ.{" "}
                  <button type="button" className="sk-link" onClick={hop.saoLuu}>
                    Tải bản sao lưu trước
                  </button>
                </span>
              </p>
            )}
            <div className="sk-hop-nut">
              <button type="button" className="btn sk-btn-do" onClick={hop.xoa} aria-disabled={hop.khoa} disabled={hop.khoa}>
                {hop.nut}
              </button>
              <button type="button" className="btn btn-line" onClick={hop.huy}>
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}
      {vm.coToast && (
        <p className="sk-toast" role="status">
          {vm.toast}
        </p>
      )}
    </>
  );
}

export function SucKhoeTrang({ daMoKhoa }: { daMoKhoa: boolean }) {
  return (
    <CongThongTinProvider nguon="suc-khoe" daMoKhoaBanDau={daMoKhoa} cauHinh={CAU_HINH}>
      <NoiDung />
    </CongThongTinProvider>
  );
}
