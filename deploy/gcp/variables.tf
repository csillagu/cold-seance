variable "gcp_project" {
  description = "The Google Cloud project to deploy into: an existing one, with billing enabled (the free tier still needs a billing account)."
  type        = string
}

variable "zone" {
  description = "The zone of the machine. Google Cloud's free tier covers one e2-micro machine in us-west1, us-central1 or us-east1 only."
  type        = string
  default     = "us-east1-b"

  validation {
    condition     = can(regex("^us-(west1|central1|east1)-[a-z]$", var.zone))
    error_message = "The free tier covers an e2-micro machine in a zone of us-west1, us-central1 or us-east1 only."
  }
}

variable "name" {
  description = "The name of the machine, the Neon project and the other resources."
  type        = string
  default     = "cold-seance-test"
}

variable "running" {
  description = "Whether the machine runs. Set it to false between test runs to stop it, and true to start it again."
  type        = bool
  default     = true
}

variable "image" {
  description = "The application image. The machine pulls it again each time it starts the tool."
  type        = string
  default     = "ghcr.io/csillagu/cold-seance:latest"
}

variable "domain" {
  description = "The host name the tool is served at, whose DNS points at the machine's address (the output address). Empty: the address under sslip.io."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "The e-mail address Let's Encrypt may write to about the certificate. Optional."
  type        = string
  default     = ""
}

variable "neon_region" {
  description = "The Neon region of the database; aws-us-east-1 is close to us-east1."
  type        = string
  default     = "aws-us-east-1"
}

variable "neon_org_id" {
  description = "The Neon organization to create the project in, if the API key belongs to more than one."
  type        = string
  default     = null
}

variable "postgres_version" {
  description = "The PostgreSQL version of the Neon database."
  type        = number
  default     = 18
}

variable "github_app_id" {
  description = "The id of the GitHub App that reads and writes issues (readIssues, writeIssues). It must be installed on the test repository."
  type        = number
}

variable "github_app_private_key_file" {
  description = "The path, on the machine running Terraform, of the GitHub App's private key (.pem)."
  type        = string
}

variable "github_projects_token" {
  description = "The classic personal access token, with the repo and project scopes, that the deployment reads the Projects status field with (projectsStatus) and the live suite sets it with. A fine-grained token cannot reach a Project owned by a user."
  type        = string
  sensitive   = true
}

variable "github_owner" {
  description = "The GitHub account that owns the test repository and the repository whose `live` environment Terraform writes."
  type        = string
  default     = "csillagu"
}

variable "test_repository" {
  description = "The name of the test repository, under github_owner, which the App is installed on and Terraform puts the webhook on."
  type        = string
  default     = "cold-seance-live"
}

variable "environment_repository" {
  description = "The name of the repository, under github_owner, whose `live` environment the live test workflow runs in."
  type        = string
  default     = "cold-seance"
}

variable "github_project_number" {
  description = "The number of the GitHub Project, owned by github_owner, whose status field the deployment reads."
  type        = number
}

variable "live_github_token" {
  description = "The fine-grained personal access token the live suite acts on the test repository with; see the README for its permissions."
  type        = string
  sensitive   = true
}

variable "status_field" {
  description = "The GitHub Projects status field and its options for started and on hold."
  type = object({
    name    = optional(string, "Status")
    started = optional(string, "In Progress")
    on_hold = optional(string, "On Hold")
  })
  default = {}
}

variable "recheck_interval_minutes" {
  description = "How often the tool re-checks the linked issues. GitHub sends no webhook for a user's Project, so a change to the status field reaches the tool only then."
  type        = number
  default     = 2
}

variable "first_admin_username" {
  description = "The first system admin, created at the first start. The live test suite signs in as them."
  type        = string
  default     = "root"
}

variable "timezone" {
  description = "The tool's time zone, in which a task's actual start and finish dates are recorded."
  type        = string
  default     = "UTC"
}
