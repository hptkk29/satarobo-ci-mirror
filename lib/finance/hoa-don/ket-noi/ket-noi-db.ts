import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { laProductionThat } from "@/lib/security/client-ip";
import { giaiMaBiMat, LoiHopBiMat, maHoaBiMat } from "@/lib/security/hop-bi-mat";
import { kiemBaseUrl as kiemBaseUrlMisa, type CauHinhHsm } from "@/lib/misa/meinvoice/cau-hinh";
import { kiemBaseUrlVin, type CauHinhVin } from "@/lib/vin-hoadon/cau-hinh";
import { cauHinhHoaDonChoMoiTruong } from "../phap-nhan-theo-moi-truong";
import { nhaCungCapApiCuaPhapNhan, nhaCungCapHieuLuc } from "../phap-nhan";
import { phamViKeToan } from "../quyen";
import { docKhoaBiMat, MUC_DICH_KET_NOI, nguCanhKetNoi } from "./khoa-bi-mat";
import {
  chuanHoaBaseUrl,
  kiemKetNoi,
  laMoiTruongKetNoi,
  moiTruongKetNoiTuMoiTruongChay,
  type DauVaoKetNoi,
  type KetNoiDaDoc,
  type MoiTruongKetNoi,
} from "./luat";

// lib/finance/hoa-don/ket-noi/ket-noi-db.ts — đọc / ghi bảng `HoaDonKetNoiNhaCungCap` (hub/13). Luật ở `luat.ts` (thuần, có test).
//
// ⚠️ BẢNG NÀY KHÔNG CÓ centerId/orgUnitId (dữ liệu cấp PHÁP NHÂN) nên `scopedDb` không che gì được — TOÀN BỘ kiểm soát truy cập nằm ở đây:
//    mọi hàm đọc/ghi của NGƯỜI DÙNG đòi `phamViKeToan(actor) === "ALL"` (kế toán Hội sở). Kế toán cơ sở KHÔNG thấy, KHÔNG sửa — nếu không, họ đọc
//    được (và đổi được) tài khoản của pháp nhân khác. Người gọi (action) vẫn phải `checkPermission("payments:confirm")` trước.
// ⚠️ MẬT KHẨU: `matKhauMaHoa` KHÔNG BAO GIỜ nằm trong kết quả trả ra giao diện / nhật ký / thông điệp lỗi. Duy nhất `docTaiKhoanChoPhatHanh` giải mã,
//    và chỉ cho máy chủ phát hành (không qua người dùng).
// ⚠️ Nhật ký chỉ ghi TÊN trường đã đổi + giá trị KHÔNG nhạy cảm; mật khẩu chỉ ghi "đã đổi" (true/false).

const ENTITY = "HoaDonKetNoiNhaCungCap";

// ─── Nhà cung cấp ĐÃ CHỌN của pháp nhân (05/11/2026) ─────────────────────────────────────────────────────────────────

/**
 * Khoá tư vấn Postgres CẤP PHÁP NHÂN giữa hai việc không được chồng nhau: «đổi nhà cung cấp» (ĐỘC QUYỀN) và «bắt đầu phát hành» (DÙNG CHUNG). Dùng khoá tư vấn chứ không khoá dòng
 * vì pháp nhân chưa có dòng kết nối nào (prod hôm nay) thì không có dòng để khoá. Có thứ tự khoá cố định (đơn → khoá này), nên không có vòng chờ.
 * `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock*` trả `void`, Prisma không đọc được cột kiểu đó (cùng mẫu `lib/affiliate/ghi-doi-tac.ts`).
 */
const khoaNhaCungCap = (phapNhanMa: string): string => `hoa-don-nha-cung-cap:${phapNhanMa}`;
export async function khoaNhaCungCapDocQuyen(tx: Pick<Prisma.TransactionClient, "$executeRaw">, phapNhanMa: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${khoaNhaCungCap(phapNhanMa)}))`;
}
export async function khoaNhaCungCapDungChung(tx: Pick<Prisma.TransactionClient, "$executeRaw">, phapNhanMa: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${khoaNhaCungCap(phapNhanMa)}))`;
}

type DocNhaCungCap = Pick<Prisma.TransactionClient, "hoaDonKetNoiNhaCungCap">;

