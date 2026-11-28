import { db } from "@/lib/db";
import { docLichSuGiaDinh } from "@/lib/disc/portal-doc";
import { baoVeDisc, docBaoCaoCaNhanKhongKiem } from "./disc";
import { isDiscEnabled } from "@/lib/flags";
import { chonRobot, KY_HIEU, NOI_DUNG, TEN_ROBOT, TEN_TINH_CACH, timDiemCuaBe, type NhomDisc, type RobotCuaBe } from "@/lib/portal/hv-tinh-cach-thuan";

import { kiemHocVienCuaPhuHuynh, type MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * H-San-pham (tab «Robot tính cách») — CHỈ ĐỌC, dựng bằng ĐÚNG hàm của cổng học sinh web (`docHvSanPham` ở `lib/portal/hv-du-lieu.ts`):
 * lịch sử DISC của gia đình (`docLichSuGiaDinh`) → kết quả của ĐÚNG em này (`timDiemCuaBe`: khớp vai HỌC SINH + tên chuẩn hoá; trùng tên/không khớp ⇒ không gán)
 * → kiểu robot chính/phụ (`chonRobot`). KHÔNG có bộ chấm/bảng/lời thứ hai ở đây: lời mô tả và tên robot lấy nguyên từ `hv-tinh-cach-thuan.ts`.
 *
 * ⚠️ NGUỒN THỨ HAI (V8.23): `docLichSuGiaDinh` chỉ đọc bảng DISC CŨ (`DiscSubmission`, luồng công khai theo SĐT) — luồng «Sổ gia đình» mới (`DiscBaiLam`, làm bài trong cổng phụ huynh/app) KHÔNG đi vào đó,
 * nên với phụ huynh chỉ dùng sổ gia đình thì web luôn rỗng. Khi nguồn cũ không có kết quả, đọc báo cáo cá nhân của THÀNH VIÊN ĐÃ NỐI học viên này trong sổ gia đình của CHÍNH phụ huynh (`docBaoCaoCaNhan`:
 * nhóm chính D/I/S/C + nhân vật «Rô …» + một dòng giới thiệu + cột điểm) — `nguon:"SO_GIA_DINH"`; tên robot/lời lấy NGUYÊN từ engine sổ gia đình, không dịch sang tên của cổng học sinh. Không nối học viên ⇒ không có.
 * Quyền (như web): phụ huynh của em, hoặc chính phiên chế độ học sinh đang khoá em đó (cổng học sinh web cũng hiện tab này cho em). Em khác ⇒ 404 / 403 ở lớp ngoài.
 * Cờ `DISC_ENABLED` TẮT ⇒ 404 (như web). Không có kết quả DISC thật của em ⇒ `coRobot:false` (KHÔNG bịa, KHÔNG gán nhãn khi không có kiểu nổi bật).
 * Không trả điểm thô từng câu, chỉ phần trăm bốn kiểu để vẽ thanh; không trả dữ liệu của người khác trong gia đình.
 */
export type NhomRobotDto = { ma: NhomDisc; tenRobot: string; tinhCach: string; kyHieu: string };
export type RobotTinhCachDto =
  | { coRobot: false; robot: null }
  | {
      coRobot: true;
      robot: {
        nguon: "HV_WEB" | "SO_GIA_DINH";
        chinh: NhomRobotDto & { cau: string; manh: string[]; tot: string[]; meo: string[] };
        phu: NhomRobotDto | null;
        thanh: Record<NhomDisc, number>;
      };
    };

/** D1 — DTO của đường STUDENT: như `RobotTinhCachDto` nhưng KHÔNG có `thanh` (bốn cột phần trăm là số liệu DISC). */
export type RobotHocSinhDto = { coRobot: false; robot: null } | { coRobot: true; robot: Omit<Extract<RobotTinhCachDto, { coRobot: true }>["robot"], "thanh"> };

const nhom = (ma: NhomDisc): NhomRobotDto => ({ ma, tenRobot: TEN_ROBOT[ma], tinhCach: TEN_TINH_CACH[ma], kyHieu: KY_HIEU[ma] });

/** Phần THUẦN: kiểu robot → DTO (test không cần DB). */
export function dungRobotDto(r: RobotCuaBe | null): RobotTinhCachDto {
  if (!r) return { coRobot: false, robot: null };
  const nd = NOI_DUNG[r.chinh];
  return { coRobot: true, robot: { nguon: "HV_WEB", chinh: { ...nhom(r.chinh), cau: nd.cau, manh: [...nd.manh], tot: [...nd.tot], meo: [...nd.meo] }, phu: nhom(r.phu), thanh: r.thanh } };
}

const MA_NHOM = ["D", "I", "S", "C"] as const;

/** Phần THUẦN: báo cáo cá nhân của sổ gia đình → DTO robot (null nếu thiếu nhóm chính/nhân vật — không bịa). */
export function dungRobotTuBaoCao(bc: unknown): RobotTinhCachDto {
  const o = (bc ?? {}) as { chinh?: unknown; nhan?: unknown; nhanVat?: unknown; motDong?: unknown; cot?: unknown };
  const ma = MA_NHOM.find((m) => m === o.chinh);
  if (!ma || typeof o.nhanVat !== "string" || !o.nhanVat) return { coRobot: false, robot: null };
  const thanh: Record<NhomDisc, number> = { D: 0, I: 0, S: 0, C: 0 };
  if (Array.isArray(o.cot)) for (const c of o.cot as Array<{ k?: unknown; v?: unknown }>) if (MA_NHOM.some((m) => m === c.k) && typeof c.v === "number") thanh[c.k as NhomDisc] = Math.max(0, Math.min(100, c.v));
  return {
    coRobot: true,
    robot: {
      nguon: "SO_GIA_DINH",
      chinh: { ma, tenRobot: o.nhanVat, tinhCach: typeof o.nhan === "string" && o.nhan ? o.nhan : TEN_TINH_CACH[ma], kyHieu: KY_HIEU[ma], cau: typeof o.motDong === "string" ? o.motDong : "", manh: [], tot: [], meo: [] },
      phu: null,
      thanh,
    },
  };
}

export async function layRobotTinhCach(hs: MaHocVienDaKiem, nguoi: NguoiGoi): Promise<RobotTinhCachDto | RobotHocSinhDto> {
  if (!isDiscEnabled()) throw new LoiApiMobile("NOT_FOUND", 404, "Tính năng chưa được mở.");
  // D1 (Owner 22/11/2026): phiên CHẾ ĐỘ HỌC SINH xem Robot của CHÍNH em bằng đường Student — KHÔNG dùng/không cần bằng chứng mở khoá DISC của phụ huynh. Em khác ⇒ 403 (đã chặn ở cổng chung; kiểm lại ở đây).
  if (nguoi.hocSinhId) {
    if (nguoi.hocSinhId !== hs) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh — không xem được học viên khác.");
    return layRobotChoHocSinh(nguoi);
  }
  // V8.31 — phụ huynh: dữ liệu DISC dẫn xuất ⇒ khi sổ ĐÃ đặt PIN và cờ ép BẬT, cần phiên mở khoá.
  await baoVeDisc(nguoi, { phamVi: "DOC" });
  return docRobotCuaHocVien(hs, nguoi.userId);
}

/**
 * D1 — API STUDENT: Robot tính cách của CHÍNH học viên mà phiên đang bị khoá vào (chế độ học sinh). Học viên KHÔNG đến từ client (không `studentId` trong đường dẫn/thân) ⇒ không có đường tới anh/chị/em.
 * KIỂM QUYỀN LẠI MỖI LẦN GỌI: học viên còn thuộc phụ huynh của phiên và chưa xoá (phụ huynh bị thu hồi quyền / đổi liên kết / xoá học viên ⇒ 404 như không có). Không dùng phiên mở khoá PIN của phụ huynh;
 * không trả hồ sơ DISC gia đình, báo cáo thô, tên/điểm của thành viên khác. Nội dung = đúng DTO robot mà cổng học sinh web hiển thị.
 */
export async function layRobotChoHocSinh(nguoi: NguoiGoi): Promise<RobotHocSinhDto> {
  if (!isDiscEnabled()) throw new LoiApiMobile("NOT_FOUND", 404, "Tính năng chưa được mở.");
  if (!nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Chỉ dùng được trong chế độ học sinh.");
  const hs = await kiemHocVienCuaPhuHuynh(nguoi.userId, nguoi.hocSinhId);
  return boSoLieu(await docRobotCuaHocVien(hs, nguoi.userId));
}

/** D1: học sinh chỉ nhận NỘI DUNG robot (chữ) — bỏ bốn cột phần trăm `thanh` (coi là số liệu DISC, Owner: «không dữ liệu DISC thô»). Đường phụ huynh giữ `thanh`. */
function boSoLieu(d: RobotTinhCachDto): RobotHocSinhDto {
  if (!d.coRobot) return { coRobot: false, robot: null };
  const { thanh: _thanh, ...robot } = d.robot;
  return { coRobot: true, robot };
}

/**
 * ĐỌC robot của MỘT học viên (đã qua `MaHocVienDaKiem`) — KHÔNG tự kiểm quyền: người gọi PHẢI đã quyết quyền ở tầng trên (phụ huynh + cổng PIN, hoặc học sinh CHÍNH em đó qua đường Student).
 * Đọc sổ gia đình ở đây là việc của MÁY CHỦ; kết quả chỉ là DTO robot (không báo cáo thô, không dữ liệu thành viên khác).
 */
async function docRobotCuaHocVien(hs: MaHocVienDaKiem, parentUserId: string): Promise<RobotTinhCachDto> {
  const be = await db.student.findFirst({ where: { id: hs, parentUserId, deletedAt: null }, select: { name: true } });
  if (!be) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const lichSu = await docLichSuGiaDinh(parentUserId).catch(() => []);
  const diem = timDiemCuaBe(lichSu, be.name);
  const cu = dungRobotDto(diem ? chonRobot(diem) : null);
  if (cu.coRobot) return cu;
  // Nguồn mới: thành viên sổ gia đình đã NỐI học viên này (chỉ trong sổ của CHÍNH phụ huynh) + báo cáo cá nhân.
  const tv = await db.discThanhVien.findFirst({ where: { studentId: hs, deletedAt: null, giaDinh: { ownerUserId: parentUserId } }, select: { id: true } });
  if (!tv) return cu;
  try {
    return dungRobotTuBaoCao((await docBaoCaoCaNhanKhongKiem(parentUserId, tv.id)).baoCao);
  } catch (e) {
    if (e instanceof LoiApiMobile && e.status === 404) return cu; // chưa có bài làm
    throw e;
  }
}
