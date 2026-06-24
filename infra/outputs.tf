output "resource_group_name" {
  value = module.resource_group.name
}

output "postgres_fqdn" {
  value = module.postgresql.fqdn
}

output "storage_account_name" {
  value = module.blob_storage.account_name
}

output "container_app_api_name" {
  value = module.container_app_api.name
}

output "container_app_web_name" {
  value = module.container_app_web.name
}

output "key_vault_name" {
  value = module.key_vault.name
}

output "app_insights_key" {
  value     = module.monitoring.instrumentation_key
  sensitive = true
}
