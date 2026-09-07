terraform {
  required_version = ">= 1.5.0"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 6.0" } }
}
variable "region" { default = "ap-northeast-1" }
variable "bucket_name" { type = string }
provider "aws" { region = var.region }
resource "aws_s3_bucket" "archives" {
  bucket        = var.bucket_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "archives" {
  bucket                  = aws_s3_bucket.archives.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "archives" {
  bucket = aws_s3_bucket.archives.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "archives" {
  bucket = aws_s3_bucket.archives.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
resource "aws_s3_bucket_policy" "tls" {
  bucket = aws_s3_bucket.archives.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "DenyNonTLS", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.archives.arn, "${aws_s3_bucket.archives.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
# No versioning: user deletion must remove the original, not leave historical object versions.
# If versioning is introduced, implement DeleteObjectVersion + version enumeration first.
output "bucket" { value = aws_s3_bucket.archives.id }
output "runtime_policy" {
  value = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.archives.arn], Condition = { StringLike = { "s3:prefix" = ["users/*"] } } },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = ["${aws_s3_bucket.archives.arn}/users/*"] }
  ] })
}
