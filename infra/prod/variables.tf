variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
  sensitive   = true
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "southeastasia"
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "transformlit"
}

variable "postgres_admin_user" {
  description = "PostgreSQL admin username"
  type        = string
  default     = "pgadmin"
}

variable "postgres_admin_password" {
  description = "PostgreSQL admin password"
  type        = string
  sensitive   = true
}

variable "postgres_sku" {
  description = "PostgreSQL SKU"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage in MB"
  type        = number
  default     = 32768
}

variable "container_api_min_replicas" {
  description = "Min replicas for API container"
  type        = number
  default     = 1
}

variable "container_web_min_replicas" {
  description = "Min replicas for web container"
  type        = number
  default     = 0
}

variable "domain_name" {
  description = "Custom domain for the app"
  type        = string
}

variable "jwt_secret" {
  description = "JWT signing secret"
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT refresh token secret"
  type        = string
  sensitive   = true
}

variable "google_client_id" {
  description = "Google OAuth client ID"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "acs_email_sender" {
  description = "Sender email for Azure Communication Services"
  type        = string
  default     = "noreply@transformlit.com"
}

variable "tags" {
  description = "Azure resource tags"
  type        = map(string)
  default     = {}
}

variable "ghcr_owner" {
  description = "GitHub Container Registry owner"
  type        = string
  default     = "transformlit"
}
