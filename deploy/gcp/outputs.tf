output "url" {
  description = "The deployment's address: LIVE_URL for the live test suite."
  value       = "https://${local.host}"
}

output "address" {
  description = "The machine's external IP address, at which a domain's DNS record points."
  value       = google_compute_address.this.address
}

output "ssh" {
  description = "Opens a shell on the machine."
  value       = "gcloud compute ssh ${google_compute_instance.this.name} --project ${var.gcp_project} --zone ${var.zone} --tunnel-through-iap"
}

output "restart" {
  description = "Restarts the tool: it pulls the image again and reads its settings again."
  value       = "gcloud compute ssh ${google_compute_instance.this.name} --project ${var.gcp_project} --zone ${var.zone} --tunnel-through-iap --command 'sudo systemctl restart cold-seance'"
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
