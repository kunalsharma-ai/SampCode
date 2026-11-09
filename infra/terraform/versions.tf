# SampCode on AWS (Milestone 13). One stack per environment (staging, production): see README.md.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 1.26"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # Configure a remote state backend per environment, e.g. in backend.hcl:
  #   bucket = "sampledge-terraform-state"  key = "zapx/production.tfstate"  region = "eu-west-1"  use_lockfile = true
  # and run `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Application = "zapx", Environment = var.environment, ManagedBy = "terraform" }
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Application = "zapx", Environment = var.environment, ManagedBy = "terraform" }
  }
}

# MongoDB Atlas (database.tf): credentials from MONGODB_ATLAS_PUBLIC_KEY / MONGODB_ATLAS_PRIVATE_KEY.
provider "mongodbatlas" {}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  name = "zapx-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
}
