# ── Dev Environment ──────────────────────────────────────────────────────────

data "azurerm_client_config" "current" {}

module "resource_group" {
  source   = "../modules/resource-group"
  name     = "rg-${var.project_name}-${var.environment}"
  location = var.location
  tags     = var.tags
}

module "monitoring" {
  source              = "../modules/monitoring"
  name                = "appi-${var.project_name}-${var.environment}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = var.tags
}

module "postgresql" {
  source              = "../modules/postgresql"
  name                = "psql-${var.project_name}-${var.environment}"
  location            = var.location
  resource_group_name = module.resource_group.name
  admin_user          = var.postgres_admin_user
  admin_password      = var.postgres_admin_password
  sku                 = var.postgres_sku
  storage_mb          = var.postgres_storage_mb
  database_name       = "${var.project_name}-${var.environment}"
  tags                = var.tags
}

module "blob_storage" {
  source              = "../modules/blob-storage"
  name                = "st${var.project_name}${var.environment}"
  location            = var.location
  resource_group_name = module.resource_group.name
  tags                = var.tags
}

module "container_apps_env" {
  source                       = "../modules/container-apps-env"
  name                         = "cae-${var.project_name}-${var.environment}"
  location                     = var.location
  resource_group_name          = module.resource_group.name
  log_analytics_workspace_id   = module.monitoring.log_analytics_workspace_id
  tags                         = var.tags
}

module "container_app_api" {
  source = "../modules/container-app"

  name                = "ca-${var.project_name}-api-${var.environment}"
  resource_group_name = module.resource_group.name
  environment_id      = module.container_apps_env.id

  image        = "ghcr.io/${var.ghcr_owner}/transformlit-api:latest"
  target_port  = 3005
  min_replicas = var.container_api_min_replicas
  max_replicas = 3
  cpu          = 0.5
  memory       = "1Gi"

  ingress_enabled = true

  env_vars = {
    PORT              = "3005"
    CORS_ORIGIN       = "https://${var.domain_name}"
    NEXT_PUBLIC_API_URL = "https://${var.domain_name}/graphql"
  }

  secret_env_vars = {
    DATABASE_URL                    = module.postgresql.connection_string
    JWT_SECRET                      = var.jwt_secret
    JWT_REFRESH_SECRET              = var.jwt_refresh_secret
    AZURE_STORAGE_CONNECTION_STRING = module.blob_storage.connection_string
    GOOGLE_CLIENT_ID                = var.google_client_id
    GOOGLE_CLIENT_SECRET            = var.google_client_secret
  }

  tags = var.tags
}

module "container_app_web" {
  source = "../modules/container-app"

  name                = "ca-${var.project_name}-web-${var.environment}"
  resource_group_name = module.resource_group.name
  environment_id      = module.container_apps_env.id

  image        = "ghcr.io/${var.ghcr_owner}/transformlit-web:latest"
  target_port  = 3000
  min_replicas = var.container_web_min_replicas
  max_replicas = 3
  cpu          = 0.5
  memory       = "1Gi"

  ingress_enabled = true

  env_vars = {
    NEXT_PUBLIC_API_URL = "https://${var.domain_name}/graphql"
    NEXT_PUBLIC_WS_URL  = "wss://${var.domain_name}/graphql"
  }

  tags = var.tags
}

module "key_vault" {
  source                    = "../modules/key-vault"
  name                      = "kvtransformlit${var.environment}"
  location                  = var.location
  resource_group_name       = module.resource_group.name
  tenant_id                 = data.azurerm_client_config.current.tenant_id
  db_connection_string      = module.postgresql.connection_string
  jwt_secret                = var.jwt_secret
  jwt_refresh_secret        = var.jwt_refresh_secret
  google_client_id          = var.google_client_id
  google_client_secret      = var.google_client_secret
  storage_connection_string = module.blob_storage.connection_string
  tags                      = var.tags
}

module "communication_services" {
  source              = "../modules/communication-services"
  name                = "acs-${var.project_name}-${var.environment}"
  resource_group_name = module.resource_group.name
  sender_email        = var.acs_email_sender
  tags                = var.tags
}