/**
 * Nhà cung cấp trên DÒNG KẾT NỐI của (pháp nhân × môi trường đang chạy), hoặc `null` nếu chưa có dòng. Đọc bằng `client` truyền vào — trong transaction khi cần nhất quán với
 * khoá ở trên. KHÔNG kiểm quyền: chỉ trả tên nhà cung cấp (không tài khoản/mật khẩu), mọi kế toán dùng được để nút nói đúng.
 */
export async function docNhaCungCapDaChon(phapNhanMa: string, env?: Record<string, string | undefined>, client: DocNhaCungCap = db): Promise<string | null> {
  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat(env ?? process.env));
  const h = await client.hoaDonKetNoiNhaCungCap.findUnique({ where: { phapNhanMa_moiTruong: { phapNhanMa, moiTruong } }, select: { nhaCungCapMa: true } });
  return h?.nhaCungCapMa ?? null;
}

/** Như trên cho MỌI pháp nhân một lượt (bộ nạp danh sách — một câu truy vấn, không N+1). Pháp nhân chưa có dòng không có mặt trong bản đồ. */
export async function docNhaCungCapDaChonTheoPhapNhan(env?: Record<string, string | undefined>): Promise<ReadonlyMap<string, string>> {
  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat(env ?? process.env));
  const ds = await db.hoaDonKetNoiNhaCungCap.findMany({ where: { moiTruong }, select: { phapNhanMa: true, nhaCungCapMa: true } });
  return new Map(ds.map((d) => [d.phapNhanMa, d.nhaCungCapMa]));
}

/** Câu nghiệp vụ khi cổng ĐỔI nhà cung cấp từ chối. Ném trong transaction ⇒ rollback; `luuKetNoi` bắt và trả `{ ok:false }`. */
class LoiDoiNhaCungCap extends Error {}

export type DongKetNoi = {
  id: string;
  phapNhanMa: string;
  moiTruong: string;
  nhaCungCapMa: string;
  dangBat: boolean;
  baseUrl: string | null;
  mst: string | null;
  tenDangNhap: string | null;
  coMatKhau: boolean;
  matKhauCapNhatLuc: string | null;
  phuongThucKy: string;
  cheDoKy: string;
  chungThuSerial: string | null;
  chungThuThumbprint: string | null;
  chungThuChuTheMst: string | null;
  chungThuNhaPhatHanh: string | null;
  chungThuHetHan: string | null;
  misaAppId: string | null;
  misaLoaiHoaDon: string | null;
  kiemTraLuc: string | null;
  kiemTraKetQua: string | null;
  capNhatBoiId: string;
  capNhatLuc: string;
};

const CHON = {
  id: true,
  phapNhanMa: true,
  moiTruong: true,
  nhaCungCapMa: true,
  dangBat: true,
  baseUrl: true,
  mst: true,
  tenDangNhap: true,
  matKhauCapNhatLuc: true,
  phuongThucKy: true,
  cheDoKy: true,
  chungThuSerial: true,
  chungThuThumbprint: true,
  chungThuChuTheMst: true,
  chungThuNhaPhatHanh: true,
  chungThuHetHan: true,
  misaAppId: true,
  misaLoaiHoaDon: true,
  kiemTraLuc: true,
  kiemTraKetQua: true,
  capNhatBoiId: true,
  updatedAt: true,
  // ⚠️ CỐ Ý KHÔNG có matKhauMaHoa.
} as const;

type HangDoc = {
  id: string;
  phapNhanMa: string;
  moiTruong: string;
  nhaCungCapMa: string;
  dangBat: boolean;
  baseUrl: string | null;
  mst: string | null;
  tenDangNhap: string | null;
  matKhauCapNhatLuc: Date | null;
  phuongThucKy: string;
  cheDoKy: string;
  chungThuSerial: string | null;
  chungThuThumbprint: string | null;
  chungThuChuTheMst: string | null;
  chungThuNhaPhatHanh: string | null;
  chungThuHetHan: Date | null;
  misaAppId: string | null;
  misaLoaiHoaDon: string | null;
  kiemTraLuc: Date | null;
  kiemTraKetQua: string | null;
  capNhatBoiId: string;
  updatedAt: Date;
};

const ngay = (d: Date) => d.toISOString().slice(0, 10);

