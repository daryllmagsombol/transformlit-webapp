variable "name" { type = string }
variable "resource_group_name" { type = string }
variable "sender_email" { type = string }
variable "tags" { type = map(string); default = {} }

resource "azurerm_email_communication_service" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  data_location       = "United States"

  tags = var.tags
}

resource "azurerm_email_communication_service_domain" "this" {
  name               = "AzureManagedDomain"
  email_service_id   = azurerm_email_communication_service.this.id
  domain_management  = "AzureManaged"
}

output "service_id" { value = azurerm_email_communication_service.this.id }
output "domain_verification_records" {
  value = azurerm_email_communication_service_domain.this.verification_records
}
