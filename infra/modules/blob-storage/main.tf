variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tags" { type = map(string); default = {} }

resource "azurerm_storage_account" "this" {
  name                     = var.name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  tags = var.tags
}

resource "azurerm_storage_container" "pdfs" {
  name                  = "pdfs"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "uploads" {
  name                  = "uploads"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "covers" {
  name                  = "covers"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

output "account_name" { value = azurerm_storage_account.this.name }
output "primary_key" {
  value     = azurerm_storage_account.this.primary_access_key
  sensitive = true
}
output "connection_string" {
  value     = azurerm_storage_account.this.primary_connection_string
  sensitive = true
}