function sangDong(h: HangDoc, coMatKhau: boolean): DongKetNoi {
  return {
    id: h.id,
    phapNhanMa: h.phapNhanMa,
    moiTruong: h.moiTruong,
    nhaCungCapMa: h.nhaCungCapMa,
    dangBat: h.dangBat,
    baseUrl: h.baseUrl,
    mst: h.mst,
    tenDangNhap: h.tenDangNhap,
    coMatKhau,
    matKhauCapNhatLuc: h.matKhauCapNhatLuc?.toISOString() ?? null,
    phuongThucKy: h.phuongThucKy,
    cheDoKy: h.cheDoKy,
    chungThuSerial: h.chungThuSerial,
    chungThuThumbprint: h.chungThuThumbprint,
    chungThuChuTheMst: h.chungThuChuTheMst,
    chungThuNhaPhatHanh: h.chungThuNhaPhatHanh,
    chungThuHetHan: h.chungThuHetHan ? ngay(h.chungThuHetHan) : null,
    misaAppId: h.misaAppId,
    misaLoaiHoaDon: h.misaLoaiHoaDon,
    kiemTraLuc: h.kiemTraLuc?.toISOString() ?? null,
    kiemTraKetQua: h.kiemTraKetQua,
    capNhatBoiId: h.capNhatBoiId,
    capNhatLuc: h.updatedAt.toISOString(),
  };
}

/** Người này có phải kế toán HỘI SỞ (phạm vi kế toán = ALL) — điều kiện duy nhất để thấy / sửa kết nối pháp nhân. */
export const laKeToanHoiSo = (actor: Actor): boolean => phamViKeToan(actor) === "ALL";

/** Mọi kết nối (không kèm mật khẩu). Không phải kế toán Hội sở ⇒ `[]` (fail-closed, không báo "không có quyền" để khỏi lộ sự tồn tại). */
export async function docCacKetNoi(actor: Actor): Promise<DongKetNoi[]> {
  if (!laKeToanHoiSo(actor)) return [];
  const [ds, coMk] = await Promise.all([
    db.hoaDonKetNoiNhaCungCap.findMany({ select: CHON, orderBy: [{ phapNhanMa: "asc" }, { moiTruong: "asc" }] }),
    // Chỉ lấy id của dòng CÓ mật khẩu — không nạp chuỗi mã hoá vào bộ nhớ để rồi vô tình mang đi.
    db.hoaDonKetNoiNhaCungCap.findMany({ where: { matKhauMaHoa: { not: null } }, select: { id: true } }),
  ]);
  const coMkSet = new Set(coMk.map((x) => x.id));
  return ds.map((h) => sangDong(h, coMkSet.has(h.id)));
}

export type DauVaoLuuKetNoi = Omit<DauVaoKetNoi, "lyDo" | "matKhauMoi"> & {
  chungThuThumbprint?: string | null;
  chungThuChuTheMst?: string | null;
  chungThuNhaPhatHanh?: string | null;
};

export type KetQuaLuuKetNoi = { ok: true; id: string; doiMatKhau: boolean; truongDoi: string[] } | { ok: false; error: string };

/** Trường KHÔNG nhạy cảm — được so sánh và ghi vào nhật ký. */
const TRUONG_GHI_NHAT_KY = [
  "nhaCungCapMa",
  "dangBat",
  "baseUrl",
  "mst",
  "tenDangNhap",
  "phuongThucKy",
  "cheDoKy",
  "chungThuSerial",
  "chungThuThumbprint",
  "chungThuChuTheMst",
  "chungThuNhaPhatHanh",
  "chungThuHetHan",
  "misaAppId",
  "misaLoaiHoaDon",
] as const;

const chuoiRong = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Thêm / sửa MỘT kết nối (pháp nhân × môi trường). Người gọi đã `checkPermission("payments:confirm")`; hàm này kiểm lại là kế toán Hội sở.
 * Đổi địa chỉ / MST / tên đăng nhập mà KHÔNG nhập lại mật khẩu ⇒ TỪ CHỐI: mật khẩu cũ thuộc về tài khoản cũ, đừng gửi nó tới nơi khác.
 */
