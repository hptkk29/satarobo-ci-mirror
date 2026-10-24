import { isUnderPath } from "@/lib/org/path";

/**
 * EL-16/EL-17 — YÊU CẦU ĐÀO TẠO nào áp cho một người trên một khoá.
 *
 * ⚠️ Vì sao mảnh này nằm ở EL-16 chứ không đợi EL-17 (ma trận R3):
 *
 * Hạn hiệu lực của chứng nhận suy theo 3 bước (HỢP ĐỒNG V2 §Z3), và **bước 1 là
 * `TrnRequirement.validityMonths`**. Bỏ bước 1 lại cho EL-17 không phải là hoãn một
 * màn hình — nó là cấp ra những tấm chứng nhận **VÔ THỜI HẠN cho khoá tuân thủ có
 * chu kỳ 12 tháng**, im lặng, đúng vào ngày ai đó khai yêu cầu đầu tiên. Không có
 * lỗi nào nổ, không có ô nào đỏ; chỉ là hai năm sau không ai phải học lại.
 *
 * Bảng `TrnRequirement` hiện RỖNG, nên mã này chạy vào nhánh "không có yêu cầu" là
 * chuyện thường ở GĐ1. Nhưng nó phải ĐÚNG sẵn từ trước, vì cái sai chỉ lộ ra sau
 * chu kỳ đầu tiên — tức sau khi đã phát hàng loạt chứng nhận sai hạn.
 */

/** Đủ dữ liệu để đối chiếu MỘT người với phạm vi của yêu cầu. */
export type NguoiDeKhop = {
  userId: string;
  /** `Employee.departmentId` — FK `DepartmentDef`. */
  departmentId: string | null;
  /** `path` của `OrgUnit` người đó neo vào, dạng `/ho/danang/cs1/`. */
  orgUnitPath: string | null;
  positionId: string | null;
};

export type YeuCauDeKhop = {
  id: string;
  scopeKind: string;
  positionId: string | null;
  departmentId: string | null;
  levelTag: string | null;
  /** `path` của `OrgUnit` mà yêu cầu neo vào (KHÔNG phải id). */
  orgUnitPath: string | null;
  validityMonths: number | null;
};

/**
 * Hai phạm vi KHÔNG khớp được ai ở GĐ1, và lý do — trả ra để người gọi ghi log.
 *
 * Đây không phải "chưa làm". Đây là hai lỗ đã ĐO ĐƯỢC trên prod (20/08/2026):
 *
 *  · `POSITION` — bảng `Position` có **0 dòng**. Một yêu cầu khai theo vị trí áp cho
 *    0 người, và không gì báo. Kế hoạch nói rõ ở TS-35.
 *  · `LEVEL_TAG` — thẻ bậc công việc L1–L4 là thuộc tính của **chương trình**
 *    (`TrnProgram.levelTags`); **không bảng nào gắn thẻ bậc cho một CON NGƯỜI**.
 *    Nên vế "người này bậc mấy" hiện không tra được ở đâu.
 *
 * Cả hai im lặng theo cùng một kiểu, và ở EL-16 hậu quả là hạn hiệu lực sai chứ
 * không phải một ô xám trên báo cáo.
 */
export const PHAM_VI_CHUA_KHOP_DUOC: Record<string, string> = {
  POSITION:
    "bảng Position rỗng trên prod (0 dòng) — yêu cầu theo vị trí hiện áp cho 0 người",
  LEVEL_TAG:
    "không bảng nào gắn thẻ bậc công việc cho một con người — thẻ L1–L4 hiện chỉ có trên TrnProgram",
};

export type KetQuaKhop = {
  /** Yêu cầu áp được cho người này. */
  apDung: YeuCauDeKhop[];
  /**
   * Yêu cầu KHÔNG đối chiếu được vì phạm vi chưa có dữ liệu — kèm lý do.
   *
   * ⚠️ Đây KHÔNG phải "không áp dụng". Khác nhau ở chỗ: "không áp dụng" là câu trả
   * lời, còn đây là "chưa trả lời được". Gộp hai thứ vào một là biến một khoảng
   * trống dữ liệu thành một kết luận.
   */
  khongDoiChieuDuoc: { yeuCau: YeuCauDeKhop; lyDo: string }[];
};

export function khopYeuCau(
  nguoi: NguoiDeKhop,
  dsYeuCau: YeuCauDeKhop[],
): KetQuaKhop {
  const apDung: YeuCauDeKhop[] = [];
  const khongDoiChieuDuoc: { yeuCau: YeuCauDeKhop; lyDo: string }[] = [];

  for (const y of dsYeuCau) {
    const chuaKhop = PHAM_VI_CHUA_KHOP_DUOC[y.scopeKind];
    if (chuaKhop) {
      khongDoiChieuDuoc.push({ yeuCau: y, lyDo: chuaKhop });
      continue;
    }

    switch (y.scopeKind) {
      case "ALL_STAFF":
        apDung.push(y);
        break;

      case "DEPARTMENT":
        // So id, KHÔNG so enum `Employee.department` cũ: hệ đang ở giai đoạn 2 pha
        // và enum sẽ bị bỏ. Người chưa có `departmentId` thì KHÔNG khớp — fail-closed.
        if (y.departmentId != null && y.departmentId === nguoi.departmentId) {
          apDung.push(y);
        }
        break;

      case "ORG_UNIT":
        // Yêu cầu neo ở đơn vị CHA áp cho cả nhánh dưới — đó là ý nghĩa của việc
        // Hội sở đặt một yêu cầu. So bằng id thì yêu cầu đặt ở HO áp cho đúng người
        // ngồi ở HO và không ai khác, tức mọi yêu cầu toàn công ty đều phải khai lại
        // ở từng cơ sở, và thiếu một cơ sở là thiếu im lặng.
        if (isUnderPath(nguoi.orgUnitPath, y.orgUnitPath)) apDung.push(y);
        break;

      default:
        // Giá trị `scopeKind` lạ: KHÔNG coi là "không áp dụng".
        khongDoiChieuDuoc.push({
          yeuCau: y,
          lyDo: `phạm vi "${y.scopeKind}" chưa có luật đối chiếu`,
        });
    }
  }

  return { apDung, khongDoiChieuDuoc };
}

/**
 * Chu kỳ NGẮN NHẤT trong số các yêu cầu áp dụng — `null` nếu không có yêu cầu nào
 * đặt chu kỳ.
 *
 * ⚠️ Ngắn nhất, không phải "cái đầu tiên tìm thấy". Một người có thể dính hai yêu
 * cầu trên cùng khoá (một của phòng ban, một toàn công ty). Lấy cái dài hơn là để họ
 * quá hạn theo yêu cầu chặt hơn mà hệ thống vẫn báo còn hiệu lực — và thứ tự trả về
 * từ DB thì không ai bảo đảm.
 */
export function chuKyNganNhat(dsApDung: YeuCauDeKhop[]): number | null {
  const cac = dsApDung
    .map((y) => y.validityMonths)
    .filter((v): v is number => typeof v === "number" && v > 0);
  return cac.length === 0 ? null : Math.min(...cac);
}
