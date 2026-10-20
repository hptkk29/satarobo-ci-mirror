# Bảng mã ca — CHỐT 09/09/2026

| | |
|---|---|
| **Chốt bởi** | chủ dự án, 09/09/2026 |
| **Nguồn sự thật của** | `dayCredit` · giờ làm · nghỉ giữa giờ · số cặp quét kỳ vọng |
| **Cắm vào mã ở** | `lib/cham-cong/catalog.ts` → `SHIFT_CATALOG` |
| **Ai canh** | `lib/cham-cong/catalog.test.ts` — lệch là ĐỎ |

---

## Luật nền

> **Một ngày làm việc = 1 công.** KHÔNG có "2 buổi = 2 ca".
> ⇒ Mẫu số hệ số công **giữ nguyên 24**. Không đụng SR.QD.231.

Hệ số công (trong MISA Tiền lương, ngoài repo này):

```
HỆ SỐ CÔNG = TONG_CONG_DI_LAM_THUC_TE_THEO_NGAY ÷ SO_CONG_CHUAN
```

Hệ thống chỉ sinh **tử số** (`dayCreditEarned` cộng lại) và **mẫu số**
(`AttendancePeriod.standardUnits`). Đổi tử số mà quên mẫu số là trả lương sai — đó là lý
do bảng này chốt "1 ngày = 1 công" thay vì đếm buổi.

---

## Bảng

| Mã | Giờ | Nghỉ giữa giờ | Công | Cặp quét |
|---|---|---|---|---|
| `CG` | 9:00–17:45 | 11:30–14:00 **KHÔNG** tính | 1 | 1 |
| `CS` | 14:00–16:30 + 17:00–21:00 | 16:30–17:00 **VẪN** tính | 1 | 1 |
| `CCT` | 7:45–17:45 | 11:30–13:45 **KHÔNG** tính | 1 | 1 |
| `CGD` | 9:00–19:15 | 11:30–13:30 **KHÔNG** tính | 1 | 1 |
| `HC` | 8:00–17:30 | 11:30–13:30 **KHÔNG** tính | 1 | **2** |
| `12` · `21` · `2C` | 8:00–17:30 | 11:30–13:30 **KHÔNG** tính | 1 | 1 |
| `SC` | 7:45–17:30 | 11:30–13:45 **KHÔNG** tính | 1 | 1 |
| `CT` | 13:45–21:00 | 16:30–17:30 **VẪN** tính | 1 | 1 |
| `SCT` | 7:45–21:00 | 11:30–13:45 **KHÔNG** + 16:30–17:30 **VẪN** | **1,5** | 1 |
| `ST` | 7:45–11:30 + 17:15–21:00 | — | 1 (0,5 + 0,5) | **2** |
| `S` | 7:45–11:30 | — | **0,5** | 1 |
| `C` | 13:45–17:30 | — | **0,5** | 1 |
| `T` | 17:15–21:00 | — | **0,5** | 1 |
| `LD` | — | — | 1 | **0** — không cần chấm |
| `NG` | 8:00–11:30 + 13:30–17:30 (ngoài) | — | 1 | **1** — đảo 15/09/2026, xem ghi chú dưới |
| `D1` · `D2` | — | — | 1 | **0** — nhãn NƠI LÀM, không phải ca có giờ |
| `P` · `X` | — | — | 0 | 0 |

---

## Ba thứ trong bảng này CHƯA cắm được vào mã

Ghi ra để không ai tưởng đã xong:

| Thứ | Trạng thái | Đợt |
|---|---|---|
| `dayCredit` | ✅ **đã cắm** — `SHIFT_CATALOG`, và test canh | — |
| Nghỉ **VẪN** tính (`PAID_BREAK`) | ✅ đã có sẵn từ trước | — |
| Nghỉ **KHÔNG** tính | ❌ chưa có `kind` nào — cần `UNPAID_BREAK` | **đợt 3** |
| Số **cặp quét kỳ vọng** | ✅ **đã cắm** 15/09/2026 — `SHIFT_CATALOG.soCapQuetKyVong`, và test đối chiếu chính bảng này | — |

⚠️ Vì thế cột "Nghỉ KHÔNG tính" ở bảng trên hiện **chưa có hiệu lực trong mã**: các mã
`CG` `CCT` `CGD` `HC` `12` `21` `2C` `SC` `SCT` đang khai hai đoạn `WORK` rời nhau, và
khoảng giữa đơn giản là *không thuộc đoạn nào* — nên nó không được tính, đúng kết quả
mong muốn, nhưng **vì lý do khác**. Khi thêm `UNPAID_BREAK` thì phải khai tường minh, và
đó là lúc `soCapQuetKyVong` bắt buộc phải có cùng lúc (xem kế hoạch đợt 3).

