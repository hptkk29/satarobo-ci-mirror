// components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-chinh-sach.tsx — MỤC 4 «Chính sách áp dụng» của trang chi tiết nguồn (SPEC nguồn động §4; yêu cầu #28).
//
// Dữ liệu là câu trả lời của CHÍNH engine (`docChinhSachApDungCuaNguon`), không phải bản viết lại: cờ «tham gia hoa hồng theo nguồn» tắt thì rule riêng của nguồn không có trong bảng, và các
// phiên bản bị bỏ qua được liệt kê RIÊNG kèm lý do — để người đọc không tưởng chính sách riêng đang chạy.
//
// Hai nhóm tách bằng `isAcquisition` của VAI (thuộc tính dòng master, không so mã): «Hoa hồng nguồn» (thưởng vì đem khách về, chịu cửa sổ ghi công) ≠ «Hoa hồng giao dịch khác». Trộn là người
// đọc cộng nhầm hai câu hỏi khác nhau.
//
// Ba chỗ KHÔNG được nói dối:
//  · trần không đọc được (`tranPhanTram === null`) ⇒ «không đọc được trần», KHÔNG «không vượt trần»;
//  · tiền: `null` = người xem không có quyền xem hoa hồng ⇒ không in số nào (KHÔNG «0đ»); có số thì ghi phạm vi nó thuộc về;
//  · vượt trần ⇒ chỉ đường (hướng xử lý chung của module), không im lặng.
import Link from "next/link";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { dungHuongXuLyTran } from "@/lib/hoa-hong/huong-xu-ly-tran";
import { quyetDinhLoiRaTran } from "@/lib/hoa-hong/loi-ra-vuot-tran";
import { NHAN_LOAI_GD } from "@/lib/hoa-hong/chinh-sach-form";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import type { DongChiTiet, NhomHoaHong } from "@/lib/nguon/chi-tiet-nguon";
import type { ChinhSachApDungCuaNguon, HoaHongCuaNguon } from "@/lib/nguon/doc-chi-tiet-nguon";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import { cn } from "@/lib/utils";
import { soVN } from "../nhan-nguon";
import { Hang, MucChiTiet, MucKhongDoc, MucRong } from "./khung-muc";
import type { LienKetChinhSach } from "./lien-ket-nguon";
import { nhanTrangThaiPhienBan } from "./nhan-chi-tiet";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

/** Ô tỉ lệ của một dòng — chữ người đọc được cho từng kiểu của ma trận. */
export function moTaO(o: DongChiTiet["o"]): string {
  switch (o.kieu) {
    case "PERCENT":
      return `${o.phanTram}%`;
    case "EXCLUDE":
      return "Loại trừ (0%)";
    case "CO_DINH":
      return `${dinhDangDong(o.soTien)} cố định`;
    case "KHAC_KIEU":
      return `Kiểu tính «${o.kieuTinh}»`;
    case "CHONG_LAN":
      return `Chồng lấn — ${o.lyDo}`;
    case "KHONG_CO":
      return "Không có";
  }
}

function nguonGocO(o: DongChiTiet["o"]): string {
  if (o.kieu === "KHONG_CO" || o.kieu === "CHONG_LAN") return "—";
  return `${o.policyCode} · v${o.version} (${o.cuThe ? "riêng" : "chung"})`;
}