export async function luuKetNoi(input: {
  actor: Actor;
  nguoi: { id: string; name: string };
  du: DauVaoLuuKetNoi;
  /** Mật khẩu MỚI; rỗng/null = giữ mật khẩu đang lưu. */
  matKhauMoi: string | null;
  lyDo: string | null;
  env?: Record<string, string | undefined>;
}): Promise<KetQuaLuuKetNoi> {
  // [BGĐ 04/11/2026] Chỉ Quản trị tối cao THAY ĐỔI cấu hình bảo mật; kế toán Hội sở chỉ xem (`docCacKetNoi`). Cổng này là lớp thứ hai — cổng thứ nhất ở action.
  if (!input.actor.isSuperAdmin) return { ok: false, error: "Chỉ Quản trị tối cao được thay đổi kết nối nhà cung cấp, cách ký và tài khoản tích hợp." };
  const du = input.du;
  const matKhauMoi = input.matKhauMoi === null || input.matKhauMoi === "" ? null : input.matKhauMoi;

  const phapNhan = cauHinhHoaDonChoMoiTruong().phapNhan.find((p) => p.ma === du.phapNhanMa && p.bat) ?? null;
  if (!phapNhan) return { ok: false, error: "Pháp nhân không tồn tại hoặc đang tắt." };
  if (!laMoiTruongKetNoi(du.moiTruong)) return { ok: false, error: "Môi trường phải là SANDBOX hoặc PROD." };
  const moiTruong: MoiTruongKetNoi = du.moiTruong;

  const cu = await db.hoaDonKetNoiNhaCungCap.findUnique({ where: { phapNhanMa_moiTruong: { phapNhanMa: du.phapNhanMa, moiTruong } }, select: { ...CHON, matKhauMaHoa: true } });
  // [05/11/2026] Nhà cung cấp ĐANG DÙNG = của dòng đã lưu (nếu có), không thì mặc định trong mã. Khác nhà cung cấp người dùng gửi lên ⇒ ĐỔI NHÀ CUNG CẤP: tài khoản cũ KHÔNG đi theo
  // (mật khẩu MISA không bao giờ được gửi sang VIN), nên coi như chưa có mật khẩu — kiểm luật khai đủ trên dữ liệu mới.
  const dangDung = nhaCungCapHieuLuc(phapNhan, cu?.nhaCungCapMa);
  const doiNhaCungCap = dangDung !== null && du.nhaCungCapMa !== dangDung;
  const daCoMatKhau = !doiNhaCungCap && cu?.matKhauMaHoa != null;

  const baseUrl = du.baseUrl ? (chuanHoaBaseUrl(du.baseUrl) ?? du.baseUrl) : null;
  const loi = kiemKetNoi(
    { ...du, baseUrl, matKhauMoi, lyDo: input.lyDo },
    { nhaCungCapCuaPhapNhan: nhaCungCapApiCuaPhapNhan(phapNhan), daCoMatKhau },
  );
  if (loi.length > 0) return { ok: false, error: loi[0]! };

  const taiKhoanDoi =
    !doiNhaCungCap && cu !== null && daCoMatKhau && (chuoiRong(cu.baseUrl) !== chuoiRong(baseUrl) || chuoiRong(cu.mst) !== chuoiRong(du.mst) || chuoiRong(cu.tenDangNhap) !== chuoiRong(du.tenDangNhap) || chuoiRong(cu.misaAppId) !== chuoiRong(du.misaAppId));
  if (taiKhoanDoi && matKhauMoi === null) {
    return { ok: false, error: "Đổi địa chỉ, MST hoặc tên đăng nhập thì phải nhập lại mật khẩu — mật khẩu cũ không được dùng cho nơi khác." };
  }

  let matKhauMaHoa: string | undefined;
  const id = cu?.id ?? randomUUID(); // id sinh TRƯỚC khi mã hoá: AAD = `ketnoi:<id>`, không insert rồi update
  if (matKhauMoi !== null) {
    const khoa = docKhoaBiMat(input.env);
    if (!khoa.ok) return { ok: false, error: khoa.lyDo };
    matKhauMaHoa = maHoaBiMat(matKhauMoi, { khoaGoc: khoa.hienHanh, mucDich: MUC_DICH_KET_NOI, nguCanh: nguCanhKetNoi(id) });
  }

  const moi = {
    nhaCungCapMa: du.nhaCungCapMa,
    dangBat: du.dangBat,
    baseUrl,
    mst: chuoiRong(du.mst),
    tenDangNhap: chuoiRong(du.tenDangNhap),
    phuongThucKy: du.phuongThucKy,
    cheDoKy: du.phuongThucKy === "USB_TOKEN" ? du.cheDoKy : "LO",
    chungThuSerial: chuoiRong(du.chungThuSerial),
    chungThuThumbprint: chuoiRong(du.chungThuThumbprint),
    chungThuChuTheMst: chuoiRong(du.chungThuChuTheMst),
    chungThuNhaPhatHanh: chuoiRong(du.chungThuNhaPhatHanh),
    chungThuHetHan: du.chungThuHetHan ? new Date(`${du.chungThuHetHan}T00:00:00.000Z`) : null,
    // Chỉ MISA mang hai cột này; đổi sang VIN thì xoá (không để rác chờ cổng đọc nhầm).
    misaAppId: du.nhaCungCapMa === "MISA_MEINVOICE" ? chuoiRong(du.misaAppId) : null,
    misaLoaiHoaDon: du.nhaCungCapMa === "MISA_MEINVOICE" ? chuoiRong(du.misaLoaiHoaDon) : null,
  };
  const giaTriCu: Record<string, unknown> | null = cu ? Object.fromEntries(TRUONG_GHI_NHAT_KY.map((k) => [k, k === "chungThuHetHan" ? (cu.chungThuHetHan ? ngay(cu.chungThuHetHan) : null) : (cu as Record<string, unknown>)[k]])) : null;
  const giaTriMoi: Record<string, unknown> = Object.fromEntries(TRUONG_GHI_NHAT_KY.map((k) => [k, k === "chungThuHetHan" ? (moi.chungThuHetHan ? ngay(moi.chungThuHetHan) : null) : (moi as Record<string, unknown>)[k]]));
  const truongDoi = TRUONG_GHI_NHAT_KY.filter((k) => !giaTriCu || giaTriCu[k] !== giaTriMoi[k]);
  const doiDangNhap = doiNhaCungCap || matKhauMoi !== null || (cu !== null && (chuoiRong(cu.baseUrl) !== moi.baseUrl || chuoiRong(cu.mst) !== moi.mst || chuoiRong(cu.tenDangNhap) !== moi.tenDangNhap || chuoiRong(cu.misaAppId) !== moi.misaAppId));

  try {
    await db.$transaction(async (tx) => {
      // ── ĐỔI NHÀ CUNG CẤP: mọi cổng ĐỨNG TRƯỚC phép ghi đầu tiên; từ chối = NÉM (return không rollback). ──────────────────────────────────────
      if (doiNhaCungCap) {
        // Độc quyền theo pháp nhân: một lượt BẮT ĐẦU PHÁT HÀNH đang chạy giữ khoá dùng chung ⇒ ta chờ nó xong rồi mới đếm; lượt bắt đầu sau thì chờ ta rồi đọc lại nhà cung cấp.
        await khoaNhaCungCapDocQuyen(tx, du.phapNhanMa);
        const hienTai = await tx.hoaDonKetNoiNhaCungCap.findUnique({ where: { phapNhanMa_moiTruong: { phapNhanMa: du.phapNhanMa, moiTruong } }, select: { nhaCungCapMa: true } });
        if (nhaCungCapHieuLuc(phapNhan, hienTai?.nhaCungCapMa) !== dangDung) {
          throw new LoiDoiNhaCungCap("Có người vừa đổi nhà cung cấp của pháp nhân này — tải lại trang rồi thử lại.");
        }
        const chinhSach = await tx.hoaDonKyChinhSach.findUnique({ where: { phapNhanMa: du.phapNhanMa }, select: { tamDung: true } });
        if (!chinhSach?.tamDung) {
          throw new LoiDoiNhaCungCap("Phải TẠM DỪNG KÝ pháp nhân này trước khi đổi nhà cung cấp (khu «Chính sách ký» → Tạm dừng ký), rồi bật lại sau khi đổi xong.");
        }
        // Chỉ những thứ CÒN gọi nhà cung cấp cũ sau khi hoá đơn đã gửi: cron đối soát chỉ chọn DANG_PHAT_HANH; «Phát hành lại» chỉ từ LOI_PHAT_HANH; lệnh ký USB còn chờ.
        // Hoá đơn đã chốt / đã huỷ không gọi nhà cung cấp nào nữa (huỷ là xử lý nội bộ, tệp nằm ở kho) nên KHÔNG chặn.
        const [dangPhatHanh, lenhKyCho] = await Promise.all([
          tx.hoaDonDienTu.count({ where: { phapNhanMa: du.phapNhanMa, trangThai: { in: ["DANG_PHAT_HANH", "LOI_PHAT_HANH"] } } }),
          tx.hoaDonLenhKy.count({ where: { trangThai: { in: ["CHO_KY", "DANG_KY"] }, hoaDon: { phapNhanMa: du.phapNhanMa } } }),
        ]);
        if (dangPhatHanh > 0 || lenhKyCho > 0) {
          const phan = [dangPhatHanh > 0 ? `${dangPhatHanh} hoá đơn đang phát hành dở / phát hành lỗi` : null, lenhKyCho > 0 ? `${lenhKyCho} lệnh ký đang chờ` : null].filter(Boolean).join(" và ");
          throw new LoiDoiNhaCungCap(`Chưa đổi được nhà cung cấp: pháp nhân còn ${phan} đang đi qua nhà cung cấp hiện tại. Xử lý xong (đối soát, phát hành lại hoặc huỷ lệnh) rồi đổi.`);
        }
      }
      const ghi = {
        ...moi,
        capNhatBoiId: input.nguoi.id,
        lyDoCapNhat: (input.lyDo ?? "").trim(),
        ...(matKhauMaHoa !== undefined
          ? { matKhauMaHoa, matKhauCapNhatLuc: new Date() }
          // Đổi nhà cung cấp mà không nhập mật khẩu mới ⇒ XOÁ mật khẩu cũ (cùng id dòng ⇒ cùng AAD, nên nếu giữ lại nó vẫn giải mã được và sẽ bị gửi tới nhà cung cấp mới).
          : doiNhaCungCap
            ? { matKhauMaHoa: null, matKhauCapNhatLuc: null }
            : {}),
        // Đổi tài khoản / mật khẩu ⇒ kết quả kiểm tra cũ hết nghĩa.
        ...(doiDangNhap ? { kiemTraLuc: null, kiemTraKetQua: null } : {}),
      };
      if (cu) await tx.hoaDonKetNoiNhaCungCap.update({ where: { id }, data: ghi });
      else await tx.hoaDonKetNoiNhaCungCap.create({ data: { id, phapNhanMa: du.phapNhanMa, moiTruong, ...ghi } });
      await writeAudit({
        tx,
        actor: input.nguoi,
        module: "hoa-don",
        entityType: ENTITY,
        entityId: id,
        action: doiNhaCungCap ? "DOI_NHA_CUNG_CAP" : !cu ? "TAO_KET_NOI_NHA_CUNG_CAP" : cu.dangBat && !moi.dangBat ? "TAT_KET_NOI_NHA_CUNG_CAP" : "SUA_KET_NOI_NHA_CUNG_CAP",
        oldValues: giaTriCu ? { ...giaTriCu, phapNhanMa: du.phapNhanMa, moiTruong } : null,
        newValues: {
          ...giaTriMoi,
          phapNhanMa: du.phapNhanMa,
          moiTruong,
          matKhauDoi: matKhauMoi !== null,
          truongDoi,
          // Đổi nhà cung cấp: ghi rõ từ → sang, và tài khoản cũ đã bị xoá (không ghi giá trị nào của tài khoản).
          ...(doiNhaCungCap ? { nhaCungCapCu: dangDung, taiKhoanCuDaXoa: true } : {}),
        },
        reason: (input.lyDo ?? "").trim(),
      });
    });
  } catch (e) {
    // Hai người lưu lần đầu cùng lúc ⇒ vi phạm UNIQUE; câu cố định, không đính kèm lỗi gốc (có thể mang tham số).
    if (e instanceof LoiDoiNhaCungCap) return { ok: false, error: e.message };
    const ma = (e as { code?: unknown } | null)?.code;
    if (ma === "P2002") return { ok: false, error: "Có người vừa lưu kết nối này — tải lại trang rồi thử lại." };
    throw e;
  }
  return { ok: true, id, doiMatKhau: matKhauMoi !== null, truongDoi: [...truongDoi] };
}

