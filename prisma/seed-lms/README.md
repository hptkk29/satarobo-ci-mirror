# Seed test diện rộng — LMS + CRM (`prisma/seed-lms/`)

Bộ seed sinh **DB test diện rộng** để thử phần **LMS** (và phễu **CRM** đề xuất kèm theo)
cho Sata Robo. Idempotent theo id cố định (`slms-*`), chạy trên **Postgres local/test**.

## Chạy nhanh

```bash
# 1) Nền (Center/Course/OrgUnit/Role/Dept/admin) — chạy 1 lần
pnpm exec dotenv -e .env.test -- tsx prisma/seed.ts

# 2) Seed LMS+CRM — smoke (nhỏ, ~vài trăm rows) để thử script
pnpm exec dotenv -e .env.test -- tsx prisma/seed-lms/index.ts

# 3) Full (số thật: 5000 PH · ~10k HV · 1000 lớp · 90k điểm danh · CRM)
SEED_SCALE=full pnpm exec dotenv -e .env.test -- tsx prisma/seed-lms/index.ts
```

> ⚠️ **An toàn:** `index.ts` gọi `assertLocalDb()` — TỪ CHỐI chạy nếu `DATABASE_URL`
> không trỏ `127.0.0.1`/`localhost`/`*_test` (chống seed nhầm 200k rows vào Supabase).
> Muốn ghi DB remote phải cố ý đặt `SEED_ALLOW_REMOTE=1`.

Reset sạch trước khi chạy lại full (tránh trùng id smoke↔full):
```bash
pnpm exec dotenv -e .env.test -- prisma migrate reset --force --skip-seed
pnpm exec dotenv -e .env.test -- tsx prisma/seed.ts
SEED_SCALE=full pnpm exec dotenv -e .env.test -- tsx prisma/seed-lms/index.ts
```

## ENV (knob)

| ENV | Mặc định | Ý nghĩa |
|---|---|---|
| `SEED_SCALE` | `smoke` | `smoke` \| `full` |
| `SEED_MODULES` | `all` | `staff,parents,content,classes,crm` (chọn phần) |
| `SEED_PASSWORD` | `Test@2026!` | Mật khẩu login cho MỌI user seed |
| `SEED_ALLOW_REMOTE` | — | `1` = bỏ guard local (tự chịu trách nhiệm) |

Mỗi module chạy độc lập được — thiếu dữ liệu đầu vào (GV/HV/nội dung) thì tự fetch từ DB.

## Sản lượng (full)

| Nhóm | Số lượng |
|---|---|
| Phụ huynh (`User` role PARENT) | 5.000 |
| Học viên (`Student`) | ~9.900 (1–3 con/PH) |
| Nhân viên (10 phòng × 10) | 100 `Employee`+`User`+`UserOrgRole` |
| Lớp / Ghi danh / Buổi / Điểm danh | 1.000 / ~9.000 / 16.000 / ~90.000 |
| Nội dung | 2 Curriculum · 48 Lesson · ~150 slide (`Document`) · **10 SCORM** |
| CRM | 2.000 lead · phễu → trial → ~400 đơn/payment/receipt |

## Đăng nhập thử

- **Phụ huynh (portal):** `ph.00001@seed.satarobo.test` … `ph.05000@…` · mật khẩu `SEED_PASSWORD`.
- **Nhân viên (admin):** `nv.<phongban>.<nn>@seed.satarobo.test` (vd `nv.giang_day.01@seed.satarobo.test`).
- **Giáo viên:** phòng `GIANG_DAY` + `DAO_TAO` (đã có `UserOrgRole` TEACHER/CENTER_MANAGER).
- Admin gốc: `admin@example.com` (đổi bằng env `SEED_ADMIN_EMAIL`) / mật khẩu = env `SEED_ADMIN_PASSWORD` lúc chạy `pnpm db:seed` (không đặt ⇒ ngẫu nhiên, đặt lại bằng Quên mật khẩu) (từ base seed).

## SCORM & slide PDF — mức "chỉ row DB" (mặc định)

`ScormPackage` và `Document`(slide) hiện **chỉ là row DB**: `storagePrefix`/`fileUrl` trỏ key
R2 **giả**, `sizeBytes` hiển thị 10–50MB. → danh sách / gắn buổi / RBAC / đếm **chạy đủ**;
bấm **"mở player"** hoặc **"xem PDF"** sẽ **404** (R2 không có file thật).

**Nâng cấp lên "chạy thật"** (khi cần player/viewer render) — KHÔNG cần zip 10–50MB thật:
1. Đặt env R2 (`R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_URL`).
2. `PutObject` 1 file `scorm/{packageId}/index.html` (HTML tĩnh vài KB, khớp `launchUrl`) cho mỗi gói;
   1 file PDF mẫu dùng chung cho mọi `Document.fileUrl`.
3. Giữ `status=PUBLISHED` (bỏ qua pipeline giải nén zip). Player/viewer sẽ render.

## Quyết định đã chốt (tự chọn khi bạn away — dễ đổi)

1. **Target DB = Postgres local** (`satarobo_test` @ 127.0.0.1) — đúng rule "test = local", KHÔNG ghi Supabase.
2. **SCORM/PDF = chỉ row DB** (nhanh, không cần secret R2). Player 404 tới khi upload file thật (mục trên).
3. **Sinh dữ liệu = generator VN tự viết** (`_lib.ts`), KHÔNG thêm `@faker-js/faker` (đúng rule "không auto-add lib").
4. **CRM = phễu đầy đủ** — giữ bất biến tiền (Σ Payment CONFIRMED == Σ installment PAID; Receipt chỉ khi CONFIRMED).

## Bất biến đã verify (query trong `prisma/seed-lms/`)

- 0 `centerId` NULL trên SCOPED models · Student chỉ ở CS1/CS2 · `Enrollment.centerId == class.centerId`.
- 0 trùng `(studentId,classId)` ghi danh sống · 1 SCORM active / lesson.
- Money: Σ Payment CONFIRMED == Σ installment PAID/đơn · Σ installment == `Order.totalAmount` · Receipt chỉ cho Payment CONFIRMED.
