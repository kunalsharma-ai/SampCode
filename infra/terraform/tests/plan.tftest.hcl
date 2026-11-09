# Plans the whole stack against a mocked AWS provider (no account, no network): catches broken
# references, counts and validations. Run: terraform init -backend=false && terraform test
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-west-1:111122223333:key/abc" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111122223333.dkr.ecr.eu-west-1.amazonaws.com/zapx-staging-api" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::111122223333:function/zapx-staging-spa" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-west-1:111122223333:zapx-staging-alarms" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/zapx-staging" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/zapx-staging/abc", arn_suffix = "app/zapx-staging/abc" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/zapx-staging/abc", arn_suffix = "targetgroup/zapx-staging/abc" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:listener/app/zapx-staging/abc/def" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:eu-west-1:111122223333:regional/webacl/zapx-staging-alb/abc" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-west-1:111122223333:log-group:aws-waf-logs-zapx-staging-alb" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::zapx-staging-files-abc", id = "zapx-staging-files-abc", bucket_regional_domain_name = "zapx-staging-files-abc.s3.eu-west-1.amazonaws.com" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-west-1:111122223333:secret:zapx-staging/app" }
  }
}

mock_provider "random" {}

mock_provider "mongodbatlas" {
  mock_resource "mongodbatlas_project" {
    defaults = { id = "6500000000000000000000aa" }
  }
  mock_resource "mongodbatlas_privatelink_endpoint" {
    defaults = { private_link_id = "6500000000000000000000bb", endpoint_service_name = "com.amazonaws.vpce.eu-west-1.vpce-svc-0abc" }
  }
  mock_data "mongodbatlas_advanced_cluster" {
    defaults = {
      connection_strings = [{ private_endpoint = [{ srv_connection_string = "mongodb+srv://zapx-staging-pl-0.abcde.mongodb.net" }] }]
    }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:111122223333:global/webacl/zapx-staging-edge/abc" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111122223333:log-group:aws-waf-logs-zapx-staging-edge" }
  }
}

variables {
  environment                = "staging"
  studio_domain              = "staging.zapx.example.com"
  runtime_domain             = "take.staging.zapx.example.com"
  capi_domain                = "field.staging.zapx.example.com"
  api_origin_domain          = "origin.staging.zapx.example.com"
  alb_certificate_arn        = "arn:aws:acm:eu-west-1:111122223333:certificate/a"
  cloudfront_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/b"
  image_tag                  = "abc123"
  edge_shared_secret         = "0123456789abcdef0123456789abcdef"
  atlas_org_id               = "6500000000000000000000cc"
}

run "plan" {
  command = apply

  assert {
    condition     = length(aws_subnet.private) == 2 && length(aws_nat_gateway.main) == 1
    error_message = "Two private subnets and one shared NAT gateway by default"
  }
  assert {
    condition     = mongodbatlas_advanced_cluster.main.termination_protection_enabled && mongodbatlas_advanced_cluster.main.pit_enabled && mongodbatlas_advanced_cluster.main.cluster_type == "REPLICASET"
    error_message = "The database must be a replica set, protected from deletion, with point-in-time restore"
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[index(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[*].name, "DB_HOST")].value == "zapx-staging-pl-0.abcde.mongodb.net"
    error_message = "The tasks reach the cluster through its PrivateLink host"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.files.block_public_policy && aws_s3_bucket_public_access_block.files.restrict_public_buckets
    error_message = "The files bucket must not be public"
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[index(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[*].name, "FILE_STORE")].value == "s3"
    error_message = "The API must use the S3 file store"
  }
  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets[*].name, "DB_PASSWORD")
    error_message = "The database password must come from the database secret"
  }
  assert {
    condition     = !contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[*].name, "JWT_SECRET")
    error_message = "Secrets must not be plain environment variables"
  }
  assert {
    condition     = length(aws_cloudfront_distribution.static) == 2
    error_message = "Runtime and CAPI each have a CloudFront distribution"
  }
  assert {
    condition     = alltrue([for d in aws_cloudfront_distribution.static : d.web_acl_id == aws_wafv2_web_acl.edge[0].arn]) && length(aws_wafv2_web_acl_association.alb) == 1
    error_message = "WAF is in front of CloudFront and the load balancer by default"
  }
  assert {
    condition     = length(one([for r in aws_wafv2_web_acl.alb[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet"]).override_action[0].count) == 1
    error_message = "Managed rules start in count mode"
  }
  assert {
    condition     = aws_appautoscaling_target.service["api"].min_capacity == 2 && aws_appautoscaling_target.service["api"].max_capacity == 6
    error_message = "The API scales between 2 and 6 tasks"
  }
  assert {
    condition     = length(aws_backup_selection.main) == 1 && length(aws_backup_selection.main[0].resources) == 1 && mongodbatlas_cloud_backup_schedule.main.policy_item_daily[0].retention_value == 14
    error_message = "AWS Backup covers the files bucket; Atlas keeps 14 days of database snapshots"
  }
  assert {
    condition     = !aws_ecs_service.api.enable_execute_command
    error_message = "ECS Exec is off unless asked for"
  }
  assert {
    condition     = alltrue([for acl in [aws_wafv2_web_acl.edge[0], aws_wafv2_web_acl.alb[0]] : length([for r in acl.rule : r if startswith(r.name, "sign-in-rate")]) == 1 && length([for r in acl.rule : r if r.name == "AWSManagedRulesSQLiRuleSet"]) == 1])
    error_message = "Both web ACLs rate-limit sign-in and carry the SQL injection rules"
  }
  assert {
    condition     = alltrue([for k, p in aws_cloudfront_response_headers_policy.static : length(p.security_headers_config[0].content_security_policy) == 1 && strcontains(p.security_headers_config[0].content_security_policy[0].content_security_policy, "object-src 'none'")])
    error_message = "Both static apps send a content security policy"
  }
  assert {
    condition     = length(aws_cloudfront_response_headers_policy.static["capi"].security_headers_config[0].frame_options) == 1 && length(aws_cloudfront_response_headers_policy.static["runtime"].security_headers_config[0].frame_options) == 0
    error_message = "Only the interviewer app refuses framing"
  }
}

run "bad_sign_in_rate_is_refused" {
  command = plan
  variables {
    waf_sign_in_rate_limit = 5
  }
  expect_failures = [var.waf_sign_in_rate_limit]
}

run "waf_block" {
  command = plan
  variables {
    waf_mode = "block"
  }
  assert {
    condition     = length(one([for r in aws_wafv2_web_acl.edge[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet"]).override_action[0].none) == 1 && length(one([for r in aws_wafv2_web_acl.edge[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet"]).override_action[0].count) == 0
    error_message = "Block mode lets the managed rules block"
  }
}

run "waf_off" {
  command = plan
  variables {
    waf_mode         = "off"
    backup_enabled   = false
    ecs_exec_enabled = true
  }
  assert {
    condition     = length(aws_wafv2_web_acl.edge) == 0 && length(aws_backup_plan.main) == 0 && aws_ecs_service.api.enable_execute_command
    error_message = "WAF and backups can be turned off, ECS Exec on"
  }
}

run "bad_waf_mode_is_refused" {
  command = plan
  variables {
    waf_mode = "maybe"
  }
  expect_failures = [var.waf_mode]
}

run "short_edge_secret_is_refused" {
  command = plan
  variables {
    edge_shared_secret = "too-short"
  }
  expect_failures = [var.edge_shared_secret]
}

run "nat_per_az" {
  command = plan
  variables {
    nat_gateway_per_az = true
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 2
    error_message = "One NAT gateway per zone when asked"
  }
}