// Tỉ lệ đứng ngay sau tên vai: ở 375px bảng cuộn ngang, và con số người ta tìm không được nằm ngoài khung nhìn.
function BangNhom({ nhan, ghiChu, nhom }: { nhan: string; ghiChu: string; nhom: NhomHoaHong }) {
  return (
    <div data-nhom-hoa-hong={nhan} className="mt-3">
      <h4 className="text-sm font-semibold text-foreground">{nhan}</h4>
      <p className="mb-1.5 text-xs text-muted-foreground">{ghiChu}</p>
      {nhom.dong.length === 0 ? (
        <MucRong>Chưa có vai nào thuộc nhóm này.</MucRong>
      ) : (
        <div className="overflow-x-auto" role="region" aria-label={`Bảng ${nhan.toLowerCase()}`} tabIndex={0}>
          <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
            {/* Bốn bảng (2 loại × 2 nhóm) xếp dọc: cột phải THẲNG HÀNG giữa chúng, nên chiều rộng cột cố định chứ không theo nội dung. */}
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[14%]" />
              <col className="w-[36%]" />
              <col className="w-[24%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>Vai hưởng</th>
                <th scope="col" className={cn(TH, "text-right")}>Tỉ lệ</th>
                <th scope="col" className={TH}>Người nhận</th>
                <th scope="col" className={TH}>Chính sách</th>
              </tr>
            </thead>
            <tbody>
              {nhom.dong.map((d) => (
                <tr key={d.vai.code} className={adminTr}>
                  <td className={cn(TD, "truncate font-medium text-foreground")} title={d.vai.name}>
                    {d.vai.name}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums", d.o.kieu === "KHONG_CO" && "text-muted-foreground")}>{moTaO(d.o)}</td>
                  <td className={cn(TD, "truncate", d.nguoiHuong.thieu ? "text-state-warning-ink" : "text-muted-foreground")} title={d.nguoiHuong.nhan}>
                    {d.nguoiHuong.nhan}
                  </td>
                  <td className={cn(TD, "truncate text-muted-foreground")} title={nguonGocO(d.o)}>
                    {nguonGocO(d.o)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Cộng các tỉ lệ phần trăm của nhóm này: <span className="font-semibold tabular-nums text-foreground">{nhom.tongPhanTram}%</span>
        {nhom.khongTinDuoc && " (chưa tính các khoản cố định / chồng lấn / kiểu khác — con số chỉ là phần quy ra % được)"}
      </p>
    </div>
  );
}

/** «11» / «8,5» → 0.11 / 0.085. Chỉ để dựng hướng xử lý vượt trần; không dùng để so sánh vượt/không (engine đã quyết `vuotTran`). */
const phanTramSangTiLe = (s: string): number => Number(s.replace(",", ".")) / 100;

function DongTran({ loai, coQuyenSuaTran }: { loai: ChinhSachApDungCuaNguon["theoLoai"][number]; coQuyenSuaTran: boolean }) {
  if (loai.tranPhanTram === null) {
    return (
      <p role="note" className="mt-3 text-sm text-state-warning-ink">
        Tổng áp dụng <span className="font-semibold tabular-nums">{loai.tongPhanTram}%</span> — <b>không đọc được trần</b> hoa hồng lúc này nên chưa kết luận được vượt hay không.
      </p>
    );
  }
  if (loai.vuotTran) {
    const h = dungHuongXuLyTran({ tongToiDa: phanTramSangTiLe(loai.tongPhanTram), tran: phanTramSangTiLe(loai.tranPhanTram) });
    // Lối ra theo QUYỀN người xem (cùng hàm với trình soạn): liên kết tới Cấu hình vận hành chỉ vẽ cho người có `settings:edit`; người khác thấy ai nâng trần được.
    const loiRa = quyetDinhLoiRaTran({ duongDan: h.duongDan, coQuyenSuaTran });
    return (
      <div role="alert" className="mt-3 text-sm text-state-danger-ink">
        <p>
          Tổng áp dụng <span className="font-semibold tabular-nums">{loai.tongPhanTram}%</span> VƯỢT trần <span className="font-semibold tabular-nums">{loai.tranPhanTram}%</span> (chênh{" "}
          <span className="tabular-nums">{h.chenhLechPhanTram}</span> điểm phần trăm).
        </p>
        <p className="mt-0.5 text-xs">{loiRa.cauChu}</p>
        {loiRa.lienKet && (
          <p className="mt-1 text-xs">
            <Link href={loiRa.lienKet.href} className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2 hover:no-underline sm:min-h-0">
              Nâng trần tại {loiRa.lienKet.nhan}
            </Link>
          </p>
        )}
      </div>
    );
  }
  return (
    <p className="mt-3 text-sm text-foreground">
      Tổng áp dụng <span className="font-semibold tabular-nums">{loai.tongPhanTram}%</span>, trong trần <span className="tabular-nums">{loai.tranPhanTram}%</span>
      {loai.khongTinDuoc && <span className="text-muted-foreground"> (chưa tính các khoản không quy ra %)</span>}.
    </p>
  );
}

const NHAN_PHAM_VI_TIEN: Record<HoaHongCuaNguon["phamVi"], string> = {
  TAT_CA: "toàn hệ thống",
  CO_SO_VA_CUA_TOI: "các cơ sở bạn quản lý và phần của bạn",
  CHI_CUA_TOI: "chỉ phần của bạn",
};

export function MucChinhSach({
  chinhSach,
  hoaHong,
  engineBat,
  coQuyenSuaTran,
  lienKet,
}: {
  chinhSach: KetQuaMuc<ChinhSachApDungCuaNguon>;
  hoaHong: KetQuaMuc<HoaHongCuaNguon | null>;
  /** Cờ engine hoa hồng (`hoaHong.engineBat`): tắt thì chính sách dưới đây CHƯA chạy với giao dịch thật. */
  engineBat: boolean;
  /** `settings:edit` của người xem (BẮT BUỘC, luật 7): quyết liên kết «Nâng trần» của cảnh báo vượt trần — cùng khoá mà action lưu ô trần kiểm. */
  coQuyenSuaTran: boolean;
  lienKet: LienKetChinhSach;
}) {
  return (
    <MucChiTiet id="chinh-sach" tieuDe="Chính sách áp dụng" ghiChu="Kết quả thật của bộ máy hoa hồng cho nguồn này (chính sách cụ thể thắng chính sách chung).">
      {!engineBat && (
        <p role="note" data-trang-thai="engine-tat" className="mb-3 text-sm text-state-warning-ink">
          Bộ máy hoa hồng đang TẮT — các chính sách dưới đây chưa được dùng để tính hoa hồng cho giao dịch thật.
        </p>
      )}
      {!chinhSach.ok ? (
        <MucKhongDoc loai={chinhSach.loai} khoa="sources:view" />
      ) : (
        (() => {
          const c = chinhSach.du;
          return (
            <>
              <dl>
                <Hang nhan="Hoa hồng theo nguồn">
                  <span className="font-medium">{c.nguon.commissionEnabled ? "Có" : "Không"}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {c.nguon.commissionEnabled
                      ? "Chính sách phạm vi riêng của nguồn này được dùng; chính sách chung vẫn chạy."
                      : "Các dòng thu hút (có tỉ lệ) của chính sách phạm vi riêng của nguồn này KHÔNG chạy; dòng «loại trừ» (nguồn này không trả một vai nào đó) vẫn chạy, và chính sách chung vẫn chạy. Bật ở «Sửa nguồn» khi cần."}
                  </span>
                </Hang>
              </dl>

              <h3 className="mt-3 text-sm font-semibold text-foreground">Chính sách riêng của nguồn</h3>
              {c.phienBanRieng.length === 0 ? (
                <MucRong>Nguồn này chưa có chính sách riêng — giao dịch của nó dùng chính sách chung.</MucRong>
              ) : (
                <ul className="mt-1.5 space-y-1.5 text-sm">
                  {c.phienBanRieng.map((v) => (
                    <li key={`${v.policyCode}-${v.versionNo}`} data-phien-ban={`${v.policyCode}-${v.versionNo}`}>
                      <span className="font-medium text-foreground">{v.tenChinhSach}</span>{" "}
                      <span className="text-muted-foreground">
                        · {v.policyCode} v{v.versionNo} · {nhanTrangThaiPhienBan(v.status)} · <span className="tabular-nums">{soVN(v.soRule)}</span> quy tắc
                      </span>
                      {v.biBoQua && v.lyDoBoQua && <span className="mt-0.5 block text-xs text-state-warning-ink">Không chạy: {v.lyDoBoQua}</span>}
                    </li>
                  ))}
                </ul>
              )}

              {c.theoLoai.map((loai) => {
                // Loại giao dịch mà MỌI vai đều «Không có»: tám dòng «Không có» là nhiễu — nói một câu.
                const trong = [...loai.nguon.dong, ...loai.khac.dong].every((d) => d.o.kieu === "KHONG_CO");
                return trong ? (
                  <div key={loai.loai} data-loai-gd={loai.loai} data-loai-trong className="mt-5 border-t border-border pt-4">
                    <h3 className="text-sm font-semibold text-foreground">{NHAN_LOAI_GD[loai.loai]}</h3>
                    <MucRong>Chưa có chính sách nào áp dụng cho loại giao dịch này — mọi vai đều «Không có».</MucRong>
                  </div>
                ) : (
                <div key={loai.loai} data-loai-gd={loai.loai} className="mt-5 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-foreground">{NHAN_LOAI_GD[loai.loai]}</h3>
                  <BangNhom nhan="Hoa hồng nguồn" ghiChu="Thưởng vì đem khách về; chỉ tính khi lead còn trong cửa sổ ghi công." nhom={loai.nguon} />
                  <BangNhom nhan="Hoa hồng giao dịch khác" ghiChu="Các vai nuôi giao dịch (Sale, quản lý cơ sở, marketing, giáo viên học thử…), không phụ thuộc cửa sổ ghi công." nhom={loai.khac} />
                  <DongTran loai={loai} coQuyenSuaTran={coQuyenSuaTran} />
                </div>
                );
              })}
            </>
          );
        })()
      )}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">Đã ghi sổ</h3>
        {!hoaHong.ok ? (
          <div className="mt-1.5">
            <MucKhongDoc loai={hoaHong.loai} khoa="commission:view-self" />
          </div>
        ) : hoaHong.du === null ? (
          <MucRong>Bạn không có quyền xem hoa hồng nên không hiện số tiền đã ghi sổ của nguồn này.</MucRong>
        ) : hoaHong.du.tong.soDong === 0 ? (
          <MucRong>Chưa có khoản hoa hồng nào của nguồn này trong phạm vi bạn xem ({NHAN_PHAM_VI_TIEN[hoaHong.du.phamVi]}).</MucRong>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">Phạm vi số liệu: {NHAN_PHAM_VI_TIEN[hoaHong.du.phamVi]}.</p>
            <dl>
            <Hang nhan="Hoa hồng nguồn">
              <span className="font-semibold tabular-nums">{dinhDangDong(hoaHong.du.nguon.tong)}</span> · {soVN(hoaHong.du.nguon.soDong)} dòng
            </Hang>
            <Hang nhan="Hoa hồng giao dịch khác">
              <span className="font-semibold tabular-nums">{dinhDangDong(hoaHong.du.khac.tong)}</span> · {soVN(hoaHong.du.khac.soDong)} dòng
            </Hang>
            </dl>
          </>
        )}
      </div>

      <div className="mt-5 text-sm">
        {lienKet.loai === "LIEN_KET" && (
          <Link href={lienKet.href} data-lien-ket="tao-chinh-sach" className="font-semibold text-foreground underline underline-offset-2 hover:no-underline">
            Tạo chính sách cho nguồn này
          </Link>
        )}
        {lienKet.loai === "LY_DO" && (
          <p data-lien-ket="tao-chinh-sach-ly-do" className="text-muted-foreground">
            <span className="font-medium text-foreground">Chưa tạo chính sách cho nguồn này được:</span> {lienKet.lyDo}
          </p>
        )}
      </div>
    </MucChiTiet>
  );
}
