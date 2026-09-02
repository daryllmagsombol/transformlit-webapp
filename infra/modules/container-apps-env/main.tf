variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "log_analytics_workspace_id" { type = string }
variable "tags" { type = map(string); default = {} }

resource "azurerm_container_app_environment" "this" {
  name                       = var.name
  location                   = var.location
  resource_group_name        = var.resource_group_name
  log_analytics_workspace_id = var.log_analytics_workspace_id

  tags = var.tags
}

output "id" { value = azurerm_container_app_environment.this.id }
output "name" { value = azurerm_container_app_environment.this.name }
output "default_domain" { value = azurerm_container_app_environment.this.default_domain }
