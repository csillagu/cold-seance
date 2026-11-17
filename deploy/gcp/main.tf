locals {
  region = join("-", slice(split("-", var.zone), 0, 2))
  # The machine's address under sslip.io (1.2.3.4 is 1-2-3-4.sslip.io), unless a domain is given.
  host = var.domain != "" ? var.domain : "${replace(google_compute_address.this.address, ".", "-")}.sslip.io"
  # Neon's addresses carry sslmode=require, which the tool's PostgreSQL client honours.
  settings = join("\n", [
    "COLD_SEANCE_DATABASE_URL=${neon_project.this.connection_uri_pooler}",
    "COLD_SEANCE_DATABASE_DIRECT_URL=${neon_project.this.connection_uri}",
    "COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID=${var.github_app_id}",
    "COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE=/run/secrets/github-app.pem",
    "COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_APP_ID=${var.github_app_id}",
    "COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE=/run/secrets/github-app.pem",
    "COLD_SEANCE_GITHUB_TOKENS_PROJECTS_STATUS=${var.github_projects_token}",
    "COLD_SEANCE_GITHUB_STATUS_FIELD_NAME=${var.status_field.name}",
    "COLD_SEANCE_GITHUB_STATUS_FIELD_STARTED=${var.status_field.started}",
    "COLD_SEANCE_GITHUB_STATUS_FIELD_ON_HOLD=${var.status_field.on_hold}",
    "COLD_SEANCE_GITHUB_RECHECK_INTERVAL_MINUTES=${var.recheck_interval_minutes}",
    "COLD_SEANCE_FIRST_ADMIN_USERNAME=${var.first_admin_username}",
    "COLD_SEANCE_FIRST_ADMIN_PASSWORD=${var.first_admin_password}",
    "TZ=${var.timezone}",
    "",
  ])
}

# The database: a Neon project on the free plan, with its default branch, database and role.
resource "neon_project" "this" {
  name       = var.name
  region_id  = var.neon_region
  org_id     = var.neon_org_id
  pg_version = var.postgres_version
  # The free plan keeps at most 6 hours of history.
  history_retention_seconds = 21600

  branch {
    name          = "main"
    database_name = "cold_seance"
    role_name     = "cold_seance"
  }
}

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

# The machine's own account, which may only write its logs: it reads its settings from its own
# metadata, which needs no role.
resource "google_service_account" "this" {
  account_id   = var.name
  display_name = "The ${var.name} machine"
}

resource "google_project_iam_member" "logs" {
  project = var.gcp_project
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.this.email}"
}

# A fixed address, so that the host name, and with it the certificate, stay the same.
resource "google_compute_address" "this" {
  name       = var.name
  region     = local.region
  depends_on = [google_project_service.compute]
}

# Only HTTP (for Let's Encrypt and the redirect) and HTTPS reach the machine from the internet; SSH
# only through Identity-Aware Proxy (gcloud compute ssh --tunnel-through-iap).
resource "google_compute_firewall" "web" {
  name          = "${var.name}-web"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = [var.name]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_firewall" "ssh" {
  name          = "${var.name}-iap-ssh"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = [var.name]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_instance" "this" {
  name         = var.name
  machine_type = "e2-micro"
  zone         = var.zone
  tags         = [var.name]

  desired_status            = var.running ? "RUNNING" : "TERMINATED"
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      # The free tier covers 30 GB of standard persistent disk.
      size = 30
      type = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.this.address
    }
  }

  service_account {
    email  = google_service_account.this.email
    scopes = ["logging-write"]
  }

  metadata = {
    # Container-Optimized OS runs this at every start: /etc is rebuilt at each boot.
    user-data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
      image = var.image
      host  = local.host
      email = var.acme_email
    })
    google-logging-enabled = "true"
    # The tool's settings and the App's key, read again at each start of the tool. Only the Google
    # Cloud project's users can read an instance's metadata.
    cold-seance-settings = local.settings
    github-app-key       = file(pathexpand(var.github_app_private_key_file))
  }

  depends_on = [google_project_iam_member.logs]
}
