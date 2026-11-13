import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napMaTran } from "@/lib/elearning/matrix-query";
import type { TrangThaiO } from "@/lib/elearning/training-matrix";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, Khoi, KhoiRong, LuoiSoLieu, SoLieu, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";
import { NHAN_PHAM_VI } from "../_components/nhan";

/**
 * EL-17 — MA TRẬN ĐÀO TẠO R3.
 *
 * ⚠️ BỐN màu, không phải ba. Ô xám ("không áp dụng") là một CÂU TRẢ LỜI: yêu cầu ấy
 * không phải của người này. Ô gạch chéo ("chưa đối chiếu được") thì ngược lại — hệ
 * thống chưa biết có áp hay không, vì phạm vi của yêu cầu tra vào một bảng đang rỗng.
 *
 * Vẽ hai thứ đó cùng màu là biến một khoảng trống dữ liệu thành kết luận về một con
 * người — và kết luận ấy sẽ đi vào báo cáo tuân thủ có ghi tên.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ma trận đào tạo | Sata Robo",
  robots: { index: false, follow: false },
};

const KIEU_O: Record<TrangThaiO, { nhan: string; lop: string; chu: string }> = {
  DAT: { nhan: "✓", lop: "bg-state-success-soft text-state-success-ink", chu: "Đạt" },
  CHUA_DAT: { nhan: "✗", lop: "bg-state-danger-soft text-state-danger-ink", chu: "Chưa đạt" },
  KHONG_AP_DUNG: {
    nhan: "–",
    lop: "bg-muted text-muted-foreground",
    chu: "Không áp dụng",
  },
  CHUA_DOI_CHIEU_DUOC: {
    nhan: "?",
    lop: "bg-state-warning-soft text-state-warning-ink",
    chu: "Chưa đối chiếu được",
  },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Ma trận đào tạo" />
        <NoPermission permission="elearning:progress:view-all" what="ma trận đào tạo" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const m = await napMaTran(db);
  const oCua = new Map(m.o.map((x) => [`${x.userId}::${x.requirementId}`, x] as const));

  return (
    <TrangQuanTri>
      <PageHeader
        title="Ma trận đào tạo"
        subtitle={
          <>
            Người × yêu cầu. Ô xám nghĩa là yêu cầu đó KHÔNG áp cho người đó — không
            phải thiếu dữ liệu.{" "}
            <Link href="/elearning/yeu-cau" className={LIEN_KET_CHU}>
              Xem yêu cầu đào tạo
            </Link>
          </>
        }
      />

      {/* ⚠️ Con số chính viết bằng NGƯỜI, không bằng phần trăm. Ở quy mô 15 người
          thì mỗi người là 6,7 điểm phần trăm — "80%" và "86,7%" là cùng một người,
          và một ngưỡng viết bằng phần trăm chỉ tạo ảo giác chính xác. */}
      <LuoiSoLieu cot={3}>
        <SoLieu
          nhan="Đạt đủ mọi yêu cầu"
          so={m.nsmNguoi.cau}
          ghiChu="Ngưỡng quý đầu 12/15 người · cổng GĐ4 13/15 người"
        />
        <SoLieu
          nhan="Cặp (người × yêu cầu) đã đạt"
          so={`${m.nsm.tuSo}/${m.nsm.mauSo}`}
          /* Mẫu số 0 ⇒ không in phần trăm. "0% tuân thủ" đọc thành thảm hoạ,
             còn sự thật là chưa có yêu cầu nào được khai. */
          ghiChu={m.nsm.tiLe == null ? "Chưa có yêu cầu nào áp cho ai" : `${m.nsm.tiLe}% số cặp`}
        />
        <SoLieu
          nhan="Chưa đối chiếu được"
          so={m.nsm.chuaDoiChieuDuoc}
          sac={m.nsm.chuaDoiChieuDuoc > 0 ? "warning" : "muted"}
          /* Nằm NGOÀI cả tử lẫn mẫu. Không hiện ra thì con số trên trông sạch
             trong khi một phần yêu cầu không được đo, và không ai biết phần ấy
             lớn cỡ nào. */
          ghiChu="Nằm ngoài cả tử lẫn mẫu số — không được tính là đạt hay chưa đạt."
        />
      </LuoiSoLieu>

      {m.soNguoiChuaCoTaiKhoan > 0 ? (
        <GhiChu sac="warning">
          {/* Im lặng bỏ họ đi thì mẫu số hụt mà không ai biết hụt bao nhiêu. */}
          {m.soNguoiChuaCoTaiKhoan} nhân sự đang làm việc chưa có tài khoản nên không
          nằm trong ma trận này. Họ không vào được khu học, nên không giao bài cho họ
          được — báo phòng Nhân sự cấp tài khoản.
        </GhiChu>
      ) : null}

      <ul aria-label="Chú giải ô" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(Object.keys(KIEU_O) as TrangThaiO[]).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`inline-flex h-6 w-6 items-center justify-center rounded font-semibold ${KIEU_O[k].lop}`}
            >
              {KIEU_O[k].nhan}
            </span>
            {/* Nhãn nằm trong phần tử RIÊNG: gộp chung với ký hiệu thì cả người
                đọc màn hình lẫn test đều nhận được chuỗi "✓Đạt", và "Đạt" khớp
                nhầm vào "Chưa đạt". */}
            <span>{KIEU_O[k].chu}</span>
          </li>
        ))}
      </ul>

      {m.yeuCau.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <KhoiRong
            title="Chưa có yêu cầu đào tạo nào đang hiệu lực"
            description="Ma trận trống không phải vì thiếu dữ liệu học — nó trống vì chưa ai khai nghĩa vụ nào."
            action={
              <Link href="/elearning/yeu-cau" className={LIEN_KET_CHU}>
                Khai yêu cầu đầu tiên
              </Link>
            }
          />
        </div>
      ) : (
        <Khoi tieuDe={`Nhân sự × yêu cầu (${m.nguoi.length} người · ${m.yeuCau.length} yêu cầu)`} sat>
          <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={`${TH_BANG} sticky left-0 z-10 bg-muted`}>
                    Nhân sự
                  </th>
                  {m.yeuCau.map((y) => (
                    <th key={y.id} scope="col" className={`${TH_BANG} align-bottom normal-case`}>
                      <span className="block max-w-40 truncate text-sm font-semibold normal-case tracking-normal text-foreground" title={y.tenKhoa}>
                        {y.tenKhoa}
                      </span>
                      <span className="block text-xs font-normal normal-case tracking-normal">
                        {NHAN_PHAM_VI[String(y.scopeKind)] ?? String(y.scopeKind)}
                        {y.validityMonths ? ` · ${y.validityMonths} tháng` : " · vô hạn"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.nguoi.map((n) => (
                  <tr key={n.userId} className={TR_BANG}>
                    <td className={`${TD_BANG} sticky left-0 z-10 whitespace-nowrap bg-card font-medium`}>
                      {n.hoTen}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {n.maNhanVien}
                      </span>
                    </td>
                    {m.yeuCau.map((y) => {
                      const x = oCua.get(`${n.userId}::${y.id}`);
                      const k = KIEU_O[x?.trangThai ?? "KHONG_AP_DUNG"];
                      return (
                        <td key={y.id} className={TD_BANG}>
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded font-semibold ${k.lop}`}
                            title={x?.lyDo ?? k.chu}
                          >
                            <span aria-hidden>{k.nhan}</span>
                            <span className="sr-only">{`${k.chu} — ${y.tenKhoa}`}</span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </Khoi>
      )}
    </TrangQuanTri>
  );
}
