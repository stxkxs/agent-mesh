terraform {
  required_version = ">= 1.10.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.72"
    }
    azapi = {
      source  = "azure/azapi"
      version = "~> 2.9"
    }
  }
}
