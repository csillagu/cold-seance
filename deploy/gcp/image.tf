# The digest the image's tag points to on ghcr.io now, looked up at each plan with the registry
# token, so that `terraform apply` deploys the latest image: the registry proxy would keep serving
# the version of a tag it fetched first.

data "http" "ghcr_pull_token" {
  url = "https://ghcr.io/token?service=ghcr.io&scope=repository:${var.image}:pull"
  request_headers = {
    Authorization = "Basic ${base64encode("${var.github_owner}:${var.ghcr_token}")}"
  }
}

data "http" "image_manifest" {
  url    = "https://ghcr.io/v2/${var.image}/manifests/${var.image_tag}"
  method = "HEAD"
  request_headers = {
    Authorization = "Bearer ${jsondecode(data.http.ghcr_pull_token.response_body).token}"
    Accept        = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
  }

  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "ghcr.io did not find ${var.image}:${var.image_tag} with the registry token (status ${self.status_code})."
    }
  }
}

locals {
  image_digest = data.http.image_manifest.response_headers["Docker-Content-Digest"]
}
