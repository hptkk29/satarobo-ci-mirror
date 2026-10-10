import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { coSoSuaDuoc } from "@/lib/settings/quyen-co-so";
import { SETTINGS } from "@/lib/settings/registry";
import { getResolvedSettings } from "@/lib/settings/service";
import { docCaiRiengTheoCoSo } from "@/lib/settings/co-so-cau-hinh";
import {
  TAB_CAU_HINH,
  QUYEN_TAB,
  coTabTheoQuyenSuaChung,
  duongTabDaDoi,
  keyCuaTab,
  nhanCuaKey,
  type TabId,
} from "@/lib/settings/nhan-van-hanh";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { catalogEntries } from "@/lib/notifications/catalog";
import { kiemVapid, MO_TA_LOI_VAPID } from "@/lib/push/cau-hinh-vapid";
import { PageHelp } from "@/components/admin/ui/page-help";
import { layVaiNhanHoaHong } from "@/lib/crm/vai-nhan-hoa-hong";
import type { ChinhSachHoaHong } from "@/lib/crm/chinh-sach-hoa-hong";
import { BangChinhSachHoaHong } from "./_components/bang-chinh-sach-hoa-hong";
import { TabPhuongThucThanhToan } from "./_components/tab-phuong-thuc-tt";
import { TabNickZalo } from "./_components/tab-nick-zalo";
import { MaTranQuyenXuat } from "./_components/ma-tran-quyen-xuat";
import { manXuatTheoNhom } from "@/lib/export/danh-muc-xuat";
import { layVaiHeThong } from "@/lib/export/vai-he-thong";
import { KhungCauHinh, type TabView } from "./_components/khung-cau-hinh";
import { ChonGvMienTru } from "./_components/chon-gv-mien-tru";
import type { CanhBaoKenh } from "./_components/chon-loai-thong-bao";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cấu hình vận hành | Admin Sata Robo" };

/** Tab mang thêm bảng chọn loại thông báo. */
const TAB_THONG_BAO = "thong-bao-day";

/**
 * Khoá này KHÔNG hiện thành một ô nhập: nó được chọn bằng bảng 51 công tắc ở cuối tab
 * "Thông báo điện thoại". Để nó hiện cả hai nơi là hai ô cùng sửa một giá trị, và người dùng
 * sẽ tin cái nào cũng có lý.
 */
const KHOA_DO_BANG_CONG_TAC_LO = "push.tienToDuocDay";

/**
 * Cùng lý do với khoá trên: chính sách hoa hồng là một DANH SÁCH, sửa bằng bảng riêng ở
 * tab "Hoa hồng". Để nó hiện thành ô nhập JSON nữa là hai chỗ cùng sửa một giá trị.
 */
const KHOA_DO_BANG_HOA_HONG = "crm.commissionPolicies";
// Ma trận quyền xuất có bảng riêng ⇒ lọc khỏi danh sách ô nhập, y như hai khoá trên. Không
// lọc thì màn vẽ một ô văn bản chứa JSON thô và mời người ta sửa tay.
const KHOA_DO_MA_TRAN_XUAT = "export.vaiTheoMan";

/**
 * Tab mang thêm bảng chọn giáo viên luôn hiện khi xếp buổi học thử.
 *
 * Khai kiểu `TabId` chứ không để chuỗi trần: đổi tên id tab trong `nhan-van-hanh.ts` mà quên
 * chỗ này thì bảng lặng lẽ rơi khỏi mọi tab — `khoiThem` tra theo id, không khớp thì không
 * dựng gì và cũng không báo gì. Gắn kiểu vào là `tsc` nói ngay.
 */
const TAB_LOP_GV: TabId = "lop-gv";

/**
 * Cùng lý do với hai khoá trên: danh sách giáo viên được miễn là một MẢNG MÃ NGƯỜI DÙNG.
 * Để nó hiện thành ô nhập JSON là bắt người vận hành gõ tay `cmf3k9x0a0001…`, và gõ sai thì
 * danh sách trông như đã khai mà không khớp ai. Chọn bằng bảng TÊN ở cuối tab Lớp & giáo viên.
 */
const KHOA_DO_BANG_CHON_GV = "trial.gvMienLocTheoCa";

