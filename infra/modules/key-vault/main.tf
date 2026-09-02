variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tenant_id" { type = string }
variable "tags" { type = map(string); default = {} }

resource "azurerm_key_vault" "this" {
  name                       = var.name
  location                   = var.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = var.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7

  tags = var.tags
}

resource "azurerm_key_vault_secret" "db_connection" {
  name         = "database-url"
  value        = var.db_connection_string
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_secret" "jwt_secret" {
  name         = "jwt-secret"
  value        = var.jwt_secret
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_secret" "jwt_refresh_secret" {
  name         = "jwt-refresh-secret"
  value        = var.jwt_refresh_secret
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_secret" "google_client_id" {
  name         = "google-client-id"
  value        = var.google_client_id
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_secret" "google_client_secret" {
  name         = "google-client-secret"
  value        = var.google_client_secret
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_secret" "storage_connection" {
  name         = "storage-connection-string"
  value        = var.storage_connection_string
  key_vault_id = azurerm_key_vault.this.id
}

variable "db_connection_string" { type = string; sensitive = true }
variable "jwt_secret" { type = string; sensitive = true }
variable "jwt_refresh_secret" { type = string; sensitive = true }
variable "google_client_id" { type = string; default = "" }
variable "google_client_secret" { type = string; sensitive = true; default = "" }
variable "storage_connection_string" { type = string; sensitive = true }

output "name" { value = azurerm_key_vault.this.name }
output "id" { value = azurerm_key_vault.this.id }
output "uri" { value = azurerm_key_vault.this.vault_uri }