// ─── Phục vụ PHÁT HÀNH (máy chủ, không qua người dùng) ──────────────────────────────────────────────────────────────────────

export type TaiKhoanKetNoi = {
  hang: KetNoiDaDoc | null;
  /** Có khi dòng BẬT, là VIN, đủ thông tin và giải mã được mật khẩu. Không bao giờ chứa trong nhật ký. */
  cauHinhVin: CauHinhVin | null;
  /** Có khi dòng BẬT, là MISA, mang ĐỦ tài khoản của pháp nhân và giải mã được mật khẩu. */
  cauHinhMisa: CauHinhHsm | null;
  /** Mã lỗi cố định khi dòng có mà không dùng được (không bao giờ chứa bí mật). `CAU_HINH_SAI` = địa chỉ máy chủ không qua luật chống trỏ nhầm. */
  loi: "KHOA_THIEU" | "KHONG_GIAI_MA_DUOC" | "CAU_HINH_SAI" | null;
  mst: string | null;
};

/** Đọc kết nối của (pháp nhân × môi trường) cho máy chủ phát hành. Giải mã mật khẩu; lỗi giải mã ⇒ cấu hình `null` + mã cố định. */
export async function docTaiKhoanKetNoi(
  phapNhanMa: string,
  moiTruong: MoiTruongKetNoi,
  env?: Record<string, string | undefined>,
  /** CHỈ cho «Kiểm tra kết nối»: cho phép giải mã cả dòng đang TẮT (kiểm trước khi bật). Phát hành KHÔNG bao giờ truyền cờ này. */
  tuyChon: { choKiemTra?: boolean } = {},
): Promise<TaiKhoanKetNoi> {
  const h = await db.hoaDonKetNoiNhaCungCap.findUnique({
    where: { phapNhanMa_moiTruong: { phapNhanMa, moiTruong } },
    select: { id: true, nhaCungCapMa: true, dangBat: true, phuongThucKy: true, cheDoKy: true, baseUrl: true, mst: true, tenDangNhap: true, chungThuSerial: true, chungThuHetHan: true, matKhauMaHoa: true, misaAppId: true, misaLoaiHoaDon: true },
  });
  if (!h) return { hang: null, cauHinhVin: null, cauHinhMisa: null, loi: null, mst: null };
  const laMisa = h.nhaCungCapMa === "MISA_MEINVOICE";
  const hang: KetNoiDaDoc = {
    nhaCungCapMa: h.nhaCungCapMa,
    dangBat: h.dangBat,
    phuongThucKy: h.phuongThucKy,
    cheDoKy: h.cheDoKy,
    coMatKhau: h.matKhauMaHoa != null,
    baseUrl: h.baseUrl,
    mst: h.mst,
    tenDangNhap: h.tenDangNhap,
    chungThuSerial: h.chungThuSerial,
    chungThuHetHan: h.chungThuHetHan ? ngay(h.chungThuHetHan) : null,
    coTaiKhoanMisa: laMisa && h.matKhauMaHoa != null && !!h.baseUrl && !!h.tenDangNhap && !!h.mst && !!h.misaAppId && !!h.misaLoaiHoaDon,
  };
  const khong = (loi: TaiKhoanKetNoi["loi"]): TaiKhoanKetNoi => ({ hang, cauHinhVin: null, cauHinhMisa: null, loi, mst: h.mst });
  if ((!h.dangBat && !tuyChon.choKiemTra) || !h.matKhauMaHoa || !h.baseUrl || !h.tenDangNhap || !h.mst) return khong(null);
  if (laMisa && hang.coTaiKhoanMisa !== true) return khong(null);
  if (!laMisa && h.nhaCungCapMa !== "VIN_HOADON") return khong(null);
  const cheDo = moiTruong === "PROD" ? "production" : "sandbox";
  // Luật chống trỏ nhầm host áp cho CẢ cấu hình lấy từ DB (không chỉ từ env): kế toán gõ nhầm địa chỉ không được ký/phát hành sang nơi lạ.
  if ((laMisa ? kiemBaseUrlMisa(cheDo, h.baseUrl) : kiemBaseUrlVin(cheDo, h.baseUrl)) !== null) return khong("CAU_HINH_SAI");
  const khoa = docKhoaBiMat(env);
  if (!khoa.ok) return khong("KHOA_THIEU");
  try {
    const password = giaiMaBiMat(h.matKhauMaHoa, { cacKhoaGoc: khoa.cacKhoa, mucDich: MUC_DICH_KET_NOI, nguCanh: nguCanhKetNoi(h.id) });
    if (laMisa) {
      const loai = h.misaLoaiHoaDon === "co-ma" || h.misaLoaiHoaDon === "khong-ma" ? h.misaLoaiHoaDon : null;
      if (!loai || !h.misaAppId) return khong(null);
      return { hang, cauHinhVin: null, cauHinhMisa: { cheDo, baseUrl: h.baseUrl.replace(/\/+$/, ""), appId: h.misaAppId, username: h.tenDangNhap, password, loaiHoaDon: loai }, loi: null, mst: h.mst };
    }
    return { hang, cauHinhVin: { cheDo, baseUrl: h.baseUrl, username: h.tenDangNhap, password }, cauHinhMisa: null, loi: null, mst: h.mst };
  } catch (e) {
    if (e instanceof LoiHopBiMat) return khong("KHONG_GIAI_MA_DUOC");
    throw e;
  }
}

