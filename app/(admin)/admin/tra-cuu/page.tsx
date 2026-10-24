// app/(admin)/admin/tra-cuu/page.tsx — TRA CỨU DANH MỤC: giá khoá, giá học cụ, lớp còn chỗ.
//
// Màn CHỈ ĐỌC. Mục đích hẹp: đang ngồi (hoặc đang nghe điện) với phụ huynh thì tra
// được ngay, không phải quay về khu quản trị hay hỏi miệng đồng nghiệp. Không có nút
// nào ghi dữ liệu, và cũng không nên có — bảng giá là việc của Đào tạo/Kế toán.
//
// ═══ THIẾT KẾ LẠI 22/09/2026 ════════════════════════════════════════════════════
// Bản cũ: ba thẻ xếp chồng, mỗi thẻ một bảng, không có ô tìm — muốn xem lớp thì phải
// cuộn qua hết bảng giá khoá và bảng học cụ, muốn tra một cái tên thì dò bằng mắt.
// Bản này: MỘT ô tìm + MỘT bảng, chuyển danh mục bằng chip có mang SỐ KẾT QUẢ.
// Xem `_components/tra-cuu-workspace.tsx` cho phần lý do đầy đủ.
//
// Trang chỉ lo DỮ LIỆU và QUYỀN: nạp đúng khối người xem được phép, định dạng sẵn mọi
// chuỗi (tiền/ngày/nhãn) và ghép sẵn chuỗi tìm đã bỏ dấu. Component không tự đọc gì.
//
// Ba khối lọc theo quyền: ai có quyền nào thấy khối đó. Không ai bị đá ra vì thiếu
// một quyền — trang vẫn mở với phần mình được xem.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission, checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { getSaleCatalog } from "@/lib/catalog/sale-catalog";
import { formatVndPlain } from "@/lib/format/money";
import { formatDateVN } from "@/lib/format/date";
import { PageHeader } from "@/components/admin/ui/page-header";
import { NoPermission } from "@/components/admin/ui/states";
import { boDau } from "@/lib/ui/bo-dau";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { docDanhSachChinhSach } from "@/lib/khuyen-mai/chinh-sach";
import { NHAN_TRANG_THAI, trangThaiTai } from "@/lib/khuyen-mai/hieu-luc";
import { khoangVi, nhacThoiGian } from "../khuyen-mai/_components/dinh-dang";
import { TraCuuWorkspace, type KhoiTraCuu } from "./_components/tra-cuu-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tra cứu | Admin" };

const TRANG_THAI_LOP_VI: Record<string, string> = {
  PLANNED: "Dự kiến",
  RECRUITING: "Đang tuyển",
  ACTIVE: "Đang học",
};

const NHOM_HOC_CU_VI: Record<string, string> = {
  KIT_ROBOT: "Bộ robot",
  SENSOR: "Cảm biến",
};

