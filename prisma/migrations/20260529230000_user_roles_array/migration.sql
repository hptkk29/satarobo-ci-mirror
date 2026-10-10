-- Đợt 3B — User.roles[] (đa vai trò) + backfill = [role]
ALTER TABLE "User" ADD COLUMN "roles" "Role"[] DEFAULT ARRAY[]::"Role"[];

-- Backfill: mọi user hiện có → roles = [role] (giữ nguyên quyền).
UPDATE "User" SET "roles" = ARRAY["role"]::"Role"[] WHERE cardinality("roles") = 0;
