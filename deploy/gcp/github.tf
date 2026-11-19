# GitHub: the test repository's webhook and the `live` environment the live test workflow runs in
# (SC-125, DD-062). The token comes from GITHUB_TOKEN; see the README for what it needs.

locals {
  webhook_url = "https://${local.host}/api/github/webhooks"
  # The live suite's settings (backend/test/live/settings.ts): variables, then secrets.
  live_variables = {
    LIVE_URL                   = "https://${local.host}"
    LIVE_ADMIN_USERNAME        = var.first_admin_username
    LIVE_GITHUB_REPOSITORY     = "${var.github_owner}/${var.test_repository}"
    LIVE_GITHUB_PROJECT_OWNER  = var.github_owner
    LIVE_GITHUB_PROJECT_NUMBER = tostring(var.github_project_number)
    LIVE_STATUS_FIELD_NAME     = var.status_field.name
    LIVE_STATUS_FIELD_STARTED  = var.status_field.started
    LIVE_STATUS_FIELD_ON_HOLD  = var.status_field.on_hold
    LIVE_TIMEZONE              = var.timezone
    # Three re-checks: a change to the Projects status field reaches the tool only at one.
    LIVE_WAIT_MINUTES = tostring(3 * var.recheck_interval_minutes)
  }
  live_secrets = {
    LIVE_ADMIN_PASSWORD        = random_password.admin.result
    LIVE_GITHUB_TOKEN          = var.live_github_token
    LIVE_GITHUB_PROJECTS_TOKEN = var.github_projects_token
  }
}

# The test repository's webhook, pointed at the tool's webhook endpoint (SC-105), with the events
# the tool takes in from a repository. GitHub sends no event for a Project owned by a user, so the
# status field still comes in through the re-check.
resource "github_repository_webhook" "test" {
  repository = var.test_repository
  events     = ["issues", "sub_issues", "issue_dependencies"]
  active     = true

  configuration {
    url          = local.webhook_url
    content_type = "json"
    secret       = random_password.webhook.result
    insecure_ssl = false
  }
}

resource "github_repository_environment" "live" {
  repository  = var.environment_repository
  environment = "live"
}

resource "github_actions_environment_variable" "live" {
  for_each      = local.live_variables
  repository    = var.environment_repository
  environment   = github_repository_environment.live.environment
  variable_name = each.key
  value         = each.value
}

resource "github_actions_environment_secret" "live" {
  for_each        = toset(keys(local.live_secrets))
  repository      = var.environment_repository
  environment     = github_repository_environment.live.environment
  secret_name     = each.key
  plaintext_value = local.live_secrets[each.key]
}
