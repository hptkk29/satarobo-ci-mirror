// components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-doi-tuong.tsx — MỤC 3 «Đối tượng liên quan»: chủ nguồn + người giới thiệu (đếm theo LOẠI, không tên, không SĐT).
import type { ReferrerKind } from "@prisma/client";
import { soVN } from "../nhan-nguon";
import type { NguoiGioiThieuTheoLoai } from "@/lib/nguon/dem-nguoi-gioi-thieu";
import type { NguonDeSuaView } from "@/lib/nguon/doc-chi-tiet-nguon";
import type { ChiTietNguon } from "@/lib/nguon/doc-danh-muc";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import { NutChupLaiChuNguon, type ChupLaiView } from "../chup-lai-chu-nguon";
import { Hang, MucChiTiet, MucKhongDoc, MucRong } from "./khung-muc";
import { NHAN_LOAI_GIOI_THIEU } from "./nhan-chi-tiet";

const THU_TU: readonly ReferrerKind[] = ["EMPLOYEE", "PARENT", "AFFILIATE"];

export function MucDoiTuong({
  nguon,
  nguoiGioiThieu,
  chiTiet,
  chupLai,
}: {
  nguon: KetQuaMuc<NguonDeSuaView>;
  nguoiGioiThieu: KetQuaMuc<NguoiGioiThieuTheoLoai>;
  chiTiet: KetQuaMuc<ChiTietNguon>;
  /** Dữ liệu nút «Chụp lại chủ nguồn cho lead cũ». Trang CHỈ truyền khi người xem có đủ hai khoá của action + đủ phạm vi (luật 12) VÀ có điều để nói (lead cần chụp · lead giữ chủ cũ · lý do chưa chụp được); vắng ⇒ không vẽ gì. */
  chupLai?: ChupLaiView | null;
}) {
  return (
    <MucChiTiet id="doi-tuong" tieuDe="Đối tượng liên quan" ghiChu="Số lead đếm trong các cơ sở bạn được xem.">
      {!nguon.ok ? (
        <MucKhongDoc loai={nguon.loai} />
      ) : (
        <dl>
          <Hang nhan="Chủ nguồn">
            {nguon.du.ownerEmployee ? (
              <>
                {nguon.du.ownerEmployee.ten}
                {nguon.du.ownerEmployee.maNv && <span className="text-muted-foreground"> ({nguon.du.ownerEmployee.maNv})</span>}
              </>
            ) : (
              <span className="text-muted-foreground">Chưa khai người phụ trách</span>
            )}
          </Hang>
          {chupLai && chupLai.tong > 0 && (
            <Hang nhan="Lead giữ chủ cũ">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>
                  <span className="tabular-nums">{soVN(chupLai.tong)}</span> lead đang giữ bản chụp chủ nguồn cũ — hoa hồng phần chủ nguồn của chúng bị treo.
                </span>
                <NutChupLaiChuNguon view={chupLai} />
              </div>
            </Hang>
          )}
          {chupLai && chupLai.giuChuCu > 0 && (
            <Hang nhan="Đã chi cho chủ cũ">
              <span className="tabular-nums">{soVN(chupLai.giuChuCu)}</span> lead đã có khoản chi cho chủ nguồn cũ nên GIỮ chủ cũ, không chụp lại. Chuyển người nhận chỉ qua «Đổi nguồn» từng lead — nó tự ghi điều chỉnh THU HỒI phần đã chi cho chủ cũ, không qua người duyệt.
            </Hang>
          )}
          {chupLai && chupLai.tong <= 0 && chupLai.khongChupDuoc && <Hang nhan="Chụp lại chủ nguồn">Chưa chụp lại được: {chupLai.khongChupDuoc}</Hang>}
          <Hang nhan="Người giới thiệu">
            {nguon.du.referrerRequirement === "NONE" ? "Nguồn này không cần chọn người giới thiệu." : "Người nhập phải chọn người giới thiệu cho mỗi lead thuộc nguồn này."}
          </Hang>
          {nguon.du.referrerRequirement !== "NONE" && chiTiet.ok && (
            <Hang nhan="Còn thiếu người">
              <span className="tabular-nums">{soVN(chiTiet.du.thongKe.thieuNguoi)}</span> lead
            </Hang>
          )}
        </dl>
      )}
      <div className="mt-2">
        {!nguoiGioiThieu.ok ? (
          <MucKhongDoc loai={nguoiGioiThieu.loai} />
        ) : (
          (() => {
            const co = THU_TU.filter((k) => nguoiGioiThieu.du[k] > 0);
            if (co.length === 0) return <MucRong>Chưa có lead nào của nguồn này mang người giới thiệu.</MucRong>;
            return (
              <dl>
                {co.map((k) => (
                  <Hang key={k} nhan={`Giới thiệu bởi ${NHAN_LOAI_GIOI_THIEU[k].toLowerCase()}`}>
                    <span className="tabular-nums">{soVN(nguoiGioiThieu.du[k])}</span> lead
                  </Hang>
                ))}
              </dl>
            );
          })()
        )}
      </div>
    </MucChiTiet>
  );
}