/**
 * Mã các pháp nhân đang cấu hình KÝ BẰNG USB TOKEN (dòng BẬT, môi trường đang chạy). Chỉ MÃ pháp nhân — không tài khoản, không mật khẩu — nên bộ nạp hàng chờ
 * (mọi kế toán) dùng được mà không phải qua cổng Hội sở: đây là thông tin để nút nói đúng, không phải thông tin xác thực.
 */
export async function docPhapNhanKyUsb(env?: Record<string, string | undefined>): Promise<Set<string>> {
  const moiTruong = moiTruongKetNoiTuMoiTruongChay(laProductionThat(env ?? process.env));
  const ds = await db.hoaDonKetNoiNhaCungCap.findMany({ where: { moiTruong, dangBat: true, phuongThucKy: "USB_TOKEN" }, select: { phapNhanMa: true } });
  return new Set(ds.map((d) => d.phapNhanMa));
}

/** Ghi kết quả "Kiểm tra kết nối" (MÃ cố định) lên dòng. Người gọi đã kiểm quyền Hội sở. */
export async function ghiKetQuaKiemTra(input: { phapNhanMa: string; moiTruong: MoiTruongKetNoi; ketQua: string; now: Date }): Promise<void> {
  await db.hoaDonKetNoiNhaCungCap.updateMany({
    where: { phapNhanMa: input.phapNhanMa, moiTruong: input.moiTruong },
    data: { kiemTraLuc: input.now, kiemTraKetQua: input.ketQua },
  });
}

