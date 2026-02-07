# Azure deploy secrets

This repo includes `.github/workflows/azure-appservice.yml`.

## GitHub repo secrets

Add these secrets:

- `AZURE_WEBAPP_NAME`
  - Your Azure App Service name (e.g. `nl-verkeer-prod`)
- `AZURE_WEBAPP_PUBLISH_PROFILE`
  - The full XML publish profile
  - Azure Portal → App Service → **Get publish profile**

## GHCR container registry

The workflow builds and pushes a container image to **GHCR**:

- `ghcr.io/<owner>/<repo>:<sha>` and `:latest`

By default, GitHub Packages may be private. If your Azure Web App can’t pull the image, set the package visibility to **Public** in GitHub (Package settings), or configure the Web App with GHCR credentials.

Then push to `main`.
