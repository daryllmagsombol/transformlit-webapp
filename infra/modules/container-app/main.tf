variable "name" { type = string }
variable "resource_group_name" { type = string }
variable "environment_id" { type = string }
variable "image" { type = string }
variable "target_port" { type = number; default = 3005 }
variable "min_replicas" { type = number; default = 0 }
variable "max_replicas" { type = number; default = 3 }
variable "cpu" { type = number; default = 0.5 }
variable "memory" { type = string; default = "1Gi" }

variable "env_vars" { type = map(string); default = {} }
variable "secret_env_vars" { type = map(string); default = {}; sensitive = true }

variable "ingress_enabled" { type = bool; default = true }
variable "allow_insecure" { type = bool; default = false }
variable "custom_domain" { type = string; default = "" }

variable "identity_ids" { type = list(string); default = [] }
variable "tags" { type = map(string); default = {} }

resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.environment_id
  revision_mode                = "Single"

  identity {
    type         = var.identity_ids != [] ? "UserAssigned" : "SystemAssigned"
    identity_ids = var.identity_ids
  }

  dynamic "secret" {
    for_each = var.secret_env_vars
    content {
      name  = secret.key
      value = secret.value
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = var.name
      image  = var.image
      cpu    = var.cpu
      memory = var.memory

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name        = env.key
          secret_name = env.key
        }
      }
    }
  }

  ingress {
    external_enabled = var.ingress_enabled
    target_port      = var.target_port
    transport        = "auto"
    allow_insecure_connections = var.allow_insecure

    dynamic "traffic_weight" {
      for_each = var.ingress_enabled ? [1] : []
      content {
        percentage      = 100
        latest_revision = true
      }
    }
  }

  tags = var.tags
}

output "name" { value = azurerm_container_app.this.name }
output "id" { value = azurerm_container_app.this.id }
output "latest_revision_fqdn" { value = azurerm_container_app.this.latest_revision_fqdn }
