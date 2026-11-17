# The project's test deployment on Google Cloud and Neon (SC-125, DD-062). The owner applies it from
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
  }
}

provider "google" {
  project = var.gcp_project
  region  = local.region
  zone    = var.zone
}

# The Neon API key is read from the environment variable NEON_API_KEY.
provider "neon" {}