---

## Cột `soCapQuetKyVong` — ĐÃ CẮM 15/09/2026

| Giá trị | Nghĩa | Mốc đối chiếu |
|---|---|---|
| `0` | không kiểm quét, không cờ | — (`LD` `NG` `D1` `D2`) |
| `1` | gom **mọi** đoạn WORK thành **một cụm** | vào = `start` đoạn **đầu**; ra = `end` đoạn **cuối** |
| `2` | **hai cụm**, cắt ở **khoảng hở lớn nhất** giữa các đoạn WORK | mỗi cụm một cặp mốc riêng (`ST`: 7:45/11:30 và 17:15/21:00) |

Cờ `THIEU_BUOI_SANG`/`THIEU_BUOI_CHIEU` chuyển thành *thiếu cụm thứ n*, chỉ có nghĩa khi
`soCapQuetKyVong ≥ 2`.

### `NG` — đảo 0 → 1 ngày 15/09/2026 (phần A)

`NG` (Công tác ngoài) chuyển từ **1 công / 0 cặp quét** sang **1 công / 1 CẶP QUÉT**, cùng
với `attendanceMode: OPTIONAL → REQUIRED` và hai nút Check in / Check out ở màn "Của tôi".

**Ba thứ này phải đi CÙNG NHAU:**

| | nếu đi một mình |
|---|---|
| `soCapQuetKyVong: 1` | KHÔNG đổi gì — cổng ngoài của engine là `attendanceMode === "REQUIRED"` |
| `attendanceMode: REQUIRED` | đòi quét mà **chưa có nút nào để bấm** |
| hai nút | có nút nhưng không ai bị đòi ⇒ không ai bấm |

**Đo prod TRƯỚC khi đảo** (`viec = ngay-cong-tac`, 15/09/2026): **0 ô ca công tác đã xếp,
0 ngày công mã công tác** ⇒ không ngày quá khứ nào bị gắn cờ oan. Đó là lý do đảo được ngay
mà không cần một lượt xử lý quá khứ — nếu số ấy khác 0 thì đây đã là một quyết định khác.

Sửa bảng này mà quên `SHIFT_CATALOG` (hoặc ngược lại) thì `catalog.test.ts` **ĐỎ** — đúng ý đồ.

---

## Lệch giữa seed và prod — đo 09/09/2026, CHỜ QUYẾT

Mục V10 của `scripts/do-khung-ca-diem-cham.ts` so đủ 17 cột. Sau khi loại nhiễu thứ tự
khoá JSON, còn những lệch THẬT dưới đây. **Hai chiều** — không phải chỗ nào prod cũng
đúng:

| Mã | Cột | seed | prod | Ai đúng |
|---|---|---|---|---|
| `S` `C` `T` | `dayCredit` | 1 | **0,5** | **prod** → đã sửa seed |
| `SCT` | `dayCredit` | 1 | **1,5** | **prod** → đã sửa seed |
| `CT` `SCT` | `segments` | không có `PAID_BREAK` | **có** | **prod** → đã sửa seed |
| `HC` `12` `21` `2C` `NG` | `place` trong `segments` | **có** (`ASSIGNED` · `CENTER:CS1` · `CENTER:CS2` · `ANY_CENTER` · `OFFSITE`) | **MẤT HẾT** | **seed** 🔴 |
| `2C` | `defaultPlace` | `ANY_CENTER` | `HOME` | **seed** 🔴 |
| `NG` | `nominalMinutes` | 450 | null | **seed** 🔴 |
| `X` `P` | `payMode` | `NONE` | `SHIFT` | **seed** 🔴 |
| `CG` | `name` | "Ca gãy" | "CA GÃY" | nhỏ, prod |
| `CS` `HC` | `note` | có | null | nhỏ, seed |

🔴 **Nhóm mất `place` đáng lo nhất.** Năm mã cùng mất `place` một lúc gợi ý màn Danh mục
mã ca **làm rụng trường đó khi lưu** — chưa xác minh. Hệ quả: `lib/cham-cong/place.ts`
không còn biết đoạn sáng ở CS1 và đoạn chiều ở CS2, nên rơi hết về `defaultPlace`, và cờ
`SAI_NOI_LAM` mất nghĩa với đúng những mã sinh ra để phân biệt nơi làm.

**Chưa sửa chiều seed → prod.** Cần chủ dự án quyết, và cần xác minh màn Danh mục có phải
thủ phạm không trước khi ghi lại — ghi lại mà cửa vẫn hở là mất lần nữa.