export default async function OperationalSettingsPage({
  searchParams,
}: {
  // `?tab=` giữ tab đang mở qua các lần rời trang rồi quay lại — xem `doiTab` trong
  // `khung-cau-hinh.tsx`. `?centerId=` là đường vào từ trang Cơ sở.
  searchParams: Promise<{ tab?: string; centerId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // ── LINK CŨ TỚI TAB ĐÃ DỜI ĐI — PHẢI ĐỨNG TRƯỚC CỔNG TAB [09/10/2026] ────────────────────
  // Tab "Máy POS" đã dời về mục "Máy POS quẹt thẻ" của màn Cơ sở. Bookmark / chuông / tài liệu cũ vẫn trỏ
  // `?tab=may-pos`: nếu để rơi xuống cổng bên dưới thì Kế toán Hội sở — người duy nhất dùng tab đó, và nay KHÔNG giữ tab
  // nào của màn này — bị đá về dashboard thay vì tới chỗ khai máy. Nên hỏi bảng "tab đã dời" TRƯỚC, và chuyển tới `/centers`
  // (link cũ không mang cơ sở nào). Ca `[HN2-MP-W05]`.
  const sp = await searchParams;
  const dich = duongTabDaDoi(sp.tab);
  if (dich) redirect(dich);

  // ── CỔNG VÀO: theo TỪNG TAB, không phải một quyền cho cả màn ──────────────────────────
  // Trước 24/09 màn này gác bằng đúng `settings:view`, mà quyền đó thực tế chỉ Quản trị
  // tối cao có (ma trận v1 khai `["SUPER_ADMIN"]`, và trong `seed-roles.ts` KHÔNG có dòng
  // nào cấp nó — nên trên prod, nơi RBAC v2 đọc quyền từ DB, không vai nào khác mở được).
  //
  // Chủ dự án chốt 24/09: quản lý cơ sở phải vào được NHỮNG PHẦN THUỘC CƠ SỞ. Cách làm là
  // cho mỗi tab một quyền riêng (`QUYEN_TAB`) rồi:
  //   · vào được màn nếu giữ quyền của ÍT NHẤT MỘT tab;
  //   · và chỉ THẤY những tab mình giữ quyền.
  // Nhờ vậy nới một tab không kéo theo 13 tab kia — thứ sẽ xảy ra nếu chỉ nới
  // `settings:view`.
  const quyenTab = await Promise.all(
    TAB_CAU_HINH.map(async (t) => ({ id: t.id, duoc: await checkPermission(QUYEN_TAB[t.id]) })),
  );
  const tabDuocXem = new Set(quyenTab.filter((q) => q.duoc).map((q) => q.id));
  if (tabDuocXem.size === 0) {
    // Lớp THỨ HAI của link cũ `?tab=may-pos` (lớp thứ nhất là `duongTabDaDoi` ở trên). Người MỞ BOOKMARK LÚC CHƯA ĐĂNG NHẬP không bao
    // giờ chạm lớp thứ nhất: proxy đá /login?callbackUrl=/admin/cau-hinh-van-hanh (`sanitizeCallbackUrl` bỏ query), sau đăng nhập trang
    // này không còn `tab=` nào. Họ là Kế toán HO — không giữ tab nào của màn này — nên rơi xuống đây; chỉ họ (tập người từng dùng tab Máy
    // POS, cổng `payments:import-pos`) được đưa tới chỗ khai máy, còn lại về dashboard như trước. Ca `[HN2-RD-09]`.
    redirect((await checkPermission("payments:import-pos")) ? "/centers" : "/admin/dashboard");
  }

  // ── HAI THỨ KHÁC NHAU, TRƯỚC 24/09 LÀ MỘT BIẾN ───────────────────────────────────────
  //
  //   · `canEditGlobal`  — sửa được giá trị TOÀN HỆ THỐNG. Chỉ Quản trị tối cao.
  //   · `suaDuocCoSo`    — sửa được phần CỦA CƠ SỞ MÌNH (khối "Cài riêng theo cơ sở").
  //
  // ⚠️ Gộp hai cái này làm một là điều màn này vừa làm, và nó biến quyền mới thành quyền
  // CHẾT: `choSua` chảy thẳng xuống `CaiRiengTheoCoSo`, nên một Quản lý cơ sở vào được tab
  // "Tiền & thanh toán" sẽ thấy MỌI ô — kể cả khối cài riêng — bị `disabled`, cộng một
  // dòng chữ vàng nói "Bạn chỉ có quyền xem". Trong khi ĐƯỜNG GHI cho họ qua:
  // `saveCenterSettingAction` không gác gì ở đầu hàm, nó giao hết cho `setCenterSetting`,
  // và hàm đó chỉ đòi vai quản lý tại ĐÚNG `orgUnitId` đang sửa.
  //
  // Tức giao diện nói KHÔNG trong khi server nói CÓ. Người dùng tin giao diện và đi báo
  // "chưa được cấp quyền" — đúng lớp lỗi luật 12: affordance không ném lỗi, không làm test
  // đỏ, console vẫn sạch; chỉ người bấm mới biết.
  const canEditGlobal = await checkPermission("settings:edit"); // settings:edit = SUPER_ADMIN
  // Chế độ CƠ SỞ: vào màn bằng quyền cấp cơ sở, không phải quyền quản trị toàn hệ.
  const cheDoCoSo = !canEditGlobal && (await checkPermission("settings:view-center"));
  const suaDuocCoSo = canEditGlobal || cheDoCoSo;
  // Người xem có thấy tab nào mà quyền sửa đi theo `settings:edit` không. Chỉ thấy tab TỰ QUẢN
  // quyền ghi (nick Zalo; trước 09/10/2026 còn Máy POS) thì dải "chỉ có quyền xem" + câu "phải ghi lý do" là nói sai
  // — tab đó thêm / sửa được và action của nó không đòi lý do. Ca `[QT-06]` `[POS-UI-08]`.
  const coOCauHinhChung = coTabTheoQuyenSuaChung(tabDuocXem);

  // Chỉ đọc những key THẬT SỰ bày ra. Dựng danh sách từ bảng tab chứ không từ `SETTING_KEYS`:
  // như vậy một key mới mà quên khai nhãn vận hành sẽ KHÔNG lặng lẽ hiện ra dưới dạng tên
  // biến — nó vắng mặt, và `nhan-van-hanh.test.ts` làm đỏ ngay ở CI.
  //
  // ⚠️ CHẾ ĐỘ CƠ SỞ LỌC BẰNG `qlcsSuaDuoc`, KHÔNG PHẢI `centerOverridable` [sửa 25/09].
  //
  // Bản 24/09 lọc bằng `centerOverridable` và nó SAI THEO CHIỀU NỚI: tab "Thanh toán" có
  // 13 khoá cài-riêng-được, nên Quản lý cơ sở thấy và sửa được cả mức ưu đãi anh chị em,
  // dung sai làm tròn khi đối soát, hạn mã QR, số ngày nhắc nợ — trong khi chốt 22/09 chỉ
  // nói đúng hai thứ: *"trần số đợt / số ưu đãi"*. Chủ dự án mở tài khoản QLCS và hỏi
  // ngay: *"setting của admin sao nằm ở QLCS?"*
  //
  // Hai cờ trả lời hai câu khác nhau: `centerOverridable` = "cơ chế có cho cài riêng
  // không", `qlcsSuaDuoc` = "AI được bấm". Gộp chúng là để câu thứ hai đi nhờ câu thứ
  // nhất — và mỗi lần ai đó bật `centerOverridable` cho một khoá mới là lặng lẽ cấp thêm
  // quyền cho cấp cơ sở.
  //
  // Lọc bằng cờ trong registry chứ không bằng danh sách gõ tay: danh sách gõ tay là bản
  // thứ hai của một sự thật đã có chủ, và nó lệch ngay lần đầu ai đó thêm khoá.
  const keyTheoTab = TAB_CAU_HINH.map((t) => ({
    tab: t,
    keys: cheDoCoSo
      ? keyCuaTab(t.id).filter((k) => SETTINGS[k]?.qlcsSuaDuoc === true)
      : keyCuaTab(t.id),
  }));
  const moiKey = keyTheoTab.flatMap((x) => x.keys);
  // Hai key của hai tab có bảng riêng KHÔNG nằm trong `moiKey` (đã lọc khỏi danh sách ô
  // nhập) nên phải nạp thêm — quên là bảng hoa hồng mở ra rỗng và người dùng tưởng mất
  // cấu hình.
  const resolved = await getResolvedSettings([
    ...moiKey,
    "crm.commissionPolicies",
    "crm.commissionMaxTotalRate",
  ]);
  // PHIÊN H — cơ sở + giá trị cài riêng, cho khối "Cài riêng theo cơ sở" ở từng dòng.
  //
  // ⚠️ `docCaiRiengTheoCoSo` trả về map CHỈ chứa khoá `centerOverridable` (đo 22/09/2026:
  // 47 khoá cho / 72 khoá không). Khoá không cho cài riêng thì vắng mặt khỏi map ⇒ dòng đó
  // không mang `coSo` ⇒ không vẽ khối. Đừng "vá" bằng cách truyền mảng rỗng: mảng rỗng và
  // vắng mặt trông giống nhau ở đây, nhưng vắng mặt là điều MAP nói, còn mảng rỗng là điều
  // ta tự bịa ra.
  //
  // ⚠️ PHẠM VI: chỉ bày cơ sở người xem SỬA ĐƯỢC. Quản trị tối cao quản lý mọi cơ sở nên
  // trước 24/09 không ai thấy lỗ — nhưng từ lúc Quản lý cơ sở vào được màn này, bày đủ
  // danh sách là hiện ô của CS khác dưới dạng MỞ, rồi lần bấm Lưu nhận "Không có quyền sửa
  // cấu hình cơ sở này". `coSoSuaDuoc` và cổng ghi `setCenterSetting` nay dùng CHUNG một
  // phép kiểm (`lib/settings/quyen-co-so.ts`), nên chúng không lệch được.
  const caiRieng = await docCaiRiengTheoCoSo(moiKey, coSoSuaDuoc(await resolveActor(session.user.id)));

  // Vai có thật, kèm TÊN TIẾNG VIỆT — ô chọn vai nhận hoa hồng không được in mã máy.
  const vai = await layVaiNhanHoaHong();

  // Giáo viên có thật, kèm TÊN — cùng lý do với dòng ngay trên. `getAssignableTeachers` là
  // nguồn DUY NHẤT của câu "ai là giáo viên phân lớp được" (`lib/teachers/assignable.ts`);
  // chép lại điều kiện lọc ở đây là đẻ bản thứ hai, và hai bản sẽ lệch nhau.
  //
  // KHÔNG truyền `centerIds`: đây là cấu hình TOÀN HỆ THỐNG và chỉ quản trị cấp cao nhất sửa
  // được, nên danh sách phải là mọi cơ sở. Lọc theo cơ sở của người đang xem thì hai quản
  // trị viên mở cùng màn sẽ thấy hai danh sách khác nhau cho cùng một giá trị.
  const giaoVien = (await getAssignableTeachers({})).map((g) => ({ id: g.id, ten: g.name }));

  // Ma trận quyền xuất: danh mục màn là HẰNG (thuần), còn danh mục vai đọc từ DB để ô tích
  // không bao giờ bày một vai đã bị xoá.
  const nhomManXuat = manXuatTheoNhom();
  const vaiHeThong = await layVaiHeThong();
  const bangQuyenXuat = (resolved[KHOA_DO_MA_TRAN_XUAT] ??
    SETTINGS[KHOA_DO_MA_TRAN_XUAT].default) as Record<string, string[]>;

  const tabs: TabView[] = keyTheoTab.filter(({ tab }) => tabDuocXem.has(tab.id)).map(({ tab, keys }) => ({
    id: tab.id,
    ten: tab.ten,
    moTa: tab.moTa,
    rows: keys
      .filter(
        (k) =>
          k !== KHOA_DO_BANG_CONG_TAC_LO &&
          k !== KHOA_DO_BANG_HOA_HONG &&
          k !== KHOA_DO_MA_TRAN_XUAT &&
          k !== KHOA_DO_BANG_CHON_GV,
      )
      .map((key) => ({
        key,
        // `resolved` trả giá trị đã hoà (cơ sở → toàn hệ → mặc định). Thiếu thì lấy mặc định
        // của registry — KHÔNG để `undefined` lọt vào ô nhập, vì ô rỗng trông hệt như "giá trị
        // là chuỗi rỗng" và người dùng sẽ bấm lưu đè lên một con số đang chạy.
        value: resolved[key] ?? SETTINGS[key].default,
        nhan: nhanCuaKey(key),
        coSo: caiRieng[key],
      })),
  }));

  // ── Dữ liệu riêng của tab thông báo ────────────────────────────────────────────────────
  const danhMucThongBao = catalogEntries();
  const thoDangBat = resolved[KHOA_DO_BANG_CONG_TAC_LO];
  const loaiDangBat = Array.isArray(thoDangBat)
    ? thoDangBat.filter((x): x is string => typeof x === "string")
    : [];

  const canhBaoKenh: CanhBaoKenh[] = [];
  if (resolved["push.webPushEnabled"] !== true) {
    canhBaoKenh.push({
      cau: "Thông báo trên điện thoại đang TẮT",
      choSua: "Bật bằng công tắc ở ngay đầu tab này.",
    });
  }
  const { loi: loiVapid } = kiemVapid();
  if (loiVapid) {
    canhBaoKenh.push({
      cau: `Hệ thống chưa gửi được thông báo: ${MO_TA_LOI_VAPID[loiVapid]}`,
      choSua: "Việc này cần bên kỹ thuật sửa trên máy chủ, không sửa được ở đây.",
    });
  }
  // Khoá lạ còn sót trong cấu hình — bảng công tắc chỉ bày loại CÓ THẬT nên không ai bỏ chọn
  // được nó. Im lặng thì nó nằm đó mãi và số đếm trên màn hình lệch với số trong dữ liệu.
  const hopLe = new Set(danhMucThongBao.map((e) => e.prefix));
  const khoaLa = loaiDangBat.filter((t) => !hopLe.has(t));
  if (khoaLa.length > 0) {
    canhBaoKenh.push({
      cau: `Còn ${khoaLa.length} mục không còn tồn tại trong danh sách loại thông báo`,
      choSua: "Bấm Lưu một lần ở bảng dưới là dọn xong.",
    });
  }

  // ── Dữ liệu riêng của bảng chọn giáo viên luôn hiện ───────────────────────────────────
  //
  // `resolved` đã mang hai khoá này (chúng có nhãn ở tab `lop-gv` nên nằm trong `moiKey`);
  // chỉ khoá `trial.gvMienLocTheoCa` bị lọc khỏi DANH SÁCH Ô NHẬP, không phải khỏi lần đọc.
  const thoGvMien = resolved[KHOA_DO_BANG_CHON_GV];
  const gvMienDangChon = Array.isArray(thoGvMien)
    ? thoGvMien.filter((x): x is string => typeof x === "string")
    : [];
  // `=== true` chứ không ép kiểu: một giá trị hỏng trong DB phải rơi về TẮT (fail-closed),
  // và bảng bên dưới sẽ nói "việc lọc đang tắt" — đúng thứ đang xảy ra.
  const locGvDangBat = resolved["trial.locGvTheoCaLamViec"] === true;

  return (
    // CĂN GIỮA + trần theo bậc màn. Bản đầu để `max-w-4xl` không `mx-auto`, và đo thật trên
    // Chromium cho thấy khối nội dung dính mép trái, bỏ trống 2688px ở 4K và 6528px ở 8K —
    // trang thành một dải hẹp lệch hẳn về một bên.
    //
    // Trần nới theo bậc chứ không thả tự do: một hàng cấu hình kéo dài 3000px thì nhãn nằm
    // tận mép trái còn ô nhập tận mép phải, mắt phải quét cả màn hình cho MỘT dòng. 1180px ở
    // laptop, 1360px từ 2K trở lên — đủ để 11 tab nằm gọn một hàng mà vẫn giữ được khoảng
    // quét mắt hợp lý.
    <div className="mx-auto w-full max-w-[1180px] space-y-5 2xl:max-w-[1360px]">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cấu hình vận hành</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Các thiết lập dùng chung cho cả hệ thống
        </p>
      </div>

      <PageHelp>
        <p>
          Mỗi tab là một nhóm việc. Đổi xong bấm <strong>Lưu</strong> ngay dòng đó — thay đổi
          có hiệu lực luôn, không cần chờ ai cài đặt lại gì.
        </p>
        {coOCauHinhChung && (
          <>
            <p className="mt-2">
              Mỗi lần lưu đều phải ghi <strong>lý do</strong> và được lưu vào nhật ký kiểm toán,
              nên về sau luôn tra được ai đổi cái gì và vì sao. Dòng có dấu tam giác vàng là dòng
              đổi sai sẽ ảnh hưởng rộng hoặc phát sinh chi phí — đọc kỹ phần giải thích trước khi
              sửa.
            </p>
            <p className="mt-2">
              Mặc định các thiết lập ở đây áp cho <strong>toàn hệ thống</strong>. Dòng nào có dòng
              chữ <strong>Cài riêng theo cơ sở</strong> bên dưới thì mở ra được để đặt mức khác cho
              một cơ sở — mỗi cơ sở hiện rõ đang <em>theo toàn hệ</em>, <em>bật riêng</em> hay{" "}
              <em>tắt riêng</em>. Bấm <strong>Trả về theo toàn hệ</strong> là gỡ mức riêng ấy đi,
              không phải tắt nó.
            </p>
          </>
        )}
      </PageHelp>

      {/* ⚠️ Câu này PHẢI rẽ theo chế độ. Nói "bạn chỉ có quyền xem" với một Quản lý cơ sở là
          nói sai: họ sửa được phần của cơ sở mình, và server cho họ ghi. Người tin câu đó
          sẽ không mở khối "Cài riêng theo cơ sở" ra, và tính năng coi như không tồn tại. */}
      {cheDoCoSo && (
        <div className="rounded-lg border border-state-info-soft bg-state-info-soft px-4 py-3 text-sm text-state-info-ink">
          Bạn sửa được phần <strong>của cơ sở mình</strong>: mở khối{" "}
          <strong>Cài riêng theo cơ sở</strong> ở từng dòng. Mức <strong>toàn hệ thống</strong>{" "}
          do quản trị cấp cao nhất đặt, bạn chỉ xem.
        </div>
      )}
      {!canEditGlobal && !cheDoCoSo && coOCauHinhChung && (
        <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          Bạn chỉ có quyền <strong>xem</strong>. Việc thay đổi dành cho quản trị cấp cao nhất.
        </div>
      )}

      <KhungCauHinh
        tabs={tabs}
        choSua={canEditGlobal}
        choSuaCoSo={suaDuocCoSo}
        tabThongBao={TAB_THONG_BAO}
        danhMucThongBao={danhMucThongBao}
        loaiDangBat={loaiDangBat}
        canhBaoKenh={canhBaoKenh}
        tabBanDau={sp.tab}
        // ⚠️ `khoiThem`, KHÔNG phải `noiDungRieng`: tab "Lớp & giáo viên" có 5 ô cấu hình
        // phải giữ nguyên. `noiDungRieng` THAY bảng ô cấu hình — dùng nhầm nó ở đây là xoá
        // trắng 5 dòng đang chạy khỏi màn hình, không lỗi, không cảnh báo.
        khoiThem={{
          [TAB_LOP_GV]: (
            <ChonGvMienTru
              giaoVien={giaoVien}
              dangChon={gvMienDangChon}
              choSua={canEditGlobal}
              locDangBat={locGvDangBat}
            />
          ),
        }}
        noiDungRieng={{
          "phuong-thuc-tt": (
            <TabPhuongThucThanhToan centerIdFilter={sp.centerId?.trim() || null} />
          ),
          "nick-zalo": <TabNickZalo />,
          "quyen-xuat": (
            <MaTranQuyenXuat
              nhomMan={nhomManXuat}
              vai={vaiHeThong}
              banDau={bangQuyenXuat}
              suaDuoc={canEditGlobal}
            />
          ),
          "hoa-hong": (
            <BangChinhSachHoaHong
              banDau={(resolved[KHOA_DO_BANG_HOA_HONG] ??
                SETTINGS[KHOA_DO_BANG_HOA_HONG].default) as ChinhSachHoaHong[]}
              tranTongTiLe={
                typeof resolved["crm.commissionMaxTotalRate"] === "number"
                  ? (resolved["crm.commissionMaxTotalRate"] as number)
                  : (SETTINGS["crm.commissionMaxTotalRate"].default as number)
              }
              vai={vai}
              suaDuoc={canEditGlobal}
            />
          ),
        }}
      />
    </div>
  );
}
