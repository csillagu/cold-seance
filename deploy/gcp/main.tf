locals {
  # The image, pulled through the registry proxy below.
  image = "${var.region}-docker.pkg.dev/${var.gcp_project}/${google_artifact_registry_repository.ghcr.repository_id}/${var.image}"
  url   = google_cloud_run_v2_service.this.uri
  # The tool's settings, as environment variables (DD-059). The App's key is a mounted file; the
  # rest are given as they are. Neon's addresses carry sslmode=require, which the tool's
  # PostgreSQL client honours.
  env = {
    COLD_SEANCE_DATABASE_URL                              = neon_project.this.connection_uri_pooler
    COLD_SEANCE_DATABASE_DIRECT_URL                       = neon_project.this.connection_uri
    COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID            = tostring(var.github_app_id)
    COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE  = "/secrets/github-app/github-app.pem"
    COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_APP_ID           = tostring(var.github_app_id)
    COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE = "/secrets/github-app/github-app.pem"
    COLD_SEANCE_GITHUB_TOKENS_PROJECTS_STATUS             = var.github_projects_token
    COLD_SEANCE_GITHUB_WEBHOOK_SECRET                     = random_password.webhook.result
    COLD_SEANCE_GITHUB_STATUS_FIELD_NAME                  = var.status_field.name
    COLD_SEANCE_GITHUB_STATUS_FIELD_STARTED               = var.status_field.started
    COLD_SEANCE_GITHUB_STATUS_FIELD_ON_HOLD               = var.status_field.on_hold
    COLD_SEANCE_GITHUB_RECHECK_INTERVAL_MINUTES           = tostring(var.recheck_interval_minutes)
    COLD_SEANCE_FIRST_ADMIN_USERNAME                      = var.first_admin_username
    COLD_SEANCE_FIRST_ADMIN_PASSWORD                      = random_password.admin.result
    TZ                                                    = var.timezone
  }
}

# The first system admin's password and the webhook secret, generated once and kept in the state.
resource "random_password" "admin" {
  length  = 32
  special = false
}

resource "random_password" "webhook" {
  length  = 40
  special = false
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

resource "google_project_service" "this" {
  for_each           = toset(["run.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

# Secret Manager: the GitHub App's key, which the tool reads from a file, and the registry token,
# which the registry proxy reads from here. The other settings are environment variables.
resource "google_secret_manager_secret" "github_app_key" {
  secret_id = "${var.name}-github-app-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_version" "github_app_key" {
  secret      = google_secret_manager_secret.github_app_key.id
  secret_data = file(pathexpand(var.github_app_private_key_file))
}

resource "google_secret_manager_secret" "ghcr_token" {
  secret_id = "${var.name}-ghcr-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_version" "ghcr_token" {
  secret      = google_secret_manager_secret.ghcr_token.id
  secret_data = var.ghcr_token
}

# Cloud Run pulls only from Google's registries, so this repository proxies the GitHub Container
# Registry, signing in with the owner's read:packages token, and keeps a copy of what it pulled.
resource "google_artifact_registry_repository" "ghcr" {
  location      = var.region
  repository_id = "${var.name}-ghcr"
  description   = "ghcr.io, for the test deployment"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"

  remote_repository_config {
    description = "ghcr.io"
    docker_repository {
      custom_repository {
        uri = "https://ghcr.io"
      }
    }
    upstream_credentials {
      username_password_credentials {
        username                = var.github_owner
        password_secret_version = google_secret_manager_secret_version.ghcr_token.name
      }
    }
  }

  # Copies older than a month are dropped, so that storage stays within the free tier.
  cleanup_policies {
    id     = "older-than-30-days"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.ghcr_token]
}

# Artifact Registry's own service agent reads the registry token. Google creates the agent only
# at the API's first use, so it is created here first.
resource "google_project_service_identity" "artifactregistry" {
  provider   = google-beta
  service    = "artifactregistry.googleapis.com"
  depends_on = [google_project_service.this]
}

# A new service agent cannot be granted a role for a while after it is created.
resource "time_sleep" "artifactregistry_agent" {
  create_duration = "60s"
  depends_on      = [google_project_service_identity.artifactregistry]
}

resource "google_secret_manager_secret_iam_member" "ghcr_token" {
  secret_id  = google_secret_manager_secret.ghcr_token.id
  role       = "roles/secretmanager.secretAccessor"
  member     = google_project_service_identity.artifactregistry.member
  depends_on = [time_sleep.artifactregistry_agent]
}

# The service's own account, which may only read the App's key.
resource "google_service_account" "this" {
  account_id   = var.name
  display_name = "The ${var.name} Cloud Run service"
}

resource "google_secret_manager_secret_iam_member" "github_app_key" {
  secret_id = google_secret_manager_secret.github_app_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.this.email}"
}

# The tool: scaled to zero and to one instance, so that there is one re-check timer and the cost
# is bounded. Its CPU stays allocated while an instance is up, not only during a request, so that
# the re-check runs and a webhook delivery is handled after it is answered. Anyone may call it;
# the tool checks every call itself.
resource "google_cloud_run_v2_service" "this" {
  name                 = var.name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true
  deletion_protection  = false

  template {
    service_account                  = google_service_account.this.email
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = local.image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }

      # Cloud Run's default startup check, a TCP connection to the port, is enough: the tool
      # listens once its database is migrated.
      volume_mounts {
        name       = "github-app"
        mount_path = "/secrets/github-app"
      }
    }

    volumes {
      name = "github-app"
      secret {
        secret = google_secret_manager_secret.github_app_key.secret_id
        items {
          version = google_secret_manager_secret_version.github_app_key.version
          path    = "github-app.pem"
        }
      }
    }
  }

  # A revision made by `terraform output update` records the command that made it.
  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    google_project_service.this,
    google_secret_manager_secret_iam_member.github_app_key,
  ]
}
