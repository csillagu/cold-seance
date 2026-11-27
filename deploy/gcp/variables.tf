variable "gcp_project" {
  description = "The Google Cloud project to deploy into: an existing one, with billing enabled (the free tier still needs a billing account)."
  type        = string
}

variable "region" {
  description = "The Cloud Run region of the service and of its image's registry; us-east1 is close to Neon's aws-us-east-1."
  type        = string
  default     = "us-east1"
}

variable "name" {
  description = "The name of the Cloud Run service, the Neon project and the other resources."
  type        = string
  default     = "cold-seance-test"
}

variable "image" {
  description = "The application image on the GitHub Container Registry, without ghcr.io/ and without a tag."
  type        = string
  default     = "csillagu/cold-seance"
}

variable "image_tag" {
  description = "The image's tag. Each plan looks up the version it points to on ghcr.io, and the service runs that version."
  type        = string
  default     = "latest"
}

variable "ghcr_token" {
  description = "The classic personal access token, with only the read:packages scope, that the registry proxy pulls the private image with. A fine-grained token cannot read GitHub Packages."
  type        = string
  sensitive   = true
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
  description = "The classic personal access token of test_owner, with the repo and project scopes, that the deployment reads the Projects status field with (projectsStatus) and the live suite sets it with. A fine-grained token cannot reach a Project owned by a user; made by test_owner, it reaches only that account's repositories and Projects."
  type        = string
  sensitive   = true
}

variable "github_owner" {
  description = "The GitHub account that owns the image, the registry token and the repository whose `live` and `demo` environments Terraform writes."
  type        = string
  default     = "csillagu"
}

variable "test_owner" {
  description = "The GitHub account made only for the live tests, which owns the test repository, its Project, the GitHub App and the Projects token (#261)."
  type        = string
  default     = "csillagu-alt"
}

variable "test_github_token" {
  description = "The fine-grained personal access token of test_owner, on the test repository only, with Webhooks read and write, that Terraform sets up the test repository's webhook with."
  type        = string
  sensitive   = true
}

variable "test_repository" {
  description = "The name of the test repository, under test_owner, which the App is installed on and Terraform puts the webhook on."
  type        = string
  default     = "cold-seance-live"
}

variable "environment_repository" {
  description = "The name of the repository, under github_owner, whose `live` environment the live test workflow runs in."
  type        = string
  default     = "cold-seance"
}

variable "github_project_number" {
  description = "The number of the GitHub Project, owned by test_owner, whose status field the deployment reads."
  type        = number
}

variable "live_github_token" {
  description = "The fine-grained personal access token of test_owner that the live suite acts on the test repository with; see docs/development/live-tests.md for its permissions."
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

variable "demo_neon_api_key" {
  description = "The Neon API key the demo seeding workflow deletes the live tests' projects with, written into the `demo` environment. For now the same key as NEON_API_KEY, which Terraform itself uses."
  type        = string
  sensitive   = true
}

variable "approver" {
  description = "The GitHub user who approves each run in the `live` and `demo` environments, as their required reviewer (#262)."
  type        = string
  default     = "csillagu"
}

variable "require_approval" {
  description = "Whether each run in the `live` and `demo` environments waits for the approver's approval. GitHub's free plan refuses a required reviewer on a private repository, so set it to false only to apply against a private one (#242, #262)."
  type        = bool
  default     = true
}