/** Lịch sử thay đổi của các kết nối (AuditLog module "hoa-don") — không cần nới quyền `audit-logs:view`. Chỉ trả TÊN trường + người + lý do + lúc. */
export async function docLichSuKetNoi(actor: Actor, ids: readonly string[]): Promise<{ id: string; ketNoiId: string; action: string; luc: string; nguoi: string; lyDo: string | null; truongDoi: string[]; matKhauDoi: boolean }[]> {
  if (!laKeToanHoiSo(actor) || ids.length === 0) return [];
  const ds = await db.auditLog.findMany({
    where: { entityType: ENTITY, entityId: { in: [...ids] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, entityId: true, action: true, createdAt: true, actorName: true, reason: true, newValues: true },
  });
  return ds.map((d) => {
    const nv = (d.newValues ?? {}) as { truongDoi?: unknown; matKhauDoi?: unknown };
    return {
      id: d.id,
      ketNoiId: d.entityId,
      action: d.action,
      luc: d.createdAt.toISOString(),
      nguoi: d.actorName ?? "",
      lyDo: d.reason ?? null,
      truongDoi: Array.isArray(nv.truongDoi) ? nv.truongDoi.filter((x): x is string => typeof x === "string") : [],
      matKhauDoi: nv.matKhauDoi === true,
    };
  });
}
