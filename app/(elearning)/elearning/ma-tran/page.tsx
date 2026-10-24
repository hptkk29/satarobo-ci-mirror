import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napMaTran } from "@/lib/elearning/matrix-query";
import type { TrangThaiO } from "@/lib/elearning/training-matrix";

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
  DAT: { nhan: "✓", lop: "bg-emerald-100 text-emerald-900", chu: "Đạt" },
  CHUA_DAT: { nhan: "✗", lop: "bg-rose-100 text-rose-900", chu: "Chưa đạt" },
  KHONG_AP_DUNG: {
    nhan: "–",
    lop: "bg-muted text-muted-foreground",
    chu: "Không áp dụng",
  },
  CHUA_DOI_CHIEU_DUOC: {
    nhan: "?",
    lop: "bg-amber-100 text-amber-900",
    chu: "Chưa đối chiếu được",
  },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ma trận đào tạo dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);
  const m = await napMaTran(db);
  const oCua = new Map(m.o.map((x) => [`${x.userId}::${x.requirementId}`, x] as const));

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/yeu-cau" className="underline">
          Yêu cầu đào tạo
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Ma trận đào tạo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Người × yêu cầu. Ô xám nghĩa là yêu cầu đó KHÔNG áp cho người đó — không
          phải thiếu dữ liệu.
        </p>
      </div>

      {/* ⚠️ Con số chính viết bằng NGƯỜI, không bằng phần trăm. Ở quy mô 15 người
          thì mỗi người là 6,7 điểm phần trăm — "80%" và "86,7%" là cùng một người,
          và một ngưỡng viết bằng phần trăm chỉ tạo ảo giác chính xác. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Đạt đủ mọi yêu cầu</p>
          <p className="mt-1 text-2xl font-bold">{m.nsmNguoi.cau}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ngưỡng quý đầu 12/15 người · cổng GĐ4 13/15 người
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Cặp (người × yêu cầu) đã đạt</p>
          <p className="mt-1 text-2xl font-bold">
            {m.nsm.tuSo}/{m.nsm.mauSo}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {/* Mẫu số 0 ⇒ không in phần trăm. "0% tuân thủ" đọc thành thảm hoạ,
                còn sự thật là chưa có yêu cầu nào được khai. */}
            {m.nsm.tiLe == null
              ? "Chưa có yêu cầu nào áp cho ai"
              : `${m.nsm.tiLe}% số cặp`}
          </p>
        </div>
        <div
          className={`rounded-md border p-3 ${
            m.nsm.chuaDoiChieuDuoc > 0 ? "border-amber-300 bg-amber-50" : ""
          }`}
        >
          <p className="text-xs text-muted-foreground">Chưa đối chiếu được</p>
          <p className="mt-1 text-2xl font-bold">{m.nsm.chuaDoiChieuDuoc}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {/* Nằm NGOÀI cả tử lẫn mẫu. Không hiện ra thì con số trên trông sạch
                trong khi một phần yêu cầu không được đo, và không ai biết phần ấy
                lớn cỡ nào. */}
            Nằm ngoài cả tử lẫn mẫu số — không được tính là đạt hay chưa đạt.
          </p>
        </div>
      </div>

      {m.soNguoiChuaCoTaiKhoan > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {/* Im lặng bỏ họ đi thì mẫu số hụt mà không ai biết hụt bao nhiêu. */}
          {m.soNguoiChuaCoTaiKhoan} nhân sự đang làm việc chưa có tài khoản nên không
          nằm trong ma trận này. Họ không vào được khu học, nên không giao bài cho họ
          được — báo phòng Nhân sự cấp tài khoản.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.keys(KIEU_O) as TrangThaiO[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded ${KIEU_O[k].lop}`}
            >
              {KIEU_O[k].nhan}
            </span>
            {/* Nhãn nằm trong phần tử RIÊNG: gộp chung với ký hiệu thì cả người
                đọc màn hình lẫn test đều nhận được chuỗi "✓Đạt", và "Đạt" khớp
                nhầm vào "Chưa đạt". */}
            <span>{KIEU_O[k].chu}</span>
          </span>
        ))}
      </div>

      {m.yeuCau.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-3 text-sm">
          Chưa có yêu cầu đào tạo nào đang hiệu lực. Ma trận trống không phải vì thiếu
          dữ liệu học — nó trống vì chưa ai khai nghĩa vụ nào.{" "}
          <Link href="/elearning/yeu-cau" className="underline">
            Khai yêu cầu đầu tiên
          </Link>
          .
        </p>
      ) : (
        <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={25}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Nhân sự</th>
                {m.yeuCau.map((y) => (
                  <th key={y.id} className="py-2 pr-3 font-normal">
                    {y.tenKhoa}
                    <span className="block text-[10px]">
                      {y.scopeKind}
                      {y.validityMonths ? ` · ${y.validityMonths} tháng` : " · vô hạn"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.nguoi.map((n) => (
                <tr key={n.userId} className="border-b">
                  <td className="py-2 pr-3">
                    {n.hoTen}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {n.maNhanVien}
                    </span>
                  </td>
                  {m.yeuCau.map((y) => {
                    const x = oCua.get(`${n.userId}::${y.id}`);
                    const k = KIEU_O[x?.trangThai ?? "KHONG_AP_DUNG"];
                    return (
                      <td key={y.id} className="py-2 pr-3">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded ${k.lop}`}
                          title={x?.lyDo ?? k.chu}
                        >
                          {k.nhan}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </div>
  );
}
