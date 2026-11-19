# The project's test deployment on Google Cloud Run and Neon (SC-125, DD-062). The owner applies it from
# their own machine; see "Test deployment on Google Cloud" in the README.
terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.18"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.6"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.gcp_project
  region  = var.region
}

# The Neon API key is read from the environment variable NEON_API_KEY.
provider "neon" {}

# The GitHub token Terraform sets up the test repository's webhook and the `live` environment with
# is read from the environment variable GITHUB_TOKEN; see the README for what it needs.
provider "github" {
  owner = var.github_owner
}
