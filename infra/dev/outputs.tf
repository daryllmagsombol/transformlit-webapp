output "api_url" {
  value = module.container_app_api.latest_revision_fqdn
}

output "web_url" {
  value = module.container_app_web.latest_revision_fqdn
}
