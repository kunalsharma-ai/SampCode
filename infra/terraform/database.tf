# ---- Database: MongoDB Atlas on AWS, reached over PrivateLink (ADR 0040) ------------------------
# A dedicated Atlas cluster (three-member replica set, which Prisma needs for transactions) in the same
# AWS region as the stack. The tasks reach it only through an interface VPC endpoint in the private
# subnets; the cluster has no IP access list entries, so it is not reachable from the internet.
#
# The mongodbatlas provider reads an Atlas organization API key from the environment:
#   MONGODB_ATLAS_PUBLIC_KEY / MONGODB_ATLAS_PRIVATE_KEY (Organization Project Creator role).

locals {
  # eu-west-1 -> EU_WEST_1 (Atlas names AWS regions this way).
  atlas_region = upper(replace(var.region, "-", "_"))
  db_name      = "zapx"
}

resource "mongodbatlas_project" "main" {
  name   = local.name
  org_id = var.atlas_org_id
}

resource "mongodbatlas_advanced_cluster" "main" {
  project_id                     = mongodbatlas_project.main.id
  name                           = local.name
  cluster_type                   = "REPLICASET"
  mongo_db_major_version         = var.db_mongodb_version
  backup_enabled                 = true
  pit_enabled                    = true
  termination_protection_enabled = true

  replication_specs {
    region_configs {
      provider_name = "AWS"
      region_name   = local.atlas_region
      priority      = 7
      electable_specs {
        instance_size = var.db_instance_size
        node_count    = 3
        disk_size_gb  = var.db_disk_size_gb
      }
      auto_scaling {
        disk_gb_enabled = true
      }
    }
  }

  advanced_configuration {
    minimum_enabled_tls_protocol = "TLS1_2"
    javascript_enabled           = false
  }

  lifecycle {
    # Disk auto-scaling grows the disk; do not shrink it back on the next apply.
    ignore_changes = [replication_specs[0].region_configs[0].electable_specs[0].disk_size_gb]
  }
}

# Point-in-time restore for db_backup_retention_days, plus daily snapshots kept as long.
resource "mongodbatlas_cloud_backup_schedule" "main" {
  project_id               = mongodbatlas_project.main.id
  cluster_name             = mongodbatlas_advanced_cluster.main.name
  restore_window_days      = min(var.db_backup_retention_days, 7)
  reference_hour_of_day    = 2
  reference_minute_of_hour = 0

  policy_item_daily {
    frequency_interval = 1
    retention_unit     = "days"
    retention_value    = var.db_backup_retention_days
  }
}

# ---- PrivateLink ---------------------------------------------------------------------------------
resource "mongodbatlas_privatelink_endpoint" "main" {
  project_id    = mongodbatlas_project.main.id
  provider_name = "AWS"
  region        = var.region
}

resource "aws_vpc_endpoint" "atlas" {
  vpc_id             = aws_vpc.main.id
  service_name       = mongodbatlas_privatelink_endpoint.main.endpoint_service_name
  vpc_endpoint_type  = "Interface"
  subnet_ids         = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.db.id]
  tags               = { Name = "${local.name}-atlas" }
}

resource "mongodbatlas_privatelink_endpoint_service" "main" {
  project_id          = mongodbatlas_project.main.id
  private_link_id     = mongodbatlas_privatelink_endpoint.main.private_link_id
  endpoint_service_id = aws_vpc_endpoint.atlas.id
  provider_name       = "AWS"
}

# The private connection string exists once the endpoint is connected, so it is read after that.
data "mongodbatlas_advanced_cluster" "main" {
  project_id = mongodbatlas_project.main.id
  name       = mongodbatlas_advanced_cluster.main.name
  depends_on = [mongodbatlas_privatelink_endpoint_service.main]
}

locals {
  # mongodb+srv://sampcode-pl-0.abcde.mongodb.net -> host for DB_HOST (database-url.ts adds the rest).
  db_private_srv = try(data.mongodbatlas_advanced_cluster.main.connection_strings[0].private_endpoint[0].srv_connection_string, "")
  db_host        = trimprefix(local.db_private_srv, "mongodb+srv://")
}

# ---- Application database user -------------------------------------------------------------------
# Read and write on the SampCode database only (that includes creating collections and indexes, which
# the migrate task does). The password is generated here and kept in Secrets Manager for the tasks;
# it is also in the Terraform state, which must stay in the encrypted, private state bucket.
resource "random_password" "db" {
  length  = 40
  special = false
}

resource "mongodbatlas_database_user" "app" {
  project_id         = mongodbatlas_project.main.id
  auth_database_name = "admin"
  username           = "zapx"
  password           = random_password.db.result

  roles {
    role_name     = "readWrite"
    database_name = local.db_name
  }

  scopes {
    name = mongodbatlas_advanced_cluster.main.name
    type = "CLUSTER"
  }
}

resource "aws_secretsmanager_secret" "db" {
  name        = "${local.name}/database"
  description = "SampCode MongoDB Atlas user: JSON with username and password"
  kms_key_id  = aws_kms_key.data.arn
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({ username = mongodbatlas_database_user.app.username, password = random_password.db.result })
}

# ---- Atlas alerts to the same address as the CloudWatch alarms -----------------------------------
locals {
  atlas_alerts = {
    cpu  = { event = "OUTSIDE_METRIC_THRESHOLD", metric = "NORMALIZED_SYSTEM_CPU_USER", operator = "GREATER_THAN", threshold = 80, units = "RAW" }
    disk = { event = "OUTSIDE_METRIC_THRESHOLD", metric = "DISK_PARTITION_SPACE_USED_DATA", operator = "GREATER_THAN", threshold = 80, units = "RAW" }
  }
}

resource "mongodbatlas_alert_configuration" "main" {
  for_each   = var.alarm_email == "" ? {} : local.atlas_alerts
  project_id = mongodbatlas_project.main.id
  event_type = each.value.event
  enabled    = true

  notification {
    type_name     = "EMAIL"
    email_address = var.alarm_email
    interval_min  = 60
    delay_min     = 5
  }

  metric_threshold_config {
    metric_name = each.value.metric
    operator    = each.value.operator
    threshold   = each.value.threshold
    units       = each.value.units
    mode        = "AVERAGE"
  }
}
