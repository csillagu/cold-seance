# The `demo` environment the demo seeding workflow runs in (#257, SC-131, DD-064): separate from
# `live`, with the owner as its required reviewer once `demo_require_approval` is set, so that no
# run resets the deployment's projects without their approval. GitHub's free plan has required
# reviewers only on public repositories, so it stays off until cold-seance is public (#242).
#
# Its settings are the same values as the live tests' for now: the deployment and its first system
# admin, and a Neon API key of its own variable, for now the key Terraform itself uses.

locals {
  demo_variables = {
    SEED_URL            = local.url
    SEED_ADMIN_USERNAME = var.first_admin_username
    NEON_PROJECT_ID     = neon_project.this.id
    NEON_DATABASE       = "cold_seance"
    NEON_ROLE           = "cold_seance"
  }
  demo_secrets = {
    SEED_ADMIN_PASSWORD = random_password.admin.result
    NEON_API_KEY        = var.demo_neon_api_key
  }
}

data "github_user" "demo_approver" {
  username = var.demo_approver
}

resource "github_repository_environment" "demo" {
  repository  = var.environment_repository
  environment = "demo"

  # The approver also starts the runs, so they may approve their own.
  prevent_self_review = false
  dynamic "reviewers" {
    for_each = var.demo_require_approval ? [data.github_user.demo_approver.id] : []
    content {
      users = [tonumber(reviewers.value)]
    }
  }
}

resource "github_actions_environment_variable" "demo" {
  for_each      = local.demo_variables
  repository    = var.environment_repository
  environment   = github_repository_environment.demo.environment
  variable_name = each.key
  value         = each.value
}

resource "github_actions_environment_secret" "demo" {
  for_each    = toset(keys(local.demo_secrets))
  repository  = var.environment_repository
  environment = github_repository_environment.demo.environment
  secret_name = each.key
  value       = local.demo_secrets[each.key]
}