export default async function TraCuuPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Ftra-cuu");
  if (!(await checkAnyPermission(PAGE_GATES["/tra-cuu"]))) redirect("/dashboard?error=unauthorized");

  // Hỏi từng quyền để nạp đúng khối được xem. Cổng trang ở trên dùng phép HOẶC:
  // vào được rồi thì phần nào thấy phần đó, không đá ai ra vì thiếu một quyền.
  const [xemHocCu, xemLop, xemKhuyenMai] = await Promise.all([
    checkPermission("products:view"),
    checkPermission("classes:view-all"),
    checkPermission("promotions:view"),
  ]);
  // Giá khoá học: Sale KHÔNG có `courses:view` (quyền đó của Đào tạo/GV), nhưng
  // vẫn thấy giá khoá trong form tạo đơn — bảng giá là thứ nghề của họ. Nên gác
  // bằng chính quyền đã mở cửa đó, không khai quyền mới.
  const xemKhoaHoc =
    (await checkPermission("orders:create")) || (await checkPermission("courses:view"));

  const actor = await resolveActor(session.user.id);
  const [dm, chinhSach] = await Promise.all([
    getSaleCatalog(actor, { xemHocCu, xemLop, xemKhoaHoc }),
    xemKhuyenMai ? docDanhSachChinhSach() : Promise.resolve([]),
  ]);

  // Thứ tự khối = thứ tự hỏi của phụ huynh: giá khoá trước, rồi lớp nào học được,
  // học cụ sau cùng (câu hỏi phát sinh chứ ít khi mở đầu).
  const khoi: KhoiTraCuu[] = [];

  if (xemKhoaHoc) {
    khoi.push({
      ma: "khoa",
      nhan: "Khoá học",
      donVi: "khoá",
      khiRong: "Chưa có khoá nào đang mở bán.",
      cot: [{ ten: "Khoá học", rong: true }, { ten: "Mã", anMobile: true }, { ten: "Giá", phai: true }],
      dong: dm.khoaHoc.map((k) => ({
        key: k.id,
        tim: boDau(`${k.name} ${k.code ?? ""}`),
        o: [k.name, k.code ?? "—", k.price == null ? "—" : formatVndPlain(k.price)],
      })),
    });
  }

  if (xemLop) {
    khoi.push({
      ma: "lop",
      nhan: "Lớp đang mở",
      donVi: "lớp",
      khiRong: "Cơ sở của bạn chưa có lớp nào đang mở.",
      cot: [
        { ten: "Lớp" },
        { ten: "Khoá", anMobile: true },
        { ten: "Cơ sở", anMobile: true },
        { ten: "Lịch", rong: true, anMobile: true },
        { ten: "Khai giảng", anMobile: true },
        { ten: "Trạng thái", anMobile: true },
        { ten: "Còn chỗ", phai: true },
      ],
      // Lớp hết chỗ vẫn hiện, nhưng nhạt đi: sale cần biết nó tồn tại để trả lời
      // "lớp đó đầy rồi", chứ không phải để giấu.
      dong: dm.lop.map((l) => ({
        key: l.id,
        mo: l.conTrong === 0,
        tim: boDau(`${l.ten} ${l.tenKhoa} ${l.tenCoSo ?? ""} ${l.lich ?? ""}`),
        o: [
          l.ten,
          l.tenKhoa,
          l.tenCoSo ?? "—",
          l.lich ?? "—",
          l.batDau ? formatDateVN(l.batDau) : "chưa định",
          { t: TRANG_THAI_LOP_VI[l.status] ?? l.status, pill: "info" as const },
          l.conTrong === 0
            ? { t: "hết chỗ", pill: "muted" as const }
            : { t: `${l.conTrong}/${l.sucChua}`, pill: "success" as const },
        ],
      })),
    });
  }

  if (xemKhuyenMai) {
    // Chỉ văn bản ĐANG hoặc SẮP áp dụng — màn này dùng trước mặt khách, văn bản đã hết/thu hồi
    // ở đây chỉ là cám dỗ trích nhầm. Trạng thái hỏi đúng MỘT hàm với màn Khuyến mãi và agent.
    const homNay = ngayVN(new Date());
    const conHieuLuc = chinhSach
      .map((c) => ({ c, tt: trangThaiTai(c, homNay) }))
      .filter((x) => x.tt === "dang_ap_dung" || x.tt === "sap_ap_dung")
      .sort((a, b) => (a.tt === b.tt ? a.c.tuNgay.localeCompare(b.c.tuNgay) : a.tt === "dang_ap_dung" ? -1 : 1));
    khoi.push({
      ma: "khuyen-mai",
      nhan: "Khuyến mãi",
      donVi: "chính sách",
      khiRong: "Hôm nay không có chính sách khuyến mãi nào đang hoặc sắp áp dụng.",
      luuY: "Bấm vào dòng để xem điều kiện đầy đủ, mã voucher và văn bản gốc.",
      // Theo hai lượt rà thiết kế 26/09: ưu đãi (tự xuống 2 dòng; dòng phụ = mã văn bản + mã voucher)
      // rồi NGAY SAU là Trạng thái — cột cuối là cột bị đẩy ra ngoài trước tiên, mà trạng thái là
      // thứ Sale không được bỏ lỡ. Không còn cột "Văn bản" riêng (mã nằm ở dòng phụ) và Hiệu lực tách
      // hai dòng: đo ở 1280px bảng vẫn tràn trong card khi còn 5 cột một dòng. Dưới 640px cột Trạng
      // thái ẩn và nhãn nằm TRONG ô ưu đãi.
      cot: [
        { ten: "Ưu đãi", rong: true },
        { ten: "Trạng thái", anMobile: true },
        { ten: "Hiệu lực", anMobile: true },
        { ten: "Áp dụng", anMobile: true, cat: true },
      ],
      dong: conHieuLuc.map(({ c, tt }) => {
        const apDung = [
          c.toanHeThong ? "Toàn hệ thống" : c.coSo.map((x) => x.ma).join(", "),
          c.moiKhoa ? "mọi khoá" : c.khoaHoc.map((k) => k.ten).join(", "),
        ].join(" · ");
        const maDangBat = c.vouchers.filter((v) => v.dangBat).map((v) => v.ma);
        const nhac = nhacThoiGian(tt, c.tuNgay, c.ketThuc, homNay);
        const nhan = { t: NHAN_TRANG_THAI[tt], pill: tt === "dang_ap_dung" ? ("success" as const) : ("info" as const) };
        return {
          key: c.id,
          tim: boDau(`${c.maVanBan} ${c.ten} ${c.noiDungUuDai} ${maDangBat.join(" ")} ${apDung}`),
          href: `/khuyen-mai/${c.id}`,
          o: [
            {
              t: c.noiDungUuDai.split(/\r?\n/)[0] ?? "",
              phu: `${c.maVanBan}${maDangBat.length ? ` · Mã ${maDangBat.join(", ")}` : ""}`,
              nhanMobile: nhan,
            },
            nhan,
            { t: khoangVi(c.tuNgay, c.ketThuc), phu: nhac, phuMo: true },
            apDung,
          ],
        };
      }),
    });
  }

  if (xemHocCu) {
    khoi.push({
      ma: "hoc-cu",
      nhan: "Học cụ",
      donVi: "mặt hàng",
      khiRong: "Chưa có học cụ nào đang bán.",
      // Nói thẳng vì sao không có cột tồn kho — không thì người dùng nghĩ là thiếu
      // sót rồi đi hỏi.
      luuY:
        "Không hiện tồn kho: số lượng còn lại do bộ phận kho nắm — hỏi quản lý cơ sở trước khi hứa giao hàng với khách.",
      cot: [
        { ten: "Tên", rong: true },
        { ten: "Mã", anMobile: true },
        { ten: "Nhóm", anMobile: true },
        { ten: "Giá bán", phai: true },
      ],
      dong: dm.hocCu.map((h) => ({
        key: h.id,
        tim: boDau(`${h.name} ${h.sku} ${NHOM_HOC_CU_VI[h.category] ?? h.category}`),
        o: [
          h.name,
          h.sku,
          NHOM_HOC_CU_VI[h.category] ?? h.category,
          formatVndPlain(h.salePrice),
        ],
      })),
    });
  }

  return (
    <div>
      <PageHeader
        title="Tra cứu"
        subtitle="Bảng giá, lớp đang mở và khuyến mãi đang áp dụng. Trang chỉ để xem — sửa giá hay mở lớp là việc của Đào tạo và Quản lý cơ sở."
      />

      {khoi.length === 0 ? (
        // Trạng thái thứ tư của DESIGN.md §5: nói rõ THIẾU QUYỀN NÀO và HỎI AI.
        // Vào được trang (cổng dùng phép HOẶC) mà không khối nào mở được là chuyện
        // có thật khi ai đó được cấp đúng một quyền rồi quyền đó bị gỡ.
        <NoPermission
          what="danh mục nào"
          permission="products:view · classes:view-all · orders:create · promotions:view"
        />
      ) : (
        <TraCuuWorkspace khoi={khoi} />
      )}
    </div>
  );
}
