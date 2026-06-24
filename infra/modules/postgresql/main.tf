variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "admin_user" { type = string }
variable "admin_password" { type = string; sensitive = true }
variable "sku" { type = string; default = "B_Standard_B1ms" }
variable "storage_mb" { type = number; default = 32768 }
variable "database_name" { type = string; default = "transformlit" }
variable "tags" { type = map(string); default = {} }

resource "azurerm_postgresql_flexible_server" "this" {
  name                   = var.name
  resource_group_name    = var.resource_group_name
  location               = var.location
  administrator_login    = var.admin_user
  administrator_password = var.admin_password
  sku_name               = var.sku
  storage_mb             = var.storage_mb
  version                = "16"

  public_network_access_enabled = true

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

output "fqdn" {
  value = azurerm_postgresql_flexible_server.this.fqdn
}

output "connection_string" {
  value     = "postgresql://${var.admin_user}:${var.admin_password}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${var.database_name}?sslmode=require"
  sensitive = true
}
