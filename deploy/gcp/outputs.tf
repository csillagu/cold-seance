output "url" {
  description = "The deployment's address: LIVE_URL for the live test suite."
  value       = local.url
}

output "webhook_url" {
  description = "Where the test repository's webhook delivers."
  value       = local.webhook_url
}

output "admin_password" {
  description = "The first system admin's password: terraform output -raw admin_password."
  value       = random_password.admin.result
  sensitive   = true
}

output "image" {
  description = "The image the service runs, by digest."
  value       = local.image
}

output "logs" {
  description = "Shows the tool's recent logs."
  value       = "gcloud run services logs read ${google_cloud_run_v2_service.this.name} --region ${var.region} --project ${var.gcp_project}"
}
