# ---- AWS Backup (Milestone 14) ------------------------------------------------------------------
# Daily backups of the files bucket, kept backup_retention_days, on top of S3 versioning. The vault uses
# the stack's KMS key. The database is backed up by Atlas itself (snapshots and point-in-time restore,
# database.tf): AWS Backup cannot back up Atlas.
resource "aws_backup_vault" "main" {
  count       = var.backup_enabled ? 1 : 0
  name        = local.name
  kms_key_arn = aws_kms_key.data.arn
}

resource "aws_backup_plan" "main" {
  count = var.backup_enabled ? 1 : 0
  name  = local.name
  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.main[0].name
    schedule          = "cron(0 2 * * ? *)"
    start_window      = 60
    completion_window = 360
    lifecycle {
      delete_after = var.backup_retention_days
    }
  }
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  count              = var.backup_enabled ? 1 : 0
  name               = "${local.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = var.backup_enabled ? toset([
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
    "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup",
    "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore",
  ]) : toset([])
  role       = aws_iam_role.backup[0].name
  policy_arn = each.value
}

resource "aws_backup_selection" "main" {
  count        = var.backup_enabled ? 1 : 0
  name         = local.name
  plan_id      = aws_backup_plan.main[0].id
  iam_role_arn = aws_iam_role.backup[0].arn
  resources    = [aws_s3_bucket.files.arn]
}
